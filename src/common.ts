import { Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk/minimal";
import { getRpc, wait } from "./helpers";
import { SequencerDurableObject } from "./sequencer";
import { Api, Server } from "@stellar/stellar-sdk/rpc";

export const MAX_U32 = 2 ** 32 - 1
export const SEQUENCER_ID_NAME = 'Test Launchtube ; June 2024'
export const EAGER_CREDITS = 100_000

export async function simulateTransaction(env: Env, tx: Transaction | FeeBumpTransaction) {
    const rpc = getRpc(env)

    return rpc.simulateTransaction(tx)
        .then(async (res) => {
            // TODO support Restore scenarios
            if (Api.isSimulationRestore(res))
                throw {
                    ...(await rpc._simulateTransaction(tx)),
                    type: 'simulate',
                    rpc: rpc.serverURL,
                    error: 'Restore flow not yet supported. Please report this issue with this response. https://github.com/stellar/launchtube/issues',
                }

            else if (Api.isSimulationSuccess(res))
                return res

            else {
                const { events, error, ...rest } = res

                delete (rest as { _parsed?: boolean })._parsed;

                throw {
                    type: 'simulate',
                    rpc: rpc.serverURL,
                    error,
                    envelopeXdr: tx.toXDR(),
                    events: events.map((event) => event.toXDR('base64')),
                    ...rest,
                }
            }
        })
}

export async function sendTransaction(env: Env, tx: Transaction | FeeBumpTransaction) {
    const rpc = getRpc(env)
    const xdr = tx.toXDR()

    return rpc.sendTransaction(tx)
        .then(({ status, hash, errorResult, diagnosticEvents, ...rest }) => {
            if (status === 'PENDING')
                return pollTransaction(env, rpc, hash, xdr)
            else {
                throw {
                    type: 'send',
                    rpc: rpc.serverURL,
                    status,
                    hash,
                    envelopeXdr: xdr,
                    errorResult: errorResult?.toXDR('base64'),
                    diagnosticEvents: diagnosticEvents?.map((event) => event.toXDR('base64')),
                    ...rest
                }   
            }
        })
}

async function pollTransaction(env: Env, rpc: Server, hash: string, xdr: string, interval = 0) {
    const result = await rpc.getTransaction(hash)

    // console.log(interval, result.status);

    if (result.status === 'SUCCESS') {
        const { status, envelopeXdr, resultXdr, resultMetaXdr, diagnosticEventsXdr, returnValue, ...rest } = result

        return {
            status,
            hash,
            feeCharged: Number(resultXdr.feeCharged().toBigInt()),
            envelopeXdr: envelopeXdr.toXDR('base64'),
            resultXdr: resultXdr.toXDR('base64'),
            resultMetaXdr: resultMetaXdr.toXDR('base64'),
            returnValue: returnValue?.toXDR('base64'),
            diagnosticEventsXdr: diagnosticEventsXdr?.map((event) => event.toXDR('base64')),
            ...rest
        }
    }

    else if (result.status === 'FAILED') {
        const { status, envelopeXdr, resultXdr, resultMetaXdr, diagnosticEventsXdr, ...rest } = result

        throw {
            type: 'send',
            rpc: rpc.serverURL,
            status,
            hash,
            feeCharged: Number(resultXdr.feeCharged().toBigInt()),
            envelopeXdr: envelopeXdr.toXDR('base64'),
            resultXdr: resultXdr.toXDR('base64'),
            resultMetaXdr: resultMetaXdr.toXDR('base64'),
            diagnosticEventsXdr: diagnosticEventsXdr?.map((event) => event.toXDR('base64')),
            ...rest
        }
    }

    else if (interval >= 30) {
        const { status, ...rest } = result

        throw {
            type: 'send',
            rpc: rpc.serverURL,
            status,
            hash,
            envelopeXdr: xdr,
            ...rest
        }
    }

    interval++
    await wait()
    return pollTransaction(env, rpc, hash, xdr, interval)
}

export async function returnAllSequence(env: Env) {
    // TODO the fact we need this because regularly sequence accounts are not being returned is concerning to me

    const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
    const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;
    const rawData = await sequencerStub.getData()

    for (const [key, date] of rawData.field.entries()) {
        if (
            typeof date === 'boolean'
            || Date.now() - await date.getTime() > 60 * 1000 * 5 // 5 minutes
        ) {
            const [, s] = key.split(':')
            await sequencerStub.returnSequence(s)
        }
    }
}