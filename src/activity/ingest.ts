import { CHAINS, getConfig, HISTORY_LIMIT } from '../config.js';
import { Activity, type ActivityDoc } from '../db/activity.js';
import { WatchedAddress } from '../db/watchedAddress.js';
import { Account, Order } from '../db/bffModels.js';
import { getClient } from '../alchemy/rpcClient.js';
import type { Transfer } from '../alchemy/transfers.js';
import { decodeKokioEvents, orderIdFromPaymentReference } from './decode.js';
import { buildLines, type PurchaseType } from './items.js';

/**
 * Builds and stores the history lines of one transaction for every watched device it touches.
 * `transfers` are what Alchemy reported for it. Kokio events come from the receipt. Safe to rerun.
 */
export const processTx = async (txHash: string, transfers: Transfer[]): Promise<void> => {
  const client = getClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== 'success') return;

  const events = decodeKokioEvents(receipt.logs);
  const touched = new Set([
    ...transfers.flatMap((t) => [t.from, t.to]),
    ...events.purchases.map((p) => p.eSIMWallet),
    ...events.priceCaps.map((c) => c.eSIMWallet),
  ]);
  const watched = await WatchedAddress.find({ address: { $in: [...touched] } }, { deviceWalletAddress: 1 }).lean();
  const devices = [...new Set(watched.map((w) => w.deviceWalletAddress))];
  if (devices.length === 0) return;

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const time = new Date(Number(block.timestamp) * 1000);

  const orderIds = new Map(events.purchases.map((p) => [p.logIndex, orderIdFromPaymentReference(p.paymentReference)]));
  const ids = [...orderIds.values()].filter((id): id is string => id !== null);
  const orders = ids.length > 0 ? await Order.find({ _id: { $in: ids } }, { purchaseType: 1 }).lean() : [];
  const purchaseTypes = new Map<string, PurchaseType | undefined>(orders.map((o) => [String(o._id), o.purchaseType]));

  const defaultTokens = CHAINS[getConfig().chainId].defaultTokens;
  for (const device of devices) {
    const own = await WatchedAddress.find({ deviceWalletAddress: device }, { address: 1 }).lean();
    const account = await Account.findOne({ deviceWalletAddress: device }, { customTokens: 1 }).lean();
    const lines = buildLines({
      deviceWalletAddress: device,
      wallets: new Set([device, ...own.map((w) => w.address)]),
      tokens: new Set<string>([...defaultTokens, ...(account?.customTokens ?? []).map((t) => t.address.toLowerCase())]),
      txHash: txHash.toLowerCase(),
      blockNumber: Number(receipt.blockNumber),
      time,
      transfers,
      events,
      purchaseTypes,
      orderIds,
    });
    // A rebuild replaces this device's lines for the transaction. If an eSIM wallet was registered
    // after its purchase was first seen, the purchase line now takes the place of the plain sends.
    // A call without transfers (the price cap webhook) only knows events, so it leaves transfer lines.
    await Activity.deleteMany({
      deviceWalletAddress: device,
      txHash: txHash.toLowerCase(),
      key: transfers.length > 0 ? { $nin: lines.map((l) => l.key) } : { $nin: lines.map((l) => l.key), $regex: ':event:' },
    });
    if (lines.length === 0) continue;
    await Activity.bulkWrite(lines.map(upsertLine), { ordered: false });
    await pruneHistory(device);
  }
};

// Equality on the unique key, and key left out of the update: racing upserts land on one document
const upsertLine = ({ key, ...rest }: ActivityDoc) => ({
  updateOne: { filter: { key }, update: { $set: rest }, upsert: true },
});

/** Deletes everything past the newest HISTORY_LIMIT lines of one device. */
export const pruneHistory = async (deviceWalletAddress: string): Promise<void> => {
  const stale = await Activity.find({ deviceWalletAddress }, { _id: 1 })
    .sort({ blockNumber: -1, key: -1 })
    .skip(HISTORY_LIMIT)
    .lean();
  if (stale.length > 0) await Activity.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
};

/** Drops a transaction that a reorg took out of the chain. */
export const removeTx = (txHash: string) => Activity.deleteMany({ txHash: txHash.toLowerCase() });
