// Smart Capture routing.
//
// Pure decision layer that decides WHICH existing, frozen parser a captured
// payload belongs to. It never re-implements a parser, never invents a field
// and never guesses when the evidence is tied: it reports candidates and lets
// a human choose.

import { parseMany } from "./parser";
import { parseFloatEvdSms } from "./float-evd-sms-parser";
import { detectStatementTemplate } from "./distributor-parser";
import { fingerprintSource } from "./capture/source-fingerprint";

/** Capture families the app can actually persist through a reviewed pipeline. */
export type CaptureFamily = "bank_message" | "airtime_sms" | "distributor_statement" | "unknown";

export const CAPTURE_FAMILY_LABEL: Record<CaptureFamily, string> = {
  bank_message: "Bank message",
  airtime_sms: "Float / EVD message",
  distributor_statement: "Distributor statement",
  unknown: "Not recognised",
};

export interface CaptureCandidate {
  family: CaptureFamily;
  /** Count of defensible units the family's own parser recovered. */
  recognized: number;
  /** Short, human-readable reason shown in the UI — never a raw score. */
  evidence: string;
  /** Deterministic ranking score. Higher wins; ties are reported as ambiguous. */
  score: number;
}

export interface CaptureClassification {
  /** Best family, or "unknown" when nothing was recognised. */
  family: CaptureFamily;
  /** True when two or more families tie — the operator must pick. */
  ambiguous: boolean;
  /** All families that recognised something, best first. */
  candidates: CaptureCandidate[];
  /** Reason for the chosen family (or for the failure). */
  evidence: string;
}

/** Only text that could plausibly hold a transaction is worth classifying. */
export function hasCaptureContent(text: string): boolean {
  return text.trim().length > 0;
}

function bankCandidate(text: string): CaptureCandidate {
  let recognized = 0;
  try {
    recognized = parseMany(text).filter((r) => r.ok).length;
  } catch {
    recognized = 0;
  }
  return {
    family: "bank_message",
    recognized,
    evidence: recognized
      ? `${recognized} bank transaction line(s) recognised`
      : "No bank transaction line recognised",
    score: recognized * 10,
  };
}

function airtimeCandidate(text: string): CaptureCandidate {
  let events = 0;
  let review = 0;
  try {
    const res = parseFloatEvdSms(text);
    events = res.events.length;
    review = res.reviewRows.length;
  } catch {
    events = 0;
  }
  const recognized = events;
  return {
    family: "airtime_sms",
    recognized,
    evidence: recognized
      ? `${recognized} Float/EVD event(s) recognised` + (review ? `, ${review} needing review` : "")
      : "No Float or EVD event recognised",
    // Float/EVD messages carry a provable reference identity, so a recognised
    // event outranks a generic bank line of the same count.
    score: recognized * 12,
  };
}

function statementCandidate(text: string): CaptureCandidate {
  let recognized = 0;
  let label = "Generic";
  let kind = "generic";
  try {
    const match = detectStatementTemplate(text, "generic");
    kind = match.kind;
    label = match.label;
    recognized = kind === "generic" ? 0 : match.rows.filter((r) => r.ok).length;
  } catch {
    recognized = 0;
  }
  return {
    family: "distributor_statement",
    recognized,
    evidence: recognized
      ? `${label} layout with ${recognized} row(s)`
      : "No distributor statement layout matched",
    score: recognized * 11,
  };
}

/**
 * Classify pasted or shared text. Deterministic: the same text always yields
 * the same family, candidate order and evidence.
 */
export function classifyCapturedText(text: string): CaptureClassification {
  if (!hasCaptureContent(text)) {
    return {
      family: "unknown",
      ambiguous: false,
      candidates: [],
      evidence: "Nothing to read — the capture was empty.",
    };
  }
  // Source first: who issued the text decides which parser owns it. Parser
  // scores are only used when the issuer cannot be established.
  const fp = fingerprintSource(text);
  if (fp.resolved) {
    const family: CaptureFamily =
      fp.source === "float" || fp.source === "evd" ? "airtime_sms" : "bank_message";
    const all = [airtimeCandidate(text), bankCandidate(text), statementCandidate(text)];
    return {
      family,
      ambiguous: false,
      candidates: all
        .filter((c) => c.recognized > 0 || c.family === family)
        .sort((a, b) => (a.family === family ? -1 : b.family === family ? 1 : 0)),
      evidence: `${fp.source} source (${fp.confidence} confidence): ${fp.evidence.join(", ")}`,
    };
  }
  const all = [airtimeCandidate(text), bankCandidate(text), statementCandidate(text)];
  const recognised = all
    .filter((c) => c.recognized > 0)
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));

  if (recognised.length === 0) {
    return {
      family: "unknown",
      ambiguous: false,
      candidates: [],
      evidence:
        fp.conflicts[0] ??
        "No parser recognised this text. Nothing was guessed — pick a type by hand or enter it manually.",
    };
  }
  const best = recognised[0];
  const ambiguous = recognised.length > 1 && recognised[1].score === best.score;
  return {
    family: ambiguous ? "unknown" : best.family,
    ambiguous,
    candidates: recognised,
    evidence: ambiguous
      ? "Two capture types read this text equally well — choose which one applies."
      : best.evidence,
  };
}

/** Families a shared/uploaded file can be routed to, from its MIME type alone. */
export type CaptureFileKind = "image" | "pdf" | "text" | "unsupported";

export function classifyCapturedFile(file: { type?: string; name?: string }): CaptureFileKind {
  const type = (file.type ?? "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || /\.(txt|csv|md)$/.test(name)) return "text";
  return "unsupported";
}
