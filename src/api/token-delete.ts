import { RequestLike, text } from "itty-router";
import { CreditsDurableObject } from "../credits";
import { checkSudoAuth } from "../helpers";

export async function apiTokenDelete(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(request.params.sub)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    await stub.delete()

    return text('OK')
}