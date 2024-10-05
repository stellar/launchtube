import { error, html, RequestLike } from "itty-router";

export async function htmlClaim(req: RequestLike, env: Env, _ctx: ExecutionContext) {
    let bonus = ``

    if (req.query.code) {
        const { value, metadata } = await env.CODES.getWithMetadata<{ ttl: number, credits: number }>(req.query.code, 'arrayBuffer')

        if (!value || !metadata)
            return error(401, 'Invalid code')

        bonus = `
            <p style="margin: 0;" id="exp">${'Expires: ' + new Date(new Date(Date.now() + metadata.ttl * 1000).toISOString()).toLocaleString()}</p>
            <p style="margin: 0;" id="credits">${'XLM: ' + (metadata.credits / 10_000_000).toLocaleString()}</p>
            <br/>
        `
    }

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
                    <label for="consent">Agree to <a href="/terms-and-conditions" target="_blank" rel="nofollow">T&C</a>:</label>
                    <input type="checkbox" id="consent" name="consent" required>
                </p>
                <p>
                    <label for="code">Code:</label>
                    <input type="text" id="code" name="code" value="${req.query.code || ''}" placeholder="Your claim code" required>
                </p>
                <div id="bonus">
                    ${bonus}
                </div>
                <button type="submit">Claim</button>
            </form>
            <script>
                const code = "${req.query.code}";
                const bonus = document.querySelector('#bonus');

                document.querySelector('#code').addEventListener('keyup', (e) => onKeyup(e.target.value));

                function onKeyup(value) {
                    if (value === code) {
                        bonus.style.display = 'block'
                    } else {
                        bonus.style.display = 'none'
                    }
                }
            </script>
        </body>
        </html>
    `)
}