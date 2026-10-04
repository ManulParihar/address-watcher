import { ENTRY_POINT } from '../config.js';
import type { ActivityRow } from '../db/walletActivity.js';

/** One line in the wallet's transaction list. */
export interface ActivityItem {
  type: 'SEND' | 'RECEIVE' | 'MOVE' | 'PURCHASE';
  txHash: string;
  blockNumber: number;
  time: string;
  from: string;
  to: string;
  /** Null for ETH. */
  token: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Base units. */
  amount: string;
  /** PURCHASE only. */
  orderId?: string;
}

export interface Purchase {
  orderId: string;
  tokenAmount: string | null;
}

export interface ItemContext {
  /** The account's device wallet and eSIM wallets, lowercase. */
  wallets: Set<string>;
  /** Token contracts the account shows, lowercase. ETH is always shown. */
  tokens: Set<string>;
  /** Successful protocol payments in these transactions, keyed by lowercase tx hash. */
  purchases: Map<string, Purchase>;
}

/** Rows sorted newest first, grouped by transaction in that order. */
export const groupByTx = (rows: ActivityRow[]): ActivityRow[][] => {
  const groups = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const group = groups.get(row.txHash);
    if (group) group.push(row);
    else groups.set(row.txHash, [row]);
  }
  return [...groups.values()];
};

const toItem = (row: ActivityRow, type: ActivityItem['type']): ActivityItem => ({
  type,
  txHash: row.txHash,
  blockNumber: row.blockNumber,
  time: row.blockTime.toISOString(),
  from: row.from,
  to: row.to,
  token: row.token,
  symbol: row.symbol,
  decimals: row.decimals,
  amount: row.amount,
});

/** Turns one transaction's rows into the lines the app shows. */
export const toItems = (legs: ActivityRow[], ctx: ItemContext): ActivityItem[] => {
  const first = legs[0];
  if (!first) return [];

  const purchase = ctx.purchases.get(first.txHash);
  if (purchase) {
    // One line for the whole purchase: the leg that leaves the user's wallets for the protocol
    const out = legs.find((l) => ctx.wallets.has(l.from) && !ctx.wallets.has(l.to)) ?? first;
    return [{ ...toItem(out, 'PURCHASE'), amount: purchase.tokenAmount ?? out.amount, orderId: purchase.orderId }];
  }

  return legs
    .filter((l) => l.token === null || ctx.tokens.has(l.token))
    // ETH to or from the EntryPoint is gas for a UserOp the paymaster did not cover
    .filter((l) => !(l.token === null && (l.from === ENTRY_POINT || l.to === ENTRY_POINT)))
    .map((l) => {
      const fromOwn = ctx.wallets.has(l.from);
      const toOwn = ctx.wallets.has(l.to);
      return toItem(l, fromOwn && toOwn ? 'MOVE' : fromOwn ? 'SEND' : 'RECEIVE');
    });
};
