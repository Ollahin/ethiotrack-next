import { describe, it, expect } from "vitest";
import { parseOne, parseMany } from "./parser";

describe("parseOne", () => {
  it("parses a Telebirr credit", () => {
    const r = parseOne(
      "Telebirr: You have received ETB 500.00 from Alemu Kebede. Ref: TB123456",
    );
    expect(r.ok).toBe(true);
    expect(r.type).toBe("in");
    expect(r.channel).toBe("Telebirr");
    expect(r.amountSantim).toBe(50000);
    expect(r.party).toBe("Alemu Kebede");
    expect(r.reference).toBe("TB123456");
    expect(r.needsReview).toBe(false);
  });

  it("parses a Telebirr debit", () => {
    const r = parseOne(
      "Telebirr: You have paid ETB 1,250.75 to Mesfin Getachew on 2026-07-15. Ref: TB999888",
    );
    expect(r.ok).toBe(true);
    expect(r.type).toBe("out");
    expect(r.amountSantim).toBe(125075);
    expect(r.party).toBe("Mesfin Getachew");
  });

  it("parses Telebirr airtime", () => {
    const r = parseOne("Telebirr: Airtime purchase ETB 100.00 successful.");
    expect(r.ok).toBe(true);
    expect(r.type).toBe("airtime_evd");
    expect(r.amountSantim).toBe(10000);
  });

  it("parses Telebirr bank-to-wallet credit with greeting/footer", () => {
    const raw = [
      "Dear MERAOL,",
      "",
      "You have received  ETB 500.00 by transaction number CIN52H16QN on 2025-09-23 09:01:40 from Commercial Bank of Ethiopia to your telebirr Account 251915845556 - MERAOL HUSSEIN HINDHESA. Your current balance is ETB 4,631.00.",
      "",
      "Thank you for using telebirr",
      "",
      "Ethio telecom",
    ].join("\n");
    const rows = parseMany(raw);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ok).toBe(true);
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
    const r = parseOne(
      "CBE: Your account has been credited with ETB 2500.00 from Almaz T. on 2026-07-01. Ref: CBE7788",
    );
    expect(r.ok).toBe(true);
    expect(r.channel).toBe("CBE");
    expect(r.type).toBe("in");
    expect(r.amountSantim).toBe(250000);
  });

  it("parses a CBE debit", () => {
    const r = parseOne(
      "CBE: Your account has been debited ETB 400.00 to Water Utility. Ref: CBE0001",
    );
    expect(r.ok).toBe(true);
    expect(r.type).toBe("out");
    expect(r.amountSantim).toBe(40000);
  });

  it("parses Awash/Dashen/Abyssinia by name", () => {
    for (const bank of ["Awash", "Dashen", "Abyssinia", "Wegagen"]) {
      const r = parseOne(
        `${bank}: Your account credited ETB 100.00 from Test User on 2026-01-01. Ref: X1`,
      );
      expect(r.ok, `${bank} match`).toBe(true);
      expect(r.channel).toBe(bank);
      expect(r.type).toBe("in");
    }
  });

  it("uses the captured preposition for the generic fallback", () => {
    // The word "from" appears in party name but the preposition after amount
    // is "to" — direction must come from that preposition, not a loose scan.
    const r = parseOne("Payment ETB 10.00 to fromage-shop on 2026-01-01");
    expect(r.ok).toBe(true);
    expect(r.type).toBe("out");
    expect(r.party).toBe("fromage-shop");
  });

  it("flags ambiguous messages as needsReview instead of guessing", () => {
    // Amount present, no direction word — should import as fallback with
    // needsReview:true, not silently label as "in" or "out".
    const r = parseOne("Some vague alert about ETB 200.00 that happened");
    expect(r.ok).toBe(true);
    expect(r.needsReview).toBe(true);
    expect(r.party).toBe("Unknown");
  });

  it("returns not-ok on empty input", () => {
    expect(parseOne("").ok).toBe(false);
    expect(parseOne("hello world").ok).toBe(false);
  });

  it("handles thousands separators without drift (integer santim)", () => {
    const r = parseOne("Telebirr received ETB 1,234,567.89 from Big Co.");
    expect(r.ok).toBe(true);
    // 1,234,567.89 ETB * 100 = 123,456,789 santim — exact, no float drift
    expect(r.amountSantim).toBe(123456789);
  });
});

describe("parseMany", () => {
  it("splits on blank lines", () => {
    const text = [
      "Telebirr: received ETB 100.00 from Ayele K.",
      "",
      "CBE: credited ETB 200.00 from Zed A. Ref: X1",
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
});