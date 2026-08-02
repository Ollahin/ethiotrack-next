// Direction engine.
//
// Money direction is decided from GRAMMATICAL ROLES, never from the presence
// of a verb like "transferred". "You have transferred to X" and "X transferred
// to your account" share that verb and mean opposite things, so every rule
// below binds the verb to the party that owns the account.
//
// Institution-independent by construction: no customer name, amount, date or
// bank brand appears in any rule.

export type Direction = "in" | "out" | "unknown";

export interface DirectionVerdict {
  direction: Direction;
  confidence: "high" | "medium" | "none";
  /** Human-readable grammatical roles that produced the verdict. */
  evidence: string[];
  /** Reasons the direction must not be trusted (opposing roles). */
  conflicts: string[];
  /** False whenever a human must confirm the direction. */
  resolved: boolean;
}

interface Rule {
  rx: RegExp;
  label: string;
}

/** Money arriving in the account the message is addressed to. */
const INBOUND_RULES: Rule[] = [
  {
    rx: /\b(?:transferred|transfered|sent|deposited|paid|credited)\b[^.;\n]{0,80}?\bto\s+your\s+(?:account|a\/c|wallet|e-?money|balance)\b/i,
    label: "…to your account (inbound role)",
  },
  {
    rx: /\byour\s+(?:account|a\/c|wallet|e-?money|balance)[^.;\n]{0,80}?\b(?:has been|was|is|been)?\s*credited\b/i,
    label: "your account credited",
  },
  { rx: /\bhas\s+been\s+credited\b|\bwas\s+credited\b/i, label: "account credited" },
  { rx: /\bcredited\s+with\b/i, label: "credited with" },
  {
    rx: /\byou\s+have\s+(?:successfully\s+)?received\b|\byou\s+received\b/i,
    label: "you have received",
  },
  {
    rx: /\breceived\b[^.;\n]{0,60}?\bfrom\s+(?:account|a\/c|[A-Z0-9])/i,
    label: "received from account",
  },
  { rx: /\bdeposit(?:ed)?\s+(?:in)?to\s+your\b/i, label: "deposited into your account" },
  { rx: /\bደርሶዎታል\b/, label: "Amharic inbound (ደርሶዎታል)" },
];

/** Money leaving the account the message is addressed to. */
const OUTBOUND_RULES: Rule[] = [
  {
    rx: /\byou\s+have\s+(?:successfully\s+)?(?:transferred|transfered|sent|paid|purchased|withdrawn)\b/i,
    label: "you have transferred/paid",
  },
  {
    rx: /\byou\s+(?:transferred|transfered|sent|paid|withdrew)\b/i,
    label: "you transferred/paid",
  },
  {
    rx: /\byour\s+(?:account|a\/c|wallet|e-?money|balance)[^.;\n]{0,80}?\b(?:has been|was|is|been)?\s*debited\b/i,
    label: "your account debited",
  },
  { rx: /\bhas\s+been\s+debited\b|\bwas\s+debited\b/i, label: "account debited" },
  { rx: /\bdebited\s+with\b/i, label: "debited with" },
  {
    rx: /\b(?:transferred|transfered|withdrawn|paid)\b[^.;\n]{0,80}?\bfrom\s+your\s+(?:account|a\/c|wallet|e-?money)\b/i,
    label: "…from your account (outbound role)",
  },
  { rx: /\bpaid\s+to\b/i, label: "paid to" },
  { rx: /\bwithdraw(?:n|al)?\b/i, label: "withdrawal wording" },
];

function hits(text: string, rules: Rule[]): string[] {
  return rules.filter((r) => r.rx.test(text)).map((r) => r.label);
}

/**
 * Resolve money direction from one message's grammar.
 *
 * A message that carries roles from both directions is never guessed: it is
 * reported unresolved so review can raise NEEDS_ATTENTION.
 */
export function resolveDirection(text: string): DirectionVerdict {
  const raw = text ?? "";
  if (!raw.trim()) {
    return {
      direction: "unknown",
      confidence: "none",
      evidence: [],
      conflicts: ["The message was empty."],
      resolved: false,
    };
  }
  const inbound = hits(raw, INBOUND_RULES);
  const outbound = hits(raw, OUTBOUND_RULES);

  if (inbound.length > 0 && outbound.length > 0) {
    return {
      direction: "unknown",
      confidence: "none",
      evidence: [...inbound, ...outbound],
      conflicts: [
        "The message states both an inbound and an outbound role — confirm the direction.",
      ],
      resolved: false,
    };
  }
  if (inbound.length > 0) {
    return {
      direction: "in",
      confidence: inbound.length > 1 ? "high" : "medium",
      evidence: inbound,
      conflicts: [],
      resolved: true,
    };
  }
  if (outbound.length > 0) {
    return {
      direction: "out",
      confidence: outbound.length > 1 ? "high" : "medium",
      evidence: outbound,
      conflicts: [],
      resolved: true,
    };
  }
  return {
    direction: "unknown",
    confidence: "none",
    evidence: [],
    conflicts: ["No grammatical role identified the direction."],
    resolved: false,
  };
}
