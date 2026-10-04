import { describe, expect, it } from 'vitest';
import { fromAddressActivity, fromAssetTransfer, type AddressActivity } from '../src/alchemy/transfers.js';
import { AMOUNT, AMOUNT_HEX, DEVICE, ESIM, TX, USDC } from './fixtures.js';

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

describe('fromAddressActivity', () => {
  it('maps a token transfer using the raw value, not the float', () => {
    expect(fromAddressActivity(tokenActivity)).toMatchObject({ id: `${TX}:log:110`, amount: AMOUNT, token: USDC, decimals: 6 });
  });

  it('drops zero-value transfers and NFTs', () => {
    expect(fromAddressActivity({ ...tokenActivity, rawContract: { rawValue: '0x0' } })).toBeNull();
    expect(fromAddressActivity({ ...tokenActivity, category: 'erc721', erc721TokenId: '0x1' })).toBeNull();
  });

  it('gives ETH a null token and 18 decimals', () => {
    const t = fromAddressActivity({ ...tokenActivity, category: 'internal', log: null, rawContract: { rawValue: '0x1' } });
    expect(t).toMatchObject({ token: null, decimals: 18, id: `${TX}:native:${DEVICE}:${ESIM}:1` });
  });
});

describe('fromAssetTransfer', () => {
  it('gives the same id as the webhook for the same token transfer', () => {
    const t = fromAssetTransfer({
      uniqueId: `${TX}:log:110`,
      category: 'erc20',
      blockNum: '0x10',
      hash: TX,
      from: DEVICE,
      to: ESIM,
      asset: 'USDC',
      rawContract: { value: AMOUNT_HEX, address: USDC, decimal: '0x6' },
    });
    expect(t?.id).toBe(fromAddressActivity(tokenActivity)?.id);
    expect(t?.decimals).toBe(6);
  });

  it('gives the same id as the webhook for the same ETH transfer', () => {
    const webhook = fromAddressActivity({ ...tokenActivity, category: 'internal', log: null, rawContract: { rawValue: '0xde0b6b3a7640000' } });
    const backfill = fromAssetTransfer({
      uniqueId: `${TX}:internal:0`,
      category: 'internal',
      blockNum: '0x10',
      hash: TX,
      from: DEVICE,
      to: ESIM,
      asset: 'ETH',
      rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
    });
    expect(backfill?.id).toBe(webhook?.id);
  });
});
