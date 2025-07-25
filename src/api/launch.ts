import { BASE_FEE, Keypair, xdr, Transaction, Operation, Address, StrKey, TransactionBuilder } from "@stellar/stellar-sdk/minimal"
import { json } from "itty-router"
import { object, string, preprocess, array, ZodIssueCode, boolean, enum as zenum } from "zod"
import { simulateTransaction, sendTransaction, EAGER_CREDITS, SEQUENCER_ID_NAME } from "../common"
import { CreditsDurableObject } from "../credits"
import { getMockData, arraysEqualUnordered, checkAuth, getRpc } from "../helpers"
import { SequencerDurableObject } from "../sequencer"

// NOTE using a higher base fee than "100" to try and counter some fee errors I was seeing
// const MIN_FEE = "100000";

export async function apiLaunch(request: Request, env: Env, _ctx: ExecutionContext) {
    let sequencerStub: DurableObjectStub<SequencerDurableObject> | undefined
    let sequenceSecret: string | undefined

    try {
        const payload = await checkAuth(request, env)

        let res: any
        let credits: number

        // TODO I don't think we need auth and func. It turns out there is an Operation XDR
        // e.g. AAAAAAAAABgAAAADAAAAAAAAAAAAAAAAtC+Cy5aKws4APbaA0DzN6v4Tf7tWQukK+itwh8JhHin70zOJBhMoSsobZiuaHtaLgtggZq1RhInV3qIJ+U5gwAAAAAB9D3lsa8kksiN/XFgciTSXj+AmLKgcLW36cA/H4l58+QAAAAYAAAASAAAAAAAAAACO+drsns+C8ivJ7BbEvGPuuaf+RI7JYRYQh3tTDoG6yAAAAA4AAAANQWkgTWVtZSBUb2tlbgAAAAAAAA4AAAAGQUlNRU1FAAAAAAADAAAABwAAAAoAAAAAAAAAAAAAAAAAAABFAAAACgAAAAAAAAAAAAAAAAAKookAAAAA

        const now = Math.floor(Date.now() / 1000)
        const formData = await request.formData() as FormData
        const schema = object({
            mock: zenum(['xdr', 'op']).optional(),
            sim: preprocess(
                (val) => val ? val === 'true' : true,
                boolean().optional()
            ),
            xdr: string().optional(),
            func: string().optional(),
            auth: preprocess(
                (val) => val ? JSON.parse(val as string) : undefined,
                array(string()).optional()
            ),
            // fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)).optional(),
        }).superRefine((input, ctx) => {
            if (input.mock) {
                if (input.sim === false && input.mock !== 'xdr')
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: 'Cannot pass `sim = false` without `mock = xdr`'
                    })
                else if (input.xdr || input.func || input.auth)
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: 'Cannot pass `mock` with `xdr`, `func`, or `auth`'
                    })
            }

            else {
                if (input.sim === false && !input.xdr)
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: 'Cannot pass `sim = false` without `xdr`'
                    })
                else if (!input.xdr && !input.func && !input.auth)
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: 'Must pass either `xdr` or `func` and `auth`'
                    })
                else if (input.xdr && (input.func || input.auth))
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: '`func` and `auth` must be omitted when passing `xdr`'
                    })
                else if (!input.xdr && !(input.func && input.auth))
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: '`func` and `auth` are both required when omitting `xdr`'
                    })
            }
        })

        const debug = formData.get('debug')
        const mock = formData.get('mock') as string | null
        const isMock = env.ENV === 'development' && mock && ['xdr', 'op'].includes(mock)
        const rpc = getRpc(env)

        let {
            xdr: x,
            func: f,
            auth: a,
            // fee,
            sim,
        } = Object.assign(
            isMock ? await getMockData(env, rpc, formData) : {},
            schema.parse(Object.fromEntries(formData))
        )

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
        let op: Operation | undefined
        let func: xdr.HostFunction
        let auth: xdr.SorobanAuthorizationEntry[] | undefined
        let fee = Number(BASE_FEE) * 2 + 2

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
            func = op.func
            auth = op.auth
        }

        // Passing `func` and `auth`
        else if (f && a) {
            func = xdr.HostFunction.fromXDR(f, 'base64')
            auth = a.map((auth) => xdr.SorobanAuthorizationEntry.fromXDR(auth, 'base64'))
        }

        else
            throw 'Invalid request'

        if (
            func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()
            && func.switch() !== xdr.HostFunctionType.hostFunctionTypeCreateContractV2()
        ) throw 'Operation func must be of type `hostFunctionTypeInvokeContract`'

        // Do a full audit of the auth entries
        for (const a of auth || []) {
            switch (a.credentials().switch()) {
                case xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount():
                    // If we're simulating we must error on `sorobanCredentialsSourceAccount`
                    // This is due to simulation rebuilding the transaction. Any borrowed signature is incredibly unlikely to succeed
                    if (sim) {
                        sim = false
                        // throw 'Set `sim = false` to use `sorobanCredentialsSourceAccount`'
                    }

                    // Ensure if we're using invoker auth it's not the sequence account
                    else if (
                        tx?.source === sequencePubkey
                        || op?.source === sequencePubkey
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
                    minTime: now,
                    maxTime: now + 30 // +{x} seconds (also change the poll interval)
                },
                memo: tx?.memo,
                minAccountSequence: tx?.minAccountSequence,
                minAccountSequenceAge: tx?.minAccountSequenceAge,
                minAccountSequenceLedgerGap: tx?.minAccountSequenceLedgerGap,
                extraSigners: tx?.extraSigners,
            })
                .addOperation(Operation.invokeHostFunction({
                    func,
                    auth,
                    source: op?.source,
                }))
                .build()

            const { result, transactionData } = await simulateTransaction(rpc, transaction)

            /*
                - Check that we have the right auth
                    The transaction ops before simulation and after simulation should be identical
                    Submitted ops should already be entirely valid thus simulation shouldn't alter them in any way
            */
            if (!arraysEqualUnordered(
                auth?.map((a) => a.toXDR('base64')) || [],
                result?.auth.map((a) => a.toXDR('base64')) || []
            )) throw 'Auth invalid'

            // HOTFIX(s) for KALE `plant`
            try {
                const invokeContract = func.invokeContract()
                const contract = StrKey.encodeContract(invokeContract.contractAddress().contractId())
                // const function_name = invokeContract.functionName().toString()

                if (
                    contract === 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA'
                    // && function_name === 'plant'
                ) {
                    // if (
                    //     env.ENV === 'production'
                    //     && !request.headers.get('X-Client-Name')
                    //     && !request.headers.get('x-client-name')
                    // ) {
                    //     throw 'Missing `X-Client-Name` header. Please update your farming client to the latest version.'
                    // }

                    // restrict KALE contract to minimum fee
                    fee = Number(BASE_FEE) * 2 + 1
                }
            } catch {}

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
                    // const sorobanDataResource = sorobanData.resources()

                    resourceFee = sorobanData.resourceFee().toBigInt()
                    transaction = tx

                    if ((BigInt(tx.fee)) > (resourceFee + 201n)) {
                        throw 'Transaction fee must be equal to the resource fee'
                    }

                    if ((Number(tx.timeBounds?.maxTime) - now) > 30) {
                        throw 'Transaction `timeBounds.maxTime` too far into the future. Must be no greater than 30 seconds'
                    }

                    // Gut check the transaction to ensure it's valid
                    // const { transactionData } = await simulateTransaction(env, transaction)
                    // const simTxDataResource = transactionData.build().resources()

                    // if (
                    //     sorobanDataResource.readBytes() < simTxDataResource.readBytes()
                    //     || sorobanDataResource.writeBytes() < simTxDataResource.writeBytes()
                    // ) {
                    //     throw {
                    //         message: 'Transaction resource usage is greater than the simulated resource usage',
                    //         resourceFee: `${resourceFee} vs ${transactionData.build().resourceFee().toBigInt()}`,
                    //         instructions: `${sorobanDataResource.instructions()} vs ${simTxDataResource.instructions()}`,
                    //         readBytes: `${sorobanDataResource.readBytes()} vs ${simTxDataResource.readBytes()}`,
                    //         writeBytes: `${sorobanDataResource.writeBytes()} vs ${simTxDataResource.writeBytes()}`,
                    //         envelopeXdr: transaction.toXDR(),
                    //     }
                    // }

                    break;
                default:
                    throw 'Invalid transaction envelope type'
            }
        }

        else {
            throw 'Invalid request'
        }

        // It should just assume the xdr fee
        // if (!fee) {
            // try {
            //     const { sorobanInclusionFee } = await rpc.getFeeStats()

            //     fee = Number(sorobanInclusionFee.p50 || BASE_FEE)
            //     fee = Math.max(fee, Number(BASE_FEE))
            // } catch (err: any) {
            //     if (typeof err !== 'string') {
            //         err.rpc = rpc.serverURL.toString()
            //         err.message = `getFeeStats error ${err.rpc}`
            //     }

            //     console.error(err);

            //     fee = Number(MIN_FEE)
            // }

            // // Increase the fee by a random number from 1 through the `BASE_FEE` just to ensure we're not underpaying
            // // and because Stellar doesn't seem to like when too many transactions with the same inclusion fee are being submitted
            // fee += getRandomNumber(1, Number(BASE_FEE));

            // // Double because we're wrapping the tx in a fee bump so we'll need to pay for both
            // fee = fee * 2

            // let fee = Number(BASE_FEE) * 2 + 1
        // } else {
            // Adding 1 to the fee to ensure when we divide / 2 later we don't go below the minimum fee
            // Double because we're wrapping the tx in a fee bump so we'll need to pay for both
            // fee = (fee + 1) * 2
        // }

        if (debug) return json({
            xdr: x,
            func: f,
            auth: a,
            // fee,
        })

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
            if (err?.feeCharged)
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