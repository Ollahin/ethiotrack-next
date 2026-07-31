import { describe, it, expect } from "vitest";
import { parseCbeTransfer, parseMoneyToken, segmentCbeTransfers } from "./cbe-transfer-parser";
import { parseMany, type ParsedOk } from "./parser";

// ---------------------------------------------------------------------------
// Source-faithful CBE outgoing-transfer corpus.
// All customer names, account digits and references are synthetic; the layout,
// order, punctuation, spacing and optional clauses mirror real messages.
// ---------------------------------------------------------------------------

/** Uncommaed five-digit amount, zero charges beside percentage labels, no date. */
const C1_UNCOMMAED_NO_DATE =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB20000.00 from account " +
  "1000****5058 to account 1000****3001 (Sample Distributor A). Service charge of " +
  "ETB0.00, VAT(15%) of ETB0.00, Disaster Recovery(5%) of ETB0.00 with total of " +
  "ETB20000.00 has been debited. Your current balance is ETB31450.00. " +
  "https://apps.cbe.com.et:100/?id=FT25213AAA01";

/** Uncommaed six-digit amount, no decimals at all. */
const C2_SIX_DIGIT_NO_DECIMALS =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB150000 from account " +
  "1000****5058 to account 1000****3001 (Sample Distributor A) on 12/08/2025 at 10:12:03. " +
  "Service charge of ETB0, VAT(15%) of ETB0, Disaster Recovery(5%) of ETB0 with total of " +
  "ETB150000 has been debited. Your current balance is ETB9000. " +
  "https://apps.cbe.com.et:100/?id=FT25224BBB02";

/** Comma-formatted amounts with non-zero charges, wrapped across many lines. */
const C3_COMMA_MULTILINE = [
  "Dear SAMPLE CUSTOMER,",
  "You have successfully transferred ETB 50,000.00 from account 1000****5058",
  "to account 1000****1086 (SAMPLE AIRTIME DISTRIBUTOR PLC) on 12/08/2025 at 10:12:03.",
  "Service charge of ETB 25.00, VAT(15%) of ETB 3.75, Disaster Recovery(5%) of ETB 1.00",
  "with total of ETB 50,029.75 has been debited.",
  "Your current balance is ETB 12,340.00.",
  "https://apps.cbe.com.et:100/?id=FT25224CCC03",
].join("\n");

/** Missing optional Disaster Recovery clause, distinct principal and total. */
const C4_NO_DR =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB 12,500.00 from account " +
  "1000****5058 to account 1000****1086 (SAMPLE AIRTIME DISTRIBUTOR PLC) on 13/08/2025. " +
  "Service charge of ETB 10.00, VAT(15%) of ETB 1.50 with total of ETB 12,511.50 has been " +
  "debited. Ref: FT25225DDD04";

/** One-line message with an explicit reference and no receipt URL. */
const C5_ONE_LINE_EXPLICIT_REF =
  "You have successfully transferred ETB 7,000.00 from account 1000****5058 to account " +
  "1000****2211 (Sample Distributor B) on 14/08/2025 at 09:00:00. Service charge of ETB 0.00, " +
  "VAT(15%) of ETB 0.00, Disaster Recovery(5%) of ETB 0.00 with total of ETB 7,000.00 has " +
  "been debited. Transaction Number: FT25226EEE05";

/** Malformed monetary token — must never be silently coerced. */
const C6_MALFORMED_TOTAL =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB 8,000.00 from account " +
  "1000****5058 to account 1000****2211 (Sample Distributor B) on 14/08/2025 at 09:00:00. " +
  "Service charge of ETB 0.00, VAT(15%) of ETB 0.00 with total of ETB 8,00.000 has been " +
  "debited. https://apps.cbe.com.et:100/?id=FT25226FFF06";

/** No explicit final total stated at all. */
const C7_NO_TOTAL =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB 8,000.00 from account " +
  "1000****5058 to account 1000****2211 (UNKNOWN COUNTERPARTY PLC) on 14/08/2025 at 09:00:00. " +
  "Your current balance is ETB 4,000.00.";

/** Charges stated but arithmetic does not reconcile with the printed total. */
const C8_SUM_MISMATCH =
  "Dear SAMPLE CUSTOMER, You have successfully transferred ETB 10,000.00 from account " +
  "1000****5058 to account 1000****3001 (Sample Distributor A) on 15/08/2025 at 11:00:00. " +
  "Service charge of ETB 25.00, VAT(15%) of ETB 3.75, Disaster Recovery(5%) of ETB 1.00 " +
  "with total of ETB 10,100.00 has been debited. " +
  "https://apps.cbe.com.et:100/?id=FT25227GGG07";

function must(raw: string) {
  const p = parseCbeTransfer(raw);
  if (!p) throw new Error("expected a CBE transfer parse");
  return p;
}

describe("parseMoneyToken", () => {
  it("accepts complete plain and grouped literals", () => {
    expect(parseMoneyToken("20000.00")).toBe(2000000);
    expect(parseMoneyToken("20,000.00")).toBe(2000000);
    expect(parseMoneyToken("20000")).toBe(2000000);
    expect(parseMoneyToken("20,000")).toBe(2000000);
    expect(parseMoneyToken("0.00")).toBe(0);
    expect(parseMoneyToken("150000")).toBe(15000000);
  });

  it("rejects malformed or truncated tokens", () => {
    for (const bad of ["20,00.00", "1,2345", "12.345", "12.", ",100", "1,00,000", "."]) {
      expect(parseMoneyToken(bad)).toBeNull();
    }
  });
});

describe("CBE outgoing transfer — uncommaed amounts", () => {
  it("consumes the complete five-digit amount (never 200 from 20000.00)", () => {
    const p = must(C1_UNCOMMAED_NO_DATE);
    expect(p.principalSantim).toBe(2000000);
    expect(p.finalDebitSantim).toBe(2000000);
    expect(p.amountSantim).toBe(2000000);
  });

  it("reads zero charges beside percentage labels, never the percentages", () => {
    const p = must(C1_UNCOMMAED_NO_DATE);
    expect(p.feeSantim).toBe(0);
    expect(p.vatSantim).toBe(0);
    expect(p.drChargeSantim).toBe(0);
  });

  it("captures both account tails, the recipient and the receipt reference", () => {
    const p = must(C1_UNCOMMAED_NO_DATE);
    expect(p.accountTail).toBe("5058");
    expect(p.counterpartyAccountTail).toBe("3001");
    expect(p.party).toBe("Sample Distributor A");
    expect(p.reference).toBe("FT25213AAA01");
    expect(p.balanceSantim).toBe(3145000);
  });

  it("reports the missing date without inventing one, and blocks nothing else", () => {
    const p = must(C1_UNCOMMAED_NO_DATE);
    expect(p.date).toBeUndefined();
    expect(p.missingFields).toContain("date");
    expect(p.blockingIssues).toEqual([]);
  });

  it("handles six-digit amounts with no decimals", () => {
    const p = must(C2_SIX_DIGIT_NO_DECIMALS);
    expect(p.principalSantim).toBe(15000000);
    expect(p.finalDebitSantim).toBe(15000000);
    expect(p.feeSantim).toBe(0);
    expect(p.vatSantim).toBe(0);
    expect(p.drChargeSantim).toBe(0);
    expect(p.balanceSantim).toBe(900000);
    expect(p.date).toBe("2025-08-12T10:12:03.000Z");
    expect(p.dateIsDayOnly).toBe(false);
    expect(p.blockingIssues).toEqual([]);
  });
});

describe("CBE outgoing transfer — comma-formatted, multiline, non-zero charges", () => {
  it("extracts every financial field", () => {
    const p = must(C3_COMMA_MULTILINE);
    expect(p.principalSantim).toBe(5000000);
    expect(p.feeSantim).toBe(2500);
    expect(p.vatSantim).toBe(375);
    expect(p.drChargeSantim).toBe(100);
    expect(p.finalDebitSantim).toBe(5002975);
    expect(p.amountSantim).toBe(5002975);
    expect(p.balanceSantim).toBe(1234000);
    expect(p.accountTail).toBe("5058");
    expect(p.counterpartyAccountTail).toBe("1086");
    expect(p.party).toBe("SAMPLE AIRTIME DISTRIBUTOR PLC");
    expect(p.reference).toBe("FT25224CCC03");
    expect(p.date).toBe("2025-08-12T10:12:03.000Z");
    expect(p.missingFields).toEqual([]);
    expect(p.blockingIssues).toEqual([]);
  });
});

describe("CBE outgoing transfer — optional clauses", () => {
  it("leaves Disaster Recovery undefined when the clause is absent", () => {
    const p = must(C4_NO_DR);
    expect(p.drChargeSantim).toBeUndefined();
    expect(p.principalSantim).toBe(1250000);
    expect(p.feeSantim).toBe(1000);
    expect(p.vatSantim).toBe(150);
    expect(p.finalDebitSantim).toBe(1251150);
    expect(p.reference).toBe("FT25225DDD04");
    expect(p.blockingIssues).toEqual([]);
  });

  it("never fabricates a clock time for a date-only message", () => {
    const p = must(C4_NO_DR);
    expect(p.date).toBe("2025-08-13T00:00:00.000Z");
    expect(p.dateIsDayOnly).toBe(true);
    expect(p.missingFields).toContain("time");
  });

  it("reads a one-line message with an explicit transaction number", () => {
    const p = must(C5_ONE_LINE_EXPLICIT_REF);
    expect(p.principalSantim).toBe(700000);
    expect(p.finalDebitSantim).toBe(700000);
    expect(p.reference).toBe("FT25226EEE05");
    expect(p.counterpartyAccountTail).toBe("2211");
    expect(p.party).toBe("Sample Distributor B");
    expect(p.blockingIssues).toEqual([]);
  });
});

describe("CBE outgoing transfer — validation", () => {
  it("blocks a malformed monetary token instead of coercing it", () => {
    const p = must(C6_MALFORMED_TOTAL);
    expect(p.finalDebitSantim).toBeUndefined();
    expect(p.blockingIssues.join(" ")).toMatch(/not a complete monetary value/i);
  });

  it("never invents a final total when the source omits one", () => {
    const p = must(C7_NO_TOTAL);
    expect(p.principalSantim).toBe(800000);
    expect(p.finalDebitSantim).toBeUndefined();
    expect(p.amountSantim).toBe(800000);
    expect(p.feeSantim).toBeUndefined();
    expect(p.missingFields).toContain("final total debit");
    expect(p.missingFields).toContain("reference");
    expect(p.blockingIssues.length).toBeGreaterThan(0);
  });

  it("keeps an arithmetic mismatch visible for review", () => {
    const p = must(C8_SUM_MISMATCH);
    expect(p.principalSantim).toBe(1000000);
    expect(p.finalDebitSantim).toBe(1010000);
    expect(p.blockingIssues.join(" ")).toMatch(/does not equal the stated final debit/i);
  });

  it("rejects a final debit below the principal", () => {
    const p = must(
      "You have successfully transferred ETB 5,000.00 from account 1000****5058 to account " +
        "1000****3001 (Sample Distributor A) on 15/08/2025 at 11:00:00 with total of ETB 4,000.00.",
    );
    expect(p.blockingIssues.join(" ")).toMatch(/below the transferred principal/i);
  });

  it("returns null for messages that are not CBE transfers", () => {
    expect(parseCbeTransfer("Telebirr: You have received ETB 500.00 from Alemu.")).toBeNull();
  });
});

describe("CBE outgoing transfer — multiple messages pasted together", () => {
  it("segments and parses each message separately", () => {
    const both = `${C1_UNCOMMAED_NO_DATE}\n\n${C3_COMMA_MULTILINE}`;
    expect(segmentCbeTransfers(both)).toHaveLength(2);
    const rows = parseMany(both);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
    const [a, b] = rows as ParsedOk[];
    expect(a.principalSantim).toBe(2000000);
    expect(a.amountSantim).toBe(2000000);
    expect(a.reference).toBe("FT25213AAA01");
    expect(b.principalSantim).toBe(5000000);
    expect(b.amountSantim).toBe(5002975);
    expect(b.reference).toBe("FT25224CCC03");
  });

  it("surfaces the same fields through the production parseMany path", () => {
    const [row] = parseMany(C1_UNCOMMAED_NO_DATE) as ParsedOk[];
    expect(row.template).toBe("cbe.transfer.out");
    expect(row.amountSantim).toBe(2000000);
    expect(row.principalSantim).toBe(2000000);
    expect(row.feeSantim).toBe(0);
    expect(row.vatSantim).toBe(0);
    expect(row.drChargeSantim).toBe(0);
    expect(row.accountTail).toBe("5058");
    expect(row.counterpartyAccountTail).toBe("3001");
    expect(row.party).toBe("Sample Distributor A");
    expect(row.date).toBeUndefined();
    expect(row.needsReview).toBe(true);
  });
});
