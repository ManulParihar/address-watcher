import { describe, expect, it } from 'vitest';
import { buildLines, type TxView } from '../src/activity/items.js';
import { ENTRY_POINT } from '../src/config.js';
import type { Transfer } from '../src/alchemy/transfers.js';
import { ADAPTER, AMOUNT, DEVICE, ESIM, SPAM_TOKEN, STRANGER, TX, USDC } from './fixtures.js';

const transfer = (over: Partial<Transfer>): Transfer => ({
  id: `${TX}:log:1`,
  txHash: TX,
  from: DEVICE,
  to: ESIM,
  token: USDC,
  symbol: 'USDC',
  decimals: 6,
  amount: AMOUNT,
  ...over,
});

const view = (over: Partial<TxView>): TxView => ({
  deviceWalletAddress: DEVICE,
  wallets: new Set([DEVICE, ESIM]),
  tokens: new Set([USDC]),
  txHash: TX,
  blockNumber: 16,
  time: new Date('2026-10-03T18:44:10Z'),
  transfers: [],
  events: { purchases: [], priceCaps: [] },
  purchaseTypes: new Map(),
  orderIds: new Map(),
  ...over,
});

const purchase = { logIndex: 3, eSIMWallet: ESIM, token: USDC, amount: '13000000', paymentReference: '0x00' as const };

describe('buildLines', () => {
  it('folds a purchase and its legs into one line', () => {
    const lines = buildLines(
      view({
        transfers: [transfer({}), transfer({ id: `${TX}:log:2`, from: ESIM, to: ADAPTER })],
        events: { purchases: [purchase], priceCaps: [] },
        orderIds: new Map([[3, 'order-1']]),
        purchaseTypes: new Map([['order-1', 'SIM']]),
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'PURCHASE', amount: '13000000', decimals: 6, orderId: 'order-1', key: `${DEVICE}:${TX}:event:3` });
  });

  it('labels a top-up from the order', () => {
    const lines = buildLines(
      view({
        events: { purchases: [purchase], priceCaps: [] },
        orderIds: new Map([[3, 'order-2']]),
        purchaseTypes: new Map([['order-2', 'TOPUP']]),
      }),
    );
    expect(lines.map((l) => l.type)).toEqual(['TOPUP']);
  });

  it('shows a price cap change on one of the device wallet eSIM wallets', () => {
    const lines = buildLines(view({ events: { purchases: [], priceCaps: [{ logIndex: 4, eSIMWallet: ESIM, priceCapUSDCents: 2500 }] } }));
    expect(lines[0]).toMatchObject({ type: 'PRICE_CAP', eSIMWallet: ESIM, priceCapUSDCents: 2500, amount: null });
  });

  it('ignores events from wallets this device does not own', () => {
    const lines = buildLines(view({ events: { purchases: [{ ...purchase, eSIMWallet: STRANGER }], priceCaps: [{ logIndex: 4, eSIMWallet: STRANGER, priceCapUSDCents: 1 }] } }));
    expect(lines).toEqual([]);
  });

  it('labels sends, receives and moves', () => {
    const types = (t: Partial<Transfer>) => buildLines(view({ transfers: [transfer(t)] })).map((l) => l.type);
    expect(types({ from: DEVICE, to: STRANGER })).toEqual(['SEND']);
    expect(types({ from: STRANGER, to: DEVICE })).toEqual(['RECEIVE']);
    expect(types({ from: ESIM, to: DEVICE })).toEqual(['MOVE']);
  });

  it('hides tokens off the list and gas paid to the EntryPoint', () => {
    const lines = buildLines(
      view({
        transfers: [
          transfer({ id: 'a', from: STRANGER, to: DEVICE, token: SPAM_TOKEN }),
          transfer({ id: 'b', from: DEVICE, to: ENTRY_POINT, token: null, decimals: 18 }),
          transfer({ id: 'c', from: STRANGER, to: DEVICE, token: null, decimals: 18 }),
        ],
      }),
    );
    expect(lines.map((l) => [l.type, l.key])).toEqual([['RECEIVE', `${DEVICE}:c`]]);
  });
});
