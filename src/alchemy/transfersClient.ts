import { CHAINS, getConfig, rpcUrl } from '../config.js';
import type { AssetTransfer } from './transfers.js';

/**
 * The newest `maxCount` transfers into or out of one address since `fromBlock`, newest first,
 * zero-value transfers excluded. History keeps only the newest lines, so one page is enough.
 */
export const getRecentTransfers = async (params: {
  fromAddress?: string;
  toAddress?: string;
  fromBlock: bigint;
  maxCount: number;
}): Promise<AssetTransfer[]> => {
  const { fromBlock, maxCount, ...direction } = params;
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'alchemy_getAssetTransfers',
      params: [
        {
          ...direction,
          category: CHAINS[getConfig().chainId].backfillCategories,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: 'latest',
          order: 'desc',
          maxCount: `0x${maxCount.toString(16)}`,
          excludeZeroValue: true,
        },
      ],
    }),
  });
  const body = (await res.json()) as { result?: { transfers: AssetTransfer[] }; error?: unknown };
  if (!res.ok || !body.result) throw new Error(`alchemy_getAssetTransfers failed: ${JSON.stringify(body.error)}`);
  return body.result.transfers;
};
