import { describe, expect, it } from "vitest";
import {
  existingIdentities,
  isDuplicateIdentity,
  normalizeSmsText,
  referenceIdentity,
  smsIdentity,
} from "./identity";

const base = {
  source: "CBE",
  direction: "in",
  accountTail: "4599",
  amountSantim: 1_500_000,
  dateIso: "2026-08-02T09:15:00.000Z",
  party: "Alexo",
  raw: "Dear Customer, ETB 15,000.00 credited from Alexo. Acct ...4599",
};

describe("smsIdentity", () => {
  it("uses the reference when the source gave one", () => {
    const id = smsIdentity({ ...base, reference: "FT2508AB" });
    expect(id).toBe(referenceIdentity("CBE", "FT2508AB"));
    // Same reference, different wording of the same alert → same identity.
    expect(smsIdentity({ ...base, reference: "ft2508ab ", raw: "resent copy" })).toBe(id);
  });

  it("falls back to a canonical fingerprint with no reference", () => {
    const a = smsIdentity(base);
    const b = smsIdentity({ ...base, raw: `  ${base.raw.toUpperCase()}  ` });
    expect(a.startsWith("fp:")).toBe(true);
    expect(b).toBe(a);
  });

  it("never collides two genuinely different messages", () => {
    const a = smsIdentity(base);
    expect(smsIdentity({ ...base, amountSantim: 1_500_100 })).not.toBe(a);
    expect(smsIdentity({ ...base, party: "Bereket" })).not.toBe(a);
    expect(smsIdentity({ ...base, dateIso: "2026-08-03T09:15:00.000Z" })).not.toBe(a);
    expect(smsIdentity({ ...base, direction: "out" })).not.toBe(a);
  });

  it("ignores the clock time — the same message on the same day is one row", () => {
    expect(smsIdentity({ ...base, dateIso: "2026-08-02T23:59:00.000Z" })).toBe(smsIdentity(base));
  });

  it("normalizes punctuation and spacing out of the raw text", () => {
    expect(normalizeSmsText("ETB 15,000.00  credited!")).toBe("etb 15 000 00 credited");
  });
});

describe("collision detection", () => {
  it("only reports a duplicate for an actual collision", () => {
    const identity = smsIdentity(base);
    const ledger = existingIdentities([
      { captureKey: identity },
      { channel: "CBE", reference: "FT999" },
    ]);
    expect(isDuplicateIdentity(identity, ledger)).toBe(true);
    expect(isDuplicateIdentity(smsIdentity({ ...base, amountSantim: 1 }), ledger)).toBe(false);
  });

  it("gives a legacy row an identity from its reference", () => {
    const ledger = existingIdentities([{ channel: "CBE", reference: "FT999" }]);
    expect(isDuplicateIdentity(smsIdentity({ ...base, reference: "FT999" }), ledger)).toBe(true);
  });
});
