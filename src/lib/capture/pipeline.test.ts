import { describe, it, expect } from "vitest";
import { fingerprintSource } from "./source-fingerprint";
import { segmentSourceRecords } from "./segmentation";
import { buildCandidates, resolveFinalAmount } from "./candidate";
import {
  defaultPurpose,
  purposeOptions,
  requiresAgent,
  settlesAgentCredits,
  isPurposeAllowed,
} from "./purpose";
import { rowReadiness, summarizeReadinessStates, type ReadinessInput } from "./readiness";
import { findMapping, applyApproval, type ApprovedMapping } from "../approved-mappings";

/* All fixtures below are synthetic and sanitized: no real names, accounts,
   references or phone numbers. */

const CBE_CREDIT =
  "Dear Customer, Account 1****4599 has been credited by SAMPLE SENDER with ETB 5,000.00 on 12/07/2026 at 10:12. Your Current Balance is ETB 12,340.00. Thank you for banking with Commercial Bank of Ethiopia. https://apps.cbe.com.et/receipt?id=FT2612345678";
const CBE_DEBIT =
  "Dear Customer, Account 1****4599 has been debited with ETB 2,000.00 on 12/07/2026 at 11:00. Your Current Balance is ETB 10,340.00. Thank you for banking with Commercial Bank of Ethiopia.";
const BOA_CREDIT =
  "Dear customer, your account 1****0021 was credited with ETB 7,500.00 by SAMPLE AGENT ONE. Available Balance: ETB 21,000.00. Bank of Abyssinia. https://bankofabyssinia.com/trx=AB123456";
const COOP_CREDIT =
  "Dear Customer, Account 1****7788 has been Credited with ETB 3,200.00 Ref: CP998877 BY SAMPLE AGENT TWO ON 12/07/2026. Your Current Balance is ETB 9,000.00. Cooperative Bank of Oromia. For more information call 8523";
const DASHEN_DEBIT =
  "Dear Customer, your account 1****3311 was debited with ETB 1,500.00. Available Balance: ETB 4,000.00. Dashen Bank";
const TELEBIRR_OUT =
  "Dear customer, You have transferred ETB 525.00 to SAMPLE RECEIVER (2519*****12) on 12/07/2026 10:30. Your service fee is ETB 3.48, VAT on the fee is ETB 0.52. Your transaction number is BQ12345678. Your E-Money Account balance is ETB 1,000.00. Thank you for using telebirr. https://transactioninfo.ethiotelecom.et/receipt/BQ12345678";
const TELEBIRR_IN =
  "Dear customer, You have received ETB 900.00 from SAMPLE PAYER (2519*****34) on 12/07/2026 09:15. Your transaction number is BQ87654321. Your E-Money Account balance is ETB 1,900.00. Thank you for using telebirr.";
const TELEBIRR_AIRTIME =
  "Dear customer, You have received ETB 1,000.00 airtime from 2519*****99 on 12/07/2026 08:00. Your transaction number is BQ55555555. Thank you for using telebirr. Ethio telecom";
const FLOAT_SENT =
  "ETB 22,000.00 removed from your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-16 10:30. Ref: SYN44710";
const FLOAT_RECEIVED =
  "ETB 40,000.00 added to your M-PESA float by Sample Administrator at Sample Shop A on 2026-08-16 09:00. Ref: SYN44711";
const EVD_RECEIVED =
  "You have received EVD airtime credit of ETB 30,000.00 from Sample Distributor on 2026-08-16 09:30. Ref: EVD77120";

describe("source fingerprinting", () => {
  it("classifies bank debit/credit for CBE, Abyssinia, Coop and Dashen", () => {
    for (const msg of [CBE_CREDIT, CBE_DEBIT, BOA_CREDIT, COOP_CREDIT, DASHEN_DEBIT]) {
      const fp = fingerprintSource(msg);
      expect(fp.source).toBe("bank");
      expect(fp.kind).toBe("bank");
      expect(fp.resolved).toBe(true);
      expect(fp.evidence.length).toBeGreaterThan(1);
    }
    expect(fingerprintSource(CBE_CREDIT).channel).toBe("CBE");
    expect(fingerprintSource(BOA_CREDIT).channel).toBe("Abyssinia");
    expect(fingerprintSource(COOP_CREDIT).channel).toBe("Coop");
    expect(fingerprintSource(DASHEN_DEBIT).channel).toBe("Dashen");
  });

  it("classifies telebirr money movements as a wallet, not a bank", () => {
    for (const msg of [TELEBIRR_OUT, TELEBIRR_IN]) {
      const fp = fingerprintSource(msg);
      expect(fp.source).toBe("telebirr");
      expect(fp.kind).toBe("wallet");
    }
  });

  it("classifies a telebirr airtime receipt as airtime, not a wallet transfer", () => {
    const fp = fingerprintSource(TELEBIRR_AIRTIME);
    expect(fp.source).toBe("evd");
    expect(fp.kind).toBe("airtime");
  });

  it("classifies Float messages from float grammar", () => {
    for (const msg of [FLOAT_SENT, FLOAT_RECEIVED]) {
      expect(fingerprintSource(msg).source).toBe("float");
    }
    expect(fingerprintSource(EVD_RECEIVED).source).toBe("evd");
  });

  it("never treats generic credited/debited wording as Float or EVD", () => {
    const fp = fingerprintSource("Your wallet has been credited with ETB 100.00.");
    expect(fp.source).not.toBe("float");
    expect(fp.source).not.toBe("evd");
  });

  it("leaves conflicting issuer evidence unresolved", () => {
    const fp = fingerprintSource(
      "Account 1****4599 has been debited with ETB 100.00. Your Current Balance is ETB 1.00. Commercial Bank of Ethiopia. Thank you for using telebirr, your E-Money Account is active.",
    );
    expect(fp.resolved).toBe(false);
    expect(fp.source).toBe("unknown");
    expect(fp.conflicts.length).toBeGreaterThan(0);
  });

  it("returns unresolved with no evidence for junk text", () => {
    const fp = fingerprintSource("hello, are you around?");
    expect(fp.source).toBe("unknown");
    expect(fp.resolved).toBe(false);
  });
});

describe("segmentation", () => {
  it("keeps one SMS as one record even with footers, links and balances", () => {
    const records = segmentSourceRecords(COOP_CREDIT);
    expect(records).toHaveLength(1);
    expect(records[0].raw).toContain("call 8523");
  });

  it("does not create a transaction out of a footer block", () => {
    const text = `${BOA_CREDIT}\n\nThank you for banking with us. For more information call 8523\nhttps://bankofabyssinia.com`;
    const records = segmentSourceRecords(text);
    expect(records).toHaveLength(1);
    const candidates = buildCandidates(text);
    expect(candidates).toHaveLength(1);
  });

  it("splits several pasted SMS into one record each", () => {
    const records = segmentSourceRecords(`${CBE_CREDIT}\n\n${TELEBIRR_IN}\n\n${FLOAT_SENT}`);
    expect(records).toHaveLength(3);
  });
});

describe("canonical candidate", () => {
  it("composes the telebirr final debit from principal, fee and VAT", () => {
    const [c] = buildCandidates(TELEBIRR_OUT);
    expect(c.source).toBe("telebirr");
    expect(c.family).toBe("wallet_out");
    expect(c.principalSantim).toBe(52500);
    expect(c.feeSantim).toBe(348);
    expect(c.vatSantim).toBe(52);
    expect(c.finalAmountSantim).toBe(52900);
  });

  it("never invents a final debit when a charge component is missing", () => {
    expect(
      resolveFinalAmount({ principalSantim: 52500, feeSantim: 348, hasCharges: true }),
    ).toBeUndefined();
    expect(resolveFinalAmount({ principalSantim: 52500, hasCharges: false })).toBe(52500);
    expect(resolveFinalAmount({ statedFinalSantim: 52900, hasCharges: true })).toBe(52900);
  });

  it("maps bank credits and debits to the right family and direction", () => {
    const [credit] = buildCandidates(CBE_CREDIT);
    expect(credit.family).toBe("bank_credit");
    expect(credit.direction).toBe("in");
    const [debit] = buildCandidates(CBE_DEBIT);
    expect(debit.family).toBe("bank_debit");
    expect(debit.direction).toBe("out");
  });

  it("keeps the full raw message as evidence", () => {
    const [c] = buildCandidates(COOP_CREDIT);
    expect(c.raw).toBe(COOP_CREDIT);
    expect(c.attachments.length).toBeGreaterThanOrEqual(0);
  });

  it("routes Float movements to airtime families", () => {
    const [sent] = buildCandidates(FLOAT_SENT);
    expect(sent.source).toBe("float");
    expect(sent.family).toBe("airtime_sent");
    const [received] = buildCandidates(FLOAT_RECEIVED);
    expect(received.family).toBe("airtime_received");
  });

  it("starts every candidate with an unresolved business purpose", () => {
    for (const c of buildCandidates(`${CBE_CREDIT}\n\n${TELEBIRR_OUT}`)) {
      expect(c.purpose).toBe("unresolved");
    }
  });
});

describe("business purpose", () => {
  it("offers only direction-appropriate purposes", () => {
    expect(purposeOptions("in")).toContain("agent_settlement");
    expect(purposeOptions("in")).not.toContain("distributor_payment");
    expect(purposeOptions("out")).toContain("distributor_payment");
    expect(purposeOptions("out")).not.toContain("agent_settlement");
    expect(isPurposeAllowed("in", "business_expense")).toBe(false);
  });

  it("defaults to unresolved and requires an agent for settlement", () => {
    expect(defaultPurpose()).toBe("unresolved");
    expect(requiresAgent("agent_settlement")).toBe(true);
    expect(settlesAgentCredits("agent_settlement")).toBe(true);
    expect(settlesAgentCredits("other_income")).toBe(false);
  });
});

describe("readiness state machine", () => {
  const base: ReadinessInput = {
    sourceResolved: true,
    familyResolved: true,
    financialBlockers: 0,
    hasDate: true,
    accountSelected: true,
    purposeResolved: true,
    requiresLink: false,
    linkSatisfied: true,
    linkCertain: true,
    needsReview: false,
  };

  it("is READY only when every gate is satisfied", () => {
    expect(rowReadiness(base)).toBe("READY");
  });

  it("blocks on unresolved purpose", () => {
    expect(rowReadiness({ ...base, purposeResolved: false })).toBe("INCOMPLETE");
  });

  it("blocks on a missing agent link, date, account or source", () => {
    expect(rowReadiness({ ...base, requiresLink: true, linkSatisfied: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...base, hasDate: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...base, accountSelected: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...base, sourceResolved: false })).toBe("INCOMPLETE");
  });

  it("marks financial failures INVALID", () => {
    expect(rowReadiness({ ...base, financialBlockers: 1 })).toBe("INVALID");
  });

  it("counts READY rows only", () => {
    const summary = summarizeReadinessStates([
      base,
      { ...base, purposeResolved: false },
      { ...base, financialBlockers: 2 },
      { ...base, needsReview: true },
    ]);
    expect(summary).toEqual({ total: 4, ready: 1, needsAttention: 1, incomplete: 1, invalid: 1 });
  });
});

describe("exact alias reuse", () => {
  const approved = applyApproval([], {
    id: "m1",
    label: "SAMPLE AGENT ONE",
    sourceFamily: "bank_message",
    targetType: "agent",
    targetId: "a1",
    targetName: "Sample Agent One",
    approvedAt: "2026-08-01T00:00:00.000Z",
  });

  it("reuses a byte-identical label inside the same source family", () => {
    const hit = findMapping("sample agent one", "bank_message", "agent", approved);
    expect(hit?.targetId).toBe("a1");
  });

  it("rejects a near match and a foreign source family", () => {
    expect(findMapping("SAMPLE AGENT 1", "bank_message", "agent", approved)).toBeNull();
    expect(findMapping("SAMPLE AGENT ONE", "airtime_sms", "agent", approved)).toBeNull();
  });

  it("never creates a mapping without an approval", () => {
    const none: ApprovedMapping[] = [];
    expect(findMapping("SAMPLE AGENT ONE", "bank_message", "agent", none)).toBeNull();
  });
});
