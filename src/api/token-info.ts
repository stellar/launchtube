import { RequestLike, json } from "itty-router"
import { CreditsDurableObject } from "../credits"
import { checkAuth } from "../helpers"

export async function apiTokenInfo(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const payload = await checkAuth(request, env)

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub!)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    const info = await stub.info()

    return json(info)
}