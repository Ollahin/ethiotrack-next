/**
 * MJ row-reconstruction helpers — batch 0.3B-a.
 *
 * Pure, deterministic helpers for MJ "Transfers / Sent" OCR screens:
 *  - deterministic line classification (chrome / account_label / amount /
 *    agent_candidate / date / noise)
 *  - amount-anchor parsing with explicit sign evidence
 *
 * These helpers are intentionally NOT wired into `parseStatementText`.
 * Integration happens in later batches (0.3B-d and later) per
 * `docs/mj-row-reconstruction-design.md`.
 *
 * Invariants:
 *  - no fuzzy matching, no fixture-ID special cases, no scoring model
 *  - no floating-point arithmetic for money
 *  - source order is preserved end to end
 */

import type { StatementRow } from "./distributor-parser";

export type MjLineKind =
  | "chrome"
  | "account_label"
  | "amount"
  | "agent_candidate"
  | "date"
  | "noise";

export interface MjLine {
  /** Index of the line in the original text (0-based, before filtering). */
  sourceIndex: number;
  /** Raw line exactly as it appeared in the source text. */
  raw: string;
  /** Normalized text: invisible characters removed, whitespace collapsed. */
  text: string;
  /** Normalized text after generic OCR decoration-prefix removal. */
  stripped: string;
  kind: MjLineKind;
  /** Stable reason code. Never free text. */
  reason: string;
}

export type MjSignEvidence =
  | "attached_minus"
  | "spaced_prefix_ignored"
  | "punctuation_prefix_ignored"
  | "none"
  | "ambiguous";

export interface MjAmount {
  /** Always non-negative, in minor units (santim). */
  amountSantim: number;
  /** True only for an attached minus, e.g. "-5,250.00". */
  isReversal: boolean;
  signEvidence: MjSignEvidence;
  /** The numeric token exactly as matched, without any prefix. */
  rawAmountText: string;
  /** The decoration/sign prefix that preceded the numeric token. */
  prefixText: string;
  /**
   * Date token that shared the amount line, exactly as read. Real MJ screens
   * right-align the amount on the same line as the transfer date; the token is
   * only kept when it is a recognizable date, never guessed.
   */
  dateText?: string;
  /** Non-date text that preceded the amount on the same line (evidence only). */
  leadNoise?: string;
}

export interface MjAmountAnchor {
  sourceIndex: number;
  amount: MjAmount;
  line: MjLine;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Zero-width, bidi marks, BOM and non-breaking spaces. */
const INVISIBLE_RX = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const NBSP_RX = /[\u00A0\u2007\u202F]/g;

export function normalizeMjLineText(raw: string): string {
  return raw.replace(INVISIBLE_RX, "").replace(NBSP_RX, " ").replace(/\s+/g, " ").trim();
}

/**
 * Removes generic OCR decoration prefixes.
 *
 * Two prefix shapes are removed, repeatedly, from the left only:
 *  1. a run of non-alphanumeric characters (glyphs, brackets, bullets);
 *  2. a single alphanumeric token of length 1-2 (list indexes and stray
 *     letters such as "2", "E", "5", "oo", "Ek", "b 3").
 *
 * Removal is prefix-only and never touches interior characters. A step is
 * only applied when the remainder still contains an alphanumeric character,
 * so a short line is never emptied by rule 2.
 */
/**
 * Removes trailing OCR decoration: status ticks, bullets and other trailing
 * non-alphanumeric glyphs. Suffix-only, never touches interior characters.
 */
export function stripMjDecorationSuffix(text: string): string {
  const out = text.replace(/[^\p{L}\p{N}.)]+$/u, "");
  return /[\p{L}\p{N}]/u.test(out) ? out.trim() : text.trim();
}

export function stripMjDecorationPrefix(text: string): string {
  let out = text;
  // Bounded loop: each iteration strictly shortens `out`.
  for (let guard = 0; guard < 16; guard += 1) {
    const symbol = /^[^\p{L}\p{N}]+/u.exec(out);
    if (symbol) {
      const rest = out.slice(symbol[0].length);
      if (rest.length > 0) {
        out = rest;
        continue;
      }
      return "";
    }
    const token = /^[\p{L}\p{N}]{1,2}(?![\p{L}\p{N}])/u.exec(out);
    if (token) {
      const rest = out.slice(token[0].length).replace(/^[^\p{L}\p{N}]+/u, "");
      if (/[\p{L}\p{N}]/u.test(rest)) {
        out = rest;
        continue;
      }
    }
    break;
  }
  return stripMjDecorationSuffix(out.trim());
}

/* ------------------------------------------------------------------ */
/* Amount anchors                                                      */
/* ------------------------------------------------------------------ */

/** A defensible money token: grouped or plain integer part, 2 decimals. */
const AMOUNT_TOKEN_SOURCE = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}";
const AMOUNT_TAIL_RX = new RegExp(`(${AMOUNT_TOKEN_SOURCE})$`, "u");
/** Clock-like token, e.g. "4:50" — never a financial amount line. */
const TIMESTAMP_RX = /\d\s?:\s?\d{2}/;
const PERCENT_RX = /%/;
const HYPHEN_CLASS = /^[-\u2010-\u2015\u2212]$/;

/** Exact minor-unit conversion. Integer arithmetic only, no floats. */
function amountToSantim(token: string): number {
  const [intPart, fracPart] = token.split(".");
  const major = Number.parseInt(intPart.replace(/,/g, ""), 10);
  const minor = Number.parseInt(fracPart, 10);
  return major * 100 + minor;
}

/**
 * A lead segment is name-like when it holds a word of four or more letters.
 * Mangled date/index noise ("@5 ITk2A26", "b 3") stays below that bar.
 */
function isNameLikeLead(lead: string): boolean {
  return lead
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .some((t) => t.length >= 4);
}

function classifySignPrefix(prefix: string): MjSignEvidence {
  if (prefix.length === 0) return "none";
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return "none";
  if (HYPHEN_CLASS.test(trimmed)) {
    // Attached minus only when the glyph touches the digits.
    return prefix === trimmed ? "attached_minus" : "spaced_prefix_ignored";
  }
  if (/^[:;.,·|]+$/u.test(trimmed)) return "punctuation_prefix_ignored";
  return "ambiguous";
}

/**
 * Parses a defensible MJ amount line. Returns `null` when the line is not an
 * amount (percentages, timestamps, plain integers, any other numeric noise).
 *
 * The input must be the *normalized* line, not the decoration-stripped one:
 * sign evidence lives in the prefix.
 *
 * Real MJ screens right-align the amount on the same line as the transfer
 * date ("24 Jul 2026 257,300.00"), so a leading segment is tolerated when it
 * is either a recognizable date (kept as `dateText`) or short OCR noise with
 * no name-like word (kept as `leadNoise`). A line whose lead reads like a
 * name is never an amount, so agent lines stay agent lines.
 */
export function parseMjAmount(normalizedLine: string): MjAmount | null {
  const line = normalizedLine.trim();
  if (line.length === 0) return null;
  if (PERCENT_RX.test(line)) return null;
  if (TIMESTAMP_RX.test(line)) return null;

  const match = AMOUNT_TAIL_RX.exec(line);
  if (!match) return null;
  const token = match[1];
  const head = line.slice(0, line.length - token.length);
  const prefixMatch = /[^\p{L}\p{N}]*$/u.exec(head);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  const lead = head.slice(0, head.length - prefix.length).trim();

  let dateText: string | undefined;
  let leadNoise: string | undefined;
  if (lead.length > 0) {
    if (LEAD_DATE_RX.test(lead)) {
      dateText = lead;
    } else if (isNameLikeLead(lead)) {
      // Name-like lead: this is an agent line, not an amount line.
      return null;
    } else {
      leadNoise = lead;
    }
  }

  const signEvidence = classifySignPrefix(prefix);

  return {
    amountSantim: amountToSantim(token),
    isReversal: signEvidence === "attached_minus",
    signEvidence,
    rawAmountText: token,
    prefixText: prefix,
    ...(dateText ? { dateText } : {}),
    ...(leadNoise ? { leadNoise } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const CHROME_WORDS = new Set([
  "transfers",
  "transfer",
  "sent",
  "received",
  "receive",
  "home",
  "back",
  "search",
  "history",
  "agents",
  "agent",
  "add",
  "refill",
  "close",
  "details",
  "success",
  "cancel",
]);

/**
 * A bottom-navigation strip ("Agents Add Agent Refill Refill History") OCRs as
 * one line made exclusively of chrome words. It is chrome, never an agent.
 */
function isChromeWordLine(stripped: string): boolean {
  const tokens = stripped
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => CHROME_WORDS.has(t));
}

/** "<handle> - <handle>" repeated sender/account label. */
const REPEATED_LABEL_RX = /^([\p{L}\p{N}._]{3,})\s*[-\u2010-\u2015\u2212]\s*\1$/iu;

const DATE_RX =
  /\b(?:\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i;

/**
 * An agent candidate needs real alphabetic substance: at least one token of
 * three or more letters. Stated positively so it is testable without
 * referencing any fixture.
 */
function hasNameSubstance(stripped: string): boolean {
  const tokens = stripped.split(/[^\p{L}]+/u).filter(Boolean);
  return tokens.some((t) => t.length >= 3);
}

function classifyOne(sourceIndex: number, raw: string): MjLine | null {
  const text = normalizeMjLineText(raw);
  if (text.length === 0) return null;
  const stripped = stripMjDecorationPrefix(text);

  const base = { sourceIndex, raw, text, stripped };

  if (PERCENT_RX.test(text)) {
    return { ...base, kind: "chrome", reason: "status_bar_percent" };
  }
  if (isChromeWordLine(stripped)) {
    return { ...base, kind: "chrome", reason: "chrome_word" };
  }
  if (parseMjAmount(text)) {
    return { ...base, kind: "amount", reason: "amount_token" };
  }
  if (REPEATED_LABEL_RX.test(stripped)) {
    return { ...base, kind: "account_label", reason: "repeated_sender_label" };
  }
  if (DATE_RX.test(stripped)) {
    return { ...base, kind: "date", reason: "date_token" };
  }
  if (stripped.length > 0 && hasNameSubstance(stripped)) {
    return { ...base, kind: "agent_candidate", reason: "name_substance" };
  }
  return { ...base, kind: "noise", reason: "no_name_substance" };
}

/**
 * Classifies every line of an MJ screen. Total, deterministic and
 * order-preserving: lines that normalize to nothing are dropped, all others
 * keep their original source index in ascending order.
 */
export function classifyMjLines(text: string): MjLine[] {
  const out: MjLine[] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = classifyOne(i, rawLines[i]);
    if (line) out.push(line);
  }
  return out;
}

/** Every amount line, in source order. One anchor per candidate row. */
export function findMjAmountAnchors(lines: MjLine[]): MjAmountAnchor[] {
  const anchors: MjAmountAnchor[] = [];
  for (const line of lines) {
    if (line.kind !== "amount") continue;
    const amount = parseMjAmount(line.text);
    if (!amount) continue;
    anchors.push({ sourceIndex: line.sourceIndex, amount, line });
  }
  return anchors;
}

/* ------------------------------------------------------------------ */
/* Agent filtering — batch 0.3B-b                                      */
/* ------------------------------------------------------------------ */

export interface MjAgentCandidate {
  sourceIndex: number;
  /** Canonical name after generic decoration-prefix removal. */
  agentName: string;
  /** Stable transform codes. Never free text. */
  transforms: string[];
}

/**
 * Promotes a classified line to an agent candidate. Returns `null` for every
 * other kind (chrome, account_label, amount, date, noise), so repeated sender
 * labels, amounts and OCR junk can never enter a reconstructed row.
 */
export function toMjAgentCandidate(line: MjLine): MjAgentCandidate | null {
  if (line.kind !== "agent_candidate") return null;
  const agentName = line.stripped;
  if (agentName.length === 0) return null;
  const transforms: string[] = [];
  if (agentName !== line.text) transforms.push("decoration_prefix_stripped");
  if (line.text !== line.raw.trim()) transforms.push("normalized");
  return { sourceIndex: line.sourceIndex, agentName, transforms };
}

/** All agent candidates of a classified screen, in source order. */
export function collectMjAgentCandidates(lines: MjLine[]): MjAgentCandidate[] {
  const out: MjAgentCandidate[] = [];
  for (const line of lines) {
    const candidate = toMjAgentCandidate(line);
    if (candidate) out.push(candidate);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Row reconstruction                                                  */
/* ------------------------------------------------------------------ */

export type MjRowStatus = "resolved" | "missing_agent" | "ambiguous_agent";

export type MjWarningCode =
  | "missing_agent"
  | "ambiguous_agent"
  | "ambiguous_sign"
  | "reversal"
  | "no_date_in_source";

export interface MjReconstructedRow {
  /** Emission order index, 0-based, in anchor order. */
  sourceOrder: number;
  /** Amount line index in the original text. Defines ordering. */
  amountLineIndex: number;
  /** Agent line index, or null when unresolved. Never guessed. */
  agentLineIndex: number | null;
  amount: MjAmount;
  /** Null unless exactly one defensible candidate was found. */
  agentName: string | null;
  /** Every candidate seen in the window, for evidence only. */
  candidateLineIndexes: number[];
  status: MjRowStatus;
  isReversal: boolean;
  /** Date token read off the amount line, or null when the screen had none. */
  date: string | null;
  warnings: MjWarningCode[];
}

/**
 * Reconstructs MJ rows from classified lines.
 *
 * Each amount anchor opens exactly one transaction window that ends at the
 * next anchor (or end of screen). An agent is bound only when the window holds
 * exactly one defensible candidate. Rows are never merged, deduplicated,
 * netted or reordered, and no value is ever invented.
 */
export function reconstructMjRows(lines: MjLine[]): MjReconstructedRow[] {
  const anchors = findMjAmountAnchors(lines);
  const candidates = collectMjAgentCandidates(lines);
  const rows: MjReconstructedRow[] = [];

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const end = i + 1 < anchors.length ? anchors[i + 1].sourceIndex : Number.POSITIVE_INFINITY;
    const inWindow = candidates.filter(
      (c) => c.sourceIndex > anchor.sourceIndex && c.sourceIndex < end,
    );

    const warnings: MjWarningCode[] = [];
    let status: MjRowStatus;
    let agentName: string | null = null;
    let agentLineIndex: number | null = null;

    if (inWindow.length === 1) {
      status = "resolved";
      agentName = inWindow[0].agentName;
      agentLineIndex = inWindow[0].sourceIndex;
    } else if (inWindow.length === 0) {
      status = "missing_agent";
      warnings.push("missing_agent");
    } else {
      status = "ambiguous_agent";
      warnings.push("ambiguous_agent");
    }

    if (anchor.amount.isReversal) warnings.push("reversal");
    if (anchor.amount.signEvidence === "ambiguous") warnings.push("ambiguous_sign");
    if (!anchor.amount.dateText) warnings.push("no_date_in_source");

    rows.push({
      sourceOrder: rows.length,
      amountLineIndex: anchor.sourceIndex,
      agentLineIndex,
      amount: anchor.amount,
      agentName,
      candidateLineIndexes: inWindow.map((c) => c.sourceIndex),
      status,
      isReversal: anchor.amount.isReversal,
      date: anchor.amount.dateText ?? null,
      warnings,
    });
  }

  return rows;
}

/** Signed minor units for evidence/reporting. Negative only for a reversal. */
export function signedMjAmountMinor(row: MjReconstructedRow): number {
  return row.isReversal ? -row.amount.amountSantim : row.amount.amountSantim;
}

/* ------------------------------------------------------------------ */
/* Production-shape adapter — batch 0.3B-c                             */
/* ------------------------------------------------------------------ */

/**
 * An amount window that could not be bound to exactly one defensible agent.
 * Surfaced separately so it is never silently converted into a row.
 */
export interface MjUnresolvedWindow {
  sourceOrder: number;
  amountLineIndex: number;
  status: Exclude<MjRowStatus, "resolved">;
  amountSantim: number;
  isReversal: boolean;
  candidateLineIndexes: number[];
  warnings: MjWarningCode[];
}

export interface MjAdapterResult {
  /** Production-shaped rows, in source order. Resolved windows only. */
  rows: StatementRow[];
  unresolved: MjUnresolvedWindow[];
  /**
   * Every window, resolved and unresolved, in strict source order. One entry
   * per defensible amount anchor — never merged, netted, dropped or reordered.
   */
  ordered: MjAdapterEntry[];
}

export type MjAdapterEntry =
  | { kind: "resolved"; sourceOrder: number; row: StatementRow }
  | { kind: "unresolved"; sourceOrder: number; window: MjUnresolvedWindow };

/** Evidence-only raw string. Contains the amount token and the bound agent. */
function adapterRaw(row: MjReconstructedRow, agentName: string): string {
  return `${row.amount.prefixText}${row.amount.rawAmountText} | ${agentName}`;
}

function toStatementRow(row: MjReconstructedRow, agentName: string): StatementRow {
  return {
    ok: true,
    raw: adapterRaw(row, agentName),
    agentName,
    airtimeType: "airtime_evd",
    amountSantim: row.amount.amountSantim,
    isReversal: row.isReversal,
    ...(row.date ? { dateText: row.date } : {}),
    // MJ rows always need a human eyeball: undated screens have no timestamp,
    // and dated screens are day-only.
    needsReview: true,
  };
}

/**
 * Pure adapter: raw MJ "Transfers → Sent" OCR text in, production-shaped
 * `StatementRow[]` out.
 *
 * - runs the deterministic classifier and row reconstruction
 * - emits one row per resolved window, in source order, duplicates preserved
 * - keeps `dateText` absent (MJ screens carry no date token)
 * - never falls back to the legacy parser and never invents a value
 * - unresolved windows are returned separately, never as rows
 */
export function adaptMjTransfersSent(text: string): MjAdapterResult {
  const reconstructed = reconstructMjRows(classifyMjLines(text));
  const rows: StatementRow[] = [];
  const unresolved: MjUnresolvedWindow[] = [];
  const ordered: MjAdapterEntry[] = [];

  for (const row of reconstructed) {
    if (row.status === "resolved" && row.agentName !== null) {
      const statementRow = toStatementRow(row, row.agentName);
      rows.push(statementRow);
      ordered.push({ kind: "resolved", sourceOrder: row.sourceOrder, row: statementRow });
      continue;
    }
    const window: MjUnresolvedWindow = {
      sourceOrder: row.sourceOrder,
      amountLineIndex: row.amountLineIndex,
      status: row.status === "resolved" ? "missing_agent" : row.status,
      amountSantim: row.amount.amountSantim,
      isReversal: row.isReversal,
      candidateLineIndexes: [...row.candidateLineIndexes],
      warnings: [...row.warnings],
    };
    unresolved.push(window);
    ordered.push({ kind: "unresolved", sourceOrder: row.sourceOrder, window });
  }

  return { rows, unresolved, ordered };
}
