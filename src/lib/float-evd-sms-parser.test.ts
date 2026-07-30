import { describe, expect, it } from "vitest";
import {
  classifySmsBlock,
  classifySmsLanguage,
  extractAmountAndBalance,
  extractCodes,
  extractLabels,
  extractLocalStamp,
  extractReference,
  extractSmsBlocks,
  extractSmsFields,
  normalizeSmsText,
  parseSantim,
  resolveSmsOccurredAt,
  segmentSmsBlocks,
} from "./float-evd-sms-parser";

/* ------------------------------------------------------------------ */
/* Raw messages — copied from the 14 sanitized SMS fixtures.           */
/* Synthetic values only; no private passage.                          */
/* ------------------------------------------------------------------ */

const DIST_01 = `[EN 2026-08-11 10:14]
ETB 45,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-11 10:14. Ref: SYN4471029. New float balance ETB 1,255,000.00.

[AM 2026-08-11 10:14]
ብር 45,000.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70002 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-11 10:14። ማጣቀሻ SYN4471029።`;

const DIST_02 = `[EN 2026-08-12 09:05]
ETB 30,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-12 09:05. Ref: SYN4471030. New float balance ETB 1,225,000.00.

[AM 2026-08-12 09:05]
ብር 30,000.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70002 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-12 09:05። ማጣቀሻ SYN4471030።

[EN 2026-08-12 09:05]
ETB 30,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-12 09:05. Ref: SYN4471031. New float balance ETB 1,195,000.00.

[AM 2026-08-12 09:05]
ብር 30,000.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70003 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-12 09:05። ማጣቀሻ SYN4471031።`;

const DIST_03 = `[EN 2026-08-12 14:40]
ETB 18,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-12 14:40. Ref: SYN4471032. New float balance ETB 1,102,000.00.`;

const DIST_04 = `[EN 2026-08-13 11:20]
ETB 25,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-13 11:20. Ref: SYN4471033. New float balance ETB 1,077,000.00.

[AM 2026-08-13 11:20]
ብር 25,000.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70002 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-13 11:20። ማጣቀሻ SYN4471034።`;

const DIST_05 = `[AM 2026-08-15 16:12]
ብር 12,500.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70004 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-15 16:12። ማጣቀሻ SYN4471035።`;

const DIST_06 = `[EN 2026-08-15 18:02]
ETB 40,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-15 18:02. Ref: SYN4471036. New float balance ETB 1,062,000.00.

[AM 2026-08-15 18:02]
ብር 40,000.00 ከኤም-ፔሳ ፍሎት ተቀንሶ ወደ 70002 ተልኳል። ላኪ ኮድ 70001። ቀን 2026-08-15 18:02። ማጣቀሻ SYN4471036።

[EN 2026-08-15 18:03]
ETB 40,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-15 18:02. Ref: SYN4471036. New float balance ETB 1,062,000.00.`;

const DIST_07 = `[EN 2026-08-16 10:30]
ETB 22,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-16 10:30. Ref: SYN44710`;

const DIST_08 = `[EN 2026-08-16 13:45]
ETB removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-16`;

const EVD_01 = `[SMS-APP 2026-08-13 15:42]
Your account has been successfully credited with ETB 20,000.00. Sample Distributor A`;

const EVD_02 = `[SMS-APP 2026-08-14 09:10]
Your account has been successfully credited with ETB 20,000.00. Sample Distributor A

[SMS-APP 2026-08-14 17:35]
Your account has been successfully credited with ETB 20,000.00. Sample Distributor A`;

const EVD_03 = `[SMS-APP TIMESTAMP UNAVAILABLE]
Your account has been successfully credited with ETB 12,000.00. Sample Distributor A`;

const EVD_04 = `[SMS-APP 2026-08-15 11:05]
Your account has been successfully credited with ETB 8,000.00. Sample Distributor B`;

const RECV_01 = `[EN 2026-08-14 08:20]
ETB 500,000.00 added to your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-14 08:20. Ref: SYN4471040. New float balance ETB 1,755,000.00.`;

const RECV_02 = `[EN 2026-08-17 08:05]
ETB 300,000.00 added to your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-17 08:05. Ref: SYN4471041. New float balance ETB 1,455,000.00.

[AM 2026-08-17 08:05]
ብር 300,000.00 ወደ ኤም-ፔሳ ፍሎት ተጨምሯል። ላኪ ኮድ 70005። ተቀባይ ኮድ 70001። ቀን 2026-08-17 08:05። ማጣቀሻ SYN4471041።

[EN 2026-08-17 08:40]
ETB 300,000.00 added to your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-17 08:40. Ref: SYN4471042. New float balance ETB 1,755,000.00.`;

const ALL_FIXTURES: Array<[string, string]> = [
  ["sms.float.dist.case-01", DIST_01],
  ["sms.float.dist.case-02", DIST_02],
  ["sms.float.dist.case-03", DIST_03],
  ["sms.float.dist.case-04", DIST_04],
  ["sms.float.dist.case-05", DIST_05],
  ["sms.float.dist.case-06", DIST_06],
  ["sms.float.dist.case-07", DIST_07],
  ["sms.float.dist.case-08", DIST_08],
  ["sms.evd.case-01", EVD_01],
  ["sms.evd.case-02", EVD_02],
  ["sms.evd.case-03", EVD_03],
  ["sms.evd.case-04", EVD_04],
  ["sms.float.recv.case-01", RECV_01],
  ["sms.float.recv.case-02", RECV_02],
];

/* ------------------------------------------------------------------ */

describe("normalizeSmsText", () => {
  it("removes invisible characters and collapses spaces without destroying evidence", () => {
    const raw = "ETB\u200B 45,000.00  removed\u00A0from float።  ";
    expect(normalizeSmsText(raw)).toBe("ETB 45,000.00 removed from float።");
  });

  it("never lowercases, never strips grouping separators or currency tokens", () => {
    const out = normalizeSmsText("New float balance ETB 1,255,000.00.");
    expect(out).toBe("New float balance ETB 1,255,000.00.");
  });

  it("keeps repeated identical lines", () => {
    expect(normalizeSmsText("a\na")).toBe("a\na");
  });
});

describe("segmentation and language halves", () => {
  it("segments every fixture into its delivered blocks", () => {
    const counts = ALL_FIXTURES.map(([id, text]) => [id, segmentSmsBlocks(text).length]);
    expect(counts).toEqual([
      ["sms.float.dist.case-01", 2],
      ["sms.float.dist.case-02", 4],
      ["sms.float.dist.case-03", 1],
      ["sms.float.dist.case-04", 2],
      ["sms.float.dist.case-05", 1],
      ["sms.float.dist.case-06", 3],
      ["sms.float.dist.case-07", 1],
      ["sms.float.dist.case-08", 1],
      ["sms.evd.case-01", 1],
      ["sms.evd.case-02", 2],
      ["sms.evd.case-03", 1],
      ["sms.evd.case-04", 1],
      ["sms.float.recv.case-01", 1],
      ["sms.float.recv.case-02", 3],
    ]);
  });

  it("classifies language halves from the delivery header", () => {
    expect(segmentSmsBlocks(DIST_01).map((b) => b.language)).toEqual(["en", "am"]);
    expect(segmentSmsBlocks(RECV_02).map((b) => b.language)).toEqual(["en", "am", "en"]);
    expect(segmentSmsBlocks(EVD_01).map((b) => b.language)).toEqual(["en"]);
  });

  it("falls back to script detection and reports unknown for scriptless text", () => {
    expect(classifySmsLanguage("ብር 1.00")).toBe("am");
    expect(classifySmsLanguage("ETB 1.00")).toBe("en");
    expect(classifySmsLanguage("1234")).toBe("unknown");
  });

  it("records SMS metadata stamps and explicit unavailability", () => {
    expect(segmentSmsBlocks(EVD_01)[0].metadataStamp).toBe("2026-08-13T15:42");
    const missing = segmentSmsBlocks(EVD_03)[0];
    expect(missing.metadataStamp).toBeNull();
    expect(missing.metadataStampMissing).toBe(true);
  });

  it("preserves source order", () => {
    expect(segmentSmsBlocks(DIST_02).map((b) => b.sourceOrder)).toEqual([0, 1, 2, 3]);
  });
});

describe("family classification", () => {
  const families = (text: string) => segmentSmsBlocks(text).map((b) => classifySmsBlock(b).family);

  it("classifies float distribution in both halves", () => {
    expect(families(DIST_01)).toEqual(["float_distribution", "float_distribution"]);
    expect(families(DIST_05)).toEqual(["float_distribution"]);
  });

  it("classifies float receipts in both halves", () => {
    expect(families(RECV_01)).toEqual(["float_receipt"]);
    expect(families(RECV_02)).toEqual(["float_receipt", "float_receipt", "float_receipt"]);
  });

  it("classifies EVD receipts", () => {
    expect(families(EVD_01)).toEqual(["evd_receipt"]);
    expect(families(EVD_02)).toEqual(["evd_receipt", "evd_receipt"]);
  });

  it("derives direction from wording only", () => {
    expect(segmentSmsBlocks(DIST_01)[0].text).toContain("removed from");
    expect(classifySmsBlock(segmentSmsBlocks(DIST_01)[0]).direction).toBe("outbound");
    expect(classifySmsBlock(segmentSmsBlocks(RECV_01)[0]).direction).toBe("inbound");
    expect(classifySmsBlock(segmentSmsBlocks(EVD_01)[0]).direction).toBe("inbound");
  });

  it("returns unknown with no direction when both directions are decisive", () => {
    const [block] = segmentSmsBlocks(
      "[EN 2026-08-16 10:30]\nETB 1.00 removed from your float and added to your float.",
    );
    const cls = classifySmsBlock(block);
    expect(cls.family).toBe("unknown");
    expect(cls.direction).toBeNull();
  });

  it("returns unknown rather than defaulting when no evidence exists", () => {
    const [block] = segmentSmsBlocks("[EN 2026-08-16 10:30]\nNo financial wording here.");
    expect(classifySmsBlock(block).family).toBe("unknown");
  });
});

describe("parseSantim", () => {
  it("converts exactly with integer arithmetic", () => {
    expect(parseSantim("45,000.00")).toBe(4500000);
    expect(parseSantim("1,255,000.00")).toBe(125500000);
    expect(parseSantim("0.07")).toBe(7);
    expect(parseSantim("12.5")).toBe(1250);
  });

  it("abstains on non-exact tokens", () => {
    expect(parseSantim("12.345")).toBeNull();
    expect(parseSantim("")).toBeNull();
    expect(parseSantim("abc")).toBeNull();
    expect(parseSantim("-5.00")).toBeNull();
  });
});

describe("amount and balance extraction", () => {
  const amountsOf = (text: string) =>
    segmentSmsBlocks(text).map((b) => {
      const a = extractAmountAndBalance(b, classifySmsBlock(b));
      return [a.amountMinor, a.resultingBalanceMinor];
    });

  it("extracts signed amounts and keeps the balance separate", () => {
    expect(amountsOf(DIST_01)).toEqual([
      [-4500000, 125500000],
      [-4500000, null],
    ]);
    expect(amountsOf(RECV_01)).toEqual([[50000000, 175500000]]);
    expect(amountsOf(RECV_02)).toEqual([
      [30000000, 145500000],
      [30000000, null],
      [30000000, 175500000],
    ]);
  });

  it("never promotes a balance to the transaction amount", () => {
    for (const [, text] of ALL_FIXTURES) {
      for (const block of segmentSmsBlocks(text)) {
        const a = extractAmountAndBalance(block, classifySmsBlock(block));
        if (a.amountMinor !== null && a.resultingBalanceMinor !== null) {
          expect(Math.abs(a.amountMinor)).not.toBe(a.resultingBalanceMinor);
        }
      }
    }
  });

  it("extracts EVD amounts with credited evidence", () => {
    const [block] = segmentSmsBlocks(EVD_01);
    const a = extractAmountAndBalance(block, classifySmsBlock(block));
    expect(a.amountMinor).toBe(2000000);
    expect(a.rawAmountText).toBe("20,000.00");
    expect(a.evidence.amountMinor.observedText).toBe("credited with ETB 20,000.00");
  });

  it("abstains on the malformed fixture without inventing an amount", () => {
    const [block] = segmentSmsBlocks(DIST_08);
    const a = extractAmountAndBalance(block, classifySmsBlock(block));
    expect(a.amountMinor).toBeNull();
    expect(a.rawAmountText).toBeNull();
    expect(a.resultingBalanceMinor).toBeNull();
    expect(a.warnings.map((w) => w.reason)).toEqual(["missing_amount"]);
  });
});

describe("reference extraction", () => {
  it("extracts complete references from both halves", () => {
    expect(segmentSmsBlocks(DIST_01).map((b) => extractReference(b).reference)).toEqual([
      "SYN4471029",
      "SYN4471029",
    ]);
    expect(segmentSmsBlocks(DIST_04).map((b) => extractReference(b).reference)).toEqual([
      "SYN4471033",
      "SYN4471034",
    ]);
    expect(extractReference(segmentSmsBlocks(DIST_05)[0]).reference).toBe("SYN4471035");
  });

  it("rejects a truncated reference with a warning and never completes it", () => {
    const r = extractReference(segmentSmsBlocks(DIST_07)[0]);
    expect(r.reference).toBeNull();
    expect(r.truncated).toBe(true);
    expect(r.warnings).toEqual([{ reason: "missing_reference", observedText: "Ref: SYN44710" }]);
  });

  it("returns null with no warning when no reference is present", () => {
    const r = extractReference(segmentSmsBlocks(EVD_01)[0]);
    expect(r.reference).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe("timestamps and date provenance", () => {
  it("prefers the in-message timestamp as a source-local string", () => {
    const when = resolveSmsOccurredAt(segmentSmsBlocks(DIST_01)[0]);
    expect(when).toMatchObject({
      occurredAt: "2026-08-11T10:14",
      datePrecision: "minute",
      dateSource: "in_message",
    });
    expect(extractLocalStamp(segmentSmsBlocks(DIST_05)[0]).stamp).toBe("2026-08-15T16:12");
  });

  it("uses SMS-app metadata only when the message carries no timestamp", () => {
    const when = resolveSmsOccurredAt(segmentSmsBlocks(EVD_01)[0]);
    expect(when).toMatchObject({
      occurredAt: "2026-08-13T15:42",
      datePrecision: "minute",
      dateSource: "sms_app",
    });
    expect(resolveSmsOccurredAt(segmentSmsBlocks(EVD_04)[0]).occurredAt).toBe("2026-08-15T11:05");
    expect(segmentSmsBlocks(EVD_02).map((b) => resolveSmsOccurredAt(b).occurredAt)).toEqual([
      "2026-08-14T09:10",
      "2026-08-14T17:35",
    ]);
  });

  it("uses a user-selected day at date precision and never invents a time", () => {
    const when = resolveSmsOccurredAt(segmentSmsBlocks(EVD_03)[0], {
      userSelectedDate: "2026-08-15",
    });
    expect(when.occurredAt).toBe("2026-08-15");
    expect(when.datePrecision).toBe("date");
    expect(when.dateSource).toBe("user_selected");
    expect(when.occurredAt).not.toContain("T");
  });

  it("warns instead of inventing a date when no evidence exists", () => {
    const when = resolveSmsOccurredAt(segmentSmsBlocks(EVD_03)[0]);
    expect(when.occurredAt).toBeNull();
    expect(when.warnings.map((w) => w.reason)).toEqual(["missing_date"]);
  });

  it("keeps date-only in-message evidence at date precision", () => {
    const local = extractLocalStamp(segmentSmsBlocks(DIST_08)[0]);
    expect(local.stamp).toBe("2026-08-16");
    expect(local.precision).toBe("date");
  });
});

describe("labels and codes", () => {
  it("extracts administrator and shop from English distribution text", () => {
    const labels = extractLabels(segmentSmsBlocks(DIST_01)[0]);
    expect(labels.counterpartyLabel).toBe("Sample Administrator");
    expect(labels.shopLabel).toBe("Sample Shop A");
  });

  it("preserves an unrecognized distributor label as unassigned", () => {
    const labels = extractLabels(segmentSmsBlocks(EVD_04)[0]);
    expect(labels.distributorLabel).toBe("Sample Distributor B");
    expect(extractSmsFields(segmentSmsBlocks(EVD_04)[0]).counterpartyMatch).toBe("unassigned");
  });

  it("never invents English labels for an Amharic half", () => {
    const labels = extractLabels(segmentSmsBlocks(DIST_05)[0]);
    expect(labels).toMatchObject({
      counterpartyLabel: null,
      shopLabel: null,
      distributorLabel: null,
    });
  });

  it("extracts sender and recipient codes from Amharic halves only", () => {
    expect(extractCodes(segmentSmsBlocks(DIST_01)[1])).toMatchObject({
      senderCode: "70001",
      recipientCode: "70002",
    });
    expect(extractCodes(segmentSmsBlocks(DIST_05)[0])).toMatchObject({
      senderCode: "70001",
      recipientCode: "70004",
    });
    expect(extractCodes(segmentSmsBlocks(RECV_02)[1])).toMatchObject({
      senderCode: "70005",
      recipientCode: "70001",
    });
  });

  it("never invents codes from English distribution text", () => {
    for (const [, text] of ALL_FIXTURES) {
      for (const block of segmentSmsBlocks(text)) {
        if (block.language === "am") continue;
        expect(extractCodes(block)).toMatchObject({ senderCode: null, recipientCode: null });
      }
    }
  });
});

describe("per-block extraction over every fixture message", () => {
  it("extracts the English distribution half completely", () => {
    const [en] = extractSmsBlocks(DIST_01);
    expect(en).toMatchObject({
      amountMinor: -4500000,
      rawAmountText: "45,000.00",
      resultingBalanceMinor: 125500000,
      rawBalanceText: "1,255,000.00",
      transactionReference: "SYN4471029",
      occurredAt: "2026-08-11T10:14",
      datePrecision: "minute",
      dateSource: "in_message",
      counterpartyLabel: "Sample Administrator",
      shopLabel: "Sample Shop A",
      senderCode: null,
      recipientCode: null,
      amharicEvidenceText: null,
    });
    expect(en.evidence.amountMinor.observedText).toBe("ETB 45,000.00 removed");
    expect(en.evidence.resultingBalanceMinor.observedText).toBe(
      "New float balance ETB 1,255,000.00",
    );
    expect(en.evidence.transactionReference.observedText).toBe("Ref: SYN4471029");
    expect(en.warnings).toEqual([]);
  });

  it("retains Amharic evidence text with codes and reference", () => {
    const [, am] = extractSmsBlocks(DIST_01);
    expect(am.amharicEvidenceText).toContain("ማጣቀሻ SYN4471029");
    expect(am).toMatchObject({
      amountMinor: -4500000,
      transactionReference: "SYN4471029",
      senderCode: "70001",
      recipientCode: "70002",
      counterpartyLabel: null,
      shopLabel: null,
    });
  });

  it("extracts distinct references for the same-minute distributions", () => {
    expect(extractSmsBlocks(DIST_02).map((e) => e.transactionReference)).toEqual([
      "SYN4471030",
      "SYN4471030",
      "SYN4471031",
      "SYN4471031",
    ]);
  });

  it("extracts mismatched references without pairing them", () => {
    expect(extractSmsBlocks(DIST_04).map((e) => e.transactionReference)).toEqual([
      "SYN4471033",
      "SYN4471034",
    ]);
  });

  it("extracts the redelivered reference on every block", () => {
    expect(extractSmsBlocks(DIST_06).map((e) => e.transactionReference)).toEqual([
      "SYN4471036",
      "SYN4471036",
      "SYN4471036",
    ]);
  });

  it("extracts English-only distributions without codes", () => {
    const [only] = extractSmsBlocks(DIST_03);
    expect(only).toMatchObject({
      amountMinor: -1800000,
      transactionReference: "SYN4471032",
      senderCode: null,
      recipientCode: null,
    });
  });

  it("keeps the truncated-reference block defensible but flagged", () => {
    const [flagged] = extractSmsBlocks(DIST_07);
    expect(flagged.amountMinor).toBe(-2200000);
    expect(flagged.occurredAt).toBe("2026-08-16T10:30");
    expect(flagged.transactionReference).toBeNull();
    expect(flagged.warnings.map((w) => w.reason)).toEqual(["missing_reference"]);
  });

  it("abstains entirely on the malformed message", () => {
    const [bad] = extractSmsBlocks(DIST_08);
    expect(bad.amountMinor).toBeNull();
    expect(bad.rawAmountText).toBeNull();
    expect(bad.resultingBalanceMinor).toBeNull();
    expect(bad.transactionReference).toBeNull();
    expect(bad.senderCode).toBeNull();
    expect(bad.recipientCode).toBeNull();
    expect(bad.warnings.map((w) => w.reason)).toContain("missing_amount");
  });

  it("extracts EVD receipts with metadata dates and distributor labels", () => {
    expect(extractSmsBlocks(EVD_01)[0]).toMatchObject({
      amountMinor: 2000000,
      occurredAt: "2026-08-13T15:42",
      dateSource: "sms_app",
      distributorLabel: "Sample Distributor A",
      transactionReference: null,
    });
    expect(extractSmsBlocks(EVD_03, { userSelectedDate: "2026-08-15" })[0]).toMatchObject({
      amountMinor: 1200000,
      occurredAt: "2026-08-15",
      datePrecision: "date",
      dateSource: "user_selected",
    });
  });

  it("extracts float receipts with balances kept separate", () => {
    expect(extractSmsBlocks(RECV_02).map((e) => e.transactionReference)).toEqual([
      "SYN4471041",
      "SYN4471041",
      "SYN4471042",
    ]);
    expect(extractSmsBlocks(RECV_02).map((e) => e.amountMinor)).toEqual([
      30000000, 30000000, 30000000,
    ]);
  });

  it("creates no events and performs no deduplication in this batch", () => {
    // One extraction per delivered block, always — pairing happens later.
    expect(extractSmsBlocks(DIST_06)).toHaveLength(3);
    expect(extractSmsBlocks(DIST_01)).toHaveLength(2);
  });

  it("is deterministic and leaves the input unchanged", () => {
    for (const [, text] of ALL_FIXTURES) {
      const before = text;
      const a = extractSmsBlocks(text, { userSelectedDate: "2026-08-15" });
      const b = extractSmsBlocks(text, { userSelectedDate: "2026-08-15" });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(text).toBe(before);
    }
  });

  it("uses integer santim everywhere", () => {
    for (const [, text] of ALL_FIXTURES) {
      for (const e of extractSmsBlocks(text)) {
        if (e.amountMinor !== null) expect(Number.isSafeInteger(e.amountMinor)).toBe(true);
        if (e.resultingBalanceMinor !== null) {
          expect(Number.isSafeInteger(e.resultingBalanceMinor)).toBe(true);
        }
      }
    }
  });
});
