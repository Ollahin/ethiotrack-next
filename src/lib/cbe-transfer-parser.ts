// ---------------------------------------------------------------------------
// CBE outgoing transfer ("successfully transferred") — source-structured parser.
//
// Every financial field is read ONLY from its own labelled clause, and every
// monetary token must consume a complete, well-formed number. Percentages
// ("VAT(15%)", "Disaster Recovery(5%)") are labels and can never become an
// amount. Nothing absent from the message is ever computed or invented.
// ---------------------------------------------------------------------------

import { flattenSms, last4 } from "./sms-text";
import { parseDateInfo } from "./sms-date";

/** Trigger phrase for a CBE outgoing transfer, tolerant of the "transfered" typo. */
export const CBE_TRANSFER_TRIGGER_RX = /successfully\s+transferr?ed/i;

export const CBE_TRANSFER_TEMPLATE = "cbe.transfer.out";

/**
 * A complete monetary literal: either grouped by thousands separators or a
 * plain digit run, with at most two decimals. Anything else is malformed.
 */
const GROUPED_MONEY_RX = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const PLAIN_MONEY_RX = /^\d+(?:\.\d{1,2})?$/;

/**
 * Convert a complete monetary token to integer santim, or null when the token
 * is malformed/truncated (e.g. "20,00.00", "1,2345", "12.345", "12.").
 */
export function parseMoneyToken(token: string): number | null {
  const t = token.trim();
  if (!GROUPED_MONEY_RX.test(t) && !PLAIN_MONEY_RX.test(t)) return null;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Optional percentage label such as "(15%)" or "15%" — never a money value. */
const PCT = String.raw`(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)|\s*\d+(?:\.\d+)?\s*%)?`;
/** Only these connector tokens may sit between a label and its amount. */
const CONNECT = String.raw`(?:\s*(?:of|is|was|[:=]|ETB\.?|Birr|Br\.?))*\s*`;
/** The complete numeric run following a label, captured for validation. */
const RUN = String.raw`(-?\s*[\d][\d.,]*)`;

export interface ClauseAmount {
  /** The clause label was present in the message. */
  found: boolean;
  /** Parsed integer santim. Absent when the token was malformed. */
  value?: number;
  /** The clause exists but its number is not a complete monetary literal. */
  malformed?: boolean;
  /** The literal token as printed in the message (for review messages). */
  token?: string;
}

/** Read the amount that belongs to exactly one labelled clause. */
export function clauseAmount(text: string, labelSource: string): ClauseAmount {
  const rx = new RegExp(labelSource + PCT + CONNECT + RUN, "i");
  const m = text.match(rx);
  if (!m) return { found: false };
  const rawToken = m[1].replace(/\s+/g, "");
  const negative = rawToken.startsWith("-");
  // Trailing sentence punctuation is not part of the number.
  const token = rawToken.replace(/^-/, "").replace(/[.,]+$/, "");
  const value = parseMoneyToken(token);
  if (value === null) return { found: true, malformed: true, token: rawToken };
  return { found: true, value: negative ? -value : value, token: rawToken };
}

const LABELS = {
  principal: String.raw`successfully\s+transferr?ed`,
  serviceCharge: String.raw`service\s+charge`,
  vat: String.raw`\bVAT\b`,
  dr: String.raw`disaster\s+recovery(?:\s+charge)?`,
  balance: String.raw`(?:current\s+)?balance(?:\s+is)?`,
} as const;

const TOTAL_LABELS = [
  String.raw`with\s+total`,
  String.raw`total\s+(?:amount\s+)?debit(?:ed|s)?`,
  String.raw`total\s+deduct(?:ion|ed)`,
  String.raw`total\s+of`,
];

function firstClause(text: string, labels: string[]): ClauseAmount {
  for (const l of labels) {
    const c = clauseAmount(text, l);
    if (c.found) return c;
  }
  return { found: false };
}

export interface CbeTransferParse {
  channel: "CBE";
  type: "out";
  template: typeof CBE_TRANSFER_TEMPLATE;
  /** Transferred principal — expected EVD. Always present when parsing succeeds. */
  principalSantim: number;
  /** Explicit final total debit when the message states one. Never computed. */
  finalDebitSantim?: number;
  /** Bank cash-out used downstream: the explicit total, else the principal. */
  amountSantim: number;
  feeSantim?: number;
  vatSantim?: number;
  drChargeSantim?: number;
  balanceSantim?: number;
  accountTail?: string;
  counterpartyAccountTail?: string;
  party?: string;
  reference?: string;
  date?: string;
  dateIsDayOnly?: boolean;
  /** Fields the message never stated. Left empty, never filled in. */
  missingFields: string[];
  /** Reasons this row must not be imported as-is (date handled separately). */
  blockingIssues: string[];
}

/**
 * Parse one CBE outgoing-transfer message. Returns null when the message is
 * not a CBE transfer or when no valid principal can be read.
 */
export function parseCbeTransfer(raw: string): CbeTransferParse | null {
  const text = flattenSms(raw);
  if (!CBE_TRANSFER_TRIGGER_RX.test(text)) return null;

  const missingFields: string[] = [];
  const blockingIssues: string[] = [];

  const principalC = clauseAmount(text, LABELS.principal);
  if (!principalC.found) return null;
  if (principalC.malformed || principalC.value === undefined) {
    // The message IS a transfer but its principal is unreadable — surface it
    // instead of guessing another number from elsewhere in the text.
    return {
      channel: "CBE",
      type: "out",
      template: CBE_TRANSFER_TEMPLATE,
      principalSantim: 0,
      amountSantim: 0,
      missingFields: ["transferred amount"],
      blockingIssues: [
        `Transferred amount "${principalC.token ?? ""}" is not a complete monetary value.`,
      ],
    };
  }
  const principal = principalC.value;
  if (principal <= 0) blockingIssues.push("Transferred amount must be greater than zero.");

  const service = clauseAmount(text, LABELS.serviceCharge);
  const vat = clauseAmount(text, LABELS.vat);
  const dr = clauseAmount(text, LABELS.dr);
  const total = firstClause(text, TOTAL_LABELS);
  const balance = clauseAmount(text, LABELS.balance);

  const named: Array<[string, ClauseAmount]> = [
    ["service charge", service],
    ["VAT", vat],
    ["Disaster Recovery charge", dr],
    ["final total debit", total],
    ["current balance", balance],
  ];
  for (const [label, c] of named) {
    if (c.found && c.malformed) {
      blockingIssues.push(`${label} "${c.token}" is not a complete monetary value.`);
    }
    if (c.found && !c.malformed && (c.value ?? 0) < 0 && label !== "current balance") {
      blockingIssues.push(`${label} cannot be negative.`);
    }
  }

  const feeSantim = service.found && !service.malformed ? service.value : undefined;
  const vatSantim = vat.found && !vat.malformed ? vat.value : undefined;
  const drChargeSantim = dr.found && !dr.malformed ? dr.value : undefined;
  const finalDebit = total.found && !total.malformed ? total.value : undefined;
  const balanceSantim = balance.found && !balance.malformed ? balance.value : undefined;

  if (finalDebit === undefined) {
    missingFields.push("final total debit");
    blockingIssues.push("The message states no final total debit, and none is calculated.");
  } else {
    if (finalDebit < principal) {
      blockingIssues.push("Final debit is below the transferred principal.");
    }
    if (feeSantim !== undefined && vatSantim !== undefined) {
      const components = principal + feeSantim + vatSantim + (drChargeSantim ?? 0);
      if (components !== finalDebit) {
        blockingIssues.push(
          "Principal plus charges does not equal the stated final debit — review required.",
        );
      }
    }
  }

  // Source account: "from your account 1000****5058".
  const srcM = text.match(
    /\bfrom\s+(?:your\s+)?(?:account|a\/c)\s*(?:no\.?|number)?\s*([\d*Xx]{4,})/i,
  );
  // Destination account and parenthesised recipient: "to account 1000****3001 (NAME)".
  const dstM = text.match(/\bto\s+(?:account\s*)?([\d*Xx]{4,})\s*(?:\(\s*([^)]{2,80}?)\s*\))?/i);
  const recipient = dstM?.[2]?.trim() || text.match(/\(([^)%]{2,80})\)/)?.[1]?.trim();
  if (!recipient) missingFields.push("recipient");

  const reference =
    text.match(/[?&]id=([A-Za-z0-9]{6,})/i)?.[1] ??
    text.match(
      /\b(?:Ref(?:erence)?|Transaction(?:\s+Number)?|Receipt)\s*(?:no\.?|number|is)?\s*[:#]?\s*((?:FT|TT)?[A-Za-z0-9]{6,})/i,
    )?.[1];
  if (!reference) missingFields.push("reference");

  const dateInfo = parseDateInfo(text);
  if (!dateInfo) missingFields.push("date");
  else if (dateInfo.dayOnly) missingFields.push("time");

  return {
    channel: "CBE",
    type: "out",
    template: CBE_TRANSFER_TEMPLATE,
    principalSantim: principal,
    finalDebitSantim: finalDebit,
    // Bank cash-out. When the source omits an explicit total, the principal is
    // preserved as-is and the gap is reported — never a computed sum.
    amountSantim: finalDebit ?? principal,
    feeSantim,
    vatSantim,
    drChargeSantim,
    balanceSantim,
    accountTail: last4(srcM?.[1]),
    counterpartyAccountTail: last4(dstM?.[1]),
    party: recipient,
    reference,
    ...(dateInfo ? { date: dateInfo.iso, dateIsDayOnly: dateInfo.dayOnly } : {}),
    missingFields,
    blockingIssues,
  };
}

/**
 * Split a paste into whole CBE transfer messages, or null when none is
 * present. Each trigger phrase marks one message; a greeting immediately
 * preceding a trigger stays with its own message.
 */
export function segmentCbeTransfers(text: string): string[] | null {
  const flat = flattenSms(text);
  const rx = new RegExp(CBE_TRANSFER_TRIGGER_RX.source, "gi");
  const triggers: number[] = [];
  for (let m = rx.exec(flat); m; m = rx.exec(flat)) triggers.push(m.index);
  if (triggers.length === 0) return null;

  const greetRx = /\b(?:Dear|Hello|Hi)\b/gi;
  const starts: number[] = [0];
  for (let i = 1; i < triggers.length; i++) {
    let start = triggers[i];
    greetRx.lastIndex = triggers[i - 1];
    for (let g = greetRx.exec(flat); g && g.index < triggers[i]; g = greetRx.exec(flat)) {
      start = g.index;
      break;
    }
    starts.push(start);
  }
  return starts
    .map((s, i) => flat.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim())
    .filter(Boolean);
}
