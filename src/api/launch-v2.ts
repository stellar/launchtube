import { BASE_FEE, Keypair, xdr, Transaction, Operation, Address, StrKey, TransactionBuilder } from "@stellar/stellar-sdk/minimal"
import { json } from "itty-router"
import { object, string } from "zod"
import { simulateTransaction, sendTransaction, EAGER_CREDITS, SEQUENCER_ID_NAME } from "../common"
import { CreditsDurableObject } from "../credits"
import { arraysEqualUnordered, checkAuth, getRpc } from "../helpers"
import { SequencerDurableObject } from "../sequencer"

export async function apiLaunchV2(request: Request, env: Env, _ctx: ExecutionContext) {
    let sequencerStub: DurableObjectStub<SequencerDurableObject> | undefined
    let sequenceSecret: string | undefined

    try {
        const payload = await checkAuth(request, env)

        let res: any
        let credits: number

        const now = Math.floor(Date.now() / 1000)
        const formData = await request.formData() as FormData
        const schema = object({
            xdr: string().optional(),
            op: string().optional(),
        }).refine((input) => !(!input.xdr && !input.op), {
            message: 'Must pass either `xdr` or `op`'
        }).refine((input) => !(input.xdr && input.op), {
            message: 'Cannot pass both `xdr` and `op`'
        })

        let {
            xdr: x,
            op: o,
        } = Object.assign(schema.parse(Object.fromEntries(formData)))

        const creditsId = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub!)
        const creditsStub = env.CREDITS_DURABLE_OBJECT.get(creditsId) as DurableObjectStub<CreditsDurableObject>;

        // Spend some initial credits before doing any work as a spam prevention measure. These will be refunded if the transaction succeeds
        // TODO at some point we should decide if the failure was user error or system error and refund the credits in case of system error
        credits = await creditsStub.spendBefore(EAGER_CREDITS)

        const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
        sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;
        sequenceSecret = await sequencerStub.getSequence()

        const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
        const sequencePubkey = sequenceKeypair.publicKey()

        let tx: Transaction | undefined
        let op: Operation.InvokeHostFunction | undefined
        let fee = Number(BASE_FEE) * 2 + 3
        let sim = true

        // Passing `xdr`
        if (x) {
            tx = new Transaction(x, env.NETWORK_PASSPHRASE)

            if (tx.operations.length !== 1)
                throw 'Must include only one Soroban operation'

            for (const op of tx.operations) {
                if (op.type !== 'invokeHostFunction')
                    throw 'Must include only one operation of type `invokeHostFunction`'
            }

            op = tx.operations[0] as Operation.InvokeHostFunction
        }

        // Passing `op`
        else if (o) {
            op = Operation.fromXDRObject(xdr.Operation.fromXDR(o, 'base64')) as Operation.InvokeHostFunction
        }

        else
            throw 'Invalid request'

        if (
            !op
            || (
                op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()
                && op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeUploadContractWasm()
                && op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeCreateContract()
                && op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeCreateContractV2()
            )
        ) throw 'Operation must be of type `hostFunctionTypeInvokeContract`, `hostFunctionTypeUploadContractWasm`, `hostFunctionTypeCreateContract`, or `hostFunctionTypeCreateContractV2`'

        // Do a full audit of the auth entries
        for (const a of op?.auth || []) {
            switch (a.credentials().switch()) {
                case xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount():
                    // If we're borrowing the tx source we cannot simulate
                    // This is due to simulation rebuilding the transaction. Any borrowed signature is incredibly unlikely to succeed
                    sim = false

                    // Ensure if we're using invoker auth it's not the sequence account
                    if (
                        tx?.source === sequencePubkey
                        || op.source === sequencePubkey
                    ) throw '`sorobanCredentialsSourceAccount` is invalid'
                    break;
                case xdr.SorobanCredentialsType.sorobanCredentialsAddress():
                    // Check to ensure the auth isn't using any system addresses
                    if (a.credentials().address().address().switch() === xdr.ScAddressType.scAddressTypeAccount()) {
                        const pk = a.credentials().address().address().accountId()

                        if (
                            pk.switch() === xdr.PublicKeyType.publicKeyTypeEd25519()
                            && Address.account(pk.ed25519()).toString() === sequencePubkey
                        ) throw '`sorobanCredentialsAddress` is invalid'
                    }
                    break;
                default:
                    throw 'Invalid credentials'
            }
        }

        let resourceFee: bigint
        let transaction: Transaction

        const rpc = getRpc(env)

        if (sim) {
            const sequenceSource = await rpc
                .getAccount(sequencePubkey)
                .catch((err) => {
                    if (typeof err !== 'string') {
                        err = {
                            ...err,
                            rpc: rpc.serverURL.toString()
                        }
                    }

                    throw err
                })

            transaction = new TransactionBuilder(sequenceSource, {
                fee: '0',
                networkPassphrase: env.NETWORK_PASSPHRASE,
                ledgerbounds: tx?.ledgerBounds,
                timebounds: tx?.timeBounds || {
                    minTime: 0,
                    maxTime: now + 30 // +{x} seconds (also change the poll interval)
                },
                memo: tx?.memo,
                minAccountSequence: tx?.minAccountSequence,
                minAccountSequenceAge: tx?.minAccountSequenceAge,
                minAccountSequenceLedgerGap: tx?.minAccountSequenceLedgerGap,
                extraSigners: tx?.extraSigners,
            })
                .addOperation(Operation.invokeHostFunction({
                    func: op.func,
                    auth: op.auth,
                    source: op.source,
                }))
                .build()

            const { result, transactionData } = await simulateTransaction(rpc, transaction)

            /*
                - Check that we have the right auth
                    The transaction ops before simulation and after simulation should be identical
                    Submitted ops should already be entirely valid thus simulation shouldn't alter them in any way
            */
            if (!arraysEqualUnordered(
                op.auth?.map((a) => a.toXDR('base64')) || [],
                result?.auth.map((a) => a.toXDR('base64')) || []
            )) throw 'Auth invalid'

            const sorobanData = transactionData.build()

            resourceFee = sorobanData.resourceFee().toBigInt()
            transaction = TransactionBuilder
                .cloneFrom(transaction, {
                    fee: resourceFee.toString(), // NOTE inner tx fee cannot be less than the resource fee or the tx will be invalid
                    sorobanData
                }).build()

            tx?.signatures.forEach((sig) => transaction.addDecoratedSignature(sig));
            transaction.sign(sequenceKeypair)
        }

        else if (tx) {
            switch (tx.toEnvelope().switch()) {
                case xdr.EnvelopeType.envelopeTypeTx():
                    const sorobanData = tx.toEnvelope().v1().tx().ext().sorobanData()

                    resourceFee = sorobanData?.resourceFee().toBigInt() || 0n
                    transaction = tx

                    if ((BigInt(tx.fee)) > (resourceFee + 203n)) {
                        throw 'Transaction fee must be equal to the resource fee'
                    }

                    if ((Number(tx.timeBounds?.maxTime) - now) > 30) {
                        throw 'Transaction `timeBounds.maxTime` too far into the future. Must be no greater than 30 seconds'
                    }

                    // TODO should we cover ledger bounds as well?

                    break;
                default:
                    throw 'Invalid transaction envelope type'
            }
        }

        else {
            throw 'Invalid request'
        }

        // HOTFIX(s) for KALE
        try {
            const invokeContract = op.func.invokeContract()
            const contract = StrKey.encodeContract(invokeContract.contractAddress().contractId() as unknown as Buffer)

            if (contract === 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA') {
    
                // restrict KALE contract to minimum fee
                fee = Number(BASE_FEE) * 2 + 1
            }
        } catch {}

        /* NOTE 
            Divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
            Note the fee is also part of the divide by 2 which means this will be the max in addition to the resource fee you'll pay for both the inner fee and the fee-bump combined
            https://github.com/stellar/js-stellar-base/issues/749
            https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
            https://discord.com/channels/897514728459468821/1245935726424752220
        */
        const feeBumpFee = (BigInt(fee) + resourceFee) / 2n
        
        const fundKeypair = Keypair.fromSecret(env.FUND_SK)
        const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
            fundKeypair,
            feeBumpFee.toString(),
            transaction,
            env.NETWORK_PASSPHRASE
        )

        feeBumpTransaction.sign(fundKeypair)

        const bidCredits = Number(feeBumpTransaction.fee)

        // Refund eager credits and spend the tx bid credits
        credits = await creditsStub.spendBefore(bidCredits, EAGER_CREDITS)

        // Send the transaction
        try {
            res = await sendTransaction(rpc, feeBumpTransaction)
        } catch (err: any) {
            if (err.feeCharged)
                credits = await creditsStub.spendBefore(err.feeCharged, bidCredits)

            throw {
                ...err,
                sim,
                sub: payload.sub,
            }
        }

        // Refund the bid credits and spend the actual fee credits
        credits = await creditsStub.spendAfter(
            feeBumpTransaction.hash().toString('hex'),
            res.feeCharged,
            bidCredits
        )

        console.log({
            ...res,
            clientName: request.headers.get('X-Client-Name') || request.headers.get('x-client-name') || 'Unknown',
        });

        return json(res, {
            headers: {
                'X-Credits-Remaining': credits.toString(),
            }
        })
    } catch (err) {
        throw err
    } finally {
        if (sequencerStub && sequenceSecret)
            await sequencerStub.returnSequence(sequenceSecret)
    }
}