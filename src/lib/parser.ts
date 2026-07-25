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
      const creditWords = /\b(loan|borrow|owe|credit due|installment|repay(?:ment)?)\b/;
      let type: TxnType | undefined;
      let needsReview = false;
      if (airWords.test(t)) type = "airtime";
      else if (creditWords.test(t)) type = "credit";
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

export function parseMany(text: string): ParsedRow[] {
  // ─────────────────────────────────────────────────────────────────────────
  // SELF-CONTAINED OCR PARSER — Distributor "Refill History" screenshots
  // Handles: date→agent→amount, agent→amount→date, trailing garbage,
  //          leading garbage on amounts, mangled dates, negative amounts.
  // ─────────────────────────────────────────────────────────────────────────

  const t = text.toLowerCase();
  const hasBirr = /\bBirr\b/i.test(text);
  const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g);
  const hasMultipleDates = dateMatches ? dateMatches.length >= 2 : false;
  const hasSmsKeywords = /\b(credited|debited|your current balance|transaction number|account has been|transfer id)\b/i.test(text);

  // Only run this parser for distributor refill OCR (not SMS)
  if (hasBirr && hasMultipleDates && !hasSmsKeywords && text.length > 80) {
    const results = parseRefillOcrInternal(text);
    if (results.length > 0) return results;
  }

  // ── FALLBACK: existing SMS / bank transfer logic (unchanged) ──
  const rawBlocks = text
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (rawBlocks.length > 1) {
    const blocks = rawBlocks.filter((b) => !isBoilerplateBlock(b));
    if (blocks.length === 0) return [];
    if (blocks.length === 1) return [parseOne(blocks[0])];
    const parsedBlocks = blocks.map(parseOne);
    const okBlocks = parsedBlocks.filter((r) => r.ok).length;
    const whole = parseOne(text);
    if (whole.ok && okBlocks <= 1 && parsedBlocks.some((r) => !r.ok)) {
      return [whole];
    }
    if (okBlocks === 0 && looksLikeOcrTransferList(text)) {
      return parseOcrTransferList(text);
    }
    return parsedBlocks;
  }
  const singleRows = text
    .split(/\n+/)
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((l) => !isBoilerplateBlock(l))
    .map(parseOne);
  const anyOk = singleRows.some((r) => r.ok);
  if (!anyOk && looksLikeOcrTransferList(text)) {
    return parseOcrTransferList(text);
  }
  return singleRows;
}

// ── Internal OCR parser (lives inside parser.ts, no imports needed) ───────

function parseRefillOcrInternal(text: string): ParsedRow[] {
  // 1. Clean lines
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[=–—\-]+$/.test(l))
    .filter((l) => !/^→\s*/.test(l))
    .filter((l) => !/^\d{1,2}%$/.test(l))
    .filter((l) => !/^\d{1,2}:\d{2}$/.test(l))
    .filter((l) => !/^4G$|^5G$|^LTE$/i.test(l))
    .filter((l) => !/\b(Refill History|Agents|Add Agent|Refill|Sent|Received|Transfers)\b/i.test(l))
    .filter((l) => l !== "Birr" && l !== "ETB" && l !== "EVD")
    .filter((l) => !/^Link to agent/i.test(l))
    .filter((l) => !/^Review$/i.test(l));

  // 2. Extract dates with line indices
  interface DateAnchor { line: string; idx: number; date: Date }
  const dates: DateAnchor[] = [];
  for (let i = 0; i < lines.length; i++) {
    const d = parseDateLine(lines[i]);
    if (d) dates.push({ line: lines[i], idx: i, date: d });
  }
  if (dates.length === 0) return [];

  // 3. Extract amounts with line indices
  interface AmountAnchor { line: string; idx: number; amount: number; isNegative: boolean }
  const amounts: AmountAnchor[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = parseAmountLine(lines[i]);
    if (a) amounts.push({ line: lines[i], idx: i, amount: a.amount, isNegative: a.isNegative });
  }

  // 4. Extract agent candidates with line indices
  interface AgentAnchor { line: string; idx: number; name: string }
  const agents: AgentAnchor[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = extractAgentName(lines[i]);
    if (name) agents.push({ line: lines[i], idx: i, name });
  }

  // 5. For each date, find nearest amount and agent within ±4 lines
  const out: ParsedOk[] = [];
  const usedAmounts = new Set<number>();
  const usedAgents = new Set<number>();

  for (const d of dates) {
    // Find nearest unused amount
    let bestAmount: AmountAnchor | null = null;
    let bestAmountDist = Infinity;
    for (const a of amounts) {
      if (usedAmounts.has(a.idx)) continue;
      const dist = Math.abs(a.idx - d.idx);
      if (dist <= 4 && dist < bestAmountDist) {
        bestAmountDist = dist;
        bestAmount = a;
      }
    }
    if (!bestAmount) continue;

    // Find nearest unused agent (preferably on the opposite side of the date from the amount)
    let bestAgent: AgentAnchor | null = null;
    let bestAgentDist = Infinity;
    for (const ag of agents) {
      if (usedAgents.has(ag.idx)) continue;
      const dist = Math.abs(ag.idx - d.idx);
      if (dist <= 4 && dist < bestAgentDist) {
        // Prefer agent that is NOT on the same side as amount relative to date
        const amountSide = bestAmount.idx > d.idx ? 1 : -1;
        const agentSide = ag.idx > d.idx ? 1 : -1;
        // If agent is on opposite side, boost it (smaller effective distance)
        const effectiveDist = amountSide !== agentSide ? dist * 0.5 : dist;
        if (effectiveDist < bestAgentDist) {
          bestAgentDist = effectiveDist;
          bestAgent = ag;
        }
      }
    }
    if (!bestAgent) continue;

    // Validate: agent and amount must be within 3 lines of each other
    if (Math.abs(bestAgent.idx - bestAmount.idx) > 3) continue;

    // Build raw context
    const minIdx = Math.min(d.idx, bestAgent.idx, bestAmount.idx);
    const maxIdx = Math.max(d.idx, bestAgent.idx, bestAmount.idx);
    const raw = lines.slice(Math.max(0, minIdx - 1), Math.min(lines.length, maxIdx + 2)).join("\n");

    usedAmounts.add(bestAmount.idx);
    usedAgents.add(bestAgent.idx);

    out.push({
      ok: true,
      type: "airtime_evd",
      amountSantim: bestAmount.amount,
      party: bestAgent.name,
      channel: "Other",
      date: d.date.toISOString(),
      note: `EVD refill to ${bestAgent.name} — ${d.date.toLocaleString("en-GB")}`,
      template: "ocr.distributor.refill",
      needsReview: bestAmount.isNegative || bestAmount.amount < 1_000_00,
      raw,
    });
  }

  // Deduplicate by (party + amount + day)
  const seen = new Set<string>();
  return out.filter((r) => {
    const day = r.date.slice(0, 10);
    const key = `${r.party}|${r.amountSantim}|${day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDateLine(line: string): Date | null {
  // YYYY-MM-DD H:MM AM/PM
  const m1 = line.match(/\b(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (m1) {
    let h = parseInt(m1[4], 10);
    const ampm = m1[6].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const d = new Date(parseInt(m1[1], 10), parseInt(m1[2], 10) - 1, parseInt(m1[3], 10), h, parseInt(m1[5], 10));
    if (!isNaN(d.getTime())) return d;
  }
  // YYYY-MM-DDH:MM AM/PM (no space — mangled OCR)
  const m1b = line.match(/\b(\d{4})-(\d{2})-(\d{2})(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (m1b) {
    let h = parseInt(m1b[4], 10);
    const ampm = m1b[6].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const d = new Date(parseInt(m1b[1], 10), parseInt(m1b[2], 10) - 1, parseInt(m1b[3], 10), h, parseInt(m1b[5], 10));
    if (!isNaN(d.getTime())) return d;
  }
  // DD MMM YYYY
  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const m2 = line.match(/\b(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})\b/);
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const d = new Date(parseInt(m2[3], 10), mo, parseInt(m2[1], 10));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function parseAmountLine(line: string): { amount: number; isNegative: boolean } | null {
  // Find number with optional negative sign, optional "Birr" or "ETB"
  // Also handles leading garbage like "9 50,000 Birr"
  const m = line.match(/(-?)\D*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(?:Birr|ETB)?/i);
  if (!m) return null;

  const raw = m[2];
  const clean = raw.replace(/,/g, "");
  const n = parseFloat(clean);
  if (isNaN(n) || n <= 0) return null;
  if (n >= 2000 && n <= 2100 && raw.endsWith(".00")) return null; // year garbage

  return { amount: Math.round(n * 100), isNegative: m[1] === "-" };
}

function extractAgentName(line: string): string | null {
  let clean = line.trim();
  if (clean.length < 2 || clean.length > 40) return null;

  // Strip trailing garbage (non-letters)
  clean = clean.replace(/[^A-Za-z\s]+$/, "").trim();
  if (clean.length < 2) return null;

  // Must have at least 2 letters
  if ((clean.match(/[A-Za-z]/g) || []).length < 2) return null;

  // Reject known non-agents
  if (/\bbariso/i.test(clean)) return null;
  if (/\bhaji\b/i.test(clean)) return null;
  if (/\b(Refill|Agents|Add Agent|Review|Link|Sent|Received|Transfers|Birr|ETB|EVD)\b/i.test(clean)) return null;
  if (/^\d+$/.test(clean)) return null;
  if (/^\d{1,2}:\d{2}/.test(clean)) return null;

  // Allow letters, spaces, limited punctuation
  if (!/^[A-Za-z\s.'\-]+$/.test(clean)) return null;

  return clean;
}
