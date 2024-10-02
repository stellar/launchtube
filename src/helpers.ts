import { Account, authorizeEntry, Keypair, nativeToScVal, Operation, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-base"
import { simulateTransaction } from "./common"
import { fetcher } from "itty-fetcher";

export function getRpc(env: Env) {
    const rpcUrls = JSON.parse(env.RPC_URLS) as (string | [string, string])[]
    const [rpcUrl, rpcKey] = getRandomRpcUrl(rpcUrls)

    return fetcher({
        base: rpcUrl,
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
    const testKeypair = Keypair.fromSecret(env.MOCK_SK)
    const testPubkey = testKeypair.publicKey()

    const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
    const mockSource = new Account(mockPubkey, '0')

    const transaction = new TransactionBuilder(mockSource, {
        fee: '0',
        networkPassphrase: env.NETWORK_PASSPHRASE,
    })
        .addOperation(Operation.invokeContractFunction({
            contract: env.NATIVE_CONTRACT_ID,
            function: 'transfer',
            args: [
                nativeToScVal(testPubkey, { type: 'address' }),
                nativeToScVal(env.NATIVE_CONTRACT_ID, { type: 'address' }),
                nativeToScVal(100, { type: 'i128' })
                // nativeToScVal(-1, { type: 'i128' }) // to fail simulation
            ],
            auth: []
        }))
        .setTimeout(30)
        .build()

    const sim = await simulateTransaction(env, transaction.toXDR())

    const op = transaction.operations[0] as Operation.InvokeHostFunction

    for (const authXDR of sim.results[0].auth) {
        const authUnsigned = xdr.SorobanAuthorizationEntry.fromXDR(authXDR, 'base64')
        const authSigned = await authorizeEntry(authUnsigned, testKeypair, sim.latestLedger + 60, env.NETWORK_PASSPHRASE)

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