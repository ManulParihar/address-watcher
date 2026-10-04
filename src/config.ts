import { base, baseSepolia } from 'viem/chains';

/** Per-chain settings. Token addresses were checked onchain with `cast`. */
export const CHAINS = {
  8453: {
    chain: base,
    network: 'BASE_MAINNET',
    rpcHost: 'base-mainnet',
    backfillCategories: ['external', 'internal', 'erc20'],
    // Not deployed yet. Set BACKFILL_FROM_BLOCK when it is.
    protocolDeployBlock: null,
    // Circle USDC
    defaultTokens: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
  },
  84532: {
    chain: baseSepolia,
    network: 'BASE_SEPOLIA',
    rpcHost: 'base-sepolia',
    // getAssetTransfers has no internal transfers on Base Sepolia
    backfillCategories: ['external', 'erc20'],
    // deployedAtBlock in smart-contract-suite/deployments/base-sepolia-84532-entrypoint-v8.json
    protocolDeployBlock: 46_246_173n,
    // Circle USDC, and Kokio's test token (USDCt in the BFF's ASSETS)
    defaultTokens: ['0x036cbd53842c5426634e7929541ec2318f3dcf7e', '0x6ac3ab54dc5019a2e57eccb214337ff5bbd52897'],
  },
} as const;

export type ChainId = keyof typeof CHAINS;

/** ERC-4337 EntryPoint v0.8, same address on Base and Base Sepolia. */
export const ENTRY_POINT = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';

/** How many history lines each device wallet keeps. Older lines are deleted. */
export const HISTORY_LIMIT = 20;

export interface Config {
  chainId: ChainId;
  port: number;
  mongodbUri: string;
  alchemyApiKey: string;
  /** Signing key of the Address Activity webhook. */
  signingKey: string;
  /** Signing key of the Custom webhook that carries price cap changes. */
  eventsSigningKey: string;
  webhookId: string;
  notifyAuthToken: string;
  internalApiToken: string;
  syncIntervalMs: number;
  /** Backfill never reads before this block. */
  backfillFromBlock: bigint;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

let cached: Config | undefined;

/**
 * Reads the environment on first call. Throws on a missing secret, since an empty HMAC key or
 * internal token would accept forged requests.
 */
export const getConfig = (): Config => {
  if (cached) return cached;
  const chainId = Number(required('CHAIN_ID'));
  if (!(chainId in CHAINS)) throw new Error(`Unsupported CHAIN_ID ${chainId}`);
  const chain = CHAINS[chainId as ChainId];

  const fromBlockEnv = process.env.BACKFILL_FROM_BLOCK;
  const backfillFromBlock = fromBlockEnv ? BigInt(fromBlockEnv) : chain.protocolDeployBlock;
  if (backfillFromBlock === null) throw new Error(`BACKFILL_FROM_BLOCK is not set for chain ${chainId}`);

  cached = {
    chainId: chainId as ChainId,
    port: Number(process.env.PORT ?? 3000),
    mongodbUri: required('MONGODB_URI'),
    alchemyApiKey: required('ALCHEMY_API_KEY'),
    signingKey: required('ALCHEMY_ACTIVITY_SIGNING_KEY'),
    eventsSigningKey: required('ALCHEMY_EVENTS_SIGNING_KEY'),
    webhookId: required('ALCHEMY_ACTIVITY_WEBHOOK_ID'),
    notifyAuthToken: required('ALCHEMY_NOTIFY_AUTH_TOKEN'),
    internalApiToken: required('INTERNAL_API_TOKEN'),
    syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 60_000),
    backfillFromBlock,
  };
  return cached;
};

/** Alchemy RPC endpoint for the configured chain. */
export const rpcUrl = (): string => {
  const { chainId, alchemyApiKey } = getConfig();
  return `https://${CHAINS[chainId].rpcHost}.g.alchemy.com/v2/${alchemyApiKey}`;
};
