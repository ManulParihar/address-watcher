// Read-only views of collections Kokio-BFF owns. Only the fields this service reads are declared,
// and the collection names are pinned to what the BFF's mongoose models create.
import mongoose, { Schema, type Types } from 'mongoose';

interface PaymentTransactionView {
  orderId: Types.ObjectId;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  transactionHash: string | null;
  /** Base units of the token actually spent. */
  tokenAmount: string | null;
}

export const PaymentTransaction = mongoose.model<PaymentTransactionView>(
  'PaymentTransactionView',
  new Schema<PaymentTransactionView>(
    { orderId: Schema.Types.ObjectId, status: String, transactionHash: String, tokenAmount: String },
    { strict: false },
  ),
  'paymenttransactions',
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
