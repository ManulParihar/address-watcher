import { getConfig } from '../config.js';

/** Adds and removes addresses on the Address Activity webhook. Alchemy treats a repeat as a no-op. */
export const updateWebhookAddresses = async (add: string[], remove: string[]): Promise<void> => {
  const { notifyAuthToken, webhookId } = getConfig();
  const res = await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Alchemy-Token': notifyAuthToken },
    body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: add, addresses_to_remove: remove }),
  });
  if (!res.ok) throw new Error(`update-webhook-addresses failed: ${res.status} ${await res.text()}`);
};
