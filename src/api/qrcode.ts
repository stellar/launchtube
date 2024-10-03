import { RequestLike, error } from 'itty-router';
import qr from 'qr-image'
import { checkSudoAuth } from '../helpers';

export async function apiQrCode(request: RequestLike, env: Env, ctx: ExecutionContext) {
    await checkSudoAuth(request, env)

    const url = new URL(request.url)
    const code = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    const data = `${url.origin}/claim?code=${code}`
    const qrcode = qr.imageSync(data, {
        ec_level: 'H',
        type: 'png',
        size: 4,
        margin: 1,
        parse_url: true
    });

    await env.CODES.put(code, Buffer.alloc(1), { expirationTtl: 604_800 }); // 1 week

    return new Response(qrcode, {
        headers: {
            'Content-Type': 'image/png'
        }
    })
}