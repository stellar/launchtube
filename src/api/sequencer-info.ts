import { RequestLike, json } from "itty-router";
import { SEQUENCER_ID_NAME } from "../common";
import { SequencerDurableObject } from "../sequencer";
import { Keypair } from "@stellar/stellar-sdk/minimal";
import { checkSudoAuth } from "../helpers";

export async function apiSequencerInfo(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    const { return: rtrn, delete: dlte, flush, shh } = request.query

    const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
    const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

    let rawData = await sequencerStub.getData()

    if (rtrn) {
        for (const [key, date] of rawData.field.entries()) {
            const [, s] = key.split(':')

            if (
                (
                    rtrn === 'all' &&
                    (
                        typeof date === 'boolean'
                        || Date.now() - await date.getTime() > 60 * 1000 * 5 // 5 minutes
                    )
                )
                || rtrn === Keypair.fromSecret(s).publicKey()
            ) await sequencerStub.returnSequence(s)
        }

        rawData = await sequencerStub.getData()
    }

    else if (dlte) {
        await sequencerStub.deleteSequence(dlte)
        rawData = await sequencerStub.getData()
    }

    else if (flush) {
        await sequencerStub.fullFlush()
        rawData = await sequencerStub.getData()
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
    const cleanData = {
        index: rawData.index,
        poolCount: rawData.poolCount,
        fieldCount: rawData.fieldCount,
        pool: rawData.pool.keys().toArray().map((key) => Keypair.fromSecret(key.split(':')[1]).publicKey()),
        field: rawData.field.keys().toArray().map((key) => Keypair.fromSecret(key.split(':')[1]).publicKey())
    }

    return json(cleanData)
}