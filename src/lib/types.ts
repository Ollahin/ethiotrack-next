// EthioTrack v2 — entity-first domain model per the blueprint.

export type TxnType =
  | "in" // money received (agent payment, deposit)
  | "out" // money paid out (to distributor, expense)
  | "airtime_evd" // EVD airtime distributed to agent (creates credit)
  | "airtime_float" // Float airtime distributed to agent (creates credit)
  | "expense" // business expense
  | "personal"; // personal — excluded from business reports

export type PartyType = "agent" | "distributor" | "bank" | "other";

export type Telecom = "ethiotelecom" | "safaricom";
export type AirtimeForm = "evd" | "float";

/**
 * Whether an airtime transaction moved stock out to an agent ("sent") or in
 * from an upstream distributor ("received"). Absent on legacy rows, which
 * always mean "sent". Ignored for money and personal transactions.
 */
export type AirtimeDirection = "sent" | "received";

export const TELECOM_LABEL: Record<Telecom, string> = {
  ethiotelecom: "Ethio Telecom",
  safaricom: "Safaricom",
};

export const AIRTIME_FORM_LABEL: Record<AirtimeForm, string> = {
  evd: "EVD",
  float: "Float",
};

export type TxnSource =
  | "manual"
  | "paste_parse"
  | "pdf_import"
  | "screenshot_import"
  | "csv_import";

export interface Agent {
  id: string;
  name: string;
  phone?: string;
  creditLimitSantim?: number;
  createdAt: string;
}

/** Known distributor statement layouts. "generic" = layout-agnostic line scraper. */
export type DistributorStatementFormat =
  | "generic"
  | "mj"
  | "alami"
  | "yenus"
  | "tilanesh"
  | "modern-app";

export const DISTRIBUTOR_FORMAT_LABEL: Record<DistributorStatementFormat, string> = {
  generic: "Generic",
  mj: "MJ",
  alami: "Alami",
  yenus: "Yenus",
  tilanesh: "Tilanesh",
  "modern-app": "Modern App",
};

export interface Distributor {
  id: string;
  name: string;
  contact?: string;
  /** Which app/format this distributor's statements come from — drives parser dispatch. */
  statementFormat?: DistributorStatementFormat;
  /** Which telecom(s) this distributor supplies (Ethio Telecom, Safaricom, or both). */
  telecoms?: Telecom[];
  /** Which airtime form(s) this distributor supplies (EVD, Float, or both). */
  forms?: AirtimeForm[];
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
  weekEnd: string; // YYYY-MM-DD (Sunday)
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
  /** Bank / wallet account this money moved through (for cash txns leave undefined). */
  bankId?: string;
  /** Airtime distributor this stock came from (airtime_evd / airtime_float only). */
  distributorId?: string;
  reference?: string;
  note?: string;
  /** Telecom this airtime transaction belongs to (airtime_evd / airtime_float only). */
  telecom?: Telecom;
  /** Airtime stock direction (airtime_evd / airtime_float only). Missing = "sent". */
  airtimeDirection?: AirtimeDirection;
  isPersonal?: boolean;
  isSettled?: boolean;
  settledAt?: string;
  /** Parser flagged this row as low-confidence (ambiguous direction/party). */
  needsReview?: boolean;
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
  /** Was the source a PDF text extract or a screenshot OCR? */
  sourceKind?: "pdf" | "image";
  /** 0..1 — only set for OCR sources. Low values indicate the raw text may be unreliable. */
  ocrConfidence?: number;
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
