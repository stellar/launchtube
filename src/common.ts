import { xdr, Keypair, Account } from "@stellar/stellar-base";
import { getRpc, wait } from "./helpers";

/* TODO
    - Add in all the types from stellar-sdk
        Doesn't look like they're exported so we'll need to manually copy that file over
*/

export const MAX_U32 = 2 ** 32 - 1
export const SEQUENCER_ID_NAME = 'Test Launchtube ; June 2024'
export const EAGER_CREDITS = 100_000

export async function getAccount(env: Env, publicKey: string) {
    const rpc = getRpc(env)

    return rpc.post('', {
        jsonrpc: "2.0",
        id: 8891,
        method: "getLedgerEntries",
        params: {
            keys: [
                xdr.LedgerKey.account(
                    new xdr.LedgerKeyAccount({
                        accountId: Keypair.fromPublicKey(publicKey).xdrPublicKey()
                    })
                ).toXDR('base64')
            ]
        }
    })
        .then((res: any) => {
            if (res.result.error)
                throw res.result

            if (!res.result.entries.length)
                throw `Account ${publicKey} not found`

            const account = xdr.LedgerEntryData.fromXDR(res.result.entries[0].xdr, 'base64').account()

            return new Account(publicKey, account.seqNum().toString()) 
        })
}

export async function getFeeStats(env: Env) {
    const rpc = getRpc(env)

    return rpc.post('', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'getFeeStats',
    }).then((res: any) => {
        if (res.result.error)
            throw res.result

        return res.result
    })
}

export async function simulateTransaction(env: Env, xdr: string) {
    const rpc = getRpc(env)

    return rpc.post('', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'simulateTransaction',
        params: {
            transaction: xdr
        }
    }).then((res: any) => {
        if (res.result.error) // TODO handle state archival 
            throw res.result

        return res.result
    })
}

export async function sendTransaction(env: Env, xdr: string) {
    const rpc = getRpc(env)

    return rpc.post('', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'sendTransaction',
        params: {
            transaction: xdr
        }
    }).then((res: any) => {

        // 'PENDING'
        // 'DUPLICATE'
        // 'TRY_AGAIN_LATER'
        // 'ERROR'
        if (res.result.status === 'PENDING')
            return pollTransaction(env, res.result)
        else
            throw {
                xdr,
                ...res.result
            }
    })
}

export async function getTransaction(env: Env, hash: string) {
    const rpc = getRpc(env)

    return rpc.post('', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'getTransaction',
        params: {
            hash: hash
        }
    }).then((res: any) => {

        // 'SUCCESS'
        // 'NOT_FOUND'
        // 'FAILED'
        if (res.result.status === 'FAILED')
            throw res.result

        return res.result
    })
}

async function pollTransaction(env: Env, sendResult: any, interval = 0) {
    const getResult = await getTransaction(env, sendResult.hash)

    console.log(interval, getResult.status);

    if (getResult.status === 'SUCCESS') {
        return {
            hash: sendResult.hash,
            ...getResult,
        }
    } else if (interval >= 30)
        throw getResult

    interval++
    await wait()
    return pollTransaction(env, sendResult, interval)
}