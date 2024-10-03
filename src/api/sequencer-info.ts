import { RequestLike, json } from "itty-router";
import { SEQUENCER_ID_NAME } from "../common";
import { SequencerDurableObject } from "../sequencer";
import { Keypair } from "@stellar/stellar-base";
import { checkSudoAuth } from "../helpers";

export async function apiSequencerInfo(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    let { return: rtrn, delete: dlte, shh } = request.query

    const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
    const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

    let data: any = await sequencerStub.getData()

    if (rtrn) {
        let secret

        for (const [key] of data.field) {
            const [, s] = key.split(':')

            if (Keypair.fromSecret(s).publicKey() === rtrn) {
                secret = s
                break;
            }
        }

        if (secret) {
            await sequencerStub.returnSequence(secret)
            data = await sequencerStub.getData()
        }
    } 
    
    else if (dlte) {
        await sequencerStub.deleteSequence(dlte)
        data = await sequencerStub.getData()
    } 
    
    // Utility for special cases to retrieve sequence secrets
    // else if (shh) {
    //     const secrets: string[][] = []

    //     for (const i in new Array(Number(shh)).fill(0)) {
    //         const index = Number(i)
    //         const indexBuffer = Buffer.alloc(4);

    //         indexBuffer.writeUInt32BE(index);

    //         const sequenceBuffer = Buffer.concat([
    //             StrKey.decodeEd25519SecretSeed(env.FUND_SK),
    //             indexBuffer
    //         ])
    //         const sequenceSeed = await crypto.subtle.digest({ name: 'SHA-256' }, sequenceBuffer);
    //         const sequenceKeypair = Keypair.fromRawEd25519Seed(Buffer.from(sequenceSeed))

    //         secrets.push([
    //             sequenceKeypair.publicKey(), 
    //             sequenceKeypair.secret()
    //         ])
    //     }

    //     return json(secrets)
    // }

    // Private endpoint, but still, don't leak secrets
    data = {
        ready: data.ready,
        queue: data.queue.map((key: string) => Keypair.fromSecret(key).publicKey()),
        index: data.index,
        poolCount: data.pool.length,
        fieldCount: data.field.length,
        pool: data.pool.map(([key]: [string]) => Keypair.fromSecret(key.split(':')[1]).publicKey()),
        field: data.field.map(([key]: [string]) => Keypair.fromSecret(key.split(':')[1]).publicKey())
    }

    return json(data)
}