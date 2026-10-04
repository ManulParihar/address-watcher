import mongoose, { Schema } from 'mongoose';

export type ActivityType = 'PURCHASE' | 'TOPUP' | 'SEND' | 'RECEIVE' | 'MOVE' | 'PRICE_CAP';

/** One line of a device wallet's history. Only the newest HISTORY_LIMIT per device are kept. */
export interface ActivityDoc {
  /** `<deviceWalletAddress>:<line id>`. The line id is the transfer id, or the event's log position. */
  key: string;
  deviceWalletAddress: string;
  type: ActivityType;
  txHash: string;
  blockNumber: number;
  time: Date;
  from: string | null;
  to: string | null;
  /** Token contract, null for ETH and for price cap changes. */
  token: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Base units. Null for price cap changes. */
  amount: string | null;
  /** The eSIM wallet a purchase, top-up or cap change belongs to. */
  eSIMWallet: string | null;
  /** Kokio-BFF order id, for purchases and top-ups. */
  orderId: string | null;
  /** New cap in USD cents. Zero means the wallet follows the Kokio default. */
  priceCapUSDCents: number | null;
}

const ActivitySchema = new Schema<ActivityDoc>(
  {
    key: { type: String, required: true, unique: true },
    deviceWalletAddress: { type: String, required: true, lowercase: true },
    type: { type: String, enum: ['PURCHASE', 'TOPUP', 'SEND', 'RECEIVE', 'MOVE', 'PRICE_CAP'], required: true },
    txHash: { type: String, required: true, index: true },
    blockNumber: { type: Number, required: true },
    time: { type: Date, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    token: { type: String, default: null },
    symbol: { type: String, default: null },
    decimals: { type: Number, default: null },
    amount: { type: String, default: null },
    eSIMWallet: { type: String, default: null },
    orderId: { type: String, default: null },
    priceCapUSDCents: { type: Number, default: null },
  },
  { timestamps: true },
);
// Read and prune both walk one device's lines newest first
ActivitySchema.index({ deviceWalletAddress: 1, blockNumber: -1, key: -1 });

export const Activity = mongoose.model<ActivityDoc>('Activity', ActivitySchema);
