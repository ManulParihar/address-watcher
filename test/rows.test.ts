import { describe, expect, it } from 'vitest';
import { activityToRow, transferToRow, upsertOp, type AddressActivity } from '../src/alchemy/rows.js';
import { AMOUNT, AMOUNT_HEX, DEVICE, ESIM, TX, USDC } from './fixtures.js';

const at = new Date('2026-10-03T18:44:10.411977228Z');

const tokenActivity: AddressActivity = {
  blockNum: '0x10',
  hash: TX,
  fromAddress: DEVICE,
  toAddress: ESIM,
  value: 13.05,
  asset: 'USDC',
  category: 'token',
  erc721TokenId: null,
  erc1155Metadata: null,
  rawContract: { rawValue: AMOUNT_HEX, address: USDC, decimals: 6 },
  log: { logIndex: '0x6e', removed: false },
};

describe('activityToRow', () => {
  it('maps a token transfer using the raw value, not the float', () => {
    const row = activityToRow(tokenActivity, 84532, at);
    expect(row).toMatchObject({ key: `${TX}:log:110`, amount: AMOUNT, blockNumber: 16, token: USDC, decimals: 6 });
  });

  it('drops zero-value transfers and NFTs', () => {
    expect(activityToRow({ ...tokenActivity, rawContract: { rawValue: '0x0' } }, 84532, at)).toBeNull();
    expect(activityToRow({ ...tokenActivity, category: 'erc721', erc721TokenId: '0x1' }, 84532, at)).toBeNull();
  });

  it('gives ETH a null token and 18 decimals', () => {
    const row = activityToRow({ ...tokenActivity, category: 'internal', log: null, rawContract: { rawValue: '0x1' } }, 84532, at);
    expect(row).toMatchObject({ token: null, decimals: 18, key: `${TX}:native:${DEVICE}:${ESIM}:1` });
  });
});

describe('transferToRow', () => {
  it('builds the same key as the webhook for the same token transfer', () => {
    const row = transferToRow(
      {
        uniqueId: `${TX}:log:110`,
        category: 'erc20',
        blockNum: '0x10',
        hash: TX,
        from: DEVICE,
        to: ESIM,
        asset: 'USDC',
        rawContract: { value: AMOUNT_HEX, address: USDC, decimal: '0x6' },
        metadata: { blockTimestamp: '2026-10-03T18:44:10.000Z' },
      },
      84532,
    );
    expect(row?.key).toBe(activityToRow(tokenActivity, 84532, at)?.key);
    expect(row?.decimals).toBe(6);
  });

  it('builds the same key as the webhook for the same ETH transfer', () => {
    const webhook = activityToRow({ ...tokenActivity, category: 'internal', log: null, rawContract: { rawValue: '0xde0b6b3a7640000' } }, 1, at);
    const backfill = transferToRow(
      {
        uniqueId: `${TX}:internal:0`,
        category: 'internal',
        blockNum: '0x10',
        hash: TX,
        from: DEVICE,
        to: ESIM,
        asset: 'ETH',
        rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
        metadata: { blockTimestamp: '2026-10-03T18:44:10.000Z' },
      },
      1,
    );
    expect(backfill?.key).toBe(webhook?.key);
  });
});

describe('upsertOp', () => {
  it('keeps the key out of the update so racing upserts land on one document', () => {
    const row = activityToRow(tokenActivity, 84532, at)!;
    const op = upsertOp(row);
    expect(op.updateOne.filter).toEqual({ key: row.key });
    expect(op.updateOne.update.$setOnInsert).not.toHaveProperty('key');
  });
});
