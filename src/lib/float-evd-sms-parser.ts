/**
 * Deterministic Float / EVD SMS primitives — batch 0.3C-e.
 *
 * Pure, per-block helpers only: segmentation, normalization, language and
 * family classification, and field extraction with structured evidence and
 * warnings.
 *
 * Explicitly NOT in this batch (per `docs/float-evd-sms-parser-design.md`):
 *  - pairing of bilingual halves
 *  - reference-based deduplication
 *  - event creation or any production-shape adapter
 *  - any wiring into `parseStatementText`, capture or import UI
 *
 * Invariants:
 *  - no floating-point money arithmetic (integer santim only)
 *  - a balance amount is never promoted to the transaction amount
 *  - English text never yields sender/recipient codes
 *  - truncated or malformed references return null plus a warning
 *  - timestamps stay source-local strings; no `Date`, no UTC conversion
 *  - missing evidence stays `null`; nothing is invented
 *  - no fixture-ID or private-value special cases
 */

export type SmsFamily = "float_distribution" | "evd_receipt" | "float_receipt" | "unknown";

export type SmsLanguage = "en" | "am" | "unknown";

export type SmsDirection = "inbound" | "outbound";

export type SmsWarningReason =
  | "missing_amount"
  | "ambiguous_direction"
  | "missing_reference"
  | "reference_mismatch"
  | "missing_date"
  | "ambiguous_counterparty"
  | "code_conflict";

export type SmsConfidence = "high" | "medium" | "low";

export interface SmsFieldEvidence {
  observedText: string;
  confidence: SmsConfidence;
}

export interface SmsWarning {
  reason: SmsWarningReason;
  observedText: string;
}

export interface SmsBlock {
  /** Position of the block in the source text (0-based). */
  sourceOrder: number;
  language: SmsLanguage;
  /** Bracketed delivery header exactly as observed, or null. */
  headerText: string | null;
  /** `YYYY-MM-DDTHH:mm` from the delivery header, or null. */
  metadataStamp: string | null;
  /** True only for an explicit "TIMESTAMP UNAVAILABLE" header. */
  metadataStampMissing: boolean;
  /** Body lines (header excluded), normalized. */
  lines: string[];
  /** Normalized, evidence-preserving body text. */
  text: string;
  /** Verbatim block slice from the source, header included. */
  raw: string;
}

export interface SmsClassification {
  family: SmsFamily;
  direction: SmsDirection | null;
  evidenceText: string | null;
}

export interface SmsAmounts {
  /** Signed integer santim: negative outbound, positive inbound. */
  amountMinor: number | null;
  rawAmountText: string | null;
  resultingBalanceMinor: number | null;
  rawBalanceText: string | null;
  evidence: Record<string, SmsFieldEvidence>;
  warnings: SmsWarning[];
}

export type SmsDatePrecision = "minute" | "date";
export type SmsDateSource = "in_message" | "sms_app" | "user_selected";

export interface SmsOccurredAt {
  occurredAt: string | null;
  datePrecision: SmsDatePrecision | null;
  dateSource: SmsDateSource | null;
  evidence: SmsFieldEvidence | null;
  warnings: SmsWarning[];
}

export interface SmsExtraction {
  block: SmsBlock;
  classification: SmsClassification;
  amountMinor: number | null;
  rawAmountText: string | null;
  resultingBalanceMinor: number | null;
  rawBalanceText: string | null;
  transactionReference: string | null;
  referenceLooksTruncated: boolean;
  occurredAt: string | null;
  datePrecision: SmsDatePrecision | null;
  dateSource: SmsDateSource | null;
  counterpartyLabel: string | null;
  shopLabel: string | null;
  distributorLabel: string | null;
  /** Label matching normalizes case and whitespace only — never fuzzy. */
  counterpartyMatch: "unassigned";
  senderCode: string | null;
  recipientCode: string | null;
  amharicEvidenceText: string | null;
  evidence: Record<string, SmsFieldEvidence>;
  warnings: SmsWarning[];
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const INVISIBLE_RX = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const NBSP_RX = /[\u00A0\u2007\u202F]/g;
const AMHARIC_RX = /[\u1200-\u137F]/;

/**
 * Evidence-preserving normalization: never lowercases, never removes Amharic
 * punctuation, currency tokens, grouping separators or repeated lines.
 */
export function normalizeSmsText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_RX, "")
    .replace(NBSP_RX, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Segmentation                                                        */
/* ------------------------------------------------------------------ */

const HEADER_RX = /^\[([A-Za-z-]+)\s+(.*)\]$/;
const STAMP_RX = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/;

/** Splits raw SMS text into delivery blocks, preserving source order. */
export function segmentSmsBlocks(text: string): SmsBlock[] {
  const normalized = normalizeSmsText(text);
  const chunks = normalized.split(/\n{2,}/);
  const blocks: SmsBlock[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    let headerText: string | null = null;
    let headerTag: string | null = null;
    let metadataStamp: string | null = null;
    let metadataStampMissing = false;

    const headerMatch = HEADER_RX.exec(lines[0]);
    if (headerMatch) {
      headerText = lines[0];
      headerTag = headerMatch[1].toUpperCase();
      const rest = headerMatch[2].trim();
      const stamp = STAMP_RX.exec(rest);
      if (stamp) {
        metadataStamp = `${stamp[1]}T${stamp[2]}`;
      } else if (/TIMESTAMP UNAVAILABLE/i.test(rest)) {
        metadataStampMissing = true;
      }
    }

    const bodyLines = headerText ? lines.slice(1) : lines;
    const body = bodyLines.join("\n");

    blocks.push({
      sourceOrder: blocks.length,
      language: classifySmsLanguage(body, headerTag),
      headerText,
      metadataStamp,
      metadataStampMissing,
      lines: bodyLines,
      text: body,
      raw: chunk,
    });
  }

  return blocks;
}

/** Language half classification from the header tag, falling back to script. */
export function classifySmsLanguage(body: string, headerTag?: string | null): SmsLanguage {
  if (headerTag === "EN") return "en";
  if (headerTag === "AM") return "am";
  if (AMHARIC_RX.test(body)) return "am";
  if (/[A-Za-z]/.test(body)) return "en";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Family classification                                               */
/* ------------------------------------------------------------------ */

interface FamilyRule {
  family: Exclude<SmsFamily, "unknown">;
  direction: SmsDirection;
  test: (text: string) => string | null;
}

function firstMatchText(text: string, rx: RegExp): string | null {
  const m = rx.exec(text);
  return m ? m[0] : null;
}

const FAMILY_RULES: FamilyRule[] = [
  {
    family: "float_distribution",
    direction: "outbound",
    test: (t) =>
      /removed from[^.]*float/i.test(t)
        ? firstMatchText(t, /removed from[^.]*float/i)
        : /ተቀንሶ/.test(t) && /ፍሎት/.test(t)
          ? "ተቀንሶ"
          : null,
  },
  {
    family: "float_receipt",
    direction: "inbound",
    test: (t) =>
      /added to[^.]*float/i.test(t)
        ? firstMatchText(t, /added to[^.]*float/i)
        : /ተጨምሯል/.test(t) && /ፍሎት/.test(t)
          ? "ተጨምሯል"
          : null,
  },
  {
    family: "evd_receipt",
    direction: "inbound",
    test: (t) =>
      firstMatchText(
        t,
        /credited with\s+(?:ETB\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*ETB)/i,
      ),
  },
];

/**
 * Deterministic keyword-evidence classification. Two decisive families are a
 * contradiction and never silently resolve to a default.
 */
export function classifySmsBlock(block: SmsBlock): SmsClassification {
  const hits: Array<{ rule: FamilyRule; evidence: string }> = [];
  for (const rule of FAMILY_RULES) {
    const evidence = rule.test(block.text);
    if (evidence) hits.push({ rule, evidence });
  }

  if (hits.length === 0) {
    // A float message truncated before its direction wording is still float
    // shaped, but the direction is not provable.
    return { family: "unknown", direction: null, evidenceText: null };
  }
  if (hits.length > 1) {
    return { family: "unknown", direction: null, evidenceText: hits[0].evidence };
  }
  return {
    family: hits[0].rule.family,
    direction: hits[0].rule.direction,
    evidenceText: hits[0].evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Amounts (integer santim only)                                       */
/* ------------------------------------------------------------------ */

/** Exact integer minor-unit conversion. Returns null when not exactly convertible. */
export function parseSantim(token: string): number | null {
  const cleaned = token.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [intPart, fracPart = ""] = cleaned.split(".");
  const frac = (fracPart + "00").slice(0, 2);
  const value = Number(intPart) * 100 + Number(frac);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Both observed money shapes: currency-before-amount (`ETB 45,000.00`) and
 * amount-before-currency (`45,000.00 Birr`). Nothing else is money.
 */
const CURRENCY_AMOUNT_RX =
  /(?:(ETB|Birr|ብር)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:(ETB|Birr)\b|(ብር)))/gi;
const BALANCE_PREFIX_RX = /(balance|ቀሪ ሂሳብ)[^\d]*$/i;

/**
 * Splits currency tokens into transaction amount versus resulting balance.
 * A balance-keyworded token is never promoted to the transaction amount.
 */
export function extractAmountAndBalance(
  block: SmsBlock,
  classification: SmsClassification,
): SmsAmounts {
  const text = block.text;
  const evidence: Record<string, SmsFieldEvidence> = {};
  const warnings: SmsWarning[] = [];

  let amountMinor: number | null = null;
  let rawAmountText: string | null = null;
  let resultingBalanceMinor: number | null = null;
  let rawBalanceText: string | null = null;

  CURRENCY_AMOUNT_RX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CURRENCY_AMOUNT_RX.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    const amountToken = match[2] ?? match[3];
    if (!amountToken) continue;
    const santim = parseSantim(amountToken);
    if (santim === null) continue;

    if (BALANCE_PREFIX_RX.test(before)) {
      if (resultingBalanceMinor === null) {
        resultingBalanceMinor = santim;
        rawBalanceText = amountToken;
        const lineStart = text.lastIndexOf("\n", match.index) + 1;
        const clauseStart = Math.max(lineStart, text.lastIndexOf(". ", match.index) + 2);
        evidence.resultingBalanceMinor = {
          observedText: text.slice(clauseStart, match.index + match[0].length).trim(),
          confidence: "high",
        };
      }
      continue;
    }

    if (amountMinor === null) {
      const after = text.slice(match.index + match[0].length);
      const trailer = /^\s+(?:was\s+|has been\s+)?(?:successfully\s+)?(removed|added|credited)\b/i.exec(
        after,
      );
      amountMinor = santim;
      rawAmountText = amountToken;
      const creditedBefore = /credited with\s*$/i.test(before) ? "credited with " : "";
      evidence.amountMinor = {
        observedText: `${creditedBefore}${match[0]}${trailer ? trailer[0] : ""}`,
        confidence: "high",
      };
    }
  }

  if (amountMinor === null) {
    warnings.push({
      reason: "missing_amount",
      observedText: block.lines[0] ?? block.text,
    });
  } else if (classification.direction === "outbound") {
    amountMinor = -amountMinor;
  }

  return {
    amountMinor,
    rawAmountText,
    resultingBalanceMinor,
    rawBalanceText,
    evidence,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Reference                                                           */
/* ------------------------------------------------------------------ */

const REFERENCE_RX = /(?:Ref:|Your Transaction Number is|ማጣቀሻ)\s*([A-Za-z0-9]+)/i;
/** A complete synthetic-shaped reference: three letters plus seven alphanumerics. */
const REFERENCE_SHAPE_RX = /^[A-Za-z]{3}[A-Za-z0-9]{7}$/;

export function extractReference(block: SmsBlock): {
  reference: string | null;
  truncated: boolean;
  evidence: SmsFieldEvidence | null;
  warnings: SmsWarning[];
} {
  const m = REFERENCE_RX.exec(block.text);
  if (!m) {
    return { reference: null, truncated: false, evidence: null, warnings: [] };
  }
  const observedText = m[0].trim();
  if (!REFERENCE_SHAPE_RX.test(m[1])) {
    return {
      reference: null,
      truncated: true,
      evidence: null,
      warnings: [{ reason: "missing_reference", observedText }],
    };
  }
  return {
    reference: m[1],
    truncated: false,
    evidence: { observedText, confidence: "high" },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Timestamps (source-local strings only)                              */
/* ------------------------------------------------------------------ */

const IN_MESSAGE_STAMP_RX = /(?:\bon\b|ቀን)\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/;
/** `on 11/8/26 at 10:14 AM` / `በ 11/8/26 10:14 AM` — day/month/two-digit year. */
const SLASH_STAMP_RX =
  /(?:\bon\b|በ)\s*(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+at)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Deterministic 12-hour → 24-hour conversion. No `Date`, no timezone math. */
function to24Hour(hour: number, meridiem: string): number | null {
  if (hour < 1 || hour > 12) return null;
  const pm = meridiem.toUpperCase() === "PM";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/** Message-local timestamp; never parsed through `Date`, never converted. */
export function extractLocalStamp(block: SmsBlock): {
  stamp: string | null;
  precision: SmsDatePrecision | null;
  evidence: SmsFieldEvidence | null;
} {
  const m = IN_MESSAGE_STAMP_RX.exec(block.text);
  if (!m) {
    const s = SLASH_STAMP_RX.exec(block.text);
    if (!s) return { stamp: null, precision: null, evidence: null };
    const day = Number(s[1]);
    const month = Number(s[2]);
    const hour24 = to24Hour(Number(s[4]), s[6]);
    if (day < 1 || day > 31 || month < 1 || month > 12 || hour24 === null) {
      return { stamp: null, precision: null, evidence: null };
    }
    const year = 2000 + Number(s[3]);
    return {
      stamp: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour24)}:${s[5]}`,
      precision: "minute",
      evidence: { observedText: s[0].trim(), confidence: "high" },
    };
  }
  if (!m[2]) {
    return {
      stamp: m[1],
      precision: "date",
      evidence: { observedText: m[0].trim(), confidence: "medium" },
    };
  }
  return {
    stamp: `${m[1]}T${m[2]}`,
    precision: "minute",
    evidence: { observedText: m[0].trim(), confidence: "high" },
  };
}

const USER_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date provenance: in-message evidence wins, then SMS-app metadata, then an
 * explicitly supplied user-selected day (which never carries a time).
 */
export function resolveSmsOccurredAt(
  block: SmsBlock,
  opts?: { userSelectedDate?: string },
): SmsOccurredAt {
  const local = extractLocalStamp(block);
  if (local.stamp) {
    return {
      occurredAt: local.stamp,
      datePrecision: local.precision,
      dateSource: "in_message",
      evidence: local.evidence,
      warnings: [],
    };
  }

  if (block.metadataStamp) {
    return {
      occurredAt: block.metadataStamp,
      datePrecision: "minute",
      dateSource: "sms_app",
      evidence: { observedText: block.headerText ?? block.metadataStamp, confidence: "medium" },
      warnings: [],
    };
  }

  const userDate = opts?.userSelectedDate;
  if (userDate && USER_DATE_RX.test(userDate)) {
    return {
      occurredAt: userDate,
      datePrecision: "date",
      dateSource: "user_selected",
      evidence: { observedText: `user-selected day ${userDate}`, confidence: "medium" },
      warnings: [],
    };
  }

  return {
    occurredAt: null,
    datePrecision: null,
    dateSource: null,
    evidence: null,
    warnings: [
      { reason: "missing_date", observedText: block.headerText ?? block.lines[0] ?? block.text },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Labels and codes                                                    */
/* ------------------------------------------------------------------ */

const ADMIN_RX = /\bby\s+([^.]+?)(?=\s+at\s|\s+on\s|\.|$)/;
const SHOP_RX = /\bat\s+([^.]+?)(?=\s+on\s|\.|$)/;
const DISTRIBUTOR_RX =
  /credited with\s+ETB\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*\.\s*([^.\n]+?)\s*$/i;

export function extractLabels(block: SmsBlock): {
  counterpartyLabel: string | null;
  shopLabel: string | null;
  distributorLabel: string | null;
  evidence: Record<string, SmsFieldEvidence>;
} {
  const evidence: Record<string, SmsFieldEvidence> = {};
  // English text only: an Amharic half never yields English labels.
  if (block.language === "am") {
    return {
      counterpartyLabel: null,
      shopLabel: null,
      distributorLabel: null,
      evidence,
    };
  }

  const admin = ADMIN_RX.exec(block.text);
  const shop = SHOP_RX.exec(block.text);
  const distributor = DISTRIBUTOR_RX.exec(block.text);

  if (admin) {
    evidence.counterpartyLabel = { observedText: admin[0].trim(), confidence: "medium" };
  }
  if (shop) {
    evidence.shopLabel = { observedText: shop[0].trim(), confidence: "medium" };
  }
  if (distributor) {
    evidence.counterpartyLabel = { observedText: distributor[1].trim(), confidence: "medium" };
  }

  return {
    counterpartyLabel: admin ? admin[1].trim() : distributor ? distributor[1].trim() : null,
    shopLabel: shop ? shop[1].trim() : null,
    distributorLabel: distributor ? distributor[1].trim() : null,
    evidence,
  };
}

const SENDER_CODE_RX = /ላኪ ኮድ\s*(\d+)/;
const RECIPIENT_CODE_EXPLICIT_RX = /ተቀባይ ኮድ\s*(\d+)/;
const RECIPIENT_CODE_TO_RX = /ወደ\s*(\d+)/;
const SENDER_CODE_FROM_RX = /ከ\s*(\d+)/;
const RECIPIENT_CODE_FOR_RX = /ለ\s*(\d+)/;

/** Codes exist only where Amharic evidence exists. English never invents them. */
export function extractCodes(block: SmsBlock): {
  senderCode: string | null;
  recipientCode: string | null;
  evidence: Record<string, SmsFieldEvidence>;
} {
  const evidence: Record<string, SmsFieldEvidence> = {};
  if (block.language !== "am") {
    return { senderCode: null, recipientCode: null, evidence };
  }

  const sender = SENDER_CODE_RX.exec(block.text) ?? SENDER_CODE_FROM_RX.exec(block.text);
  const recipient =
    RECIPIENT_CODE_EXPLICIT_RX.exec(block.text) ??
    RECIPIENT_CODE_TO_RX.exec(block.text) ??
    RECIPIENT_CODE_FOR_RX.exec(block.text);

  if (sender) evidence.senderCode = { observedText: sender[0].trim(), confidence: "high" };
  if (recipient) evidence.recipientCode = { observedText: recipient[0].trim(), confidence: "high" };

  return {
    senderCode: sender ? sender[1] : null,
    recipientCode: recipient ? recipient[1] : null,
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Per-block extraction                                                */
/* ------------------------------------------------------------------ */

/** Extracts every evidenced field of a single block. No pairing, no merging. */
export function extractSmsFields(
  block: SmsBlock,
  opts?: { userSelectedDate?: string },
): SmsExtraction {
  const classification = classifySmsBlock(block);
  const amounts = extractAmountAndBalance(block, classification);
  const reference = extractReference(block);
  const when = resolveSmsOccurredAt(block, opts);
  const labels = extractLabels(block);
  const codes = extractCodes(block);

  const evidence: Record<string, SmsFieldEvidence> = {
    ...amounts.evidence,
    ...labels.evidence,
    ...codes.evidence,
  };
  if (reference.evidence) evidence.transactionReference = reference.evidence;
  if (when.evidence) evidence.occurredAt = when.evidence;

  const warnings: SmsWarning[] = [...amounts.warnings, ...reference.warnings, ...when.warnings];
  if (classification.family === "unknown") {
    warnings.unshift({
      reason: "ambiguous_direction",
      observedText: block.lines[0] ?? block.text,
    });
  }

  return {
    block,
    classification,
    amountMinor: amounts.amountMinor,
    rawAmountText: amounts.rawAmountText,
    resultingBalanceMinor: amounts.resultingBalanceMinor,
    rawBalanceText: amounts.rawBalanceText,
    transactionReference: reference.reference,
    referenceLooksTruncated: reference.truncated,
    occurredAt: when.occurredAt,
    datePrecision: when.datePrecision,
    dateSource: when.dateSource,
    counterpartyLabel: labels.counterpartyLabel,
    shopLabel: labels.shopLabel,
    distributorLabel: labels.distributorLabel,
    counterpartyMatch: "unassigned",
    senderCode: codes.senderCode,
    recipientCode: codes.recipientCode,
    amharicEvidenceText: block.language === "am" ? block.text : null,
    evidence,
    warnings,
  };
}

/** Convenience: segment then extract, preserving source order. */
export function extractSmsBlocks(
  text: string,
  opts?: { userSelectedDate?: string },
): SmsExtraction[] {
  return segmentSmsBlocks(text).map((block) => extractSmsFields(block, opts));
}
