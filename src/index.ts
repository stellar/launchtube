import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { MonitorDurableObject } from "./monitor";
import { IttyRouter, cors, error, withParams } from 'itty-router'
import { apiLaunch } from "./api/launch";
import { apiSequencerInfo } from "./api/sequencer-info";
import { apiTokenInfo } from "./api/token-info";
import { apiTokenDelete } from "./api/token-delete";
import { apiTokensGenerate } from "./api/tokens-generate";
// import { apiSql } from "./api/sql";
import { apiTokenActivate } from "./api/token-activate";
import { apiSequencerCreate } from "./api/sequencer-create";
import { htmlTermsAndConditions } from "./html/terms-and-conditions";
import { htmlActivate } from "./html/activate";
import { apiQrCode } from "./api/qrcode";
import { htmlClaim } from "./html/claim";
import { apiTokenClaim } from "./api/token-claim";
import { ZodError } from "zod";
import { returnAllSequence, SEQUENCER_ID_NAME } from "./common";
import { StrKey, xdr } from "@stellar/stellar-sdk/minimal";
import { apiTokenGet } from "./api/token-get";
import { apiLaunchV2 } from "./api/launch-v2";

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
	.post('/v2', apiLaunchV2)
	.get('/terms-and-conditions', htmlTermsAndConditions)
	.get('/activate', htmlActivate)
	.post('/activate', apiTokenActivate)
	.get('/claim', htmlClaim)
	.post('/claim', apiTokenClaim)
	.get('/info', apiTokenInfo)
	// Private endpoints
	.get('/qrcode', apiQrCode)
	.get('/gen', apiTokensGenerate)
	.get('/seq', apiSequencerInfo)
	.post('/seq', apiSequencerCreate)
	// .post('/sql', apiSql)
	.get('/:sub', apiTokenGet)
	.delete('/:sub', apiTokenDelete)
	// ---
	.all('*', () => error(404))

const handler = {
	fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(req, env, ctx)
			.catch(async (err) => {
				if (
					err?.type !== 'simulate'
					&& err !== 'No credits left'
					&& err?.message !== 'No credits left'
				) {
					if (typeof err !== 'string') {
						let message = err?.message || ''

						if (err?.status) {
							message += ` ${err.status}`
						}

						if (err?.errorResult || err?.resultXdr) {
							const txres = xdr.TransactionResult.fromXDR(err.errorResult || err.resultXdr, 'base64');
							const result = txres?.result()?.innerResultPair()?.result()?.result();

							switch (result?.switch()) {
								case xdr.TransactionResultCode.txFailed():
									message += ' ' + result?.results()?.[0]?.tr()?.invokeHostFunctionResult()?.switch()?.name || ''
									break;
								case xdr.TransactionResultCode.txBadSeq():
									const name = result?.switch()?.name || '';
									const tx = xdr.TransactionEnvelope.fromXDR(err.envelopeXdr, 'base64');

									// TEST if the error is a sequence error check if the source account is one of our sequence accounts
									if (name === 'txBadSeq') {
										const source = await new Promise<string>((resolve) => {
											let source: Buffer | undefined;

											try {
												source = tx.v0().tx().sourceAccountEd25519()
											} catch {
												try {
													source = tx.v1().tx().sourceAccount().ed25519()
												} catch {
													try {
														source = tx.feeBump().tx().innerTx().v1().tx().sourceAccount().ed25519()
													} catch { }
												}
											}

											if (source) {
												resolve(StrKey.encodeEd25519PublicKey(source))
											} else {
												resolve('')
											}
										})

										message += ` ${name} ${source}`
									} else {
										message += ` ${name}`
									}
									break;
							}
						}

						if (err?.rpc) {
							message += ` ${err.rpc}`
						}

						message = message.trim()

						console.error({
							...err,
							message,
							clientName: req.headers.get('X-Client-Name') || req.headers.get('x-client-name') || 'Unknown',
						});

						const monitorId = env.MONITOR_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
						const monitorStub = env.MONITOR_DURABLE_OBJECT.get(monitorId) as DurableObjectStub<MonitorDurableObject>;

						if (
							!message.includes('try again later')
							&& !message.includes('equal to the resource fee')
							&& !message.includes('no greater than 30 seconds')
						) {
							ctx.waitUntil(monitorStub.bumpErrorCount());
						}
					} else {
						console.error(err);
					}
				}

				if (err?.rpc)
					delete err.rpc;
				if (err?.sim)
					delete err.sim;
				if (err?.sub)
					delete err.sub;

				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof ZodError
						? err
						: err instanceof Error
							? err?.message || err
							: err
				)
			})
			.then((res) => corsify(res, req)),

	scheduled: (
		_ctrl: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	) => ctx.waitUntil(returnAllSequence(env)),
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	MonitorDurableObject,
	handler as default
}