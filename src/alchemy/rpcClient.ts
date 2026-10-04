import { createPublicClient, http, type PublicClient } from 'viem';
import { CHAINS, getConfig, rpcUrl } from '../config.js';

let client: PublicClient | undefined;

/** viem client on the configured chain, through Alchemy. */
export const getClient = (): PublicClient => {
  client ??= createPublicClient({ chain: CHAINS[getConfig().chainId].chain, transport: http(rpcUrl()) }) as PublicClient;
  return client;
};
