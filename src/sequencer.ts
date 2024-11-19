import { Keypair, Operation, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk/minimal";
import { DurableObject } from "cloudflare:workers";
import { getAccount, sendTransaction } from "./common";
import { addUniqItemsToArray, wait } from "./helpers";

export class SequencerDurableObject extends DurableObject<Env> {
    private ready: boolean = true
    private queue: string[] = []

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    public async getData() {
        const index = await this.ctx.storage.get<number>('index') || 0
        const pool = await this.ctx.storage.list<Date>({ prefix: 'pool:' })
        const field = await this.ctx.storage.list<Date>({ prefix: 'field:' })

        // TODO need to return the dates as well, the values

        return {
            ready: this.ready,
            queue: this.queue,
            index,
            poolCount: pool.size,
            fieldCount: field.size,
            pool,
            field,
        }
    }
    public async queueSequences(count: number) {
        let i = 0

        while (i < count) {
            await this.queueSequence()
            i++
        }

        return this.pollSequence()
    }
    public async getSequence(): Promise<string> {
        const items = await this.ctx.storage.list<Date>({ prefix: 'pool:', limit: 1 })

        if (items.size <= 0)
            throw 'Too many transactions queued. Please try again later'

        const [[key]] = items.entries()
        const sequenceSecret = key.split(':')[1]

        this.ctx.storage.delete(`pool:${sequenceSecret}`)
        this.ctx.storage.put(`field:${sequenceSecret}`, new Date())

        return sequenceSecret
    }
    public async deleteSequence(sequence: string) {
        this.ctx.storage.delete(`field:${sequence}`)
        this.ctx.storage.delete(`pool:${sequence}`)
    }
    public async returnSequence(sequence: string) {
        this.ctx.storage.delete(`field:${sequence}`)
        this.ctx.storage.put(`pool:${sequence}`, new Date())
    }

    // e.g. scenario
    // 100 requests for new sequences comes in
    // All are queued up and begin to wait
    // Once the fund account is ready the first 25 are taken from the queue
    // A transaction is created to create the accounts and submitted
    // In case of success or failure we need to communicate that back to the 25 pending requests
    // Repeat taking the next batch of queued sequences 

    private async queueSequence() {
        if (this.queue.length >= 25)
            throw 'Too many sequences queued. Please try again later'

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

        this.queue = addUniqItemsToArray(this.queue, sequenceSecret)

        await this.ctx.storage.put('index', index + 1)
    }
    private async pollSequence(interval = 0): Promise<void> {
        if (this.ready) {
            if (interval >= 30)
                throw 'Sequencer transaction timed out. Please try again'
            else if (this.queue.length >= 1)
                this.createSequences(this.queue.splice(0, 25))
            else 
                return
        }

        interval++
        await wait()
        return this.pollSequence(interval)
    }
    private async createSequences(queue: string[]) {
        try {
            this.ready = false

            const fundKeypair = Keypair.fromSecret(this.env.FUND_SK)
            const fundPubkey = fundKeypair.publicKey()
            const fundSource = await getAccount(this.env, fundPubkey)

            let transaction: TransactionBuilder | Transaction = new TransactionBuilder(fundSource, {
                fee: (100_000).toString(),
                networkPassphrase: this.env.NETWORK_PASSPHRASE,
            })

            for (const sequence of queue) {
                transaction
                    .addOperation(Operation.createAccount({
                        destination: Keypair.fromSecret(sequence).publicKey(),
                        startingBalance: '1'
                    }))
            }

            transaction = transaction
                .setTimeout(60)
                .build()

            transaction.sign(fundKeypair)

            await sendTransaction(this.env, transaction)

            // If we fail here we'll lose the sequence keypairs. Keypairs should be derived so they can always be recreated
            for (const sequenceSecret of queue) {
                this.ctx.storage.put(`field:${sequenceSecret}`, new Date())
            }
        } catch (err: any) {
            console.error(err);
            await wait(5000);
        } finally {
            this.ready = true
        }
    }
}