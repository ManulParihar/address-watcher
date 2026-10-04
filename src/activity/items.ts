import { ENTRY_POINT } from '../config.js';
import type { ActivityDoc, ActivityType } from '../db/activity.js';
import type { Transfer } from '../alchemy/transfers.js';
import type { KokioEvents } from './decode.js';

export type PurchaseType = 'SIM' | 'TOPUP' | 'SIM_OR_TOPUP';

/** Everything known about one transaction, seen from one device wallet. */
export interface TxView {
  deviceWalletAddress: string;
  /** The device wallet and its eSIM wallets, lowercase. */
  wallets: Set<string>;
  /** Token contracts this account shows, lowercase. ETH is always shown. */
  tokens: Set<string>;
  txHash: string;
  blockNumber: number;
  time: Date;
  transfers: Transfer[];
  events: KokioEvents;
  /** purchaseType of each order paid for in this transaction, by order id. */
  purchaseTypes: Map<string, PurchaseType | undefined>;
  /** Order id for each purchase event, by log index. */
  orderIds: Map<number, string | null>;
}

type Line = Omit<ActivityDoc, 'key' | 'deviceWalletAddress' | 'txHash' | 'blockNumber' | 'time'> & { id: string };

const blank = { from: null, to: null, token: null, symbol: null, decimals: null, amount: null, eSIMWallet: null, orderId: null, priceCapUSDCents: null };

/** Turns one transaction into the history lines one device wallet should see. */
export const buildLines = (tx: TxView): ActivityDoc[] => {
  const purchases = tx.events.purchases.filter((p) => tx.wallets.has(p.eSIMWallet));
  const caps = tx.events.priceCaps.filter((c) => tx.wallets.has(c.eSIMWallet));
  const lines: Line[] = [];

  for (const p of purchases) {
    const orderId = tx.orderIds.get(p.logIndex) ?? null;
    const purchaseType = orderId ? tx.purchaseTypes.get(orderId) : undefined;
    // The transfer of the same token tells us how to display the amount
    const leg = tx.transfers.find((t) => t.token === p.token);
    lines.push({
      ...blank,
      id: `event:${p.logIndex}`,
      type: purchaseType === 'TOPUP' ? 'TOPUP' : 'PURCHASE',
      from: p.eSIMWallet,
      token: p.token,
      symbol: leg?.symbol ?? null,
      decimals: leg?.decimals ?? null,
      amount: p.amount,
      eSIMWallet: p.eSIMWallet,
      orderId,
    });
  }

  for (const c of caps) {
    lines.push({ ...blank, id: `event:${c.logIndex}`, type: 'PRICE_CAP', eSIMWallet: c.eSIMWallet, priceCapUSDCents: c.priceCapUSDCents });
  }

  for (const t of tx.transfers) {
    const fromOwn = tx.wallets.has(t.from);
    const toOwn = tx.wallets.has(t.to);
    if (!fromOwn && !toOwn) continue;
    // A purchase's own legs (device wallet to eSIM wallet, eSIM wallet to the adapter) fold into its line
    if (purchases.length > 0 && fromOwn) continue;
    if (t.token !== null && !tx.tokens.has(t.token)) continue;
    // ETH to or from the EntryPoint is gas for a UserOp the paymaster did not cover
    if (t.token === null && (t.from === ENTRY_POINT || t.to === ENTRY_POINT)) continue;

    const type: ActivityType = fromOwn && toOwn ? 'MOVE' : fromOwn ? 'SEND' : 'RECEIVE';
    lines.push({ ...blank, id: t.id, type, from: t.from, to: t.to, token: t.token, symbol: t.symbol, decimals: t.decimals, amount: t.amount });
  }

  return lines.map(({ id, ...line }) => ({
    ...line,
    key: `${tx.deviceWalletAddress}:${id.startsWith('event:') ? `${tx.txHash}:${id}` : id}`,
    deviceWalletAddress: tx.deviceWalletAddress,
    txHash: tx.txHash,
    blockNumber: tx.blockNumber,
    time: tx.time,
  }));
};
