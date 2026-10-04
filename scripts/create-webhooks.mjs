// Creates the two Alchemy webhooks this service needs and prints the values for .env.
//
//   node --env-file=.env scripts/create-webhooks.mjs https://your-tunnel.ngrok-free.app
//
// Reads ALCHEMY_NOTIFY_AUTH_TOKEN and CHAIN_ID from the environment. Run it once per public URL.

const PRICE_CAP_TOPIC = '0xa4cb36ed327c8d262711fcd1c50594e6d1170201b6e8c810084119a05d85f581';
const NETWORKS = { 8453: 'BASE_MAINNET', 84532: 'BASE_SEPOLIA' };

const PRICE_CAP_QUERY = `{
  block {
    number
    timestamp
    logs(filter: { addresses: [], topics: ["${PRICE_CAP_TOPIC}"] }) {
      account { address }
      topics
      index
      transaction { hash }
    }
  }
}`;

const baseUrl = process.argv[2]?.replace(/\/$/, '');
const token = process.env.ALCHEMY_NOTIFY_AUTH_TOKEN;
const network = NETWORKS[process.env.CHAIN_ID ?? '84532'];

if (!baseUrl?.startsWith('https://')) throw new Error('Pass the public https URL, e.g. https://abc.ngrok-free.app');
if (!token) throw new Error('ALCHEMY_NOTIFY_AUTH_TOKEN is not set');
if (!network) throw new Error(`Unsupported CHAIN_ID ${process.env.CHAIN_ID}`);

const createWebhook = async (body) => {
  const res = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alchemy-Token': token },
    body: JSON.stringify({ network, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.data) throw new Error(`create-webhook failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data;
};

const activity = await createWebhook({
  webhook_type: 'ADDRESS_ACTIVITY',
  webhook_url: `${baseUrl}/webhooks/address-activity`,
  addresses: [],
});
const events = await createWebhook({
  webhook_type: 'GRAPHQL',
  webhook_url: `${baseUrl}/webhooks/protocol-events`,
  graphql_query: PRICE_CAP_QUERY,
});

console.log('Add these to .env:\n');
console.log(`ALCHEMY_ACTIVITY_WEBHOOK_ID=${activity.id}`);
console.log(`ALCHEMY_ACTIVITY_SIGNING_KEY=${activity.signing_key}`);
console.log(`ALCHEMY_EVENTS_SIGNING_KEY=${events.signing_key}`);
