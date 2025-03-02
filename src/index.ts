import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, cors, error, withParams } from 'itty-router'
import { apiLaunch } from "./api/launch";
import { apiSequencerInfo } from "./api/sequencer-info";
import { apiTokenInfo } from "./api/token-info";
import { apiTokenDelete } from "./api/token-delete";
import { apiTokensGenerate } from "./api/tokens-generate";
import { apiSql } from "./api/sql";
import { apiTokenActivate } from "./api/token-activate";
import { apiSequencerQueue } from "./api/sequencer-queue";
import { htmlTermsAndConditions } from "./html/terms-and-conditions";
import { htmlActivate } from "./html/activate";
import { apiQrCode } from "./api/qrcode";
import { htmlClaim } from "./html/claim";
import { apiTokenClaim } from "./api/token-claim";
import { ZodError } from "zod";
import { returnAllSequence } from "./common";
import { xdr } from "@stellar/stellar-sdk/minimal";

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
	.get('/', () => new Response(null, {
		status: 307,
		headers: {
			'Location': 'https://github.com/stellar/launchtube'
		}
	}))
	.post('/', apiLaunch)
	.get('/terms-and-conditions', htmlTermsAndConditions)
	.get('/activate', htmlActivate)
	.post('/activate', apiTokenActivate)
	.get('/claim', htmlClaim)
	.post('/claim', apiTokenClaim)
	.get('/info', apiTokenInfo)
	// Private endpoints
	.get('/qrcode', apiQrCode)
	.get('/gen', apiTokensGenerate)
	.delete('/:sub', apiTokenDelete)
	.get('/seq', apiSequencerInfo)
	.post('/seq', apiSequencerQueue)
	.post('/sql', apiSql)
	// ---
	.all('*', () => error(404))

const handler = {
	fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(req, env, ctx)
			.catch((err) => {
				if (err?.type !== 'simulate') {
					if (typeof err !== 'string') {
						err.message = err?.message || ''
						
						if (err?.status) {
							err.message += ` ${err.status}`
						}

						if (err?.errorResult || err?.resultXdr) {
							const txres = xdr.TransactionResult.fromXDR(err.errorResult || err.resultXdr, 'base64');
							const result = txres?.result()?.innerResultPair()?.result()?.result();
							
							switch (result?.switch()) {
								case xdr.TransactionResultCode.txFailed():
									err.message += ' '+ result?.results()?.[0]?.tr()?.invokeHostFunctionResult()?.switch()?.name || ''
								break;
								case xdr.TransactionResultCode.txBadSeq():
									err.message += ' '+ result?.switch()?.name || ''
								break;
							}
						}

						if (err?.rpc) {
							err.message += ` ${err.rpc}`
						}
					}
					
					console.error(err);
				}

				if (err?.rpc)
					delete err.rpc;
				
				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof ZodError
						? err
						: err instanceof Error
							? err?.message || err
							: err
				)
			})
			.then((r) => corsify(r, req)),

	scheduled: (
		_ctrl: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	) => ctx.waitUntil(returnAllSequence(env)),
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}