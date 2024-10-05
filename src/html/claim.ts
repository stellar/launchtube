import { error, html, RequestLike } from "itty-router";

export async function htmlClaim(req: RequestLike, env: Env, _ctx: ExecutionContext) {
    if (req.query.code && !await env.CODES.get<Uint8Array>(req.query.code))
        return error(401, 'Invalid code')

    return html(`
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Claim Launchtube Token</h1>
            <form method="POST" action="/claim">
                <p>
                    <label for="consent">Agree to <a href="/terms-and-conditions">T&C</a>:</label>
                    <input type="checkbox" id="consent" name="consent" required>
                </p>
                <p>
                    <label for="code">Code:</label>
                    <input type="text" id="code" name="code" value="${req.query.code || ''}" placeholder="Your claim code" required>
                </p>
                <button type="submit">Claim</button>
            </form>
        </body>
        </html>
    `)
}