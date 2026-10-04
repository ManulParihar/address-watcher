import { ESIMWallet } from 'kokio-sdk/abis';
import { getAbiItem } from 'viem';
import { getConfig, HISTORY_LIMIT } from '../config.js';
import { WatchedAddress, type WalletKind } from '../db/watchedAddress.js';
import { updateWebhookAddresses } from '../alchemy/notifyClient.js';
import { getRecentTransfers } from '../alchemy/transfersClient.js';
import { getClient } from '../alchemy/rpcClient.js';
import { fromAssetTransfer, type Transfer } from '../alchemy/transfers.js';
import { processTx } from '../activity/ingest.js';

const BATCH = 500;
const PRICE_CAP_EVENT = getAbiItem({ abi: ESIMWallet, name: 'PriceCapUSDCentsUpdated' });

/** Queue a wallet for watching. Kokio-BFF calls this as soon as the protocol creates a wallet. */
export const watchWallet = (address: string, deviceWalletAddress: string, kind: WalletKind) =>
  WatchedAddress.updateOne(
    { address: address.toLowerCase() },
    { $setOnInsert: { deviceWalletAddress: deviceWalletAddress.toLowerCase(), kind, status: 'PENDING' } },
    { upsert: true },
  );

/** Stop watching every wallet of a deleted account. The next sync tells Alchemy. */
export const unwatchAccount = (deviceWalletAddress: string) =>
  WatchedAddress.updateMany({ deviceWalletAddress: deviceWalletAddress.toLowerCase() }, { status: 'REMOVING' });

/**
 * Fills one wallet's history with its newest transactions since `fromBlock`. Covers what happened
 * before the webhook started watching it. Safe to rerun.
 */
export const backfillAddress = async (address: string, kind: WalletKind, fromBlock = getConfig().backfillFromBlock) => {
  const byTx = new Map<string, Map<string, Transfer>>();
  // getAssetTransfers matches one direction per call
  for (const direction of ['fromAddress', 'toAddress'] as const) {
    const transfers = await getRecentTransfers({ [direction]: address, fromBlock, maxCount: HISTORY_LIMIT });
    for (const t of transfers.map(fromAssetTransfer)) {
      if (!t) continue;
      const group = byTx.get(t.txHash) ?? new Map<string, Transfer>();
      group.set(t.id, t);
      byTx.set(t.txHash, group);
    }
  }

  // Cap changes move no tokens, so getAssetTransfers never returns them
  if (kind === 'ESIM') {
    const logs = await getClient().getLogs({ address: address as `0x${string}`, event: PRICE_CAP_EVENT, fromBlock, toBlock: 'latest' });
    for (const log of logs) if (!byTx.has(log.transactionHash)) byTx.set(log.transactionHash, new Map());
  }

  for (const [txHash, transfers] of byTx) await processTx(txHash, [...transfers.values()]);
};

/** Watch PENDING wallets, backfill them, and drop wallets of deleted accounts. */
export const runWatchlistSync = async (): Promise<void> => {
  const pending = await WatchedAddress.find({ status: 'PENDING' }).limit(BATCH).lean();
  if (pending.length > 0) {
    // Watch first, backfill second. A transaction landing in between arrives from both and dedupes on key.
    await updateWebhookAddresses(pending.map((w) => w.address), []);
    for (const w of pending) {
      await backfillAddress(w.address, w.kind);
      await WatchedAddress.updateOne({ address: w.address }, { status: 'WATCHED' });
    }
  }

  const removing = await WatchedAddress.find({ status: 'REMOVING' }).limit(BATCH).lean();
  if (removing.length > 0) {
    const addresses = removing.map((w) => w.address);
    await updateWebhookAddresses([], addresses);
    await WatchedAddress.deleteMany({ address: { $in: addresses } });
  }
};

/** Refills a window the webhooks missed, such as an outage longer than Alchemy's retries. */
export const repairGap = async (fromBlock: bigint): Promise<void> => {
  for await (const w of WatchedAddress.find({ status: 'WATCHED' }).lean().cursor()) {
    await backfillAddress(w.address, w.kind, fromBlock);
  }
};
