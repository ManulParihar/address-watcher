import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { getConfig } from './config.js';
import { SignatureError } from './alchemy/signature.js';
import { handleAddressActivity } from './webhook/addressActivity.js';
import { handleProtocolEvents } from './webhook/protocolEvents.js';
import { repairGap, runWatchlistSync, unwatchAccount, watchWallet } from './watchlist/sync.js';
import { getWalletActivity } from './activity/query.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BLOCK = /^(0x[0-9a-fA-F]+|\d+)$/;

// Every route except the webhook is for Kokio-BFF only, which sends the shared token.
const requireInternalToken = (req: Request, res: Response, next: NextFunction) => {
  const expected = Buffer.from(getConfig().internalApiToken);
  const given = Buffer.from(req.get('x-internal-token') ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).end();
    return;
  }
  next();
};

const badRequest = (res: Response, message: string) => res.status(400).json({ error: message });

export const createApp = () => {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: mongoose.connection.readyState === 1 });
  });

  // The signature covers the exact bytes Alchemy sent, so webhook routes take the raw body
  const webhook =
    (handle: (body: Buffer, signature: string | undefined) => Promise<void>) => async (req: Request, res: Response) => {
      try {
        await handle(req.body as Buffer, req.get('x-alchemy-signature'));
        res.status(200).json({ received: true });
      } catch (err) {
        if (err instanceof SignatureError) {
          res.status(401).end();
          return;
        }
        console.error(`${req.path} failed`, err);
        res.status(500).end();
      }
    };
  app.post('/webhooks/address-activity', express.raw({ type: 'application/json' }), webhook(handleAddressActivity));
  app.post('/webhooks/protocol-events', express.raw({ type: 'application/json' }), webhook(handleProtocolEvents));

  const internal = express.Router();
  internal.use(requireInternalToken, express.json());

  internal.post('/watch', async (req, res) => {
    const { address, deviceWalletAddress, kind } = req.body ?? {};
    if (!ADDRESS.test(address) || !ADDRESS.test(deviceWalletAddress)) return badRequest(res, 'invalid address');
    if (kind !== 'DEVICE' && kind !== 'ESIM') return badRequest(res, 'kind must be DEVICE or ESIM');
    await watchWallet(address, deviceWalletAddress, kind);
    res.status(202).end();
  });

  internal.delete('/watch/:deviceWalletAddress', async (req, res) => {
    if (!ADDRESS.test(req.params.deviceWalletAddress)) return badRequest(res, 'invalid address');
    await unwatchAccount(req.params.deviceWalletAddress);
    res.status(202).end();
  });

  internal.get('/activity/:deviceWalletAddress', async (req, res) => {
    if (!ADDRESS.test(req.params.deviceWalletAddress)) return badRequest(res, 'invalid address');
    res.json({ items: await getWalletActivity(req.params.deviceWalletAddress) });
  });

  // Runs in the background: one backfill per watched wallet can take a while
  internal.post('/repair', (req, res) => {
    const { fromBlock } = req.body ?? {};
    if (typeof fromBlock !== 'string' || !BLOCK.test(fromBlock)) return badRequest(res, 'fromBlock must be a block number');
    repairGap(BigInt(fromBlock)).catch((err) => console.error('repair failed', err));
    res.status(202).end();
  });

  app.use(internal);
  return app;
};

// ponytail: in-process timer, assumes one instance. Use a shared lock (like the BFF's job locks) before scaling out.
const startSyncLoop = (intervalMs: number) => {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runWatchlistSync();
    } catch (err) {
      console.error('watch list sync failed', err);
    } finally {
      running = false;
    }
  }, intervalMs);
};

const main = async () => {
  const config = getConfig();
  await mongoose.connect(config.mongodbUri);
  startSyncLoop(config.syncIntervalMs);
  createApp().listen(config.port, () => console.log(`address-watcher listening on ${config.port}`));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
