import mongoose, { Schema } from 'mongoose';

/** One stored transfer that touched a watched wallet. */
export interface ActivityRow {
  /** `<txHash>:log:<logIndex>` for ERC-20, `<txHash>:native:<from>:<to>:<amount>` for ETH. */
  key: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
  blockTime: Date;
  from: string;
  to: string;
  /** Token contract, null for ETH. */
  token: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Base units, as a string so large values keep their precision. */
  amount: string;
  source: 'WEBHOOK' | 'BACKFILL';
}

const WalletActivitySchema = new Schema<ActivityRow>(
  {
    key: { type: String, required: true, unique: true },
    chainId: { type: Number, required: true },
    txHash: { type: String, required: true },
    blockNumber: { type: Number, required: true },
    blockTime: { type: Date, required: true },
    from: { type: String, required: true, lowercase: true },
    to: { type: String, required: true, lowercase: true },
    token: { type: String, default: null, lowercase: true },
    symbol: { type: String, default: null },
    decimals: { type: Number, default: null },
    amount: { type: String, required: true },
    source: { type: String, enum: ['WEBHOOK', 'BACKFILL'], required: true },
  },
  { timestamps: true },
);
// The history query reads by wallet, newest first, paging on (blockNumber, txHash)
WalletActivitySchema.index({ from: 1, blockNumber: -1, txHash: -1 });
WalletActivitySchema.index({ to: 1, blockNumber: -1, txHash: -1 });

export const WalletActivity = mongoose.model<ActivityRow>('WalletActivity', WalletActivitySchema);
