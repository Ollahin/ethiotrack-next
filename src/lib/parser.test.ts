import { describe, it, expect } from "vitest";
import { parseOne, parseMany, type ParsedOk, type ParsedRow } from "./parser";

function ok(r: ParsedRow): ParsedOk {
  if (!r.ok) throw new Error(`expected ok, got fail: ${r.reason}`);
  return r;
}

describe("parseOne", () => {
  it("parses a Telebirr credit", () => {
    const r = ok(
      parseOne("Telebirr: You have received ETB 500.00 from Alemu Kebede. Ref: TB123456"),
    );
    expect(r.type).toBe("in");
    expect(r.channel).toBe("Telebirr");
    expect(r.amountSantim).toBe(50000);
    expect(r.party).toBe("Alemu Kebede");
    expect(r.reference).toBe("TB123456");
    expect(r.needsReview).toBe(false);
  });

  it("parses a Telebirr debit", () => {
    const r = ok(
      parseOne(
        "Telebirr: You have paid ETB 1,250.75 to Mesfin Getachew on 2026-07-15. Ref: TB999888",
      ),
    );
    expect(r.type).toBe("out");
    expect(r.amountSantim).toBe(125075);
    expect(r.party).toBe("Mesfin Getachew");
  });

  it("parses Telebirr airtime", () => {
    const r = ok(parseOne("Telebirr: Airtime purchase ETB 100.00 successful."));
    expect(r.type).toBe("airtime_evd");
    expect(r.amountSantim).toBe(10000);
  });

  it("parses Telebirr bank-to-wallet credit with greeting/footer", () => {
    const raw = [
      "Dear MERAOL,",
      "",
      "You have received  ETB 500.00 by transaction number CIN52H16QN on 2025-09-23 09:01:40 from Commercial Bank of Ethiopia to your telebirr Account 251915845556 - MERAOL HUSSEIN HINDHESA. Your current balance is ETB 4,631.00.",
      "",
      "Thank you for using telebirr",
      "",
      "Ethio telecom",
    ].join("\n");
    const rows = parseMany(raw);
    expect(rows).toHaveLength(1);
    const r = ok(rows[0]);
    expect(r.channel).toBe("Telebirr");
    expect(r.type).toBe("in");
    expect(r.amountSantim).toBe(50000);
    expect(r.party).toBe("Commercial Bank of Ethiopia");
    expect(r.reference).toBe("CIN52H16QN");
    expect(r.accountTail).toBe("5556");
    expect(r.balanceSantim).toBe(463100);
    expect(r.date).toBe("2025-09-23T09:01:40.000Z");
    expect(r.template).toBe("telebirr.receive.bank");
  });

  it("parses a CBE credit", () => {
    const r = ok(
      parseOne(
        "CBE: Your account has been credited with ETB 2500.00 from Almaz T. on 2026-07-01. Ref: CBE7788",
      ),
    );
    expect(r.channel).toBe("CBE");
    expect(r.type).toBe("in");
    expect(r.amountSantim).toBe(250000);
  });

  it("parses a CBE debit", () => {
    const r = ok(
      parseOne("CBE: Your account has been debited ETB 400.00 to Water Utility. Ref: CBE0001"),
    );
    expect(r.type).toBe("out");
    expect(r.amountSantim).toBe(40000);
  });

  it("parses Awash/Dashen/Abyssinia by name", () => {
    for (const bank of ["Awash", "Dashen", "Abyssinia", "Wegagen"]) {
      const r = ok(
        parseOne(`${bank}: Your account credited ETB 100.00 from Test User on 2026-01-01. Ref: X1`),
      );
      expect(r.channel).toBe(bank);
      expect(r.type).toBe("in");
    }
  });

  it("uses the captured preposition for the generic fallback", () => {
    const r = ok(parseOne("Payment ETB 10.00 to fromage-shop on 2026-01-01"));
    expect(r.type).toBe("out");
    expect(r.party).toBe("fromage-shop");
  });

  it("flags ambiguous messages as needsReview instead of guessing", () => {
    const r = ok(parseOne("Some vague alert about ETB 200.00 that happened"));
    expect(r.needsReview).toBe(true);
    expect(r.party).toBe("Unknown");
  });

  it("returns not-ok on empty input", () => {
    expect(parseOne("").ok).toBe(false);
    expect(parseOne("hello world").ok).toBe(false);
  });

  it("handles thousands separators without drift (integer santim)", () => {
    const r = ok(parseOne("Telebirr received ETB 1,234,567.89 from Big Co."));
    expect(r.amountSantim).toBe(123456789);
  });
});

describe("parseMany", () => {
  it("splits on blank lines", () => {
    const text = [
      "Telebirr: received ETB 100.00 from Ayele K.",
      "",
      "CBE: credited ETB 200.00 from Sami A. Ref: X1",
    ].join("\n");
    const rows = parseMany(text);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("falls back to line-by-line when no blank separators", () => {
    const text = [
      "Telebirr: received ETB 100.00 from Ayele K.",
      "Telebirr: received ETB 50.00 from Beti M.",
    ].join("\n");
    const rows = parseMany(text);
    expect(rows).toHaveLength(2);
  });

  it("drops boilerplate blocks (greeting/thank-you/sender footer) when batch-pasting", () => {
    const one = [
      "Dear MERAOL,",
      "",
      "You have received ETB 500.00 by transaction number AAA111 on 2025-09-23 09:01:40 from Commercial Bank of Ethiopia to your telebirr Account 251915845556 - MERAOL. Your current balance is ETB 4,631.00.",
      "",
      "Thank you for using telebirr",
      "",
      "Ethio telecom",
    ].join("\n");
    const two = [
      "Dear MERAOL,",
      "",
      "You have received ETB 250.00 by transaction number BBB222 on 2025-09-24 10:11:12 from Commercial Bank of Ethiopia to your telebirr Account 251915845556 - MERAOL. Your current balance is ETB 4,881.00.",
      "",
      "Thank you for using telebirr",
      "",
      "Ethio telecom",
    ].join("\n");
    const rows = parseMany(`${one}\n\n${two}`);
    // Only the two real receipts survive; boilerplate blocks are filtered.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});

// Sanitized CBE outgoing-transfer fixtures. Values are synthetic but keep the
// real message layout, order, punctuation and optional clauses.
const CBE_FRESH = [
  "Dear SAMPLE CUSTOMER,",
  "You have successfully transferred ETB 50,000.00 from your account 1000****4599",
  "to 1000****1086 (SAMPLE AIRTIME DISTRIBUTOR PLC) on 12/08/2025 at 10:12:03.",
  "Service charge ETB 25.00, VAT ETB 3.75, Disaster Recovery charge ETB 1.00.",
  "Total debited ETB 50,029.75. Your Current Balance is ETB 12,340.00.",
  "Thank you for Banking with CBE!",
  "https://apps.cbe.com.et:100/?id=FT25224ABCD1",
].join("\n");

const CBE_DAY_ONLY = [
  "Dear SAMPLE CUSTOMER,",
  "You have successfully transferred ETB 12,500.00 from your account 1000****4599",
  "to 1000****1086 (SAMPLE AIRTIME DISTRIBUTOR PLC) on 13/08/2025.",
  "Service charge ETB 10.00, VAT ETB 1.50. Total debited ETB 12,511.50.",
  "https://apps.cbe.com.et:100/?id=FT25225EFGH2",
].join("\n");

const CBE_NO_TOTAL = [
  "Dear SAMPLE CUSTOMER,",
  "You have successfully transferred ETB 8,000.00 from your account 1000****4599",
  "to 1000****2211 (UNKNOWN COUNTERPARTY PLC) on 14/08/2025 at 09:00:00.",
  "Your Current Balance is ETB 4,000.00.",
].join("\n");

describe("CBE outgoing transfer capture", () => {
  it("survives the greeting and multi-line wrapping", () => {
    const rows = parseMany(CBE_FRESH);
    expect(rows).toHaveLength(1);
    const r = ok(rows[0]);
    expect(r.template).toBe("cbe.transfer.out");
    expect(r.channel).toBe("CBE");
    expect(r.type).toBe("out");
  });

  it("separates the principal from the final debit", () => {
    const r = ok(parseMany(CBE_FRESH)[0]);
    expect(r.principalSantim).toBe(5000000);
    expect(r.amountSantim).toBe(5002975);
    expect(r.feeSantim).toBe(2500);
    expect(r.vatSantim).toBe(375);
    expect(r.drChargeSantim).toBe(100);
    expect(r.balanceSantim).toBe(1234000);
  });

  it("captures both accounts, the recipient and the reference", () => {
    const r = ok(parseMany(CBE_FRESH)[0]);
    expect(r.accountTail).toBe("4599");
    expect(r.counterpartyAccountTail).toBe("1086");
    expect(r.party).toBe("SAMPLE AIRTIME DISTRIBUTOR PLC");
    expect(r.reference).toBe("FT25224ABCD1");
    expect(r.date).toBe("2025-08-12T10:12:03.000Z");
    expect(r.dateIsDayOnly).toBe(false);
    expect(r.needsReview).toBe(false);
    expect(r.missingFields).toBeUndefined();
  });

  it("never fabricates a clock time for a date-only message", () => {
    const r = ok(parseMany(CBE_DAY_ONLY)[0]);
    expect(r.date).toBe("2025-08-13T00:00:00.000Z");
    expect(r.dateIsDayOnly).toBe(true);
    expect(r.missingFields).toContain("time");
    expect(r.needsReview).toBe(true);
    expect(r.drChargeSantim).toBeUndefined();
  });

  it("never invents a total debit when the source omits one", () => {
    const r = ok(parseMany(CBE_NO_TOTAL)[0]);
    expect(r.principalSantim).toBe(800000);
    expect(r.amountSantim).toBe(800000);
    expect(r.feeSantim).toBeUndefined();
    expect(r.vatSantim).toBeUndefined();
    expect(r.missingFields).toContain("final total debit");
    expect(r.missingFields).toContain("reference");
    expect(r.needsReview).toBe(true);
  });

  it("keeps two pasted transfers as two separate rows", () => {
    const rows = parseMany(`${CBE_FRESH}\n\n${CBE_DAY_ONLY}`);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(ok(rows[0]).reference).toBe("FT25224ABCD1");
    expect(ok(rows[1]).reference).toBe("FT25225EFGH2");
  });
});
