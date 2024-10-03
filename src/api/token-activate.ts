import { RequestLike, error, html } from "itty-router"
import { CreditsDurableObject } from "../credits"
import { checkAuth } from "../helpers"

export async function apiTokenActivate(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const body = await request.formData()
    const consent = body.get('consent') === 'on'
    const token = body.get('token')

    if (!consent)
        return error(400, 'Consent required')

    const payload = await checkAuth(token, env)

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub!)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    await stub.activate()

    return html(`
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Token Activated!</h1>
        </body>
        </html>
    `)
}