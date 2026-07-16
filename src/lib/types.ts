export type TxnType = "in" | "out" | "airtime" | "credit";

export interface Transaction {
  id: string;
  type: TxnType;
  /** Amount in santim (integer). 1 ETB = 100 santim. */
  amountSantim: number;
  party: string;
  channel: string;
  reference?: string;
  note?: string;
  /** ISO string */
  date: string;
  /** For credit txns: has it been settled? */
  settled?: boolean;
  createdAt: string;
}

export const CHANNELS = [
  "CBE",
  "Telebirr",
  "Awash",
  "Dashen",
  "Abyssinia",
  "Wegagen",
  "M-Pesa",
  "Cash",
  "Other",
] as const;

export const TYPE_LABEL: Record<TxnType, string> = {
  in: "Money In",
  out: "Money Out",
  airtime: "Airtime",
  credit: "Credit",
};

export interface LeakFinding {
  id: string;
  severity: "high" | "medium" | "low";
  kind:
    | "duplicate"
    | "large_outflow"
    | "airtime_spike"
    | "aging_credit"
    | "test_before_large";
  title: string;
  reason: string;
  txnIds: string[];
}