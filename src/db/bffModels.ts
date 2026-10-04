// Read-only views of collections Kokio-BFF owns. Only the fields this service reads are declared,
// and the collection names are pinned to what the BFF's mongoose models create.
import mongoose, { Schema } from 'mongoose';

interface OrderView {
  purchaseType?: 'SIM' | 'TOPUP' | 'SIM_OR_TOPUP';
}

export const Order = mongoose.model<OrderView>(
  'OrderView',
  new Schema<OrderView>({ purchaseType: String }, { strict: false }),
  'orders',
);

interface AccountView {
  deviceWalletAddress: string;
  /** Tokens the user added in the app. Not in the BFF's Account schema yet. */
  customTokens?: { address: string; symbol: string; decimals: number }[];
}

export const Account = mongoose.model<AccountView>(
  'AccountView',
  new Schema<AccountView>(
    { deviceWalletAddress: String, customTokens: [{ address: String, symbol: String, decimals: Number }] },
    { strict: false },
  ),
  'accounts',
);
