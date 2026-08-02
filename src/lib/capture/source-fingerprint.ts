// Source fingerprinting.
//
// The first stage of the capture pipeline. It answers "who issued this text?"
// from positive AND negative evidence before any parser is allowed to guess a
// transaction out of it. Weak or conflicting evidence stays unresolved: the
// operator picks, the app never invents an issuer.

export type CaptureSource = "bank" | "telebirr" | "float" | "evd" | "unknown";

/** Nature of the money container the source describes. */
export type SourceKind = "bank" | "wallet" | "airtime" | "unknown";

export type SourceConfidence = "high" | "medium" | "low" | "none";

export interface SourceFingerprint {
  source: CaptureSource;
  kind: SourceKind;
  /** Named institution/wallet when one is positively identified. */
  channel?: string;
  confidence: SourceConfidence;
  /** Human-readable positive evidence, in detection order. */
  evidence: string[];
  /** Reasons the classification is not trustworthy on its own. */
  conflicts: string[];
  /** False whenever the operator must choose the source by hand. */
  resolved: boolean;
}

interface Marker {
  rx: RegExp;
  label: string;
}

const BANK_INSTITUTIONS: Array<{ channel: string; rx: RegExp; label: string }> = [
  {
    channel: "CBE",
    rx: /\b(?:CBE|Commercial\s+Bank\s+of\s+Ethiopia)\b/i,
    label: "Commercial Bank of Ethiopia named",
  },
  {
    channel: "Abyssinia",
    rx: /\b(?:BoA|Bank\s+of\s+Abyssinia|Abyssinia)\b/i,
    label: "Bank of Abyssinia named",
  },
  {
    channel: "Coop",
    rx: /\b(?:Coop(?:erative)?(?:\s+Bank(?:\s+of\s+Oromia)?)?|CBO)\b/i,
    label: "Cooperative Bank of Oromia named",
  },
  { channel: "Dashen", rx: /\bDashen(?:\s+Bank)?\b/i, label: "Dashen Bank named" },
  { channel: "Awash", rx: /\bAwash(?:\s+Bank)?\b/i, label: "Awash Bank named" },
  { channel: "Wegagen", rx: /\bWegagen(?:\s+Bank)?\b/i, label: "Wegagen Bank named" },
];

const BANK_DOMAINS: Marker[] = [
  {
    rx: /\b(?:apps\.)?cbe\.com\.et|combanketh\.et|bankofabyssinia\.com|coopbankoromia\.com\.et|dashenbanksc\.com|awashbank\.com|wegagen\.com/i,
    label: "bank domain in the message",
  },
];

const BANK_LANGUAGE: Marker[] = [
  {
    rx: /\bAccount\s+[\d*x•]{4,}|\bA\/C\s*[:#]?\s*[\d*x•]{4,}|account\s+number\s+[\d*x•]{4,}/i,
    label: "masked bank account wording",
  },
  {
    rx: /\b(?:Your\s+)?Current\s+Balance\s+is\b|\bAvailable\s+Balance\b|\bLedger\s+Balance\b/i,
    label: "bank balance statement",
  },
  {
    rx: /\bhas been (?:credited|debited)\b|\bwas (?:credited|debited)\b/i,
    label: "bank credit/debit wording",
  },
];

const TELEBIRR_MARKERS: Marker[] = [
  { rx: /\btele\s?-?birr\b/i, label: "telebirr named" },
  { rx: /\bEthio\s*telecom\b/i, label: "Ethio telecom named" },
  { rx: /transactioninfo\.ethiotelecom\.et/i, label: "telebirr receipt domain" },
  { rx: /\bE-?Money\s+Account\b/i, label: "telebirr E-Money account wording" },
];

const FLOAT_MARKERS: Marker[] = [
  { rx: /\bM-?PESA\s+float\b/i, label: "M-PESA float named" },
  { rx: /\bfloat\s+(?:distribution|balance|account)\b/i, label: "float distribution grammar" },
  {
    rx: /\b(?:added to|removed from)\s+your\s+[A-Za-z-]*\s*float\b/i,
    label: "float movement grammar",
  },
  { rx: /\badministrator\b/i, label: "float administrator wording" },
  { rx: /\bSafaricom\b/i, label: "Safaricom named" },
];

const EVD_MARKERS: Marker[] = [
  { rx: /\bEVD\b/, label: "EVD named" },
  { rx: /\bairtime\s+(?:credit|balance|stock)\b/i, label: "airtime credit wording" },
  { rx: /\breceived\s+ETB\s*[\d,.]+\s+airtime\b/i, label: "airtime receipt wording" },
  { rx: /\brecharged\s+ETB\s*[\d,.]+\s+airtime\b/i, label: "airtime recharge wording" },
];

/**
 * Generic money wording that proves a transaction exists but proves NOTHING
 * about the issuer. Kept explicit so "credited with ETB" can never be read as
 * Float or EVD evidence.
 */
const GENERIC_MONEY_RX = /\b(?:credited|debited)\s+with\s+ETB\b/i;

function hits(text: string, markers: Marker[]): string[] {
  return markers.filter((m) => m.rx.test(text)).map((m) => m.label);
}

function bankChannel(text: string): { channel: string; label: string } | null {
  for (const b of BANK_INSTITUTIONS)
    if (b.rx.test(text)) return { channel: b.channel, label: b.label };
  return null;
}

/**
 * Classify the issuer of a raw capture. Deterministic: same text in, same
 * fingerprint out.
 */
export function fingerprintSource(text: string): SourceFingerprint {
  const raw = text ?? "";
  if (!raw.trim()) {
    return {
      source: "unknown",
      kind: "unknown",
      confidence: "none",
      evidence: [],
      conflicts: ["The capture was empty."],
      resolved: false,
    };
  }

  const institution = bankChannel(raw);
  const bankEvidence = [
    ...(institution ? [institution.label] : []),
    ...hits(raw, BANK_DOMAINS),
    ...hits(raw, BANK_LANGUAGE),
  ];
  const telebirrEvidence = hits(raw, TELEBIRR_MARKERS);
  const floatEvidence = hits(raw, FLOAT_MARKERS);
  const evdEvidence = hits(raw, EVD_MARKERS);

  // Negative evidence: generic credit/debit wording never promotes Float/EVD.
  const genericOnly = GENERIC_MONEY_RX.test(raw);

  const conflicts: string[] = [];

  // Airtime always wins over the wallet that delivered it: an airtime receipt
  // is stock movement, not a money transfer.
  if (evdEvidence.length > 0) {
    return {
      source: "evd",
      kind: "airtime",
      channel: telebirrEvidence.length ? "Telebirr" : institution?.channel,
      confidence: evdEvidence.length > 1 ? "high" : "medium",
      evidence: [...evdEvidence, ...telebirrEvidence],
      conflicts,
      resolved: true,
    };
  }

  if (floatEvidence.length > 0) {
    // "Float" alone next to a bank statement is not enough.
    const strongFloat = floatEvidence.length >= 2;
    if (!strongFloat && bankEvidence.length >= 2) {
      conflicts.push("Float wording appears inside a bank message — choose the source.");
      return {
        source: "unknown",
        kind: "unknown",
        confidence: "low",
        evidence: [...floatEvidence, ...bankEvidence],
        conflicts,
        resolved: false,
      };
    }
    return {
      source: "float",
      kind: "airtime",
      channel: "M-Pesa",
      confidence: strongFloat ? "high" : "medium",
      evidence: floatEvidence,
      conflicts,
      resolved: true,
    };
  }

  const bankStrong = Boolean(institution) && bankEvidence.length >= 2;
  const telebirrStrong = telebirrEvidence.length >= 2;

  if (bankStrong && telebirrStrong) {
    // A telebirr-to-bank or bank-to-telebirr message names both sides; the
    // issuer is whichever one owns the account wording. When both own it, the
    // operator decides.
    const telebirrOwns = /\b(?:your\s+tele\s?-?birr\s+account|E-?Money\s+Account)\b/i.test(raw);
    const bankOwns = /\b(?:your\s+account|Account\s+[\d*x•]{4,})\b/i.test(raw);
    if (telebirrOwns && !bankOwns) {
      return {
        source: "telebirr",
        kind: "wallet",
        channel: "Telebirr",
        confidence: "high",
        evidence: telebirrEvidence,
        conflicts,
        resolved: true,
      };
    }
    if (bankOwns && !telebirrOwns) {
      return {
        source: "bank",
        kind: "bank",
        channel: institution?.channel,
        confidence: "high",
        evidence: bankEvidence,
        conflicts,
        resolved: true,
      };
    }
    conflicts.push("Both a bank and telebirr claim this message — choose the source.");
    return {
      source: "unknown",
      kind: "unknown",
      confidence: "low",
      evidence: [...bankEvidence, ...telebirrEvidence],
      conflicts,
      resolved: false,
    };
  }

  if (telebirrStrong || (telebirrEvidence.length === 1 && !bankStrong)) {
    return {
      source: "telebirr",
      kind: "wallet",
      channel: "Telebirr",
      confidence: telebirrStrong ? "high" : "medium",
      evidence: telebirrEvidence,
      conflicts,
      resolved: true,
    };
  }

  if (bankStrong) {
    return {
      source: "bank",
      kind: "bank",
      channel: institution?.channel,
      confidence: "high",
      evidence: bankEvidence,
      conflicts,
      resolved: true,
    };
  }

  if (bankEvidence.length >= 2) {
    // Bank grammar without a named institution: usable, but the operator must
    // still say which bank it is.
    return {
      source: "bank",
      kind: "bank",
      confidence: "medium",
      evidence: bankEvidence,
      conflicts: ["No institution name in the message — pick the bank/wallet."],
      resolved: true,
    };
  }

  return {
    source: "unknown",
    kind: "unknown",
    confidence: bankEvidence.length || genericOnly ? "low" : "none",
    evidence: [...bankEvidence, ...(genericOnly ? ["generic credit/debit wording only"] : [])],
    conflicts: ["Not enough issuer evidence — choose the source by hand."],
    resolved: false,
  };
}
