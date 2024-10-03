import { html, RequestLike } from "itty-router";

export async function htmlClaim(req: RequestLike, _env: Env, _ctx: ExecutionContext) {
    return html(`
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
            <br/>
            <button type="submit">Claim</button>
        </form>
        <script>
            
        </script>
    `)
}