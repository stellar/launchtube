import { json, RequestLike } from "itty-router";
import { object, string, preprocess, array } from "zod";
import { checkSudoAuth } from "../helpers";

export async function apiSql(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    const body = object({
        query: string(),
        args: preprocess(
            (val) => val ? JSON.parse(val as string) : undefined,
            array(string()).optional()
        )
    });

    let { query, args } = body.parse(Object.fromEntries(await request.formData()))

    let results = []

    if (args) {
        const { results: r } = await env.DB.prepare(query)
            .bind(...args)
            .all();

        results = r
    } else {
        const { results: r } = await env.DB.prepare(query)
            .all();

        results = r
    }

    return json(results)
}