import { RequestLike, json } from "itty-router";
import { object, preprocess, number, boolean } from "zod";
import { CreditsDurableObject } from "../credits";
import { sign } from "@tsndr/cloudflare-worker-jwt";
import { checkSudoAuth } from "../helpers";

export async function apiTokensGenerate(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    let ttl, credits, count, init = false;

    if (env.ENV === 'development') {
        ttl = 7_257_600 // 12 weeks (3 months)
        credits = 100 * 10_000_000 // 100 XLM
        count = 1
    } else {
        await checkSudoAuth(request, env)

        const body = object({
            ttl: preprocess(Number, number()),
            xlm: preprocess(Number, number().gte(1).lte(10_000)),
            count: preprocess(Number, number().gte(1).lte(100)),
            init: preprocess(Boolean, boolean()).optional().default(false)
        }).parse(request.query)
    
        ttl = body.ttl
        credits = body.xlm * 10_000_000
        count = body.count
        init = body.init
    }

    const tokens = []

    while (count--) {
        const id = env.CREDITS_DURABLE_OBJECT.newUniqueId();
        const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;
        const token = await sign({
            sub: id.toString(),
            exp: Math.floor((Date.now() + ttl * 1000) / 1000),
            credits,
        }, env.JWT_SECRET)

        await stub.init(ttl, credits, init);

        tokens.push(token)
    }

    return json(tokens)
}