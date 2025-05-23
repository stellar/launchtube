# Launchtube

![DALL·E 2024-10-07 20 36 03](https://github.com/user-attachments/assets/05d2289d-f0e4-4eb7-9701-59a7b0d3b353)


Getting Stellar transactions successfully submitted to the network can be a chore. You've got a lot to think about between XLM fees, sequence numbers, block times, retries, rate limits, ledger limits, and more. This gets even trickier when trying to submit smart contract invocations. Soroban contracts can't pay Stellar transaction fees and they maintain nonces not sequence numbers.

The Launchtube service aims to alleviate all of these challenges and complexities by giving you an API which accepts Soroban ops and then handles getting those entries successfully submitted to the network. No XLM or G-addresses required! Just simulate and sign your Soroban ops, submit them to Launchtube, and we'll handle getting them onchain. Too easy!

> [!CAUTION]  
> Launchtube is an experimental service and while SDF maintains a mainnet implementation we make no guarantees about its stability, availablility or longevity. Do not use SDF's Launchtube service for mission-critical production services.


## Base URL

* `Testnet` `https://testnet.launchtube.xyz`
* `Mainnet` `https://launchtube.xyz`

## Public Endpoints

### Authorization

#### Headers

- `Authorization`: `Bearer {jwt token}`

> [!NOTE]  
> * For Testnet JWT tokens just open https://testnet.launchtube.xyz/gen
> * For Mainnet tokens drop a note in the `#launchtube` channel in [our Discord](https://discord.gg/stellardev)

---

### `POST` `/`

Submit a transaction

> [!IMPORTANT]  
> Credits are spent with progressive levels of granularity as the transaction moves through the backend
>
> * Initially upon submission `100_000` credits are spent
> * Assuming your tx simulates successfully, those `100_000` credits are refunded and the simulation bid fee is spent
> * If your tx submission is successful the bid fee is refunded and the final tx fee is spent
>
> This ensures a fair and predictable system without restrictive rate limits by incentiving properly formed transactions

#### Body

<!-- - `fee` (optional)
    
    Number of credits (stroops) you want to spend on the [inclusion fee](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering#resource-fee) to submit the transaction

AND -->

- `xdr`
    
    Transaction you want submitted as an `XDR` encoded `String`

OR

- `func`

    `xdr.HostFunction` encoded as an `XDR` `String`

- `auth`

    Array of `xdr.SorobanAuthorizationEntry` encoded `XDR` `String`s 

OPTIONAL

- `sim` (default `true`)

    Boolean flag for if you want Launchtube to handle simulation for you or not. This is especially useful if you want to borrow the invoker auth of the transaction for the Soroban auth entry. Please keep in mind though if you opt for `sim=false` you MUST set a transaction timeout for <= 30 seconds and keep your inclusion fee at or below 201 stroops.

#### Headers

- `Content-Type`: `x-www-form-urlencoded`

#### Return

The response of the transaction submission as `JSON` assuming it was successful. Otherwise a (hopefully) useful `JSON` error

##### Headers

- `X-Credits-Remaining`: `String` numeric value of the token's remaining credits (stroops)

---

### `GET` `/info`

Get the remaining credits (stoops) available for your token

#### Return

`String` numeric value of the token's remaining credits (stroops)

---

### `GET` `/activate`

Webpage form to activate your token to enable usage of the API

#### Query

- `token`
    
    The `{jwt token}` you were given and wish to activate

---

### `POST` `/activate`

The API endpoint used by the `GET` `/` webpage form to activate your token

#### Body

- `token`
    
    The `{jwt token}` you were given and wish to activate

#### Headers

- `Content-Type`: `x-www-form-urlencoded`

---

### `GET` `/claim`

Webpage form to create and activate a new token

#### Query

- `code`
    
    The claim `{claim code}` you were given and wish to use to create and activate a new token with

---

### `POST` `/claim`

The API endpoint used by the `GET` `/claim` webpage form to create and activate new tokens via claim codes

#### Body

- `code`
    
    The claim `{claim code}` you were given and wish to use to create and activate a new token with

#### Headers

- `Content-Type`: `x-www-form-urlencoded`

#### Return

`HTML` page with the newly activated token you can use as the `{jwt token}` to authenticate the service

---

<details closed>
<summary><h2>Private Endpoints</h2></summary>

### Authorization

#### Headers

- `Authorization`: `Bearer {auth token}`

If you are a member of the SDF and need an auth token let [tyler@stellar.org](mailto:tyler@stellar.org) know

---

### `GET` `/qrcode`

Generate a QR code for a new JWT token
    
#### Query

- `ttl`
    
    The number of seconds these tokens should live for
    
- `xlm`
    
    The number of xlm this tokens can spend

- `claim`

    Boolean value to redirect away from the QR page right to the claim link page

#### Return

`PNG` QR code image linking to `{location.origin}/claim?code={claim code}`. 

##### Headers

- `X-Claim-Code`: `String` the claim code you can use to create new tokens

> [!NOTE]  
> For SDF members only. If you open this page without an Authorization header it will be an HTML form to input your auth token which when saved will include it as a cookie which will allow you to generate QR codes right on the page whenever you refresh the page.

---

### `GET` `/gen`

Generate a list of new credit JWT tokens

#### Query

- `ttl`
    
    The number of seconds these tokens should live for
    
- `credits`
    
    The number of credits these tokens can spend (in stroops)
    
- `count`
    
    The number of unique new tokens to generate (max of 100)
    
#### Return

`JSON` array of tokens which will be what you hand out like candy

---

### `DELETE` `/:sub`

Delete a previously generated token

#### Params

- `sub`
    
    The JWT `sub` claim of the token you want to delete

#### Return

`OK`

---

### `POST` `/sql`

Run a SQL query on the database

> [!CAUTION]  
> Be careful! I don't do any query validation before running your query so you could easily bork the database with an erroneous query. So don't do that

#### Body

- `query`
    
    SQL query you want to run. e.g. `SELECT * FROM Transactions LIMIT 100`
    
- `args`
    
    Positional arguments for the query. Include as strings in an array. e.g. `["arg1", "arg2"]`

#### Headers

- `Content-Type`: `x-www-form-urlencoded`

#### Return

JSON array of results from the query (if any)
e.g.
```json
[
    {
        "Sub": "712f3af6061d26ac4c573151e116547a3b58b364fcf5a6df8f1a5916d540cae3",
        "Tx": "40833f9c1b6e3187f7ff915a2bbad55e422650a283d3d13d941a5eaf81abaed7"
    },
    {
        "Sub": "712f3af6061d26ac4c573151e116547a3b58b364fcf5a6df8f1a5916d540cae3",
        "Tx": "f5b4d4638944ffab6ca693fe4036275c4822dd46e7e0f558a4e53a38f704fb45"
    },
    ...
]
```
`Sub` is the token's `sub` claim and `Tx` is the transaction hash

---

### `GET` `/seq`

Get information about the sequencer Durable Object. You very probably don't ever need to run this. It's really just for system maintainers doing health or debug checks

#### Body

Review the [endpoint code](./src/api/sequencer-info.ts) for available params

#### Return

`JSON` object with information about the sequencer. Again, review the code for the exact shape of the response
</details>
