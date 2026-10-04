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

/** One transfer from `alchemy_getAssetTransfers`. */
export interface AssetTransfer {
  uniqueId: string;
  category: string;
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  asset: string | null;
  rawContract: { value: string | null; address: string | null; decimal: string | null };
}

/** An ETH or ERC-20 transfer, the same shape whichever Alchemy API reported it. */
export interface Transfer {
  /** `<txHash>:log:<logIndex>` for ERC-20, `<txHash>:native:<from>:<to>:<amount>` for ETH. */
  id: string;
  txHash: string;
  from: string;
  to: string;
  /** Token contract, null for ETH. */
  token: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Base units. */
  amount: string;
}

const nativeId = (hash: string, from: string, to: string, amount: string) =>
  `${hash}:native:${from}:${to}:${amount}`;

/** Webhook entry to transfer. Null for NFTs and zero-value transfers, which history never shows. */
export const fromAddressActivity = (a: AddressActivity): Transfer | null => {
  if (a.erc721TokenId != null || a.erc1155Metadata != null) return null;
  const raw = a.rawContract?.rawValue;
  // Zero-value transfers are how address poisoning plants fake history
  if (!raw || BigInt(raw) === 0n) return null;

  const txHash = a.hash.toLowerCase();
  const from = a.fromAddress.toLowerCase();
  const to = a.toAddress.toLowerCase();
  const amount = BigInt(raw).toString();
  const log = a.log;
  return {
    // Number() reads both "0x6e" and "110"
    id: log ? `${txHash}:log:${Number(log.logIndex)}` : nativeId(txHash, from, to, amount),
    txHash,
    from,
    to,
    token: log ? a.rawContract?.address?.toLowerCase() ?? null : null,
    symbol: a.asset,
    decimals: log ? (a.rawContract?.decimals ?? null) : 18,
    amount,
  };
};

/** Backfill entry to transfer. Gives the same id as the webhook, so the two never double up. */
export const fromAssetTransfer = (t: AssetTransfer): Transfer | null => {
  const raw = t.rawContract.value;
  if (!raw || BigInt(raw) === 0n || !t.to) return null;
  if (t.category !== 'erc20' && t.category !== 'external' && t.category !== 'internal') return null;

  const txHash = t.hash.toLowerCase();
  const from = t.from.toLowerCase();
  const to = t.to.toLowerCase();
  const amount = BigInt(raw).toString();
  const isToken = t.category === 'erc20';
  return {
    // uniqueId is `<hash>:log:<index>` for token transfers
    id: isToken ? `${txHash}:log:${Number(t.uniqueId.split(':log:')[1])}` : nativeId(txHash, from, to, amount),
    txHash,
    from,
    to,
    token: isToken ? t.rawContract.address?.toLowerCase() ?? null : null,
    symbol: t.asset,
    decimals: isToken ? (t.rawContract.decimal ? Number(t.rawContract.decimal) : null) : 18,
    amount,
  };
};
