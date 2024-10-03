import { html } from "itty-router";

export async function htmlTermsAndConditions() {
    return html(`
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Launchtube Terms & Conditions</h1>
            <div style="max-width: 600px;">
                <p>The Stellar Development Foundation (SDF) is providing token credits to developers building on the Stellar smart contracts platform Soroban.</p>
                <p>These token credits are not transferred to the developer but instead are provided as credits to be used exclusively to pay for Stellar network transaction fees, and are not to be used for any other purpose.</p>
                <p>The redemption period and value of the token credits will be determined by the SDF in our sole discretion and will be automatically reflected in the developer's Launchtube account on activation.</p>
                <p>By clicking activate, you agree to the SDF's <a href="https://stellar.org/terms-of-service">Terms of Service</a> and <a href="https://stellar.org/privacy-policy">Privacy Policy</a>, and agree that SDF in its sole discretion may revoke access to, withdraw or discontinue these token credits at any time, for any reason.</p>
            </div>
        </body>
        </html>
    `)
}