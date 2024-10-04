import { html } from 'itty-router';
import qr from 'qr-image'
import { checkSudoAuth, parseCookies } from '../helpers';

export async function apiQrCode(request: Request, env: Env, ctx: ExecutionContext) {
    try {
        await checkSudoAuth(request, env)
    } catch {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = parseCookies(cookieHeader);
        const authKey = cookies['authKey'];

        if (authKey) try {
            await checkSudoAuth(decodeURIComponent(authKey), env)
        } catch {
            return html(htmlCode)
        } else {
            return html(htmlCode)
        }
    }

    const url = new URL(request.url)
    const code = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    const data = `${url.origin}/claim?code=${code}`
    const qrcode = qr.imageSync(data, {
        ec_level: 'H',
        type: 'png',
        size: 12,
        margin: 1,
        parse_url: true
    });

    await env.CODES.put(code, Buffer.alloc(1), { expirationTtl: 604_800 }); // 1 week

    return new Response(qrcode, {
        headers: {
            'Content-Type': 'image/png',
            'X-Claim-Code': code
        }
    })
}

const htmlCode = `
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <p>
                <label for="key">Key:</label>
                <input type="text" id="key" name="key" placeholder="Your auth key" required>
            </p>
            <button>Save and Refresh</button>

            <script>
                document.querySelector('button').addEventListener('click', () => {
                    const key = document.querySelector('input').value;
                    document.cookie = \`authKey=\${encodeURIComponent(key)}; path=/qrcode; max-age=604800; SameSite=Strict; Secure\`;
                    window.location.reload();
                });
            </script>
        </body>
    </html>
`
