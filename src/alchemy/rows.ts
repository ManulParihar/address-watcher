import type { ActivityRow } from '../db/walletActivity.js';

/** One entry of `event.activity[]` in an Address Activity delivery. */
export interface AddressActivity {
  blockNum: string;
  hash: string;
  fromAddress: string;
  toAddress: string;
  value: number | null;
  asset: string | null;
  category: string;
  erc721TokenId?: string | null;
  erc1155Metadata?: unknown[] | null;
  rawContract?: { rawValue?: string | null; address?: string | null; decimals?: number | null };
  log?: { logIndex: string; removed: boolean } | null;
}

/** One transfer from `alchemy_getAssetTransfers` with `withMetadata: true`. */
export interface AssetTransfer {
  uniqueId: string;
  category: string;
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  asset: string | null;
  rawContract: { value: string | null; address: string | null; decimal: string | null };
  metadata: { blockTimestamp: string };
}

const nativeKey = (hash: string, from: string, to: string, amount: string) =>
  `${hash}:native:${from}:${to}:${amount}`;

/** Webhook entry to row. Null means the wallet screen never shows it. */
export const activityToRow = (a: AddressActivity, chainId: number, blockTime: Date): ActivityRow | null => {
  if (a.erc721TokenId != null || a.erc1155Metadata != null) return null;
  const raw = a.rawContract?.rawValue;
  // Zero-value transfers are how address poisoning plants fake history
  if (!raw || BigInt(raw) === 0n) return null;

  const hash = a.hash.toLowerCase();
  const from = a.fromAddress.toLowerCase();
  const to = a.toAddress.toLowerCase();
  const amount = BigInt(raw).toString();
  const log = a.log;
  return {
    // Number() reads both "0x6e" and "110"
    key: log ? `${hash}:log:${Number(log.logIndex)}` : nativeKey(hash, from, to, amount),
    chainId,
    txHash: hash,
    blockNumber: Number(a.blockNum),
    blockTime,
    from,
    to,
    token: log ? a.rawContract?.address?.toLowerCase() ?? null : null,
    symbol: a.asset,
    decimals: log ? (a.rawContract?.decimals ?? null) : 18,
    amount,
    source: 'WEBHOOK',
  };
};

/** Backfill transfer to row. Builds the same key as the webhook, so overlaps dedupe. */
export const transferToRow = (t: AssetTransfer, chainId: number): ActivityRow | null => {
  const raw = t.rawContract.value;
  if (!raw || BigInt(raw) === 0n || !t.to) return null;
  if (t.category !== 'erc20' && t.category !== 'external' && t.category !== 'internal') return null;

  const hash = t.hash.toLowerCase();
  const from = t.from.toLowerCase();
  const to = t.to.toLowerCase();
  const amount = BigInt(raw).toString();
  const isToken = t.category === 'erc20';
  return {
    // uniqueId is `<hash>:log:<index>` for token transfers
    key: isToken ? `${hash}:log:${Number(t.uniqueId.split(':log:')[1])}` : nativeKey(hash, from, to, amount),
    chainId,
    txHash: hash,
    blockNumber: Number(t.blockNum),
    blockTime: new Date(t.metadata.blockTimestamp),
    from,
    to,
    token: isToken ? t.rawContract.address?.toLowerCase() ?? null : null,
    symbol: t.asset,
    decimals: isToken ? (t.rawContract.decimal ? Number(t.rawContract.decimal) : null) : 18,
    amount,
    source: 'BACKFILL',
  };
};

/** Insert-if-missing. A repeat delivery changes nothing. */
export const upsertOp = ({ key, ...rest }: ActivityRow) => ({
  // Equality on the unique key, and key left out of the update: racing upserts land on one document
  updateOne: { filter: { key }, update: { $setOnInsert: rest }, upsert: true },
});
