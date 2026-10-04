import { getConfig } from '../config.js';
import { WalletActivity, type ActivityRow } from '../db/walletActivity.js';
import { WatchedAddress, type WalletKind } from '../db/watchedAddress.js';
import { updateWebhookAddresses } from '../alchemy/notifyClient.js';
import { getAssetTransfers } from '../alchemy/transfersClient.js';
import { transferToRow, upsertOp } from '../alchemy/rows.js';

const BATCH = 500;

/** Queue a wallet for watching. Kokio-BFF calls this whenever it learns a new wallet address. */
export const watchWallet = (address: string, deviceWalletAddress: string, kind: WalletKind) =>
  WatchedAddress.updateOne(
    { address: address.toLowerCase() },
    { $setOnInsert: { deviceWalletAddress: deviceWalletAddress.toLowerCase(), kind, status: 'PENDING' } },
    { upsert: true },
  );

/** Stop watching every wallet of a deleted account. The next sync tells Alchemy. */
export const unwatchAccount = (deviceWalletAddress: string) =>
  WatchedAddress.updateMany({ deviceWalletAddress: deviceWalletAddress.toLowerCase() }, { status: 'REMOVING' });

/** Copies past transfers of one wallet into walletActivity. Safe to rerun over any block range. */
export const backfillAddress = async (address: string, fromBlock = '0x0', toBlock = 'latest'): Promise<void> => {
  const { chainId } = getConfig();
  // getAssetTransfers matches one direction per call
  for (const direction of ['fromAddress', 'toAddress'] as const) {
    let pageKey: string | undefined;
    do {
      const page = await getAssetTransfers({ [direction]: address, fromBlock, toBlock, pageKey });
      const ops = page.transfers
        .map((t) => transferToRow(t, chainId))
        .filter((row): row is ActivityRow => row !== null)
        .map(upsertOp);
      if (ops.length > 0) await WalletActivity.bulkWrite(ops, { ordered: false });
      pageKey = page.pageKey;
    } while (pageKey);
  }
};

/** Watch PENDING wallets, backfill them, and drop wallets of deleted accounts. */
export const runWatchlistSync = async (): Promise<void> => {
  const pending = await WatchedAddress.find({ status: 'PENDING' }).limit(BATCH).lean();
  if (pending.length > 0) {
    // Watch first, backfill second. A transfer landing in between arrives from both and dedupes on key.
    await updateWebhookAddresses(pending.map((w) => w.address), []);
    for (const w of pending) {
      await backfillAddress(w.address);
      await WatchedAddress.updateOne({ address: w.address }, { status: 'WATCHED' });
    }
  }

  const removing = await WatchedAddress.find({ status: 'REMOVING' }).limit(BATCH).lean();
  if (removing.length > 0) {
    const addresses = removing.map((w) => w.address);
    await updateWebhookAddresses([], addresses);
    await WatchedAddress.deleteMany({ address: { $in: addresses } });
  }
};

/** Refills a window the webhook missed, such as an outage longer than Alchemy's retries. Blocks in hex. */
export const repairGap = async (fromBlock: string, toBlock: string): Promise<void> => {
  for await (const w of WatchedAddress.find({ status: 'WATCHED' }).lean().cursor()) {
    await backfillAddress(w.address, fromBlock, toBlock);
  }
};
