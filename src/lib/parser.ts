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
  /** Last 4 chars of the account/wallet involved (e.g. "4599", "8755", "1086"). */
  accountTail?: string;
  /** Counterparty phone if present (Telebirr transfers). */
  counterpartyPhone?: string;
  /** Service fee in santim (Telebirr). */
  feeSantim?: number;
  /** VAT on the fee in santim (Telebirr). */
  vatSantim?: number;
  /** Reported balance after the txn, in santim. */
  balanceSantim?: number;
  /** Which named template matched — for debugging & UI badges. */
  template?: string;
}

function toSantim(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  return Math.round(n * 100);
}

function last4(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const digits = s.replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse the many date shapes bank SMS use. Returns ISO string or undefined. */
function parseDate(raw: string): string | undefined {
  const m1 = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (m1) {
    const dt = new Date(Date.UTC(+m1[3], +m1[2] - 1, +m1[1], +(m1[4] ?? 0), +(m1[5] ?? 0), +(m1[6] ?? 0)));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  const m2 = raw.match(/\bON\s+(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\b/i);
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const dt = new Date(Date.UTC(+m2[3], mo, +m2[1], +(m2[4] ?? 0), +(m2[5] ?? 0)));
      if (!isNaN(dt.getTime())) return dt.toISOString();
    }
  }
  const m3 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (m3) {
    const dt = new Date(`${m3[1]}-${m3[2]}-${m3[3]}T${m3[4]}:${m3[5]}:${m3[6] ?? "00"}Z`);
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return undefined;
}

/** High-precision templates for known Ethiopian bank/wallet SMS. */
function matchTemplates(raw: string): Partial<ParsedRow> | null {
  // -------- CBE --------
  let m = raw.match(/Account\s+([\d*]+)\s+has been credited by\s+(.+?)\s+with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "CBE", type: "in",
    amountSantim: toSantim(m[3]), party: m[2].trim(),
    accountTail: last4(m[1]), balanceSantim: toSantim(m[4]),
    reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
    template: "cbe.credit.by",
  };
  m = raw.match(/Account\s+([\d*]+)\s+has been Credited with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "CBE", type: "in",
    amountSantim: toSantim(m[2]), party: "Deposit",
    accountTail: last4(m[1]), balanceSantim: toSantim(m[3]),
    reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
    template: "cbe.credit",
  };
  m = raw.match(/Account\s+([\d*]+)\s+has been debited with ETB\s*([\d,]+(?:\.\d+)?)\s*\.?\s*Service charge of ETB\s*([\d,]+(?:\.\d+)?)\s*and VAT.*?of ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) {
    const balM = raw.match(/Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "CBE", type: "out",
      amountSantim: toSantim(m[2]), party: "Bank charge / transfer",
      accountTail: last4(m[1]),
      feeSantim: toSantim(m[3]), vatSantim: toSantim(m[4]),
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
      template: "cbe.debit.fees",
    };
  }
  m = raw.match(/Account\s+([\d*]+)\s+has been debited with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "CBE", type: "out",
    amountSantim: toSantim(m[2]), party: "Withdrawal / payment",
    accountTail: last4(m[1]), balanceSantim: toSantim(m[3]),
    reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
    template: "cbe.debit",
  };

  // -------- Bank of Abyssinia --------
  m = raw.match(/your account\s+([\d*]+)\s+was credited with ETB\s*([\d,]+(?:\.\d+)?)\s+by\s+(.+?)\.\s*Available Balance:\s*ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "Abyssinia", type: "in",
    amountSantim: toSantim(m[2]), party: m[3].trim(),
    accountTail: last4(m[1]), balanceSantim: toSantim(m[4]),
    reference: raw.match(/trx=([A-Z0-9]{6,})/i)?.[1],
    template: "boa.credit",
  };
  m = raw.match(/your account\s+([\d*]+)\s+was debited with ETB\s*([\d,]+(?:\.\d+)?)\.\s*Available Balance:\s*ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "Abyssinia", type: "out",
    amountSantim: toSantim(m[2]), party: "Withdrawal / payment",
    accountTail: last4(m[1]), balanceSantim: toSantim(m[3]),
    reference: raw.match(/trx=([A-Z0-9]{6,})/i)?.[1],
    template: "boa.debit",
  };

  // -------- Coop Bank of Oromia --------
  m = raw.match(/Account\s+([\d*]+)\s+has been Credited with ETB\s*([\d,]+(?:\.\d+)?)\s+Ref:\s*([A-Z0-9]+).*?Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) {
    const bySelf = /\bby self\b/i.test(raw);
    const byM = raw.match(/BY\s+([A-Z][A-Z0-9 .'\/-]{1,60}?)(?:\s+ON\s+\d|\s*\.\s*Your Current Balance)/i);
    return {
      channel: "Coop", type: "in",
      amountSantim: toSantim(m[2]),
      party: bySelf ? "Self deposit" : (byM?.[1]?.trim() || "Deposit"),
      accountTail: last4(m[1]), balanceSantim: toSantim(m[4]),
      reference: m[3], template: "coop.credit",
    };
  }
  m = raw.match(/Account\s+([\d*]+)\s+has been Debited with ETB\s*-?([\d,]+(?:\.\d+)?)\s+Ref:\s*([A-Z0-9]+).*?(?:TO\s+([A-Z][A-Z0-9 .'\/-]{1,60}?))?\.\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
  if (m) return {
    channel: "Coop", type: "out",
    amountSantim: toSantim(m[2]),
    party: m[4]?.trim() || "Payment",
    accountTail: last4(m[1]), balanceSantim: toSantim(m[5]),
    reference: m[3], template: "coop.debit",
  };

  // -------- Telebirr --------
  m = raw.match(/You have transferred ETB\s*([\d,]+(?:\.\d+)?)\s+to\s+(.+?)\s*\(([\d*]+)\)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i);
  if (m) {
    const feeM = raw.match(/service fee is ETB\s*([\d,]+(?:\.\d+)?)/i);
    const vatM = raw.match(/VAT[^E]*ETB\s*([\d,]+(?:\.\d+)?)/i);
    const balM = raw.match(/E-Money Account balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr", type: "out",
      amountSantim: toSantim(m[1]), party: m[2].trim(),
      counterpartyPhone: m[3], reference: m[5],
      feeSantim: feeM ? toSantim(feeM[1]) : undefined,
      vatSantim: vatM ? toSantim(vatM[1]) : undefined,
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.transfer.out",
    };
  }
  m = raw.match(/transferred ETB\s*([\d,]+(?:\.\d+)?)\s+successfully from your telebirr account\s+([\d*]+)\s+to\s+(.+?)\s+account number\s+([\d*]+).*?telebirr transaction number is\s+([A-Z0-9]+)/i);
  if (m) return {
    channel: "Telebirr", type: "out",
    amountSantim: toSantim(m[1]),
    party: `${m[3].trim()} (${last4(m[4]) ?? m[4]})`,
    accountTail: last4(m[2]),
    reference: m[5], template: "telebirr.transfer.bank",
  };
  m = raw.match(/You have received ETB\s*([\d,]+(?:\.\d+)?)\s+from\s+(.+?)\s*\(([\d*]+)\)[^.]*\.\s*Your transaction number is\s+([A-Z0-9]+)(?:.*?E-Money Account balance is ETB\s*([\d,]+(?:\.\d+)?))?/i);
  if (m) return {
    channel: "Telebirr", type: "in",
    amountSantim: toSantim(m[1]), party: m[2].trim(),
    counterpartyPhone: m[3], reference: m[4],
    balanceSantim: m[5] ? toSantim(m[5]) : undefined,
    template: "telebirr.receive.person",
  };
  m = raw.match(/You have received ETB\s*([\d,]+(?:\.\d+)?)\s+airtime\s+from\s+([\d*+]+)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i);
  if (m) return {
    channel: "Telebirr", type: "airtime_evd",
    amountSantim: toSantim(m[1]), party: m[2],
    counterpartyPhone: m[2], reference: m[4],
    template: "telebirr.receive.airtime",
  };
  m = raw.match(/You have received ETB\s*([\d,]+(?:\.\d+)?)\s+by transaction number\s+([A-Z0-9]+)\s+on\s+\S+\s+\S+\s+from\s+(.+?)\s+to your telebirr Account\s+([\d*]+)/i);
  if (m) return {
    channel: "Telebirr", type: "in",
    amountSantim: toSantim(m[1]), party: m[3].trim(),
    reference: m[2], accountTail: last4(m[4]),
    template: "telebirr.receive.bank",
  };
  m = raw.match(/You have paid ETB\s*([\d,]+(?:\.\d+)?)\s+for\s+([a-zA-Z ]+?)\s+purchased from\s+(\d+)\s*-\s*(.+?)(?:\s+for plate number\s+(\S+))?\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i);
  if (m) {
    const balM = raw.match(/current balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr", type: "out",
      amountSantim: toSantim(m[1]),
      party: `${m[4].trim()}${m[5] ? ` · ${m[5]}` : ""}`,
      reference: m[7],
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.merchant",
    };
  }
  m = raw.match(/successfully made a tax payment ETB\s*([\d,]+(?:\.\d+)?)\s+for\s+(.+?)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i);
  if (m) return {
    channel: "Telebirr", type: "out",
    amountSantim: toSantim(m[1]), party: `Tax · ${m[2].trim()}`,
    reference: m[4], template: "telebirr.tax",
  };
  m = raw.match(/You have recharged ETB\s*([\d,]+(?:\.\d+)?)\s+airtime\s+for\s+([\d*+]+)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i);
  if (m) {
    const balM = raw.match(/current balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr", type: "airtime_evd",
      amountSantim: toSantim(m[1]), party: `Recharge · ${m[2]}`,
      counterpartyPhone: m[2], reference: m[4],
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.recharge",
    };
  }
  return null;
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

/**
 * Channel/bank keyword detection — scans an SMS/notification for the standard
 * name or well-known abbreviation of a bank/wallet. Used as a fallback when
 * no high-precision template matches, so we can still categorize the txn
 * under a specific bank instead of "Other".
 */
export const CHANNEL_KEYWORDS: Array<{ channel: string; rx: RegExp }> = [
  { channel: "CBE",       rx: /\b(CBE|Commercial\s+Bank\s+of\s+Ethiopia)\b/i },
  { channel: "Abyssinia", rx: /\b(BoA|Bank\s+of\s+Abyssinia|Abyssinia)\b/i },
  { channel: "Coop",      rx: /\b(Coop(?:erative)?(?:\s+Bank(?:\s+of\s+Oromia)?)?|CBO)\b/i },
  { channel: "Awash",     rx: /\bAwash(?:\s+Bank)?\b/i },
  { channel: "Dashen",    rx: /\bDashen(?:\s+Bank)?\b/i },
  { channel: "Wegagen",   rx: /\bWegagen(?:\s+Bank)?\b/i },
  { channel: "Telebirr",  rx: /\b(telebirr|tele[- ]?birr|E[- ]?Money\s+Account)\b/i },
  { channel: "CoopPay",   rx: /\b(coop[- ]?pay|coopay|e[- ]?birr|ebirr)\b/i },
  { channel: "M-Pesa",    rx: /\b(M[- ]?Pesa|Safaricom(?:\s+M[- ]?Pesa)?)\b/i },
];

export function detectChannel(raw: string): string | undefined {
  for (const { channel, rx } of CHANNEL_KEYWORDS) {
    if (rx.test(raw)) return channel;
  }
  return undefined;
}

/** Generic account/wallet-tail extractor for messages we can't template-match. */
function detectAccountTail(raw: string): string | undefined {
  const m = raw.match(
    /(?:A\/C|A\/c|Acc(?:ount)?|Wallet)\s*(?:no\.?|number)?\s*[:#]?\s*[*xX•·]*\s*(\d{4,})/i,
  );
  return last4(m?.[1]);
}

export function parseOne(raw: string): ParsedRow {
  const line = raw.trim();
  if (!line) return { ok: false, raw, reason: "empty" };
  const tpl = matchTemplates(line);
  if (tpl) {
    return {
      ok: true,
      raw: line,
      date: parseDate(line) ?? new Date().toISOString(),
      note: line,
      needsReview: false,
      ...tpl,
    };
  }
  for (const rule of RULES) {
    const m = line.match(rule.test);
    if (m) {
      const partial = rule.parse(m, line);
      const refM = line.match(REF_RX);
      // Prefer a keyword-detected channel over the rule's own default.
      // "Other" is the generic fallback and should be replaced whenever a
      // real bank/wallet keyword shows up anywhere in the message.
      const kwChannel = detectChannel(line);
      const ruleChannel = partial.channel ?? rule.channel;
      const channel =
        ruleChannel === "Other" && kwChannel ? kwChannel : ruleChannel;
      return {
        ok: true,
        raw: line,
        channel,
        type: partial.type,
        amountSantim: partial.amountSantim,
        party: partial.party,
        reference: refM?.[1],
        accountTail: detectAccountTail(line),
        date: parseDate(line) ?? new Date().toISOString(),
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