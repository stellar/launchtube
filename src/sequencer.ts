import { Keypair, Operation, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk/minimal";
import { DurableObject } from "cloudflare:workers";
import { sendTransaction } from "./common";
import { getRpc } from "./helpers";

export class SequencerDurableObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    public async getData() {
        const index = await this.ctx.storage.get<number>('index') || 0
        const pool = await this.ctx.storage.list<Date>({ prefix: 'pool:' })
        const field = await this.ctx.storage.list<Date>({ prefix: 'field:' })

        // TODO need to return the dates as well, the values

        return {
            index,
            poolCount: pool.size,
            fieldCount: field.size,
            pool,
            field,
        }
    }
    public async fullFlush() {
        await this.ctx.storage.deleteAll()
        await this.ctx.storage.deleteAlarm()
    }
    public async getSequence(): Promise<string> {
        // I need to test if it's possible to get the first item in the list more than once in times of concurrent requests
        // Did this. We're good.
        const items = await this.ctx.storage.list<Date>({ prefix: 'pool:', limit: 1 })

        if (items.size <= 0)
            throw 'Too many transactions queued. Please try again later'

        const [[key]] = items.entries()
        const sequenceSecret = key.split(':')[1]

        await this.ctx.storage.delete(`pool:${sequenceSecret}`)
        await this.ctx.storage.put(`field:${sequenceSecret}`, new Date())

        return sequenceSecret
    }
    public async deleteSequence(sequence: string) {
        await this.ctx.storage.delete(`field:${sequence}`)
        await this.ctx.storage.delete(`pool:${sequence}`)
    }
    public async returnSequence(sequence: string) {
        await this.ctx.storage.delete(`field:${sequence}`)
        await this.ctx.storage.put(`pool:${sequence}`, new Date())
    }

    public async createSequences(count: number) {
        try {
            const queue: string[] = []

            const fundKeypair = Keypair.fromSecret(this.env.FUND_SK)
            const fundPubkey = fundKeypair.publicKey()

            const sequenceSecret = await this.getSequence()
            const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
            const sequencePubkey = sequenceKeypair.publicKey()
            const sequenceSource = await getRpc(this.env).getAccount(sequencePubkey)

            let transaction: TransactionBuilder | Transaction = new TransactionBuilder(sequenceSource, {
                fee: (100_000).toString(),
                networkPassphrase: this.env.NETWORK_PASSPHRASE,
            })

            for (let i = 0; i < count; i++) {
                const index = await this.ctx.storage.get<number>('index') || 0
                const indexBuffer = Buffer.alloc(4);

                indexBuffer.writeUInt32BE(index);

                // Seed new sequences in a reproducible way so we can always recreate them to recoup "lost" accounts
                const sequenceBuffer = Buffer.concat([
                    StrKey.decodeEd25519SecretSeed(this.env.FUND_SK),
                    indexBuffer
                ])
                const sequenceSeed = await crypto.subtle.digest({ name: 'SHA-256' }, sequenceBuffer);
                const sequenceKeypair = Keypair.fromRawEd25519Seed(Buffer.from(sequenceSeed))
                const sequenceSecret = sequenceKeypair.secret()

                queue.push(sequenceSecret)

                await this.ctx.storage.put('index', index + 1)

                transaction
                    .addOperation(Operation.createAccount({
                        destination: sequenceKeypair.publicKey(),
                        startingBalance: '1',
                        source: fundPubkey
                    }))
            }

            transaction = transaction
                .setTimeout(30)
                .build()

            transaction.sign(sequenceKeypair, fundKeypair)

            const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
                fundKeypair,
                transaction.fee,
                transaction,
                this.env.NETWORK_PASSPHRASE
            )
        
            feeBumpTransaction.sign(fundKeypair)

            const send_res = await sendTransaction(this.env, feeBumpTransaction)

            // If we fail here we'll lose the sequence keypairs. Keypairs should be derived so they can always be recreated
            for (const sequenceSecret of queue) {
                this.ctx.storage.put(`pool:${sequenceSecret}`, new Date())
            }

            return send_res;
        } catch (err: any) {
            // TODO seem to be getting some odd TRY_AGAIN_LATER errors here
            // Occasionally it'll work though. Idk why.

            console.error(err);
            throw err
        }
    }
}