// Sanitized SMS golden-fixture contract tests.
//
// These tests validate fixture *meaning* only. No production parser, OCR
// engine, database or UI module is imported or invoked.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  SmsFixtureCatalog,
  SmsGoldenExpectationSchema,
  type SmsExpectedEvent,
  type SmsFixtureCatalogEntry,
  type SmsGoldenExpectation,
} from "./sms-schema";
import { FixtureCatalog, ProductionBaselineSchema } from "./schema";
import { evaluateGates } from "./acceptance-gates";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const catalog: SmsFixtureCatalogEntry[] = SmsFixtureCatalog.parse(
  JSON.parse(readFileSync(join(here, "sms-catalog.json"), "utf8")),
);
const active = catalog.filter((e) => e.status === "active");

function readRaw(entry: SmsFixtureCatalogEntry): string {
  return readFileSync(join(repoRoot, entry.rawFixturePath!), "utf8");
}

function readExpected(entry: SmsFixtureCatalogEntry): SmsGoldenExpectation {
  return SmsGoldenExpectationSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, entry.expectedFixturePath!), "utf8")),
  );
}

const loaded = active.map((entry) => ({ entry, expected: readExpected(entry) }));
const allEvents: SmsExpectedEvent[] = loaded.flatMap((f) => f.expected.expectedEvents);

const ALLOWED_LABELS = [
  "Sample Administrator",
  "Sample Shop A",
  "Sample Distributor A",
  "Sample Distributor B",
];

/** The only fixture allowed to carry a deliberately truncated reference token. */
const TRUNCATED_REFERENCE_FIXTURE = "sms.float.dist.case-07";

const FORBIDDEN = [
  { name: "http-url", re: /https?:\/\//i },
  { name: "masked-account", re: /\d\*{1,}\d/ },
  { name: "phone-number", re: /(?:\+251|\b0)\d{8,9}\b/ },
  // Generic salutations are structural; any other salutation would be private.
  { name: "non-generic-salutation", re: /^\s*Dear\s+(?!Agent,|customer,)/im },
  {
    name: "non-synthetic-reference",
    re: /\b(?:Ref:|Your Transaction Number is)\s*(?!SYN\d{1,7}\b)\S+/,
  },
];

describe("sanitized SMS fixture catalog", () => {
  it("has fourteen active fixtures across the three families", () => {
    expect(active.length).toBe(14);
    expect(active.filter((e) => e.family === "float_distribution").length).toBe(8);
    expect(active.filter((e) => e.family === "evd_receipt").length).toBe(4);
    expect(active.filter((e) => e.family === "float_receipt").length).toBe(2);
  });

  it("has 17 expected events and 3 review rows", () => {
    expect(active.reduce((a, e) => a + e.expected.eventCount, 0)).toBe(17);
    expect(active.reduce((a, e) => a + e.expected.reviewRowCount, 0)).toBe(3);
  });

  it("has unique fixture ids", () => {
    expect(new Set(catalog.map((e) => e.id)).size).toBe(catalog.length);
  });

  it("references existing raw and expected files", () => {
    for (const entry of active) {
      expect(existsSync(join(repoRoot, entry.rawFixturePath!)), entry.id).toBe(true);
      expect(existsSync(join(repoRoot, entry.expectedFixturePath!)), entry.id).toBe(true);
    }
  });

  it("agrees with the counts declared in each expectation file", () => {
    for (const { entry, expected } of loaded) {
      expect(expected.fixtureId, entry.id).toBe(entry.id);
      expect(expected.family, entry.id).toBe(entry.family);
      expect(expected.expectedEvents.length, entry.id).toBe(entry.expected.eventCount);
      expect(expected.reviewRows.length, entry.id).toBe(entry.expected.reviewRowCount);
    }
  });
});

describe("SMS fixture schema strictness", () => {
  it("rejects unknown fields on an expectation", () => {
    const base = JSON.parse(
      readFileSync(join(repoRoot, active[0].expectedFixturePath!), "utf8"),
    ) as Record<string, unknown>;
    expect(SmsGoldenExpectationSchema.safeParse({ ...base, extraField: 1 }).success).toBe(false);
  });

  it("rejects unknown fields on an event", () => {
    const base = JSON.parse(
      readFileSync(join(repoRoot, active[0].expectedFixturePath!), "utf8"),
    ) as SmsGoldenExpectation;
    const mutated = {
      ...base,
      expectedEvents: [{ ...base.expectedEvents[0], surpriseField: true }],
    };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });

  it("rejects a catalog entry with an unknown field", () => {
    expect(SmsFixtureCatalog.safeParse([{ ...catalog[0], nope: true }]).success).toBe(false);
  });

  it("rejects an outbound event with a positive amount", () => {
    const base = readExpected(active[0]);
    const mutated = {
      ...base,
      expectedEvents: [{ ...base.expectedEvents[0], amountMinor: 4500000 }],
    };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });

  it("rejects a balance equal to the transaction amount", () => {
    const base = readExpected(active[0]);
    const first = base.expectedEvents[0];
    const mutated = {
      ...base,
      expectedEvents: [{ ...first, resultingBalanceMinor: Math.abs(first.amountMinor) }],
    };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });

  it("rejects a user-selected date carrying an invented time", () => {
    const base = readExpected(active[0]);
    const mutated = {
      ...base,
      expectedEvents: [
        { ...base.expectedEvents[0], dateSource: "user_selected", datePrecision: "minute" },
      ],
    };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });

  it("rejects codes on an english_only event", () => {
    const englishOnly = loaded.find((f) => f.entry.id === "sms.float.dist.case-03")!;
    const mutated = {
      ...englishOnly.expected,
      expectedEvents: [{ ...englishOnly.expected.expectedEvents[0], recipientCode: "70002" }],
    };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });
});

describe("bilingual pairing rules", () => {
  it("collapses a complete English/Amharic pair into one event", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-01")!;
    expect(f.expected.languageHalves).toEqual(["en", "am"]);
    expect(f.expected.expectedEvents.length).toBe(1);
    const e = f.expected.expectedEvents[0];
    expect(e.pairing).toBe("paired");
    expect(e.pairingStatus).toBe("complete");
    expect(e.senderCode).toBe("70001");
    expect(e.recipientCode).toBe("70002");
  });

  it("uses the transaction reference as the pairing key", () => {
    const raw = readRaw(active.find((e) => e.id === "sms.float.dist.case-01")!);
    const refs = [...raw.matchAll(/SYN\d{7}/g)].map((m) => m[0]);
    expect(refs.length).toBe(2);
    expect(new Set(refs).size).toBe(1);
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-01")!;
    expect(f.expected.expectedEvents[0].transactionReference).toBe(refs[0]);
  });

  it("blocks pairing when the two halves carry different references", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-04")!;
    expect(f.expected.expectedEvents.length).toBe(2);
    expect(f.expected.expectedEvents.map((e) => e.pairing)).toEqual([
      "english_only",
      "amharic_only",
    ]);
    expect(f.expected.expectedEvents.every((e) => e.pairingStatus === "pending")).toBe(true);
    expect(f.expected.reviewRows[0].reason).toBe("reference_mismatch");
    const refs = f.expected.expectedEvents.map((e) => e.transactionReference);
    expect(new Set(refs).size).toBe(2);
  });

  it("keeps unmatched halves visible rather than dropping them", () => {
    const pending = allEvents.filter((e) => e.pairingStatus === "pending");
    expect(pending.length).toBeGreaterThan(0);
    for (const e of pending) {
      expect(e.amountMinor).not.toBe(0);
      expect(e.pairing === "english_only" || e.pairing === "amharic_only").toBe(true);
    }
  });

  it("retains Amharic evidence for amharic_only events", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-04")!;
    const am = f.expected.expectedEvents[1];
    expect(am.amharicEvidenceText).toBeTruthy();
    expect(am.counterpartyLabel).toBeNull();
  });

  it("never invents a recipient code from English text", () => {
    for (const { entry, expected } of loaded) {
      for (const e of expected.expectedEvents) {
        if (e.pairing === "english_only") {
          expect(e.recipientCode, entry.id).toBeNull();
          expect(e.senderCode, entry.id).toBeNull();
        }
        if (e.recipientCode !== null) {
          expect(expected.languageHalves, entry.id).toContain("am");
          expect(readRaw(entry), entry.id).toContain(e.recipientCode);
        }
      }
    }
  });
});

describe("identity and duplication rules", () => {
  it("keeps same-minute, same-amount distributions with different references separate", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-02")!;
    const [a, b] = f.expected.expectedEvents;
    expect(a.occurredAt).toBe(b.occurredAt);
    expect(a.amountMinor).toBe(b.amountMinor);
    expect(a.transactionReference).not.toBe(b.transactionReference);
    expect(f.expected.expectedEvents.length).toBe(2);
  });

  it("keeps repeated EVD amounts at different timestamps separate", () => {
    const f = loaded.find((x) => x.entry.id === "sms.evd.case-02")!;
    const [a, b] = f.expected.expectedEvents;
    expect(a.amountMinor).toBe(b.amountMinor);
    expect(a.occurredAt).not.toBe(b.occurredAt);
    expect(a.transactionReference).toBeNull();
    expect(b.transactionReference).toBeNull();
  });

  it("never reuses a duplicate reference across the corpus", () => {
    const refs = allEvents
      .map((e) => e.transactionReference)
      .filter((r): r is string => r !== null);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("keeps every counterparty strictly unassigned", () => {
    expect(allEvents.every((e) => e.counterpartyMatch === "unassigned")).toBe(true);
  });
});

describe("amount versus balance", () => {
  it("never reports the resulting balance as the transaction amount", () => {
    for (const e of allEvents) {
      if (e.resultingBalanceMinor !== null) {
        expect(Math.abs(e.amountMinor)).not.toBe(e.resultingBalanceMinor);
      }
    }
  });

  it("keeps the raw balance text distinct from the raw amount text", () => {
    for (const e of allEvents) {
      if (e.rawBalanceText !== null) expect(e.rawBalanceText).not.toBe(e.rawAmountText);
    }
  });

  it("signs amounts by direction", () => {
    for (const e of allEvents) {
      if (e.direction === "outbound") expect(e.amountMinor).toBeLessThan(0);
      else expect(e.amountMinor).toBeGreaterThan(0);
    }
  });
});

describe("EVD receipt date provenance", () => {
  it("takes the date from SMS metadata when the message text lacks one", () => {
    for (const { entry, expected } of loaded.filter((f) => f.entry.family === "evd_receipt")) {
      const raw = readRaw(entry);
      for (const e of expected.expectedEvents) {
        if (e.dateSource !== "sms_app") continue;
        expect(e.occurredAt, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        const [day, minute] = e.occurredAt!.split("T");
        expect(raw, entry.id).toContain(`[SMS-APP ${day} ${minute}]`);
      }
      // No in-message date or reference exists in the body itself.
      const body = raw
        .split("\n")
        .filter((l) => !l.startsWith("[SMS-APP"))
        .join("\n");
      expect(body, entry.id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(body, entry.id).not.toMatch(/SYN\d{7}/);
    }
  });

  it("falls back to a user-selected day with no invented time", () => {
    const f = loaded.find((x) => x.entry.id === "sms.evd.case-03")!;
    const raw = readRaw(f.entry);
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const e = f.expected.expectedEvents[0];
    expect(e.dateSource).toBe("user_selected");
    expect(e.datePrecision).toBe("date");
    expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves an unrecognized distributor label unassigned but preserved", () => {
    const f = loaded.find((x) => x.entry.id === "sms.evd.case-04")!;
    const e = f.expected.expectedEvents[0];
    expect(e.counterpartyLabel).toBe("Sample Distributor B");
    expect(e.counterpartyMatch).toBe("unassigned");
    expect(readRaw(f.entry)).toContain("Sample Distributor B");
  });
});

describe("unmatched, duplicate and malformed SMS outcomes", () => {
  it("keeps an unmatched Amharic distribution half visible and pending", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-05")!;
    expect(f.expected.languageHalves).toEqual(["am"]);
    expect(f.expected.expectedEvents.length).toBe(1);
    const e = f.expected.expectedEvents[0];
    expect(e.pairing).toBe("amharic_only");
    expect(e.pairingStatus).toBe("pending");
    expect(e.counterpartyLabel).toBeNull();
    expect(e.shopLabel).toBeNull();
    expect(e.amharicEvidenceText).toBeTruthy();
    expect(e.recipientCode).toBe("70004");
  });

  it("collapses a duplicate bilingual delivery of one reference into one event", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-06")!;
    const raw = readRaw(f.entry);
    const refs = [...raw.matchAll(/SYN\d{7}/g)].map((m) => m[0]);
    expect(refs.length).toBe(3);
    expect(new Set(refs).size).toBe(1);
    expect(f.expected.expectedEvents.length).toBe(1);
    expect(f.expected.reviewRows.length).toBe(0);
    expect(f.expected.expectedEvents[0].pairing).toBe("paired");
  });

  it("abstains on a truncated reference instead of completing it", () => {
    const f = loaded.find((x) => x.entry.id === TRUNCATED_REFERENCE_FIXTURE)!;
    const e = f.expected.expectedEvents[0];
    expect(e.transactionReference).toBeNull();
    expect(e.amountMinor).toBe(-2200000);
    expect(f.expected.reviewRows.map((r) => r.reason)).toEqual(["missing_reference"]);
    expect(readRaw(f.entry)).toContain("Ref: SYN44710");
  });

  it("emits no financial event for a malformed message", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-08")!;
    expect(f.expected.expectedEvents.length).toBe(0);
    expect(f.expected.reviewRows.map((r) => r.reason)).toEqual(["missing_amount"]);
    const raw = readRaw(f.entry);
    expect(raw).not.toMatch(/SYN\d/);
    expect(raw).not.toMatch(/\d[\d,]*\.\d{2}/);
  });

  it("requires a review row when a fixture reports no events", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.dist.case-08")!;
    const mutated = { ...f.expected, reviewRows: [] };
    expect(SmsGoldenExpectationSchema.safeParse(mutated).success).toBe(false);
  });

  it("keeps repeated float receipts separate when references differ", () => {
    const f = loaded.find((x) => x.entry.id === "sms.float.recv.case-02")!;
    const [a, b] = f.expected.expectedEvents;
    expect(a.amountMinor).toBe(b.amountMinor);
    expect(a.transactionReference).not.toBe(b.transactionReference);
    expect(a.pairing).toBe("paired");
    expect(b.pairing).toBe("english_only");
    expect(f.expected.expectedEvents.length).toBe(2);
  });

  it("keeps every review outcome visible and ordered", () => {
    for (const { entry, expected } of loaded) {
      for (const r of expected.reviewRows) {
        expect(r.observedText.length, entry.id).toBeGreaterThan(0);
        expect(r.sourceOrder, entry.id).toBeGreaterThanOrEqual(0);
      }
    }
    const totalReviews = loaded.reduce((a, f) => a + f.expected.reviewRows.length, 0);
    expect(totalReviews).toBe(3);
  });

  it("allows a truncated reference token in exactly one fixture", () => {
    for (const entry of active) {
      const shortRefs = [...readRaw(entry).matchAll(/SYN\d+/g)]
        .map((m) => m[0])
        .filter((r) => r.length !== 10);
      if (entry.id === TRUNCATED_REFERENCE_FIXTURE) expect(shortRefs.length).toBe(1);
      else expect(shortRefs.length, entry.id).toBe(0);
    }
  });
});

describe("sanitization and determinism", () => {
  it("contains no forbidden private patterns", () => {
    for (const entry of active) {
      const raw = readRaw(entry);
      for (const rule of FORBIDDEN) {
        expect(rule.re.test(raw), `${entry.id}: ${rule.name}`).toBe(false);
      }
    }
  });

  it("uses only synthetic labels, codes and references", () => {
    for (const { entry, expected } of loaded) {
      for (const e of expected.expectedEvents) {
        if (e.counterpartyLabel) expect(ALLOWED_LABELS, entry.id).toContain(e.counterpartyLabel);
        if (e.shopLabel) expect(ALLOWED_LABELS, entry.id).toContain(e.shopLabel);
        if (e.transactionReference) expect(e.transactionReference).toMatch(/^SYN\d{7}$/);
        for (const code of [e.senderCode, e.recipientCode]) {
          if (code) expect(code).toMatch(/^700\d{2}$/);
        }
      }
    }
  });

  it("commits no image or document fixture data", () => {
    for (const entry of active) {
      expect(entry.rawFixturePath!.endsWith(".raw.txt"), entry.id).toBe(true);
      expect(entry.privacyStatus, entry.id).toBe("sanitized");
    }
  });

  it("loads deterministically", () => {
    for (const entry of active) {
      expect(JSON.stringify(readExpected(entry))).toBe(JSON.stringify(readExpected(entry)));
      expect(readRaw(entry)).toBe(readRaw(entry));
    }
  });

  it("invokes no production parser module", () => {
    const source = readFileSync(join(here, "sms-fixtures.test.ts"), "utf8");
    expect(source).not.toMatch(/from\s+"(\.\.\/)+src\//);
    expect(source).not.toMatch(/@\/lib\//);
  });
});

describe("existing screenshot corpus is untouched", () => {
  it("keeps 9 active screenshot fixtures and 56 expected rows", () => {
    const ocr = FixtureCatalog.parse(
      JSON.parse(readFileSync(join(here, "catalog.json"), "utf8")),
    ).filter((e) => e.status === "active");
    expect(ocr.length).toBe(9);
    expect(ocr.reduce((a, e) => a + e.expected.completeRowCount, 0)).toBe(56);
  });

  it("keeps the frozen baseline at 56/56 with both gates passing", () => {
    const baseline = ProductionBaselineSchema.parse(
      JSON.parse(readFileSync(join(here, "production-baseline.json"), "utf8")),
    );
    expect(baseline.summary.expectedRows).toBe(56);
    expect(baseline.summary.exactRowMatches).toBe(56);
    const gates = evaluateGates(baseline);
    expect(gates.nonRegression.passed).toBe(true);
    expect(gates.release.passed).toBe(true);
  });
});
