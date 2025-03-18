import { DurableObject } from "cloudflare:workers";

/* NOTE
	- As written you can have credits go into the negative
		I'm okay with that however as there are many checks at various steps in the process
*/

export class CreditsDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	// TODO allow init with pre-activate
	async init(ttl: number, credits: number, init: boolean = false) {
		this.ctx.storage.put('credits', credits);
		this.ctx.storage.setAlarm(Date.now() + ttl * 1000);
		
		if (init) {
			await this.activate()
		}
	}
	async activate() {
		this.ctx.storage.put('activated', true)
	}
	async info() {
		return {
			credits: await this.ctx.storage.get('credits') || 0,
			activated: await this.ctx.storage.get('activated') || false
		}
	}
	async delete() {
		return this.ctx.storage.deleteAll();
	}

	async spendBefore(spend: number, refund: number = 0) {
		if (
			this.env.ENV !== 'development'
			&& !(await this.ctx.storage.get('activated'))
		) throw 'Not activated'

		const existing_credits = (await this.ctx.storage.get<number>('credits') || 0) + refund

		if (existing_credits <= 0) {
			// this.ctx.waitUntil(this.delete())
			throw 'No credits left'
		}

		const now_credits = existing_credits - spend

		await this.ctx.storage.put('credits', now_credits);

		return now_credits
	}
	async spendAfter(tx: string, spend: number, refund: number = 0) {
		if (
			this.env.ENV !== 'development'
			&& !(await this.ctx.storage.get('activated'))
		) throw 'Not activated'

		const existing_credits = (await this.ctx.storage.get<number>('credits') || 0) + refund

		if (existing_credits <= 0) {
			// this.ctx.waitUntil(this.delete())
			throw 'No credits left'
		}

		// Since this method is called after a successful tx send I'm fine not throwing if (now_credits < 0)
		const now_credits = existing_credits - spend

		await this.ctx.storage.put('credits', now_credits);

		// Since metrics aren't critical punt them into the `ctx.waitUntil` 
		const metric = this.env.DB.prepare(`
			INSERT OR IGNORE INTO Transactions (Sub, Tx) 
			VALUES (?1, ?2)
		`)
			.bind(
				this.ctx.id.toString(),
				tx
			)
			.run()

		this.ctx.waitUntil(metric)

		return now_credits
	}

	async alarm() {
		await this.delete();
	}
}