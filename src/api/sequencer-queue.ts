import { RequestLike, status } from "itty-router";
import { SEQUENCER_ID_NAME } from "../common";
import { SequencerDurableObject } from "../sequencer";
import { checkSudoAuth } from "../helpers";

export async function apiSequencerQueue(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    let { count = 1 } = request.query

    const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
    const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

    await sequencerStub.queueSequences(count)

    return status(204)
}