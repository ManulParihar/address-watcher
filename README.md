# address-watcher

Builds the transaction history for Kokio wallets on Base. Two Alchemy webhooks feed it. Address Activity reports every ETH and ERC-20 transfer that touches a watched wallet, and a Custom webhook reports price cap changes. For each transaction the service reads the receipt, decodes the Kokio events with the `kokio-sdk` ABIs, and stores labeled lines. It keeps the newest 20 per device wallet.

It is a reference implementation for Kokio-BFF. Run it as is, or lift the parts you need.

## What shows up in history

| `type` | Meaning | Detected from |
| --- | --- | --- |
| `PURCHASE` | A new eSIM was bought | `DataBundleBoughtWithToken` on one of the user's eSIM wallets, and the BFF order's `purchaseType` is not `TOPUP` |
| `TOPUP` | Data was added to an existing eSIM | The same event, with order `purchaseType: "TOPUP"` |
| `PRICE_CAP` | The user changed an eSIM wallet's price cap | `PriceCapUSDCentsUpdated`. A cap of 0 means the wallet follows the Kokio default. |
| `SEND` | Tokens left the user's wallets | A transfer with no Kokio event |
| `RECEIVE` | Tokens arrived | A transfer with no Kokio event |
| `MOVE` | Tokens moved between the user's own wallets, such as leftover returned from an eSIM wallet | Both ends of the transfer belong to the user |

The transfers that make up a purchase (device wallet to eSIM wallet, eSIM wallet to the payment adapter) fold into the purchase line. Transfers of tokens that aren't on the user's list are hidden, along with zero-value transfers and gas paid to the EntryPoint.

Left out on purpose: card purchases recorded onchain (no tokens move), the auto top-up toggle, ownership transfers and wallet deployment.

## Run it

Needs Node 24 and the MongoDB that Kokio-BFF uses. The service reads the BFF's `orders` collection for `purchaseType`, and its `accounts` collection for each user's added tokens.

```bash
npm install
cp .env.sample .env    # fill in the values
npm run build
npm start
```

`npm test` runs the unit tests and `npm run typecheck` checks types. Neither needs a database.

## Alchemy setup

Create two webhooks per environment. The examples use production, so for staging switch to `BASE_SEPOLIA` and the staging URL.

**Address Activity**, for transfers:

```bash
curl -X POST https://dashboard.alchemy.com/api/create-webhook \
  -H "X-Alchemy-Token: $ALCHEMY_NOTIFY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"network":"BASE_MAINNET","webhook_type":"ADDRESS_ACTIVITY","webhook_url":"https://address-watcher.example.com/webhooks/address-activity","addresses":[]}'
```

Put its `id` in `ALCHEMY_ACTIVITY_WEBHOOK_ID` and its `signing_key` in `ALCHEMY_ACTIVITY_SIGNING_KEY`. It has no query to write. The address list decides what gets sent, and the service fills that list itself.

**Custom webhook**, for price cap changes. In the dashboard, create a Custom webhook pointed at `/webhooks/protocol-events` with this query. The topic is `keccak256("PriceCapUSDCentsUpdated(uint64)")`.

```graphql
{
  block {
    number
    timestamp
    logs(filter: { addresses: [], topics: ["0xa4cb36ed327c8d262711fcd1c50594e6d1170201b6e8c810084119a05d85f581"] }) {
      account { address }
      topics
      index
      transaction { hash }
    }
  }
}
```

The filter matches the event on any contract, so the service only acts on logs from watched eSIM wallets. Put this webhook's signing key in `ALCHEMY_EVENTS_SIGNING_KEY`.

## Backfill

When a wallet is first watched, the service fetches its newest 20 transfers in each direction since `BACKFILL_FROM_BLOCK` (for eSIM wallets, also its cap changes) and builds lines from them. On Base Sepolia the start block defaults to the protocol deployment, `46246173`. Set `BACKFILL_FROM_BLOCK` once the protocol is on Base Mainnet.

Kokio-BFF registers wallets as soon as the protocol creates them, so the backfill mostly covers the minute before the next sync, plus any deposits made to a device wallet's address before it was deployed.

## Routes

The two `/webhooks/*` routes are for Alchemy. They check `x-alchemy-signature` against their own signing key and answer 401 if the check fails. They answer 500 when processing fails, so Alchemy retries. Retries are safe because every line is an upsert on a unique key.

Every other route needs the `x-internal-token` header set to `INTERNAL_API_TOKEN`. Only Kokio-BFF should call them.

| Route | Purpose |
| --- | --- |
| `POST /watch` | `{ "address", "deviceWalletAddress", "kind": "DEVICE" \| "ESIM" }`. Queues a wallet. The sync loop adds it to the webhook and backfills it. |
| `DELETE /watch/:deviceWalletAddress` | Stops watching every wallet of a deleted account. |
| `GET /activity/:deviceWalletAddress` | `{ "items": [...] }`, the newest 20 lines first. |
| `POST /repair` | `{ "fromBlock": "46300000" }`. Rebuilds every watched wallet's history from that block, after an outage longer than Alchemy's retries. |
| `GET /health` | Reports whether the database is connected. |

Two lines, with sample values. `amount` is in base units, so format it with `decimals`:

```json
{
  "items": [
    {
      "type": "TOPUP",
      "txHash": "0x7a4a39da2a3fa1fc2ef88fd1eaea070286ed2aba21e0419dcfb6d5c5d9f02a72",
      "blockNumber": 46301877,
      "time": "2026-10-03T18:44:10.000Z",
      "from": "0xbe3f4b43db5eb49d1f48f53443b9abce45da3b79",
      "to": null,
      "token": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      "symbol": "USDC",
      "decimals": 6,
      "amount": "13050000",
      "eSIMWallet": "0xbe3f4b43db5eb49d1f48f53443b9abce45da3b79",
      "orderId": "66fe9c2a8b1d4e0012ab34cd",
      "priceCapUSDCents": null
    },
    {
      "type": "PRICE_CAP",
      "txHash": "0x2c9f0d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
      "blockNumber": 46301102,
      "time": "2026-10-03T18:18:20.000Z",
      "from": null,
      "to": null,
      "token": null,
      "symbol": null,
      "decimals": null,
      "amount": null,
      "eSIMWallet": "0xbe3f4b43db5eb49d1f48f53443b9abce45da3b79",
      "orderId": null,
      "priceCapUSDCents": 2500
    }
  ]
}
```

Addresses come back lowercase, so checksum them before display. The plan name for a purchase or top-up comes from the BFF order with that `orderId`, the same way the Orders tab gets it.

## What Kokio-BFF calls

| When | Call |
| --- | --- |
| A device wallet is deployed (`accountRepo.markDeployed`) | `POST /watch` with `kind: "DEVICE"` |
| An eSIM wallet is deployed (lazy route `deployResult.eSIMWallets`, and every `walletHelperService.deployESIMWallet`) | `POST /watch` with `kind: "ESIM"` |
| An account is deleted | `DELETE /watch/:deviceWalletAddress` |
| The app opens the wallet tab | proxy `GET /activity/:deviceWalletAddress` after the BFF's own auth |

Wallets that exist before launch need one `POST /watch` each: every account with `walletState: "DEPLOYED"`, its `unassignedESIMWallets`, and each eSim's `eSimId`.

The BFF's `Account` schema has no `customTokens` field yet. Until it does, history shows ETH plus the chain's default tokens in `src/config.ts`.

## Layout

```
src/
  config.ts             chain constants and environment
  server.ts             routes, internal auth, sync loop
  db/                   activity lines, watched wallets, read-only BFF models
  alchemy/              signature check, transfer mapping, API and RPC clients
  webhook/              Address Activity and price cap handlers
  watchlist/            watch, unwatch, sync, backfill, repair
  activity/             event decoding, line building, ingest, query
test/                   unit tests for the pure parts
```

## Limits

- Each new transaction costs two RPC calls (receipt and block), on top of the webhook delivery.
- Alchemy stops retrying a failed delivery after 10 minutes on Free and PAYG plans (1 hour on Enterprise). After a longer outage, call `POST /repair`.
- A reorg removes a transaction's lines when Address Activity reports `log.removed`. A reorged ETH-only or cap-only transaction has no such signal and stays. Base reorgs are rare.
- On Base Sepolia, the backfill API has no internal transfers. ETH sent from a device wallet before it was watched won't backfill on staging. New transfers still arrive through the webhook.
- Alchemy's docs only show a token payload. Check on the first real delivery that ETH transfers carry `rawContract.rawValue`. If they don't, ETH transfers are skipped.
- The cap backfill uses one `eth_getLogs` call from the start block for each eSIM wallet. If Alchemy rejects the block range on Base, split it into windows.
- A cap change that lands before the BFF registers the wallet is missed by the webhook. The backfill picks it up on the next sync.
- One Address Activity webhook holds 100,000 addresses, about 25,000 to 30,000 users at 3 to 4 wallets each.
- The sync loop runs in-process and assumes a single instance.
