import { SorobanRpc, xdr, Keypair, Account, Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk/minimal";
import { getRpc, wait } from "./helpers";

export const MAX_U32 = 2 ** 32 - 1
export const SEQUENCER_ID_NAME = 'Test Launchtube ; June 2024'
export const EAGER_CREDITS = 100_000

export async function getAccount(env: Env, publicKey: string) {
    const rpc = getRpc(env)

    return rpc.getLedgerEntries(
        xdr.LedgerKey.account(
            new xdr.LedgerKeyAccount({
                accountId: Keypair.fromPublicKey(publicKey).xdrPublicKey()
            })
        )
    ).then(({ entries }) => {
        if (!entries.length)
            throw `Account ${publicKey} not found`

        return new Account(publicKey, entries[0].val.account().seqNum().toString()) 
    })
}

export async function simulateTransaction(env: Env, tx: Transaction | FeeBumpTransaction) {
    const rpc = getRpc(env)

    return rpc.simulateTransaction(tx)
    .then((res) => {
        if (SorobanRpc.Api.isSimulationSuccess(res))
            return res
        
        // TODO support Restore scenarios
        else if (SorobanRpc.Api.isSimulationRestore(res)) {
            throw rpc._simulateTransaction(tx)
        }

        else {
            const { error, events, ...rest } = res

            throw {
                error,
                events: events.map((event) => event.toXDR('base64')),
                ...rest
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
        else
            throw {
                status,
                hash,
                envelopeXdr: xdr,
                errorResult: errorResult?.toXDR('base64'),
                diagnosticEvents: diagnosticEvents?.map((event) => event.toXDR('base64')),
                ...rest
            }
    })
}

async function pollTransaction(env: Env, rpc: SorobanRpc.Server, hash: string, xdr: string, interval = 0) {
    const result = await rpc.getTransaction(hash)

    console.log(interval, result.status);

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