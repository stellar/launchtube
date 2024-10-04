import { simulateTransaction } from "./common"
import { RequestLike, StatusError } from "itty-router";
import { verify } from "@tsndr/cloudflare-worker-jwt";
import { SorobanRpc, Account, authorizeEntry, Keypair, nativeToScVal, Operation, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk/minimal';

export function getRpc(env: Env) {
    const rpcUrls = JSON.parse(env.RPC_URLS) as (string | [string, string])[]
    const [rpcUrl, rpcKey] = getRandomRpcUrl(rpcUrls)

    return new SorobanRpc.Server(rpcUrl, {
        headers: rpcKey ? {
            Authorization: `Bearer ${rpcKey}`,
        } : undefined
    })
}

function getRandomRpcUrl(input: (string | [string, string])[]): [string, string | null] {
    const randomIndex = Math.floor(Math.random() * input.length);
    const randomElement = input[randomIndex];

    if (typeof randomElement === 'string')
        return [randomElement, null]

    return randomElement
}

export function wait(ms: number = 1000) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function arraysEqualUnordered(arr1: any[], arr2: any[]) {
    if (arr1.length !== arr2.length)
        return false;

    arr1.sort();
    arr2.sort();

    return arr1.every((item, i) => item === arr2[i]);
}

export function addUniqItemsToArray(arr: any[], ...items: any[]) {
    return [
        ...new Set([
            ...arr,
            ...items
        ])
    ]
}

export async function checkAuth(request: RequestLike | string, env: Env) {
    const token = typeof request === 'string' ? request : request.headers.get('Authorization').split(' ')[1]
    const validToken = await verify(token, env.JWT_SECRET, { throwError: true})

    if (!validToken)
        throw new StatusError(401, 'Invalid token')

    const { payload } = validToken

    if (!payload?.sub)
        throw new StatusError(401, 'Token invalid')

    return payload
}

export async function checkSudoAuth(request: RequestLike, env: Env) {
    const token = request.headers.get('Authorization').split(' ')[1]

    if (!await env.SUDOS.get(token))
        throw new StatusError(401, 'Unauthorized')
}

export function removeValueFromArrayIfExists(arr: any[], value: any) {
    const index = arr.indexOf(value);

    if (index === -1)
        return false
    else {
        arr.splice(index, 1)
        return true
    }
};

export function getRandomNumber(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function getMockData(env: Env, type: 'xdr' | 'op' | '', formData: FormData) {
    // NOTE Ensure this address is funded before trying to use it. 
    // Should also be an env var on dev ONLY
    const mockKeypair = Keypair.fromSecret(env.MOCK_SK)
    const mockPubkey = mockKeypair.publicKey()

    const nullPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
    const nullSource = new Account(nullPubkey, '0')

    const transaction = new TransactionBuilder(nullSource, {
        fee: '0',
        networkPassphrase: env.NETWORK_PASSPHRASE,
    })
        .addOperation(Operation.invokeContractFunction({
            contract: env.NATIVE_CONTRACT_ID,
            function: 'transfer',
            args: [
                nativeToScVal(mockPubkey, { type: 'address' }),
                nativeToScVal(env.NATIVE_CONTRACT_ID, { type: 'address' }),
                nativeToScVal(100, { type: 'i128' })
                // nativeToScVal(-1, { type: 'i128' }) // to fail simulation
            ],
            auth: []
        }))
        .setTimeout(30)
        .build()

    const { result, latestLedger } = await simulateTransaction(env, transaction)
    const op = transaction.operations[0] as Operation.InvokeHostFunction

    for (const auth of result?.auth || []) {
        const authSigned = await authorizeEntry(auth, mockKeypair, latestLedger + 60, env.NETWORK_PASSPHRASE)
        op.auth!.push(authSigned)
    }

    const fee = formData.get('fee') || undefined

    return type === 'op'
        ? {
            func: op.func.toXDR('base64'),
            auth: JSON.stringify(op.auth?.map((auth) => auth.toXDR('base64'))),
            fee
        }
        : {
            xdr: transaction.toXDR(),
            fee
        }
}