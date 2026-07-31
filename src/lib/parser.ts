import type { TxnType } from "./types";
import {
  looksLikeDistributorRefillOcr,
  parseDistributorRefillOcr,
  looksLikeBankTransferOcr,
  parseBankTransferOcr,
} from "./ocr-parser";

// SMS "airtime" mentions are represented as EVD credits by default in v2.
type ParserTxnType = Extract<TxnType, "in" | "out" | "airtime_evd">;

/**
 * Successful parse. Discriminated by `ok: true` so `type` and `amountSantim`
 * are guaranteed present — no more `row.type!` non-null assertions at call sites.
 */
export interface ParsedOk {
  ok: true;
  raw: string;
  type: ParserTxnType;
  amountSantim: number;
  party?: string;
  channel?: string;
  reference?: string;
  date?: string;
  note?: string;
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
  /**
   * Principal (transferred) amount of an outgoing transfer, in santim, when the
   * source states it separately from the final debit. Never inferred.
   */
  principalSantim?: number;
  /** Disaster Recovery charge in santim, when the source states one. */
  drChargeSantim?: number;
  /** Last 4 digits of the counterparty/destination account, when stated. */
  counterpartyAccountTail?: string;
  /** True when the source gave a calendar date but no clock time. */
  dateIsDayOnly?: boolean;
  /**
   * Fields the source did not state and which were therefore NOT filled in.
   * Surfaced in review so the user can see exactly what is missing.
   */
  missingFields?: string[];
  /** Which named template matched — for debugging & UI badges. */
  template?: string;
}

export interface ParsedFail {
  ok: false;
  raw: string;
  reason: string;
}

export type ParsedRow = ParsedOk | ParsedFail;

/** Partial template output — must produce `type` and `amountSantim` to succeed. */
type TemplateFields = Partial<Omit<ParsedOk, "ok" | "raw">>;

function toSantim(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  return Math.round(n * 100);
}

function normalizeSms(raw: string): string {
  return raw
    .replace(/[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, " ")
    .trim();
}

function last4(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const digits = s.replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export interface ParsedDateInfo {
  iso: string;
  /** The source stated a calendar day but no clock time. */
  dayOnly: boolean;
}

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const up = meridiem.toUpperCase();
  if (up === "AM") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/**
 * Parse the many date shapes bank SMS use. Returns the ISO value plus whether
 * the source stated a clock time. Never invents a date or a time.
 */
export function parseDateInfo(raw: string): ParsedDateInfo | undefined {
  const m1 = raw.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i,
  );
  if (m1) {
    const hasTime = m1[4] !== undefined;
    const dt = new Date(
      Date.UTC(
        +m1[3],
        +m1[2] - 1,
        +m1[1],
        hasTime ? to24h(+m1[4], m1[7]) : 0,
        +(m1[5] ?? 0),
        +(m1[6] ?? 0),
      ),
    );
    if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
  }
  const m2 = raw.match(
    /\bON\s+(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2}))?/i,
  );
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const hasTime = m2[4] !== undefined;
      const dt = new Date(Date.UTC(+m2[3], mo, +m2[1], +(m2[4] ?? 0), +(m2[5] ?? 0)));
      if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
    }
  }
  const m3 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (m3) {
    const hasTime = m3[4] !== undefined;
    const dt = new Date(
      `${m3[1]}-${m3[2]}-${m3[3]}T${m3[4] ?? "00"}:${m3[5] ?? "00"}:${m3[6] ?? "00"}Z`,
    );
    if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
  }
  return undefined;
}

function parseDate(raw: string): string | undefined {
  return parseDateInfo(raw)?.iso;
}

// ---------------------------------------------------------------------------
// CBE outgoing transfer ("successfully transferred")
//
// Source-faithful field scan rather than one monolithic regex: each field is
// located independently so line wrapping, extra punctuation and optional
// clauses (Disaster Recovery charge, receipt link, greeting) never destroy the
// whole message. Nothing absent from the source is ever filled in.
// ---------------------------------------------------------------------------

/** Trigger phrase for a CBE outgoing transfer, tolerant of the "transfered" typo. */
export const CBE_TRANSFER_TRIGGER_RX = /successfully\s+transferr?ed/i;

const AMOUNT_BODY = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?`;

/** First amount following `label`, with the currency word on either side. */
function amountAfter(text: string, label: string): number | undefined {
  const rx = new RegExp(
    String.raw`${label}[^0-9]{0,40}?(?:ETB|Birr|Br\.?)?\s*(${AMOUNT_BODY})(?:\s*(?:ETB|Birr|Br\.?))?`,
    "i",
  );
  const m = text.match(rx);
  return m ? toSantim(m[1]) : undefined;
}

/** Collapse wrapped lines so a multiline SMS reads as one sentence. */
export function flattenSms(raw: string): string {
  return normalizeSms(raw).replace(/\s*\n+\s*/g, " ").replace(/[ \t]{2,}/g, " ");
}

function matchCbeOutgoingTransfer(raw: string): TemplateFields | null {
  const text = flattenSms(raw);
  if (!CBE_TRANSFER_TRIGGER_RX.test(text)) return null;

  // Principal — the transferred amount itself. Required.
  const principal =
    amountAfter(text, String.raw`successfully\s+transferr?ed`) ??
    amountAfter(text, String.raw`\btransferr?ed\b`);
  if (principal === undefined) return null;

  const missing: string[] = [];

  // Source account: "from your account 1000****4599" / "from account 1000...".
  const srcM = text.match(/\bfrom\s+(?:your\s+)?(?:account|a\/c)\s*(?:no\.?|number)?\s*([\d*Xx]{4,})/i);
  // Destination account and recipient: "to 1000****1086 (NAME)" — either part
  // may be absent; the parenthesised name is the recipient/distributor label.
  const dstM = text.match(/\bto\s+(?:account\s*)?([\d*Xx]{4,})/i);
  const nameM = text.match(/\(([^)]{2,60})\)/);

  const serviceCharge = amountAfter(text, String.raw`service\s+charge`);
  const vat = amountAfter(text, String.raw`\bVAT\b`);
  const drCharge = amountAfter(text, String.raw`disaster\s+recovery(?:\s+charge)?`);
  const totalDebit =
    amountAfter(text, String.raw`total\s+(?:amount\s+)?debit(?:ed|s)?`) ??
    amountAfter(text, String.raw`total\s+deduct(?:ion|ed)`);
  const balance = amountAfter(text, String.raw`(?:current\s+)?balance(?:\s+is)?`);

  const reference =
    text.match(/\bid=(?:FT|TT)?([A-Za-z0-9]{6,})/i)?.[1] ??
    text.match(/\b(?:Ref(?:erence)?|Transaction(?:\s+Number)?|Receipt)\s*(?:no\.?|number|is)?\s*[:#]?\s*((?:FT|TT)?[A-Za-z0-9]{6,})/i)?.[1];

  const dateInfo = parseDateInfo(text);
  if (!dateInfo) missing.push("date");
  else if (dateInfo.dayOnly) missing.push("time");
  if (totalDebit === undefined) missing.push("final total debit");
  if (!nameM) missing.push("recipient");
  if (!reference) missing.push("reference");

  const recipient = nameM?.[1].trim();

  return {
    channel: "CBE",
    type: "out",
    // The bank cash-out is the final debit when stated; otherwise the row is
    // preserved on the principal alone and the gap is reported, never invented.
    amountSantim: totalDebit ?? principal,
    principalSantim: principal,
    party: recipient || "Unresolved recipient",
    accountTail: last4(srcM?.[1]),
    counterpartyAccountTail: last4(dstM?.[1]),
    feeSantim: serviceCharge,
    vatSantim: vat,
    drChargeSantim: drCharge,
    balanceSantim: balance,
    reference,
    ...(dateInfo ? { date: dateInfo.iso, dateIsDayOnly: dateInfo.dayOnly } : {}),
    missingFields: missing.length ? missing : undefined,
    needsReview: missing.length > 0,
    template: "cbe.transfer.out",
  };
}

/** High-precision templates for known Ethiopian bank/wallet SMS. */
function matchTemplates(raw: string): TemplateFields | null {
  // -------- CBE outgoing transfer (principal vs final debit) --------
  const cbeTransfer = matchCbeOutgoingTransfer(raw);
  if (cbeTransfer) return cbeTransfer;

  // -------- CBE --------
  let m = raw.match(
    /Account\s+([\d*]+)\s+has been credited by\s+(.+?)\s+with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "CBE",
      type: "in",
      amountSantim: toSantim(m[3]),
      party: m[2].trim(),
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[4]),
      reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
      template: "cbe.credit.by",
    };
  m = raw.match(
    /Account\s+([\d*]+)\s+has been Credited with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "CBE",
      type: "in",
      amountSantim: toSantim(m[2]),
      party: "Deposit",
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[3]),
      reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
      template: "cbe.credit",
    };
  m = raw.match(
    /Account\s+([\d*]+)\s+has been debited with ETB\s*([\d,]+(?:\.\d+)?)\s*\.?\s*Service charge of ETB\s*([\d,]+(?:\.\d+)?)\s*and VAT.*?of ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m) {
    const balM = raw.match(/Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "CBE",
      type: "out",
      amountSantim: toSantim(m[2]),
      party: "Bank charge / transfer",
      accountTail: last4(m[1]),
      feeSantim: toSantim(m[3]),
      vatSantim: toSantim(m[4]),
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
      template: "cbe.debit.fees",
    };
  }
  m = raw.match(
    /Account\s+([\d*]+)\s+has been debited with ETB\s*([\d,]+(?:\.\d+)?)\.?\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "CBE",
      type: "out",
      amountSantim: toSantim(m[2]),
      party: "Withdrawal / payment",
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[3]),
      reference: raw.match(/id=(?:FT|TT)?([A-Z0-9]{8,})/i)?.[1],
      template: "cbe.debit",
    };

  // -------- Bank of Abyssinia --------
  m = raw.match(
    /your account\s+([\d*]+)\s+was credited with ETB\s*([\d,]+(?:\.\d+)?)\s+by\s+(.+?)\.\s*Available Balance:\s*ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "Abyssinia",
      type: "in",
      amountSantim: toSantim(m[2]),
      party: m[3].trim(),
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[4]),
      reference: raw.match(/trx=([A-Z0-9]{6,})/i)?.[1],
      template: "boa.credit",
    };
  m = raw.match(
    /your account\s+([\d*]+)\s+was debited with ETB\s*([\d,]+(?:\.\d+)?)\.\s*Available Balance:\s*ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "Abyssinia",
      type: "out",
      amountSantim: toSantim(m[2]),
      party: "Withdrawal / payment",
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[3]),
      reference: raw.match(/trx=([A-Z0-9]{6,})/i)?.[1],
      template: "boa.debit",
    };

  // -------- Coop Bank of Oromia --------
  m = raw.match(
    /Account\s+([\d*]+)\s+has been Credited with ETB\s*([\d,]+(?:\.\d+)?)\s+Ref:\s*([A-Z0-9]+).*?Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m) {
    const bySelf = /\bby self\b/i.test(raw);
    const byM = raw.match(
      /BY\s+([A-Z][A-Z0-9 .'/-]{1,60}?)(?:\s+ON\s+\d|\s*\.\s*Your Current Balance)/i,
    );
    return {
      channel: "Coop",
      type: "in",
      amountSantim: toSantim(m[2]),
      party: bySelf ? "Self deposit" : byM?.[1]?.trim() || "Deposit",
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[4]),
      reference: m[3],
      template: "coop.credit",
    };
  }
  m = raw.match(
    /Account\s+([\d*]+)\s+has been Debited with ETB\s*-?([\d,]+(?:\.\d+)?)\s+Ref:\s*([A-Z0-9]+).*?(?:TO\s+([A-Z][A-Z0-9 .'/-]{1,60}?))?\.\s*Your Current Balance is ETB\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (m)
    return {
      channel: "Coop",
      type: "out",
      amountSantim: toSantim(m[2]),
      party: m[4]?.trim() || "Payment",
      accountTail: last4(m[1]),
      balanceSantim: toSantim(m[5]),
      reference: m[3],
      template: "coop.debit",
    };

  // -------- Telebirr --------
  m = raw.match(
    /You have transferred ETB\s*([\d,]+(?:\.\d+)?)\s+to\s+(.+?)\s*\(([\d*]+)\)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m) {
    const feeM = raw.match(/service fee is ETB\s*([\d,]+(?:\.\d+)?)/i);
    const vatM = raw.match(/VAT[^E]*ETB\s*([\d,]+(?:\.\d+)?)/i);
    const balM = raw.match(/E-Money Account balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr",
      type: "out",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
      counterpartyPhone: m[3],
      reference: m[5],
      feeSantim: feeM ? toSantim(feeM[1]) : undefined,
      vatSantim: vatM ? toSantim(vatM[1]) : undefined,
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.transfer.out",
    };
  }
  m = raw.match(
    /transferred ETB\s*([\d,]+(?:\.\d+)?)\s+successfully from your telebirr account\s+([\d*]+)\s+to\s+(.+?)\s+account number\s+([\d*]+).*?telebirr transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m)
    return {
      channel: "Telebirr",
      type: "out",
      amountSantim: toSantim(m[1]),
      party: `${m[3].trim()} (${last4(m[4]) ?? m[4]})`,
      accountTail: last4(m[2]),
      reference: m[5],
      template: "telebirr.transfer.bank",
    };
  m = raw.match(
    /You have received ETB\s*([\d,]+(?:\.\d+)?)\s+from\s+(.+?)\s*\(([\d*]+)\)[^.]*\.\s*Your transaction number is\s+([A-Z0-9]+)(?:.*?E-Money Account balance is ETB\s*([\d,]+(?:\.\d+)?))?/i,
  );
  if (m)
    return {
      channel: "Telebirr",
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
      counterpartyPhone: m[3],
      reference: m[4],
      balanceSantim: m[5] ? toSantim(m[5]) : undefined,
      template: "telebirr.receive.person",
    };
  m = raw.match(
    /You have received ETB\s*([\d,]+(?:\.\d+)?)\s+airtime\s+from\s+([\d*+]+)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m)
    return {
      channel: "Telebirr",
      type: "airtime_evd",
      amountSantim: toSantim(m[1]),
      party: m[2],
      counterpartyPhone: m[2],
      reference: m[4],
      template: "telebirr.receive.airtime",
    };
  m = raw.match(
    /You have received\s+ETB\s*([\d,]+(?:\.\d+)?)\s+by transaction number\s+([A-Z0-9]+)\s+on\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+from\s+(.+?)\s+to your\s+tele[- ]?birr\s+Account\s+([\d*]+)(?:\s*-\s*[^.]+)?\.?(?:.*?current balance is ETB\s*([\d,]+(?:\.\d+)?))?/i,
  );
  if (m)
    return {
      channel: "Telebirr",
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[3].trim(),
      reference: m[2],
      accountTail: last4(m[4]),
      balanceSantim: m[5] ? toSantim(m[5]) : undefined,
      template: "telebirr.receive.bank",
    };
  m = raw.match(
    /You have paid ETB\s*([\d,]+(?:\.\d+)?)\s+for\s+([a-zA-Z ]+?)\s+purchased from\s+(\d+)\s*-\s*(.+?)(?:\s+for plate number\s+(\S+))?\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m) {
    const balM = raw.match(/current balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr",
      type: "out",
      amountSantim: toSantim(m[1]),
      party: `${m[4].trim()}${m[5] ? ` · ${m[5]}` : ""}`,
      reference: m[7],
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.merchant",
    };
  }
  m = raw.match(
    /successfully made a tax payment ETB\s*([\d,]+(?:\.\d+)?)\s+for\s+(.+?)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m)
    return {
      channel: "Telebirr",
      type: "out",
      amountSantim: toSantim(m[1]),
      party: `Tax · ${m[2].trim()}`,
      reference: m[4],
      template: "telebirr.tax",
    };
  m = raw.match(
    /You have recharged ETB\s*([\d,]+(?:\.\d+)?)\s+airtime\s+for\s+([\d*+]+)\s+on\s+([^.]+)\.\s*Your transaction number is\s+([A-Z0-9]+)/i,
  );
  if (m) {
    const balM = raw.match(/current balance is ETB\s*([\d,]+(?:\.\d+)?)/i);
    return {
      channel: "Telebirr",
      type: "airtime_evd",
      amountSantim: toSantim(m[1]),
      party: `Recharge · ${m[2]}`,
      counterpartyPhone: m[2],
      reference: m[4],
      balanceSantim: balM ? toSantim(balM[1]) : undefined,
      template: "telebirr.recharge",
    };
  }

  // -------- eBirr / CoopPay --------
  // Ex: "Transfer ID: FT252955B05V, You have successfully transfered ETB 5,000
  //      to ( 1035000006094 ) undefined bank account at 2025-10-22 14:01:51."
  m = raw.match(
    /Transfer ID:\s*([A-Z0-9]+)[,\s]+You have successfully transfer(?:r)?ed\s+ETB\s*([\d,]+(?:\.\d+)?)\s+to\s*\(\s*([\d*]+)\s*\)\s*(.*?)\s+bank account\s+at\s+([\d\-: ]+)/i,
  );
  if (m) {
    const rawParty = m[4].trim();
    const cleanParty = !rawParty || /^undefined$/i.test(rawParty) ? "Unknown recipient" : rawParty;
    return {
      channel: "CoopPay",
      type: "out",
      amountSantim: toSantim(m[2]),
      party: `${cleanParty} (${last4(m[3]) ?? m[3]})`,
      accountTail: last4(m[3]),
      reference: m[1],
      template: "coopay.transfer.out",
    };
  }
  m = raw.match(
    /Transfer ID:\s*([A-Z0-9]+)[,\s]+You have successfully received\s+ETB\s*([\d,]+(?:\.\d+)?)\s+from\s*\(\s*([\d*]+)\s*\)\s*(.*?)\s+(?:bank account\s+)?at\s+([\d\-: ]+)/i,
  );
  if (m) {
    const rawParty = m[4].trim();
    const cleanParty = !rawParty || /^undefined$/i.test(rawParty) ? "Unknown sender" : rawParty;
    return {
      channel: "CoopPay",
      type: "in",
      amountSantim: toSantim(m[2]),
      party: `${cleanParty} (${last4(m[3]) ?? m[3]})`,
      accountTail: last4(m[3]),
      reference: m[1],
      template: "coopay.transfer.in",
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
  parse: (m: RegExpMatchArray, raw: string) => TemplateFields;
}> = [
  // Telebirr — credited / received
  {
    channel: "Telebirr",
    test: /telebirr[\s\S]*?(?:received|credited)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
  },
  // Telebirr — paid / debited
  {
    channel: "Telebirr",
    test: /telebirr[\s\S]*?(?:paid|debited|sent)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?to\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
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
    test: /\bCBE\b[\s\S]*?(?:credited|received)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      type: "in",
      amountSantim: toSantim(m[1]),
      party: m[2].trim(),
    }),
  },
  // CBE — debited
  {
    channel: "CBE",
    test: /\bCBE\b[\s\S]*?(?:debited|withdrawn|paid)[\s\S]*?ETB\s*([\d,]+(?:\.\d+)?)(?:[\s\S]*?(?:to|for)\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref)))?/i,
    parse: (m) => ({
      type: "out",
      amountSantim: toSantim(m[1]),
      party: (m[2] ?? "Unknown").trim(),
    }),
  },
  // Awash / Dashen / Abyssinia — credit
  {
    channel: "Awash",
    test: /\b(Awash|Dashen|Abyssinia|Wegagen)\b[\s\S]*?(?:credited|received)[\s\S]*?(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)[\s\S]*?from\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref))/i,
    parse: (m) => ({
      channel: m[1],
      type: "in",
      amountSantim: toSantim(m[2]),
      party: m[3].trim(),
    }),
  },
  {
    channel: "Awash",
    test: /\b(Awash|Dashen|Abyssinia|Wegagen)\b[\s\S]*?(?:debited|withdrawn|paid)[\s\S]*?(?:ETB|Br\.?)\s*([\d,]+(?:\.\d+)?)(?:[\s\S]*?to\s+([A-Za-z0-9\u1200-\u137F .'-]+?)(?:\.|,|\s+(?:on|Ref)))?/i,
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
    test: /(?:ETB|Birr|Br\.?)\s*([\d,]+(?:\.\d+)?)\s*(to|from)\s+([A-Za-z0-9\u1200-\u137F.'-][A-Za-z0-9\u1200-\u137F .'-]*?)(?=\s+(?:on|Ref|Txn|TrxID)\b|[.,;\n]|$)/i,
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
    test: /(?:ETB|Birr|Br\.?)\s*([\d,]+(?:\.\d+)?)/i,
    parse: (m, raw) => {
      const t = raw.toLowerCase();
      const inWords =
        /\b(received|credited|deposit(?:ed)?|refund(?:ed)?|incoming|transferred to your|added to your)\b/;
      const outWords =
        /\b(paid|debited|withdrawn|withdrew|purchase(?:d)?|bought|sent|transfer(?:red)? to|payment to|charged|bill|utility|topped? up|recharge)\b/;
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
      const partyM = raw.match(
        /\b(?:to|from)\s+([A-Za-z0-9\u1200-\u137F.'-][A-Za-z0-9\u1200-\u137F .'-]{1,40}?)(?=\s+(?:on|Ref|Txn|TrxID|via)\b|[.,;\n]|$)/i,
      );
      if (partyM) party = partyM[1].trim();
      else needsReview = true;
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
  { channel: "CBE", rx: /\b(CBE|Commercial\s+Bank\s+of\s+Ethiopia)\b/i },
  { channel: "Abyssinia", rx: /\b(BoA|Bank\s+of\s+Abyssinia|Abyssinia)\b/i },
  { channel: "Coop", rx: /\b(Coop(?:erative)?(?:\s+Bank(?:\s+of\s+Oromia)?)?|CBO)\b/i },
  { channel: "Awash", rx: /\bAwash(?:\s+Bank)?\b/i },
  { channel: "Dashen", rx: /\bDashen(?:\s+Bank)?\b/i },
  { channel: "Wegagen", rx: /\bWegagen(?:\s+Bank)?\b/i },
  { channel: "Telebirr", rx: /\b(telebirr|tele[- ]?birr|E[- ]?Money\s+Account)\b/i },
  { channel: "CoopPay", rx: /\b(coop[- ]?pay|coopay|e[- ]?birr|ebirr)\b/i },
  { channel: "M-Pesa", rx: /\b(M[- ]?Pesa|Safaricom(?:\s+M[- ]?Pesa)?)\b/i },
];

export function detectChannel(raw: string): string | undefined {
  if (
    /\b(?:to your\s+tele[- ]?birr\s+Account|from your\s+tele[- ]?birr\s+account|E[- ]?Money\s+Account|Thank you for using\s+tele[- ]?birr|Ethio telecom)\b/i.test(
      raw,
    )
  ) {
    return "Telebirr";
  }
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
  const line = normalizeSms(raw);
  if (!line) return { ok: false, raw, reason: "empty" };
  const tpl = matchTemplates(line);
  if (tpl && tpl.type !== undefined && tpl.amountSantim !== undefined) {
    const info = parseDateInfo(line);
    return {
      ok: true,
      raw: line,
      ...(info ? { date: info.iso, dateIsDayOnly: info.dayOnly } : {}),
      note: line,
      needsReview: false,
      ...tpl,
      type: tpl.type,
      amountSantim: tpl.amountSantim,
    };
  }
  for (const rule of RULES) {
    const m = line.match(rule.test);
    if (m) {
      const partial = rule.parse(m, line);
      if (partial.type === undefined || partial.amountSantim === undefined) continue;
      const refM = line.match(REF_RX);
      const info = parseDateInfo(line);
      // Prefer a keyword-detected channel over the rule's own default.
      // "Other" is the generic fallback and should be replaced whenever a
      // real bank/wallet keyword shows up anywhere in the message.
      const kwChannel = detectChannel(line);
      const ruleChannel = partial.channel ?? rule.channel;
      const channel = ruleChannel === "Other" && kwChannel ? kwChannel : ruleChannel;
      return {
        ok: true,
        raw: line,
        channel,
        type: partial.type,
        amountSantim: partial.amountSantim,
        party: partial.party,
        reference: refM?.[1],
        accountTail: detectAccountTail(line),
        ...(info ? { date: info.iso, dateIsDayOnly: info.dayOnly } : {}),
        // Keep the full original message as the description — truncating it
        // loses reference numbers, dates, and context we need 1 year later.
        note: line,
        needsReview:
          partial.needsReview ??
          (!partial.party || partial.party.trim() === "" || partial.party === "Unknown"),
      };
    }
  }
  return { ok: false, raw: line, reason: "no rule matched" };
}

/**
 * Boilerplate lines/blocks that surround real SMS content (greetings,
 * signoffs, sender footers). Filtered out before parsing so batch-pastes
 * don't show a wall of "couldn't parse" rows for "Dear X," / "Thank you…".
 */
const BOILERPLATE_RX =
  /^(dear\s|hi\s|hello\s|thank you|thanks for|regards|sincerely|ethio\s*telecom|safaricom(?:\s+ethiopia)?\s*$|--\s*$)/i;

function isBoilerplateBlock(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t.length < 20 && !/\d/.test(t)) return true;
  // A greeting glued to the real sentence ("Dear X, You have successfully
  // transferred ETB ...") is content, not boilerplate. Only discard a block
  // that carries no money signal of its own.
  if (/(?:ETB|Birr|ብር)\s*[\d,]|[\d,]+(?:\.\d+)?\s*(?:ETB|Birr|ብር)/i.test(t)) return false;
  return BOILERPLATE_RX.test(t);
}

export function parseMany(text: string): ParsedRow[] {
  // ── Gate 1: Distributor "Refill History" OCR ──
  // Must run before SMS templates — SMS RULES misread date lines as parties.
  if (looksLikeDistributorRefillOcr(text)) {
    const results = parseDistributorRefillOcr(text);
    if (results.length > 0) return results;
  }

  // ── Gate 2: Bank "Transfers" / "Sent" tab OCR ──
  if (looksLikeBankTransferOcr(text)) {
    const results = parseBankTransferOcr(text);
    if (results.length > 0) return results;
  }

  // ── Gate 3: CBE outgoing transfers ──
  // These messages wrap across many lines and mid-sentence, so line/blank-line
  // splitting destroys them. Each occurrence of the trigger phrase is one
  // message; the text is segmented on the trigger and parsed whole.
  const cbeSegments = segmentCbeTransfers(text);
  if (cbeSegments) return cbeSegments.map(parseOne);

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
  // Single-block input: parse line-by-line, dropping obvious boilerplate.
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
// ---------------------------------------------------------------------------
// OCR "Sent transfers" list parser — mobile banking-app screenshots.
//
// Repeating 3-line blocks:
//   <sender label>        the subdistributor account label, printed as a
//                         repeated handle "<name> - <name>"
//   <date> <amount>       e.g. "23 Jul 2026 50,000.00"
//   <agent/recipient>     the alphabetic agent name
// Some OCR engines split date and amount onto adjacent lines — we look ±1
// line to recover the amount.
// ---------------------------------------------------------------------------

const OCR_DATE_RX = /\b(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})\b/;
const OCR_AMOUNT_RX = /\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/;
const OCR_CHROME_RX =
  /^(transfers?|received|sent|home|history|balance|menu|back|close|cancel|ok|search|filter|details?|success(?:ful)?|pending|failed|completed|all|today|yesterday|amount|date|name|status|\d{1,2}:\d{2}(?:\s*(?:AM|PM))?|\d{1,3}%|[▲▼◀▶●○■□◆★☆]+)$/i;

function isOcrChromeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (OCR_CHROME_RX.test(t)) return true;
  // Pure symbol/icon lines (no letters or digits at all).
  if (!/[A-Za-z0-9\u1200-\u137F]/.test(t)) return true;
  return false;
}

export function looksLikeOcrTransferList(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let dateCount = 0;
  let amountCount = 0;
  for (const l of lines) {
    if (OCR_DATE_RX.test(l)) dateCount++;
    if (OCR_AMOUNT_RX.test(l)) amountCount++;
  }
  const hasKeyword = /\b(transfers?|sent)\b/i.test(text);
  return hasKeyword && dateCount >= 2 && amountCount >= 2;
}

/** Signed-amount matcher for the strict per-line check. */
const OCR_STRICT_AMOUNT_RX = /^-?(\d{1,3}(?:,\d{3})*(?:\.\d{2}))$/;
/** Agent-name matcher: 3–40 letters/spaces, starts+ends with a letter. */
const OCR_AGENT_NAME_RX = /^[A-Za-z][A-Za-z\s]{1,38}[A-Za-z]$/;
/**
 * Repeated-handle sender-label detector. Matches "<name> - <name>" (also
 * en-dash) case-insensitively via a backreference. No private literal is
 * embedded — the rule is structural.
 */
const OCR_SENDER_LABEL_RX = /^([A-Za-z0-9._]{3,})\s*[-–]\s*\1\b/i;

/**
 * Parse a mobile banking app "Sent" transfers screenshot (OCR text) into
 * outbound transactions. Extracts every (date, amount, agent) triplet
 * found within a ±4-line window of each date anchor.
 */
export function parseOcrTransferList(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !isOcrChromeLine(l));

  const rows: ParsedOk[] = [];

  for (let dateIdx = 0; dateIdx < lines.length; dateIdx++) {
    const dateLine = lines[dateIdx];
    const dateMatch = dateLine.match(OCR_DATE_RX);
    if (!dateMatch) continue;

    // Amount: prefer same line, else scan ±4 lines.
    let amountRaw: string | undefined;
    let amountNegative = false;
    const tryAmount = (s: string): string | undefined => {
      // Same-line amounts may have surrounding text; scan tokens.
      const tokens = s.split(/\s+/);
      for (const t of tokens) {
        const m = t.match(OCR_STRICT_AMOUNT_RX);
        if (m) {
          amountNegative = t.startsWith("-");
          return m[1];
        }
      }
      return undefined;
    };
    amountRaw = tryAmount(dateLine);
    for (let d = 1; d <= 4 && !amountRaw; d++) {
      if (dateIdx + d < lines.length) amountRaw = tryAmount(lines[dateIdx + d]);
      if (!amountRaw && dateIdx - d >= 0) amountRaw = tryAmount(lines[dateIdx - d]);
    }
    if (!amountRaw) continue;

    // Nearest repeated-handle sender label above the date.
    let sender: string | undefined;
    for (let k = dateIdx - 1; k >= 0; k--) {
      if (OCR_SENDER_LABEL_RX.test(lines[k])) {
        sender = lines[k];
        break;
      }
    }

    // Agent: alphabetic name within ±4 lines, not the sender.
    let agent: string | undefined;
    const isAgentCandidate = (s: string): boolean => {
      if (!OCR_AGENT_NAME_RX.test(s)) return false;
      if (OCR_SENDER_LABEL_RX.test(s)) return false;
      if (OCR_DATE_RX.test(s)) return false;
      if (OCR_STRICT_AMOUNT_RX.test(s)) return false;
      return true;
    };
    for (let d = 1; d <= 4 && !agent; d++) {
      if (dateIdx + d < lines.length && isAgentCandidate(lines[dateIdx + d])) {
        agent = lines[dateIdx + d];
        break;
      }
      if (dateIdx - d >= 0 && isAgentCandidate(lines[dateIdx - d])) {
        agent = lines[dateIdx - d];
        break;
      }
    }
    if (!agent) continue;

    const dateIso = parseDate(`ON ${dateMatch[0]}`) ?? new Date().toISOString();
    const suspicious = agent.trim().length < 3 || /\d/.test(agent);
    const windowLines = [sender, dateLine, agent].filter(Boolean) as string[];

    rows.push({
      ok: true,
      raw: windowLines.join("\n"),
      type: "out",
      amountSantim: toSantim(amountRaw),
      party: agent,
      channel: "Other",
      date: dateIso,
      note: `Transfer to ${agent}${sender ? ` via ${sender}` : ""}`,
      needsReview: amountNegative || suspicious,
      template: "ocr.sent.transfer",
    });
  }

  // Deduplicate: same party + amount + same calendar day.
  const seen = new Set<string>();
  const out: ParsedRow[] = [];
  for (const r of rows) {
    const day = (r.date ?? "").slice(0, 10);
    const key = `${r.party}|${r.amountSantim}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
