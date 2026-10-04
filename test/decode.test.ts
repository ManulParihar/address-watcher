import { ESIMWallet } from 'kokio-sdk/abis';
import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeKokioEvents, orderIdFromPaymentReference } from '../src/activity/decode.js';
import { ESIM, TX, USDC } from './fixtures.js';

const ORDER_ID = '66fe9c2a8b1d4e0012ab34cd';
const REFERENCE = `0x${ORDER_ID.padStart(64, '0')}` as const;

// A log as viem returns it from a receipt. encodeEventTopics types topics loosely, so accept that.
const log = (topics: readonly unknown[], data: `0x${string}`, logIndex: number): Log => ({
  address: ESIM as `0x${string}`,
  topics: topics as [`0x${string}`, ...`0x${string}`[]],
  data,
  logIndex,
  blockHash: `0x${'00'.repeat(32)}`,
  blockNumber: 16n,
  transactionHash: TX as `0x${string}`,
  transactionIndex: 0,
  removed: false,
});

const purchaseLog = log(
  encodeEventTopics({
    abi: ESIMWallet,
    eventName: 'DataBundleBoughtWithToken',
    args: { _asset: `0x${'aa'.repeat(32)}`, _token: USDC as `0x${string}`, _paymentReference: REFERENCE },
  }),
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'uint256' }],
    [`0x${'bb'.repeat(32)}`, 1305n, 13_050_000n],
  ),
  3,
);

const capLog = log(
  encodeEventTopics({ abi: ESIMWallet, eventName: 'PriceCapUSDCentsUpdated' }),
  encodeAbiParameters([{ type: 'uint64' }], [2500n]),
  4,
);

describe('decodeKokioEvents', () => {
  it('reads purchases and cap changes and ignores other logs', () => {
    const other = log([`0x${'cc'.repeat(32)}`], '0x', 5);
    const { purchases, priceCaps } = decodeKokioEvents([purchaseLog, capLog, other]);
    expect(purchases).toEqual([{ logIndex: 3, eSIMWallet: ESIM, token: USDC, amount: '13050000', paymentReference: REFERENCE }]);
    expect(priceCaps).toEqual([{ logIndex: 4, eSIMWallet: ESIM, priceCapUSDCents: 2500 }]);
  });
});

describe('orderIdFromPaymentReference', () => {
  it('recovers the order id from a left-padded reference', () => {
    expect(orderIdFromPaymentReference(REFERENCE)).toBe(ORDER_ID);
  });

  it('rejects a reference with non-zero padding', () => {
    expect(orderIdFromPaymentReference(`0x${'1'.repeat(40)}${ORDER_ID}`)).toBeNull();
  });
});
