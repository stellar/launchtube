import { verify, decode } from "@tsndr/cloudflare-worker-jwt"
import { RequestLike, error, html } from "itty-router"
import { CreditsDurableObject } from "../credits"

export async function apiTokenActivate(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const body = await request.formData()
    const consent = body.get('consent') === 'on'
    const token = body.get('token')

    if (!consent)
        return error(400, 'Consent required')

    if (!await verify(token, env.JWT_SECRET))
        return error(401, 'Unauthorized')

    const { payload } = decode(token)

    if (!payload?.sub)
        return error(401, 'Invalid')

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    await stub.activate()

    return html(`
        <h1>Token Activated!</h1>
    `)
}