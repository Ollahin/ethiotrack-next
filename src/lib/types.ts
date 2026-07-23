// EthioTrack v2 — entity-first domain model per the blueprint.

export type TxnType =
  | "in"            // money received (agent payment, deposit)
  | "out"           // money paid out (to distributor, expense)
  | "airtime_evd"   // EVD airtime distributed to agent (creates credit)
  | "airtime_float" // Float airtime distributed to agent (creates credit)
  | "expense"       // business expense
  | "personal";     // personal — excluded from business reports

export type PartyType = "agent" | "distributor" | "bank" | "other";

export type TxnSource =
  | "manual"
  | "paste_parse"
  | "sms_listener"
  | "pdf_import"
  | "csv_import";

export interface Agent {
  id: string;
  name: string;
  phone?: string;
  creditLimitSantim?: number;
  createdAt: string;
}

export interface Distributor {
  id: string;
  name: string;
  contact?: string;
  statementFormat?: string; // e.g. "ethio-evd", "generic"
  createdAt: string;
}

export interface Bank {
  id: string;
  name: string;
  accountNumber?: string;
  channel: string; // CBE, Awash, Telebirr, etc.
  openingBalanceSantim: number;
  createdAt: string;
}

export interface DailyOpening {
  id: string;
  date: string; // YYYY-MM-DD
  cashOnHandSantim: number;
  bankBalances: Record<string, number>; // bankId -> santim
  evdStockSantim: number;
  floatStockSantim: number;
  openedAt: string;
}

export interface DailyClosing {
  id: string;
  date: string;
  openingId: string;
  actualCashSantim: number;
  varianceSantim: number;
  notes?: string;
  closedAt: string;
}

// Weekly period (Mon → Sun). Replaces daily open/close as the primary cycle.
export interface PeriodOpening {
  id: string;
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;   // YYYY-MM-DD (Sunday)
  cashOnHandSantim: number;
  bankBalances: Record<string, number>;
  /** Per-distributor EVD airtime stock at week open. distributorId -> santim. */
  evdStockByDistributor?: Record<string, number>;
  /** Per-distributor Float airtime stock at week open. distributorId -> santim. */
  floatStockByDistributor?: Record<string, number>;
  /** Legacy aggregate totals — retained for backward compatibility. */
  evdStockSantim: number;
  floatStockSantim: number;
  openedAt: string;
}

export interface PeriodClosing {
  id: string;
  weekStart: string;
  weekEnd: string;
  openingId: string;
  actualCashSantim: number;
  varianceSantim: number;
  notes?: string;
  closedAt: string;
}

export interface Transaction {
  id: string;
  type: TxnType;
  amountSantim: number;
  partyId?: string;
  partyType?: PartyType;
  /** Free-text party name — kept even after link, for search & audit. */
  partyName: string;
  channel: string;
  reference?: string;
  note?: string;
  isPersonal?: boolean;
  isSettled?: boolean;
  settledAt?: string;
  /** For payments applied to credits: which credit txn ids they settled. */
  settlesTxnIds?: string[];
  source: TxnSource;
  statementImportId?: string;
  date: string; // ISO
  createdAt: string;
}

export interface StatementImport {
  id: string;
  distributorId?: string;
  fileName: string;
  rowCount: number;
  totalSantim: number;
  importedAt: string;
  rawText: string;
}

export const CHANNELS = [
  "CBE",
  "Telebirr",
  "Awash",
  "Dashen",
  "Abyssinia",
  "Coop",
  "Wegagen",
  "M-Pesa",
  "Cash",
  "Other",
] as const;

export const TYPE_LABEL: Record<TxnType, string> = {
  in: "Money In",
  out: "Money Out",
  airtime_evd: "Airtime · EVD",
  airtime_float: "Airtime · Float",
  expense: "Expense",
  personal: "Personal",
};

export const TYPE_COLOR: Record<TxnType, string> = {
  in: "money-in",
  out: "money-out",
  airtime_evd: "airtime",
  airtime_float: "credit",
  expense: "money-out",
  personal: "muted-foreground",
};

export interface BrainAlert {
  id: string;
  severity: "high" | "medium" | "low";
  kind:
    | "overdue_credit"
    | "aging_credit"
    | "distribution_anomaly"
    | "missing_statement"
    | "over_credit_limit"
    | "duplicate";
  title: string;
  reason: string;
  txnIds?: string[];
  agentId?: string;
}