import { CHAINS, getConfig } from '../config.js';
import { verifySignature } from '../alchemy/signature.js';
import { fromAddressActivity, type AddressActivity, type Transfer } from '../alchemy/transfers.js';
import { processTx, removeTx } from '../activity/ingest.js';

interface AddressActivityPayload {
  type: string;
  event?: { network?: string; activity?: AddressActivity[] };
}

/**
 * Handles one Address Activity delivery. Throws SignatureError on a bad signature (answer 401),
 * anything else when processing fails (answer 500 so Alchemy retries). Processing is idempotent.
 */
export const handleAddressActivity = async (rawBody: Buffer, signature: string | undefined): Promise<void> => {
  const { signingKey, chainId } = getConfig();
  verifySignature(rawBody, signature, signingKey);
  const payload = JSON.parse(rawBody.toString('utf8')) as AddressActivityPayload;
  // A staging webhook pointed at production must not write lines
  if (payload.type !== 'ADDRESS_ACTIVITY' || payload.event?.network !== CHAINS[chainId].network) return;

  const byTx = new Map<string, Transfer[]>();
  const reorged = new Set<string>();
  for (const activity of payload.event.activity ?? []) {
    if (activity.log?.removed) {
      reorged.add(activity.hash.toLowerCase());
      continue;
    }
    const transfer = fromAddressActivity(activity);
    if (transfer) byTx.set(transfer.txHash, [...(byTx.get(transfer.txHash) ?? []), transfer]);
  }

  for (const txHash of reorged) await removeTx(txHash);
  for (const [txHash, transfers] of byTx) await processTx(txHash, transfers);
};
