import type { TxnType } from "./types";

export interface ParsedRow {
  ok: boolean;
  raw: string;
  type?: TxnType;
  amountSantim?: number;
  party?: string;
  channel?: string;
  reference?: string;
  date?: string;
  note?: string;
  reason?: string;
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
      type: "airtime",
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
    test: /(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:to|from)\s+([A-Za-z0-9 .'-]+)/i,
    parse: (m, raw) => ({
      type: /from/i.test(raw) ? "in" : "out",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
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
        note: line.length > 140 ? line.slice(0, 140) + "…" : line,
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