import { verify } from "@tsndr/cloudflare-worker-jwt"
import { error, html, RequestLike } from "itty-router"

export async function htmlActivate(req: RequestLike, env: Env, _ctx: ExecutionContext) {
    if (req.query.token && !await verify(req.query.token, env.JWT_SECRET, { throwError: true }))
        return error(401, 'Invalid token')

    return html(`
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Activate Launchtube Token</h1>
            <form method="POST" action="/activate">
                <p>
                    <label for="consent">Agree to <a href="/terms-and-conditions" target="_blank" rel="nofollow">T&C</a>:</label>
                    <input type="checkbox" id="consent" name="consent" required>
                </p>
                <p>
                    <label for="token">Token:</label>
                    <input type="text" id="token" name="token" value="${req.query.token || ''}" placeholder="Your Launchtube token" required>
                </p>
                <div id="bonus">
                    <p style="margin: 0;" id="exp"></p>
                    <p style="margin: 0;" id="credits"></p>
                    <br/>
                </div>
                <button type="submit">Activate</button>
            </form>
            <script>
                const bonus = document.querySelector('#bonus');

                onKeyup(document.querySelector('#token').value)
                document.querySelector('#token').addEventListener('keyup', (e) => onKeyup(e.target.value))

                function onKeyup(value) {
                    try {
                        const [,payload] = value.split('.')
                        const decoded = JSON.parse(atob(payload))
                        document.querySelector('#exp').textContent = 'Expires: ' + new Date(decoded.exp * 1000).toLocaleString()
                        document.querySelector('#credits').textContent = 'XLM: ' + (decoded.credits / 10_000_000).toLocaleString()
                        bonus.style.display = 'block'
                    } catch {
                        document.querySelector('#exp').textContent = ''
                        document.querySelector('#credits').textContent = ''
                        bonus.style.display = 'none'
                    }
                }
            </script>
        </body>
        </html>
    `)
}