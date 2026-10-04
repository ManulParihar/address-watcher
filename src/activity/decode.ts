import { ESIMWallet } from 'kokio-sdk/abis';
import { parseEventLogs, type Log } from 'viem';

export interface PurchaseEvent {
  logIndex: number;
  eSIMWallet: string;
  token: string;
  /** Base units the adapter actually took. */
  amount: string;
  paymentReference: `0x${string}`;
}

export interface PriceCapEvent {
  logIndex: number;
  eSIMWallet: string;
  priceCapUSDCents: number;
}

export interface KokioEvents {
  purchases: PurchaseEvent[];
  priceCaps: PriceCapEvent[];
}

/**
 * Pulls the history-worthy Kokio events out of a receipt's logs. Any contract can emit an event
 * with the same signature, so callers must check the emitter is a watched eSIM wallet.
 */
export const decodeKokioEvents = (logs: Log[]): KokioEvents => {
  const events = parseEventLogs({
    abi: ESIMWallet,
    logs,
    eventName: ['DataBundleBoughtWithToken', 'PriceCapUSDCentsUpdated'],
  });

  const result: KokioEvents = { purchases: [], priceCaps: [] };
  for (const e of events) {
    const eSIMWallet = e.address.toLowerCase();
    const logIndex = e.logIndex ?? 0;
    if (e.eventName === 'DataBundleBoughtWithToken') {
      result.purchases.push({
        logIndex,
        eSIMWallet,
        token: e.args._token.toLowerCase(),
        amount: e.args._amountSpent.toString(),
        paymentReference: e.args._paymentReference,
      });
    } else {
      result.priceCaps.push({ logIndex, eSIMWallet, priceCapUSDCents: Number(e.args._cap) });
    }
  }
  return result;
};

const OBJECT_ID_HEX_LENGTH = 24;

/**
 * Kokio-BFF writes an order's ObjectId, left-padded to 32 bytes, as the payment reference.
 * Returns null for a reference that was not made that way.
 */
export const orderIdFromPaymentReference = (reference: `0x${string}`): string | null => {
  const hex = reference.slice(2);
  if (hex.length !== 64) return null;
  const padding = hex.slice(0, 64 - OBJECT_ID_HEX_LENGTH);
  return /^0+$/.test(padding) ? hex.slice(-OBJECT_ID_HEX_LENGTH) : null;
};
