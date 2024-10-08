import { sign } from "@tsndr/cloudflare-worker-jwt"
import { RequestLike, error, html } from "itty-router"
import { CreditsDurableObject } from "../credits"

export async function apiTokenClaim(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const body = await request.formData()
    const consent = body.get('consent') === 'on'
    const code = body.get('code')

    if (!consent)
        return error(400, 'Consent required')

    const { value, metadata } = await env.CODES.getWithMetadata<{ ttl: number, credits: number }>(code, 'arrayBuffer')

    if (!value || !metadata)
        return error(401, 'Invalid code')

    await env.CODES.delete(code)

    const id = env.CREDITS_DURABLE_OBJECT.newUniqueId();
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;
    const ttl = metadata.ttl
    const credits = metadata.credits
    const token = await sign({
        sub: id.toString(),
        exp: Math.floor((Date.now() + ttl * 1000) / 1000),
        credits,
    }, env.JWT_SECRET)

    await stub.init(ttl, credits);
    await stub.activate();

    return html(`
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Token Claimed!</h1>
            <pre><code>${token}</code></pre>
            <p style="margin: 0;" id="exp"></p>
            <p style="margin: 0;" id="credits"></p>
            <br/>
            <button type="submit">Copy</button>
            <script>
                const token = document.querySelector('code').textContent

                parseToken(token)
                document.querySelector('button').addEventListener('click', () => copyToClipboard(token))

                function parseToken(value) {
                    const [,payload] = value.split('.')
                    const decoded = JSON.parse(atob(payload))
                    document.querySelector('#exp').textContent = 'Expires: ' + new Date(decoded.exp * 1000).toLocaleString()
                    document.querySelector('#credits').textContent = 'XLM: ' + (decoded.credits / 10_000_000).toLocaleString()
                }
                function copyToClipboard(text) {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        return navigator.clipboard.writeText(text).then(() => {
                            console.log('Text copied to clipboard!');
                        }).catch((err) => {
                            console.error('Failed to copy text to clipboard:', err);
                        });
                    } else {
                        const textarea = document.createElement('textarea');

                        textarea.value = text;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.focus();
                        textarea.select();

                        try {
                            const successful = document.execCommand('copy');

                            if (successful) {
                                console.log('Text copied to clipboard!');
                            } else {
                                console.error('Failed to copy text using execCommand.');
                            }
                        } catch (err) {
                            console.error('Failed to copy text using execCommand:', err);
                        }

                        document.body.removeChild(textarea);
                    }
                }
            </script>
            <style>
                pre {
                    max-width: 500px;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                }
            </style>
        </body>
        </html>
    `)
}