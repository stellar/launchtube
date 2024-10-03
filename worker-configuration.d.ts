// Generated by Wrangler by running `wrangler types`

interface Env {
	SUDOS: KVNamespace;
	CODES: KVNamespace;
	RPC_URLS: string;
	NETWORK_PASSPHRASE: string;
	MOCK_SK: string;
	NATIVE_CONTRACT_ID: string;
	FUND_SK: string;
	JWT_SECRET: string;
	ENV: string;
	CREDITS_DURABLE_OBJECT: DurableObjectNamespace<import("./dist/index").CreditsDurableObject>;
	SEQUENCER_DURABLE_OBJECT: DurableObjectNamespace<import("./dist/index").SequencerDurableObject>;
	DB: D1Database;
}
