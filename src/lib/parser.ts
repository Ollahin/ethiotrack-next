import type { TxnType } from "./types";

// SMS "airtime" mentions are represented as EVD credits by default in v2.
type ParserTxnType = Extract<TxnType, "in" | "out" | "airtime_evd">;

export interface ParsedRow {
  ok: boolean;
  raw: string;
  type?: ParserTxnType;
  amountSantim?: number;
  party?: string;
  channel?: string;
  reference?: string;
  date?: string;
  note?: string;
  reason?: string;
  /** Parsed enough to import, but direction/party is a best-guess. */
  needsReview?: boolean;
}

function toSantim(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  return Math.round(n * 100);
}

function pickDate(): string {
  return new Date().toISOString();
}

/**
 * Rules-based parser. Each rule returns a partial ParsedRow on match.
 * Order matters — most specific first.
 */
const RULES: Array<{
  channel: string;
  test: RegExp;
  parse: (m: RegExpMatchArray, raw: string) => Partial<ParsedRow>;
}> = [
  // Telebirr — credited / received
  {
    channel: "Telebirr",
    test: /telebirr[\s\S]*?(?:received|credited)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
  },
  // Telebirr — paid / debited
  {
    channel: "Telebirr",
    test: /telebirr[\s\S]*?(?:paid|debited|sent)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?to\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      type: "out",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
  },
  // Telebirr — airtime
  {
    channel: "Telebirr",
    test: /telebirr[\s\S]*?airtime[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)/i,
    parse: (m) => ({
      type: "airtime_evd",
      amountSantim: toSantim(m[1]),
      party: "Airtime",
    }),
  },
  // CBE — credited
  {
    channel: "CBE",
    test: /\bCBE\b[\s\S]*?(?:credited|received)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
  },
  // CBE — debited
  {
    channel: "CBE",
    test: /\bCBE\b[\s\S]*?(?:debited|withdrawn|paid)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)(?:[\s\S]*?(?:to|for)\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref)))?/i,
    parse: (m) => ({
      type: "out",
      amountSantim: toSantim(m[1]),
      party: (m[2] ?? "Unknown").trim(),
    }),
  },
  // Awash / Dashen / Abyssinia — credit
  {
    channel: "Awash",
    test: /\b(Awash|Dashen|Abyssinia|Wegagen)\b[\s\S]*?(?:credited|received)[\s\S]*?(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      channel: m[1],
      type: "in",
      amountSantim: toSantim(m[2]),
      party: m[3].trim(),
    }),
  },
  {
    channel: "Awash",
    test: /\b(Awash|Dashen|Abyssinia|Wegagen)\b[\s\S]*?(?:debited|withdrawn|paid)[\s\S]*?(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)(?:[\s\S]*?to\s+([A-Za-z0-9 .'-]+?)(?:\.|,|\s+(?:on|Ref)))?/i,
    parse: (m) => ({
      channel: m[1],
      type: "out",
      amountSantim: toSantim(m[2]),
      party: (m[3] ?? "Unknown").trim(),
    }),
  },
  // Generic fallback — any "ETB N.NN to/from X"
  {
    channel: "Other",
    // Capture the preposition itself so direction comes from the SAME match,
    // never from a second loose scan of the whole line.
    // Party stops before " on ", " Ref", punctuation, or end of line.
    test: /(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)\s*(to|from)\s+([A-Za-z0-9.'-][A-Za-z0-9 .'-]*?)(?=\s+(?:on|Ref|Txn|TrxID)\b|[.,;\n]|$)/i,
    parse: (m) => ({
      type: m[2].toLowerCase() === "from" ? "in" : "out",
      amountSantim: toSantim(m[1]),
      party: m[3].trim(),
    }),
  },
  // Last-resort: an amount is present. Try hard to infer direction from
  // keywords anywhere in the message before giving up. Only when nothing
  // conclusive is found do we flag for review (no silent "out" default).
  {
    channel: "Other",
    test: /(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)/i,
    parse: (m, raw) => {
      const t = raw.toLowerCase();
      const inWords = /\b(received|credited|deposit(?:ed)?|refund(?:ed)?|incoming|transferred to your|added to your)\b/;
      const outWords = /\b(paid|debited|withdrawn|withdrew|purchase(?:d)?|bought|sent|transfer(?:red)? to|payment to|charged|bill|utility|topped? up|recharge)\b/;
      const airWords = /\b(airtime|top[- ]?up|recharge|data bundle|mobile package)\b/;
      let type: ParserTxnType | undefined;
      let needsReview = false;
      if (airWords.test(t)) type = "airtime_evd";
      else {
        const hasIn = inWords.test(t);
        const hasOut = outWords.test(t);
        if (hasIn && !hasOut) type = "in";
        else if (hasOut && !hasIn) type = "out";
        else {
          type = "out";
          needsReview = true;
        }
      }
      // Try to extract a party name from "to X" or "from X"
      let party = "Unknown";
      const partyM = raw.match(/\b(?:to|from)\s+([A-Za-z0-9.'-][A-Za-z0-9 .'-]{1,40}?)(?=\s+(?:on|Ref|Txn|TrxID|via)\b|[.,;\n]|$)/i);
      if (partyM) party = partyM[1].trim();
      return {
        type,
        amountSantim: toSantim(m[1]),
        party,
        needsReview,
      };
    },
  },
];

const REF_RX = /\b(?:Ref|Transaction ID|Txn|TrxID)[:# ]*([A-Za-z0-9]{4,})/i;

export function parseOne(raw: string): ParsedRow {
  const line = raw.trim();
  if (!line) return { ok: false, raw, reason: "empty" };
  for (const rule of RULES) {
    const m = line.match(rule.test);
    if (m) {
      const partial = rule.parse(m, line);
      const refM = line.match(REF_RX);
      return {
        ok: true,
        raw: line,
        channel: partial.channel ?? rule.channel,
        type: partial.type,
        amountSantim: partial.amountSantim,
        party: partial.party,
        reference: refM?.[1],
        date: pickDate(),
        // Keep the full original message as the description — truncating it
        // loses reference numbers, dates, and context we need 1 year later.
        note: line,
        needsReview: partial.needsReview ?? false,
      };
    }
  }
  return { ok: false, raw: line, reason: "no rule matched" };
}

export function parseMany(text: string): ParsedRow[] {
  // Split on blank lines OR on newline if each line looks like a full alert
  const blocks = text
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  const blockRows = blocks.length > 1 ? blocks : text.split(/\n+/);
  return blockRows
    .map((r) => r.trim())
    .filter(Boolean)
    .map(parseOne);
}