import mongoose, { Schema } from 'mongoose';

export type WalletKind = 'DEVICE' | 'ESIM';

/** A wallet Alchemy should watch, and the account it belongs to. */
export interface WatchedAddressDoc {
  address: string;
  deviceWalletAddress: string;
  kind: WalletKind;
  /** PENDING: not sent to Alchemy yet. WATCHED: sent and backfilled. REMOVING: account deleted. */
  status: 'PENDING' | 'WATCHED' | 'REMOVING';
}

const WatchedAddressSchema = new Schema<WatchedAddressDoc>(
  {
    address: { type: String, required: true, unique: true, lowercase: true },
    deviceWalletAddress: { type: String, required: true, lowercase: true, index: true },
    kind: { type: String, enum: ['DEVICE', 'ESIM'], required: true },
    status: { type: String, enum: ['PENDING', 'WATCHED', 'REMOVING'], default: 'PENDING', index: true },
  },
  { timestamps: true },
);

export const WatchedAddress = mongoose.model<WatchedAddressDoc>('WatchedAddress', WatchedAddressSchema);
