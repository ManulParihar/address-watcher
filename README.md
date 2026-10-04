# address-watcher

Builds the transaction history for Kokio wallets. Alchemy's Address Activity webhook pushes every ETH and ERC-20 transfer that touches a watched wallet on Base. This service stores those transfers in Mongo and serves them back as a paged list, with data bundle purchases folded into one line each.

It is a reference implementation for Kokio-BFF. Run it as is, or lift the parts you need.

## Run it

Needs Node 24 and the MongoDB that Kokio-BFF uses. The service reads the BFF's `paymenttransactions` and `accounts` collections to label purchases and find each user's tokens.

```bash
npm install
cp .env.sample .env    # fill in the values
npm run build
npm start
```

`npm test` runs the unit tests and `npm run typecheck` checks types. Neither needs a database.

## Alchemy setup

Create one Address Activity webhook per environment, in the Alchemy dashboard or with the API. Use `BASE_SEPOLIA` and the staging URL for staging:

```bash
curl -X POST https://dashboard.alchemy.com/api/create-webhook \
  -H "X-Alchemy-Token: $ALCHEMY_NOTIFY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"network":"BASE_MAINNET","webhook_type":"ADDRESS_ACTIVITY","webhook_url":"https://address-watcher.example.com/webhooks/address-activity","addresses":[]}'
```

Put the returned `id` in `ALCHEMY_ACTIVITY_WEBHOOK_ID` and its `signing_key` in `ALCHEMY_ACTIVITY_SIGNING_KEY`. There's no GraphQL query to write: Address Activity has a fixed payload, and the address list decides what gets sent.

## Routes

`POST /webhooks/address-activity` is for Alchemy. It checks `x-alchemy-signature` and answers 401 if the check fails. It answers 500 when the database write fails, so Alchemy retries. Retries are safe because every write is an upsert on a unique key.

Every other route needs the `x-internal-token` header set to `INTERNAL_API_TOKEN`. Only Kokio-BFF should call them.

| Route | Purpose |
| --- | --- |
| `POST /watch` | `{ "address", "deviceWalletAddress", "kind": "DEVICE" \| "ESIM" }`. Queues a wallet. The sync loop adds it to the webhook and backfills its history. |
| `DELETE /watch/:deviceWalletAddress` | Stops watching every wallet of a deleted account. |
| `GET /activity/:deviceWalletAddress?cursor=&limit=` | The history, newest first. `limit` is 1 to 100 (default 30). Pass the response's `next` as `cursor` for the next page. |
| `POST /repair` | `{ "fromBlock": "0x...", "toBlock": "0x..." }`. Backfills every watched wallet over that block range. |
| `GET /health` | Reports whether the database is connected. |

A history line looks like this. `amount` is in base units, so format it with `decimals`:

```json
{
  "type": "PURCHASE",
  "txHash": "0x7a4a39da2a3fa1fc2ef88fd1eaea070286ed2aba21e0419dcfb6d5c5d9f02a72",
  "blockNumber": 31999937,
  "time": "2026-10-03T18:44:10.411Z",
  "from": "0xbe3f4b43db5eb49d1f48f53443b9abce45da3b79",
  "to": "0x9d2e1c8a4b7f30e6a1c5d8b2f4e7a0c3b6d9e1f2",
  "token": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "symbol": "USDC",
  "decimals": 6,
  "amount": "13050000",
  "orderId": "66fe9c2a8b1d4e0012ab34cd"
}
```

`type` is `SEND`, `RECEIVE`, `MOVE` (between the user's own wallets) or `PURCHASE`. Addresses come back lowercase, so checksum them before display.

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
  db/                   walletActivity, watchedAddress, read-only BFF models
  alchemy/              signature check, payload mapping, API clients
  webhook/              stores one webhook delivery
  watchlist/            watch, unwatch, sync, backfill, repair
  activity/             grouping, labels, paged query
test/                   unit tests for the pure parts
```

## Limits

- Alchemy stops retrying a failed delivery after 10 minutes on Free and PAYG plans (1 hour on Enterprise). After a longer outage, call `POST /repair` with the outage's block range.
- The webhook payload has no block timestamp. `time` comes from the delivery's `createdAt`, which is within seconds. Backfilled rows use the real block time.
- A reorg removes token rows (`log.removed`). ETH rows have no log, so a reorged ETH transfer stays. Base reorgs are rare.
- On Base Sepolia, the backfill API has no internal transfers. ETH sent from a device wallet before it was watched won't backfill on staging. New transfers still arrive through the webhook.
- Alchemy's docs only show a token payload. Check on the first real delivery that ETH transfers carry `rawContract.rawValue`. If they don't, ETH transfers are skipped.
- One webhook holds 100,000 addresses, about 25,000 to 30,000 users at 3 to 4 wallets each.
- The sync loop runs in-process and assumes a single instance.
