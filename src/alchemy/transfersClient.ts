import { CHAINS, getConfig } from '../config.js';
import type { AssetTransfer } from './rows.js';

export interface TransfersPage {
  transfers: AssetTransfer[];
  pageKey?: string;
}

/** One page of `alchemy_getAssetTransfers`, oldest first, zero-value transfers excluded. */
export const getAssetTransfers = async (params: {
  fromAddress?: string;
  toAddress?: string;
  fromBlock: string;
  toBlock: string;
  pageKey?: string;
}): Promise<TransfersPage> => {
  const { chainId, alchemyApiKey } = getConfig();
  const chain = CHAINS[chainId];
  const res = await fetch(`https://${chain.rpcHost}.g.alchemy.com/v2/${alchemyApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'alchemy_getAssetTransfers',
      params: [
        {
          category: chain.backfillCategories,
          withMetadata: true,
          excludeZeroValue: true,
          order: 'asc',
          maxCount: '0x3e8',
          ...params,
        },
      ],
    }),
  });
  const body = (await res.json()) as { result?: TransfersPage; error?: unknown };
  if (!res.ok || !body.result) throw new Error(`alchemy_getAssetTransfers failed: ${JSON.stringify(body.error)}`);
  return body.result;
};
