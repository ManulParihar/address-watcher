import { CHAINS, getConfig } from '../config.js';
import { WalletActivity } from '../db/walletActivity.js';
import { activityToRow, upsertOp, type AddressActivity } from '../alchemy/rows.js';
import { verifySignature } from '../alchemy/signature.js';

interface AddressActivityPayload {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event?: { network?: string; activity?: AddressActivity[] };
}

/**
 * Stores one Address Activity delivery. Throws SignatureError on a bad signature (answer 401),
 * anything else on a failed write (answer 500 so Alchemy retries). Every write is idempotent.
 */
export const handleAddressActivity = async (rawBody: Buffer, signature: string | undefined): Promise<void> => {
  const { signingKey, chainId } = getConfig();
  verifySignature(rawBody, signature, signingKey);
  const payload = JSON.parse(rawBody.toString('utf8')) as AddressActivityPayload;
  // A staging webhook pointed at production must not write rows
  if (payload.type !== 'ADDRESS_ACTIVITY' || payload.event?.network !== CHAINS[chainId].network) return;

  // The payload carries no block timestamp. createdAt is when Alchemy saw the block.
  const blockTime = new Date(payload.createdAt);
  const ops = [];
  for (const activity of payload.event.activity ?? []) {
    const row = activityToRow(activity, chainId, blockTime);
    if (!row) continue;
    ops.push(activity.log?.removed ? { deleteOne: { filter: { key: row.key } } } : upsertOp(row));
  }
  if (ops.length > 0) await WalletActivity.bulkWrite(ops, { ordered: false });
};
