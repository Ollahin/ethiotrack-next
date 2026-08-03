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
  | "sms_import"
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
  /**
   * Extra exact names this distributor is known by on bank statements.
   * Matching normalizes case and whitespace only — never fuzzy.
   */
  aliases?: string[];
  /** Configured bank account tails (digits only) used to identify payments. */
  accountTails?: string[];
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
  /**
   * True when the source row is a reversal of an earlier airtime movement
   * (e.g. a negative amount on an MJ "Transfers → Sent" screen). The row keeps
   * the direction of the screen it came from — a sent reversal is never a
   * distributor receipt — and `amountSantim` stays the non-negative magnitude.
   */
  isReversal?: boolean;
  /**
   * Reviewer's written explanation, preserved as evidence whenever a reversal
   * larger than the agent's recorded delivered balance is saved as an override.
   */
  overrideReason?: string;
  /**
   * Principal amount of an outgoing distributor payment, i.e. the airtime value
   * bought. `amountSantim` stays the final bank debit (principal + charges +
   * VAT). Absent means principal equals the debit.
   */
  principalSantim?: number;
  /**
   * True when the source only gave a calendar date and no clock time. Overdue
   * timing must never be computed from a fabricated timestamp.
   */
  dateIsDayOnly?: boolean;
  isPersonal?: boolean;
  isSettled?: boolean;
  settledAt?: string;
  /** Parser flagged this row as low-confidence (ambiguous direction/party). */
  needsReview?: boolean;
  /** For payments applied to credits: which credit txn ids they settled. */
  settlesTxnIds?: string[];
  /**
   * Stable capture identity for one saved row. Re-running the same import
   * (retry, refresh, replayed share) must never write it twice.
   */
  captureKey?: string;
  source: TxnSource;
  statementImportId?: string;
  date: string; // ISO
  createdAt: string;
}

/**
 * One explicit, partial-aware application of an agent's cash payment against
 * one outstanding airtime credit. Allocations are records in their own right:
 * the receivable is always credit amount minus allocations, never a guess.
 */
export interface SettlementAllocation {
  id: string;
  /** The incoming money transaction that paid. */
  paymentTxnId: string;
  /** The airtime credit row being paid down. */
  creditTxnId: string;
  agentId: string;
  amountSantim: number;
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
  /** Was the source a PDF text extract, a screenshot OCR, or pasted SMS text? */
  sourceKind?: "pdf" | "image" | "sms";
  /** 0..1 — only set for OCR sources. Low values indicate the raw text may be unreliable. */
  ocrConfidence?: number;
  /** Lifecycle of a screenshot import. The raw image is kept in every state. */
  status?: "pending" | "parsed" | "empty" | "failed";
  /** Detected capture orientation in degrees (0/90/180/270). */
  orientation?: number;
  /** Layout the production parser matched ("mj" | "refill" | "generic"). */
  layout?: string;
  /** Failure message preserved with the raw image so the import can be retried. */
  parseError?: string;
  /** Original uploaded screenshot, persisted before OCR begins. */
  rawImage?: Blob;
}

/**
 * One payload handed to the app by the Android share sheet (or dropped into
 * the inbox by hand). It is stored untouched: nothing is parsed, linked or
 * saved until a human opens it in Smart Capture.
 */
export interface SharedInput {
  id: string;
  receivedAt: string;
  kind: "text" | "image" | "pdf" | "unsupported";
  /**
   * Position of this message inside the capture it arrived in. One paste of
   * 200 messages produces 200 rows, 0..199, and that order never changes.
   */
  seq?: number;
  /** How the message reached the inbox. Evidence only. */
  origin?: "paste" | "clipboard" | "share";
  /** Title supplied by the sharing app, when it sent one. */
  title?: string;
  /** Shared text (SMS body, message, URL note). */
  text?: string;
  fileName?: string;
  fileType?: string;
  /** Shared file exactly as received. */
  blob?: Blob;
  status: "pending" | "reviewed" | "dismissed";
  reviewedAt?: string;
  /**
   * Everything the operator has decided about this message so far. It lives on
   * the inbox record itself, not in screen state, so a review survives a
   * refresh, a lock and a share-target hand-over. Absent on rows captured
   * before this field existed, which simply means "nothing decided yet".
   */
  decisions?: InboxDecision;
}

/**
 * Operator decisions for one inbox message. `null` is an explicit "none"
 * chosen by a human; `undefined` means the app may still infer the answer.
 */
export interface InboxDecision {
  bankId?: string | null;
  agentId?: string | null;
  distributorId?: string | null;
  /** BusinessPurpose value, kept as a string so persistence stays schema-free. */
  purpose?: string;
  /** Operator-chosen day (yyyy-mm-dd) for a message that stated no date. */
  day?: string;
  /** Optional clock time chosen by the operator; never invented. */
  time?: string;
  /** An explicit correction of a genuine source date. */
  correctedDay?: string;
  /** The operator confirmed the correction of a genuine source date. */
  correctionConfirmed?: boolean;
  /** The operator confirmed the linked party despite a name mismatch. */
  recipientConfirmed?: boolean;
  /** The reviewer confirmed a flagged identity collision is not a repeat. */
  duplicateAcknowledged?: boolean;
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

// -- distributor payment → EVD purchase intents ------------------------------

export type PurchaseIntentStatus =
  | "pending"
  | "partially_fulfilled"
  | "fulfilled"
  | "overdue"
  | "disputed"
  | "cancelled"
  | "personal";

export const PURCHASE_STATUS_LABEL: Record<PurchaseIntentStatus, string> = {
  pending: "Pending",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  overdue: "Overdue",
  disputed: "Disputed",
  cancelled: "Cancelled / refunded",
  personal: "Personal",
};

/** How an amount received above the expected EVD is explained. */
export type SurplusClassification = "unexplained_surplus" | "bonus" | "commission" | "loan";

export const SURPLUS_LABEL: Record<SurplusClassification, string> = {
  unexplained_surplus: "Unexplained surplus",
  bonus: "Bonus",
  commission: "Commission",
  loan: "Loan",
};

export type FulfillmentExceptionAction = "disputed" | "cancelled" | "personal" | "correction";

/**
 * Immutable, append-only ledger entry against one purchase intent (a bank
 * payment transaction). Nothing here is ever rewritten: corrections append an
 * "adjustment" entry that points at the entry being corrected.
 */
export interface FulfillmentEntry {
  id: string;
  /** Transaction id of the bank payment this entry belongs to. */
  intentTxnId: string;
  kind: "receipt" | "adjustment" | "exception";
  /** Signed santim applied to the fulfilled total (0 for exception entries). */
  amountSantim: number;
  /** Portion of `amountSantim` above the expected EVD, when explicitly accepted. */
  surplusSantim?: number;
  surplusClassification?: SurplusClassification;
  /** Exception entries only. */
  action?: FulfillmentExceptionAction;
  note?: string;
  /** Adjustment entries only: the earlier entry being corrected. */
  correctsEntryId?: string;
  recordedAt: string;
}
