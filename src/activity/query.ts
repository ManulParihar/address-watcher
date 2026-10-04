import { CHAINS, getConfig } from '../config.js';
import { WalletActivity } from '../db/walletActivity.js';
import { WatchedAddress } from '../db/watchedAddress.js';
import { Account, PaymentTransaction } from '../db/bffModels.js';
import { groupByTx, toItems, type ActivityItem, type Purchase } from './items.js';

const CURSOR = /^(\d+):(0x[0-9a-f]{64})$/;

export class InvalidCursorError extends Error {}

export interface ActivityPage {
  items: ActivityItem[];
  /** Pass back as `cursor` for the next page. Null on the last page. */
  next: string | null;
}

/**
 * Wallet history for one account, newest first. Pages by transaction, so a purchase's legs
 * never split across two pages.
 */
export const getWalletActivity = async (
  deviceWalletAddress: string,
  cursor: string | undefined,
  limit = 30,
): Promise<ActivityPage> => {
  const device = deviceWalletAddress.toLowerCase();
  const parsed = cursor ? CURSOR.exec(cursor) : null;
  if (cursor && !parsed) throw new InvalidCursorError('cursor must be <blockNumber>:<txHash>');

  const watched = await WatchedAddress.find({ deviceWalletAddress: device }, { address: 1 }).lean();
  const wallets = new Set([device, ...watched.map((w) => w.address)]);

  const filter: Record<string, unknown> = { $or: [{ from: { $in: [...wallets] } }, { to: { $in: [...wallets] } }] };
  if (parsed) {
    const block = Number(parsed[1]);
    filter.$and = [{ $or: [{ blockNumber: { $lt: block } }, { blockNumber: block, txHash: { $lt: parsed[2] } }] }];
  }

  // A transaction has a few legs at most, so 4 rows per requested line is plenty
  const fetchLimit = limit * 4;
  const rows = await WalletActivity.find(filter).sort({ blockNumber: -1, txHash: -1 }).limit(fetchLimit).lean();
  const groups = groupByTx(rows);
  // The fetch limit may have cut the oldest transaction short. Leave it for the next page.
  if (rows.length === fetchLimit && groups.length > 1) groups.pop();
  const page = groups.slice(0, limit);

  const hashes = page.map((g) => g[0]!.txHash);
  const payments = await PaymentTransaction.find(
    { transactionHash: { $in: hashes }, status: 'SUCCESS' },
    { transactionHash: 1, orderId: 1, tokenAmount: 1 },
  ).lean();
  const purchases = new Map<string, Purchase>(
    payments.map((p) => [String(p.transactionHash).toLowerCase(), { orderId: String(p.orderId), tokenAmount: p.tokenAmount ?? null }]),
  );

  const account = await Account.findOne({ deviceWalletAddress: device }, { customTokens: 1 }).lean();
  const tokens = new Set<string>([
    ...CHAINS[getConfig().chainId].defaultTokens,
    ...(account?.customTokens ?? []).map((t) => t.address.toLowerCase()),
  ]);

  const items = page.flatMap((legs) => toItems(legs, { wallets, tokens, purchases }));
  const last = page.at(-1)?.[0];
  const hasMore = groups.length > page.length || rows.length === fetchLimit;
  return { items, next: last && hasMore ? `${last.blockNumber}:${last.txHash}` : null };
};
