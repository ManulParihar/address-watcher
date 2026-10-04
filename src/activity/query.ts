import { HISTORY_LIMIT } from '../config.js';
import { Activity, type ActivityDoc } from '../db/activity.js';

export type ActivityItem = Omit<ActivityDoc, 'key' | 'deviceWalletAddress'>;

/** The stored history of one device wallet, newest first. */
export const getWalletActivity = async (deviceWalletAddress: string): Promise<ActivityItem[]> => {
  const docs = await Activity.find({ deviceWalletAddress: deviceWalletAddress.toLowerCase() })
    .sort({ blockNumber: -1, key: -1 })
    .limit(HISTORY_LIMIT)
    .lean();
  return docs.map(({ type, txHash, blockNumber, time, from, to, token, symbol, decimals, amount, eSIMWallet, orderId, priceCapUSDCents }) => ({
    type,
    txHash,
    blockNumber,
    time,
    from,
    to,
    token,
    symbol,
    decimals,
    amount,
    eSIMWallet,
    orderId,
    priceCapUSDCents,
  }));
};
