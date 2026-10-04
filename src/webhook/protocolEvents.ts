import { getConfig } from '../config.js';
import { verifySignature } from '../alchemy/signature.js';
import { WatchedAddress } from '../db/watchedAddress.js';
import { processTx } from '../activity/ingest.js';

/** keccak256("PriceCapUSDCentsUpdated(uint64)"), the topic the Custom webhook filters on. */
export const PRICE_CAP_TOPIC = '0xa4cb36ed327c8d262711fcd1c50594e6d1170201b6e8c810084119a05d85f581';

interface CustomWebhookPayload {
  type: string;
  event?: {
    data?: {
      block?: { logs?: { account?: { address?: string }; topics?: string[]; transaction?: { hash?: string } }[] };
    };
  };
}

/**
 * Handles one Custom (GraphQL) webhook delivery carrying price cap changes. These move no tokens,
 * so Address Activity never reports them. Same error contract as the Address Activity handler.
 */
export const handleProtocolEvents = async (rawBody: Buffer, signature: string | undefined): Promise<void> => {
  verifySignature(rawBody, signature, getConfig().eventsSigningKey);
  const payload = JSON.parse(rawBody.toString('utf8')) as CustomWebhookPayload;
  if (payload.type !== 'GRAPHQL') return;

  // The filter is topic-only, so check the emitter is one of our eSIM wallets before fetching receipts
  const candidates = new Map<string, string>();
  for (const log of payload.event?.data?.block?.logs ?? []) {
    const emitter = log.account?.address?.toLowerCase();
    const txHash = log.transaction?.hash?.toLowerCase();
    if (emitter && txHash && log.topics?.[0] === PRICE_CAP_TOPIC) candidates.set(txHash, emitter);
  }
  if (candidates.size === 0) return;

  const watched = await WatchedAddress.find({ address: { $in: [...candidates.values()] }, kind: 'ESIM' }, { address: 1 }).lean();
  const known = new Set(watched.map((w) => w.address));
  for (const [txHash, emitter] of candidates) {
    // Transfers in the same transaction, if any, arrive through Address Activity
    if (known.has(emitter)) await processTx(txHash, []);
  }
};
