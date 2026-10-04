import { describe, expect, it } from 'vitest';
import { groupByTx, toItems, type ItemContext } from '../src/activity/items.js';
import { ENTRY_POINT } from '../src/config.js';
import type { ActivityRow } from '../src/db/walletActivity.js';
import { ADAPTER, AMOUNT, DEVICE, ESIM, SPAM_TOKEN, STRANGER, TX, TX2, USDC } from './fixtures.js';

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  key: `${TX}:log:1`,
  chainId: 84532,
  txHash: TX,
  blockNumber: 16,
  blockTime: new Date('2026-10-03T18:44:10Z'),
  from: DEVICE,
  to: ESIM,
  token: USDC,
  symbol: 'USDC',
  decimals: 6,
  amount: AMOUNT,
  source: 'WEBHOOK',
  ...over,
});

const ctx = (purchases: ItemContext['purchases'] = new Map()): ItemContext => ({
  wallets: new Set([DEVICE, ESIM]),
  tokens: new Set([USDC]),
  purchases,
});

const lines = (rows: ActivityRow[], c: ItemContext) =>
  groupByTx(rows).flatMap((g) => toItems(g, c)).map((i) => [i.type, i.from, i.to]);

describe('toItems', () => {
  it('collapses a purchase into one line with the spent amount and order', () => {
    const pull = row({});
    const pay = row({ key: `${TX}:log:2`, from: ESIM, to: ADAPTER });
    const items = groupByTx([pull, pay]).flatMap((g) =>
      toItems(g, ctx(new Map([[TX, { orderId: 'order-1', tokenAmount: '13000000' }]]))),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'PURCHASE', from: ESIM, to: ADAPTER, amount: '13000000', orderId: 'order-1' });
  });

  it('labels sends, receives and moves between own wallets', () => {
    const rows = [
      row({ key: 'a', txHash: TX, from: DEVICE, to: STRANGER }),
      row({ key: 'b', txHash: TX2, blockNumber: 15, from: STRANGER, to: DEVICE }),
      row({ key: 'c', txHash: `0x${'ef'.repeat(32)}`, blockNumber: 14, from: ESIM, to: DEVICE }),
    ];
    expect(lines(rows, ctx())).toEqual([
      ['SEND', DEVICE, STRANGER],
      ['RECEIVE', STRANGER, DEVICE],
      ['MOVE', ESIM, DEVICE],
    ]);
  });

  it('hides tokens off the list and gas paid to the EntryPoint', () => {
    const rows = [
      row({ key: 'a', from: STRANGER, to: DEVICE, token: SPAM_TOKEN }),
      row({ key: 'b', from: DEVICE, to: ENTRY_POINT, token: null, decimals: 18 }),
      row({ key: 'c', from: STRANGER, to: DEVICE, token: null, decimals: 18 }),
    ];
    expect(lines(rows, ctx())).toEqual([['RECEIVE', STRANGER, DEVICE]]);
  });
});

describe('groupByTx', () => {
  it('keeps newest-first order across transactions', () => {
    const groups = groupByTx([row({ key: 'a' }), row({ key: 'b', txHash: TX2 }), row({ key: 'c' })]);
    expect(groups.map((g) => g.map((r) => r.key))).toEqual([['a', 'c'], ['b']]);
  });
});
