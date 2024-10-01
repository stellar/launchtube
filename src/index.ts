import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, cors, error, html, withParams, RequestLike } from 'itty-router'
import { apiLaunch } from "./api/launch";
import { apiSequencerInfo } from "./api/sequencer-info";
import { apiTokenInfo } from "./api/token-info";
import { apiTokenDelete } from "./api/token-delete";
import { apiTokensGenerate } from "./api/tokens-generate";
import { apiSql } from "./api/sql";
import { apiTokenActivate } from "./api/token-activate";
import { verify } from "@tsndr/cloudflare-worker-jwt";
import { apiSequencerQueue } from "./api/sequencer-queue";

const { preflight, corsify } = cors()
const router = IttyRouter()

/* TODO
	- Likely need some rate limiting around here
		Throttle on dupe params
		Throttle on sequence creation
		Eager credit spending may be a sufficient deterrent
	- Support generic transaction fee bumping?
		Currently Launchtube only supports contract invocation operations
		I think folks will want this, otherwise they'll need to maintain both Soroban submission flows and Classic submission flows
			No XLM needed for Soroban
			XLM needed for Stellar
			Bit of an oof
		At the very least we should support all the Soroban ops incl. `Operation.ExtendFootprintTTL` and `Operation.RestoreFootprint`
*/

router
	.options('*', preflight)
	.all('*', withParams)
	// Public endpoints
	.get('/', async (req: RequestLike, env: Env, _ctx: ExecutionContext) => {
		if (!await verify(req.query.token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		return html(`
			<h1>Activate Launchtube Token</h1>
			<form method="POST" action="/activate">
				<p>
					<label for="consent">Agree to <a href="/terms-and-conditions">T&C</a>:</label>
					<input type="checkbox" id="consent" name="consent" required>
				</p>
				<p>
					<label for="token">Token:</label>
					<input type="text" id="token" name="token" value="${req.query.token || ''}" required>
				</p>
				<p style="margin: 0;" id="exp"></p>
				<p style="margin: 0;" id="credits"></p>
				<br/>
				<button type="submit">Activate</button>
			</form>
			<script>
				onKeyup(document.querySelector('#token').value)
				document.querySelector('#token').addEventListener('keyup', (e) => onKeyup(e.target.value))

				function onKeyup(value) {
					try {
						const [,payload] = value.split('.')
						const decoded = JSON.parse(atob(payload))
						document.querySelector('#exp').textContent = 'Expires: ' + new Date(decoded.exp * 1000).toLocaleString()
						document.querySelector('#credits').textContent = 'XLM: ' + decoded.credits / 10_000_000
					} catch {
						document.querySelector('#exp').textContent = ''
						document.querySelector('#credits').textContent = ''					 
					}
				}
			</script>
		`)
	})
	.get('/terms-and-conditions', () => {
		return html(`
			<h1>Launchtube Terms & Conditions</h1>
			<div style="max-width: 600px;">
				<p>The Stellar Development Foundation (SDF) is providing token credits to developers building on the Stellar smart contracts platform Soroban.</p>
				<p>These token credits are not transferred to the developer but instead are provided as credits to be used exclusively to pay for Stellar network transaction fees, and are not to be used for any other purpose.</p>
				<p>The redemption period and value of the token credits will be determined by the SDF in our sole discretion and will be automatically reflected in the developer's Launchtube account on activation.</p>
				<p>By clicking activate, you agree to the SDF's <a href="https://stellar.org/terms-of-service">Terms of Service</a> and <a href="https://stellar.org/privacy-policy">Privacy Policy</a>, and agree that SDF in its sole discretion may revoke access to, withdraw or discontinue these token credits at any time, for any reason.</p>
			</div>
		`)
	})
	.post('/activate', apiTokenActivate)
	.get('/info', apiTokenInfo)
	.post('/', apiLaunch)
	// Private endpoints
	.get('/gen', apiTokensGenerate)
	.delete('/:sub', apiTokenDelete)
	.post('/seq', apiSequencerQueue)
	.get('/seq', apiSequencerInfo)
	.post('/sql', apiSql)
	// ---
	.all('*', () => error(404))

const handler = {
	fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(req, env, ctx)
			.catch((err) => {
				console.error(err);
				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof Error ? err?.message : err
				)
			})
			.then((r) => corsify(r, req))
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}