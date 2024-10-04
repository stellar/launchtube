import { BASE_FEE, Keypair, xdr, Transaction, Operation, Address, StrKey, TransactionBuilder } from "@stellar/stellar-sdk/minimal";
import { RequestLike, json } from "itty-router"
import { object, string, preprocess, array, number, ZodIssueCode } from "zod"
import { getAccount, simulateTransaction, sendTransaction, MAX_U32, EAGER_CREDITS, SEQUENCER_ID_NAME } from "../common"
import { CreditsDurableObject } from "../credits"
import { getMockData, arraysEqualUnordered, checkAuth, getRpc } from "../helpers"
import { SequencerDurableObject } from "../sequencer"

export async function apiLaunch(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const payload = await checkAuth(request, env)

    let res: any
    let credits: number
    let sequencerId: DurableObjectId
    let sequencerStub: DurableObjectStub<SequencerDurableObject> | undefined
    let sequenceSecret: string | undefined

    try {
        const formData = await request.formData() as FormData
        const schema = object({
            xdr: string().optional(),
            func: string().optional(),
            auth: preprocess(
                (val) => val ? JSON.parse(val as string) : undefined,
                array(string()).optional()
            ),
            fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)).optional(),
        }).superRefine((input, ctx) => {
            if (!input.xdr && !input.func && !input.auth)
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
        })

        const mock = (formData.get('mock') || "") as "xdr" | "op" | ""
        const isMock = ['xdr', 'op'].includes(mock)

        let {
            xdr: x,
            func: f,
            auth: a,
            fee,
        } = schema.parse(
            isMock && env.ENV === 'development'
                ? await getMockData(env, mock, formData) // Only ever mock in development
                : Object.fromEntries(formData)
        )
        
        if (!fee) {
            try {
                const { sorobanInclusionFee } = await getRpc(env).getFeeStats()
                fee = parseInt(sorobanInclusionFee.p50 || BASE_FEE)
                fee = Math.max(fee, Number(BASE_FEE))
            } catch {
                fee = Number(BASE_FEE)
            }

            // Adding 1 to the fee to ensure when we divide / 2 later in launchtube we don't go below the minimum fee
            // Double because we're wrapping the tx in a fee bump so we'll need to pay for both
            fee = (fee + 1) * 2
        }

        const debug = formData.get('debug') === 'true'

        if (debug)
            return json({ xdr: x, func: f, auth: a, fee })

        const creditsId = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub!)
        const creditsStub = env.CREDITS_DURABLE_OBJECT.get(creditsId) as DurableObjectStub<CreditsDurableObject>;

        // Spend some initial credits before doing any work as a spam prevention measure. These will be refunded if the transaction succeeds
        // TODO at some point we should decide if the failure was user error or system error and refund the credits in case of system error
        credits = await creditsStub.spendBefore(EAGER_CREDITS)

        sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
        sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;
        sequenceSecret = await sequencerStub.getSequence()

        const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
        const sequencePubkey = sequenceKeypair.publicKey()
        const sequenceSource = await getAccount(env, sequencePubkey)

        let func: xdr.HostFunction
        let auth: xdr.SorobanAuthorizationEntry[] | undefined

        // Passing `xdr`
        if (x) {
            const t = new Transaction(x, env.NETWORK_PASSPHRASE)

            if (t.operations.length !== 1)
                throw 'Must include only one Soroban operation'

            for (const op of t.operations) {
                if (op.type !== 'invokeHostFunction')
                    throw 'Must include only one operation of type `invokeHostFunction`'
            }

            const op = t.operations[0] as Operation.InvokeHostFunction

            func = op.func
            auth = op.auth
        }

        // Passing `func` and `auth`
        else if (f && a) {
            func = xdr.HostFunction.fromXDR(f, 'base64')
            auth = a?.map((auth) => xdr.SorobanAuthorizationEntry.fromXDR(auth, 'base64'))
        }

        else
            throw 'Invalid request'

        if (func.switch().name !== 'hostFunctionTypeInvokeContract')
            throw 'Operation func must be of type `hostFunctionTypeInvokeContract`'

        // Do a full audit of the auth entries
        for (const a of auth || []) {
            switch (a.credentials().switch().name) {
                case 'sorobanCredentialsSourceAccount':
                    throw '`sorobanCredentialsSourceAccount` credentials are not supported'
                case 'sorobanCredentialsAddress':
                    // Check to ensure the auth isn't using any system addresses
                    if (a.credentials().address().address().switch().name === 'scAddressTypeAccount') {
                        const pk = a.credentials().address().address().accountId()

                        if (
                            pk.switch().name === 'publicKeyTypeEd25519'
                            && Address.account(pk.ed25519()).toString() === sequencePubkey
                        ) throw '`scAddressTypeAccount` credentials are invalid'
                    }
                    break;
                default:
                    throw 'Invalid credentials'
            }
        }

        const invokeContract = func.invokeContract()
        const contract = StrKey.encodeContract(invokeContract.contractAddress().contractId())

        let transaction = new TransactionBuilder(sequenceSource, {
            fee: '0',
            networkPassphrase: env.NETWORK_PASSPHRASE
        })
            .addOperation(Operation.invokeContractFunction({
                contract,
                function: invokeContract.functionName().toString(),
                args: invokeContract.args(),
                auth
            }))
            .setTimeout(5 * 60)
            .build()

        transaction.sign(sequenceKeypair)

        const { result, transactionData } = await simulateTransaction(env, transaction)

        /* NOTE
            - Check that we have the right auth
                The transaction ops before simulation and after simulation should be identical
                Submitted ops should already be entirely valid thus simulation shouldn't alter them in any way
        */
        if (!arraysEqualUnordered(
            (transaction.operations[0] as Operation.InvokeHostFunction).auth?.map((a) => a.toXDR('base64')) || [],
            result?.auth.map((a) => a.toXDR('base64')) || []
        )) throw 'Invalid auth'

        const sorobanData = transactionData.build()
        const resourceFee = sorobanData.resourceFee().toBigInt()

        /* NOTE 
            Divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
            Note the fee is also part of the divide by 2 which means this will be the max in addition to the resource fee you'll pay for both the inner fee and the fee-bump combined
            https://github.com/stellar/js-stellar-base/issues/749
            https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
            https://discord.com/channels/897514728459468821/1245935726424752220
        */
        const feeBumpFee = (BigInt(fee) + resourceFee) / 2n

        transaction = TransactionBuilder
            .cloneFrom(transaction, {
                fee: resourceFee.toString(), // NOTE inner tx fee cannot be less than the resource fee or the tx will be invalid
                sorobanData
            })
            .build()

        transaction.sign(sequenceKeypair)

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

        res = await sendTransaction(env, feeBumpTransaction)

        // Refund the bid credits and spend the actual fee credits
        credits = await creditsStub.spendAfter(
            feeBumpTransaction.hash().toString('hex'),
            res.feeCharged,
            bidCredits
        )
    } finally {
        // if this fails we'd lose the sequence keypair. Fine because sequences are derived and thus re-discoverable
        if (sequencerStub && sequenceSecret)
            await sequencerStub.returnSequence(sequenceSecret)
    }

    return json(res, {
        headers: {
            'X-Credits-Remaining': credits.toString(),
        }
    })
}