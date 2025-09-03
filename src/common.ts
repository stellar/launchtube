import { Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk/minimal";
import { wait } from "./helpers";
import { SequencerDurableObject } from "./sequencer";
import { Api, type Server } from "@stellar/stellar-sdk/rpc";

export const MAX_U32 = 2 ** 32 - 1
export const SEQUENCER_ID_NAME = 'Test Launchtube ; June 2024'
export const EAGER_CREDITS = 100_000

export async function simulateTransaction(rpc: Server, tx: Transaction | FeeBumpTransaction) {
    return rpc.simulateTransaction(tx)
        .then(async (res) => {
            // TODO support Restore scenarios
            if (Api.isSimulationRestore(res))
                throw {
                    ...(await rpc._simulateTransaction(tx)),
                    message: 'Restore flow not yet supported. Please report this issue with this response. https://github.com/stellar/launchtube/issues',
                    type: 'simulate',
                }

            else if (Api.isSimulationSuccess(res))
                return res

            else {
                const { events, error, ...rest } = res

                delete (rest as { _parsed?: boolean })._parsed;

                throw {
                    ...rest,
                    type: 'simulate',
                    error,
                    envelopeXdr: tx.toXDR(),
                    events: events.map((event) => event.toXDR('base64')),
                }
            }
        })
        .catch((err) => {
            if (typeof err !== 'string') {
                err = {
                    ...err,
                    type: 'simulate',
                    rpc: rpc.serverURL.toString()
                }
            }

            throw err
        })
}

export async function sendTransaction(rpc: Server, tx: Transaction | FeeBumpTransaction) {
    const xdr = tx.toXDR()

    return rpc.sendTransaction(tx)
        .then(({ status, hash, errorResult, diagnosticEvents, ...rest }) => {
            if (status === 'PENDING')
                return pollTransaction(rpc, hash, xdr)
            else {
                throw {
                    type: 'send',
                    rpc: rpc.serverURL.toString(),
                    status,
                    hash,
                    envelopeXdr: xdr,
                    errorResult: errorResult?.toXDR('base64'),
                    diagnosticEvents: diagnosticEvents?.map((event) => event.toXDR('base64')),
                    ...rest
                }
            }
        })
        .catch((err) => {
            if (typeof err !== 'string') {
                err.rpc = err?.rpc || rpc.serverURL.toString()
            }

            throw err
        })
}

async function pollTransaction(rpc: Server, hash: string, xdr: string, interval = 2) {
    await wait(interval * 1000); // exponential backoff
    interval *= 2;

    const result = await rpc
        .getTransaction(hash)
        .catch((err) => {
            if (typeof err !== 'string') {
                err.rpc = err?.rpc || rpc.serverURL.toString()
            }

            throw err
        })

    if (result.status === 'SUCCESS') {
        delete (result as { events?: any }).events;

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
            rpc: rpc.serverURL.toString(),
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

    else if (interval > 16) { // 2+4+8+16 = 30 seconds
        const { status, ...rest } = result

        throw {
            type: 'send',
            rpc: rpc.serverURL.toString(),
            status,
            hash,
            envelopeXdr: xdr,
            ...rest
        }
    }

    return pollTransaction(rpc, hash, xdr, interval)
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
            const [p, s] = key.split(':');
            console.log(`Returning ${p} sequence`);
            await sequencerStub.returnSequence(s);
        }
    }
}