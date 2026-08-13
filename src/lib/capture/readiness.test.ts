import { describe, expect, it } from "vitest";
import {
  evaluateRow,
  importableCount,
  rowBlocker,
  rowReadiness,
  type ReadinessInput,
} from "./readiness";

const ready: ReadinessInput = {
  sourceResolved: true,
  familyResolved: true,
  financialBlockers: 0,
  hasDate: true,
  accountSelected: true,
  purposeResolved: true,
  requiresLink: false,
  linkSatisfied: true,
  linkCertain: true,
};

describe("duplicate-risk gate", () => {
  it("holds a colliding row at NEEDS_ATTENTION until it is confirmed", () => {
    expect(rowReadiness({ ...ready, duplicateRisk: true })).toBe("NEEDS_ATTENTION");
    expect(rowReadiness({ ...ready, duplicateRisk: true, duplicateRiskAcknowledged: true })).toBe(
      "READY",
    );
  });

  it("never asks about duplicates for an ordinary unique message", () => {
    expect(evaluateRow(ready)).toMatchObject({
      state: "READY",
      blocker: null,
      blockerCode: null,
      blockers: [],
      canImport: true,
    });
  });

  it("never lets an acknowledgement override a missing date, account, purpose or link", () => {
    const ack = { ...ready, duplicateRisk: true, duplicateRiskAcknowledged: true };
    expect(rowReadiness({ ...ack, hasDate: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...ack, accountSelected: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...ack, purposeResolved: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...ack, requiresLink: true, linkSatisfied: false })).toBe("INCOMPLETE");
    expect(rowReadiness({ ...ack, financialBlockers: 1 })).toBe("INVALID");
  });
});

describe("one readiness engine", () => {
  it("reports one concise blocker per row", () => {
    expect(rowBlocker({ ...ready, hasDate: false })).toBe("Choose date");
    expect(rowBlocker({ ...ready, requiresLink: true, linkSatisfied: false })).toBe("Choose agent");
    expect(rowBlocker({ ...ready, accountSelected: false })).toBe("Choose account");
    expect(rowBlocker({ ...ready, purposeResolved: false })).toBe("Choose purpose");
    expect(rowBlocker({ ...ready, financialBlockers: 1 })).toBe("Amounts do not add up");
  });

  it("counts exactly the rows the Import button will write", () => {
    const rows: ReadinessInput[] = [ready, { ...ready, hasDate: false }, ready];
    expect(importableCount(rows)).toBe(2);
    expect(rows.filter((r) => evaluateRow(r).canImport)).toHaveLength(2);
  });
});

describe("exact blockers", () => {
  it("spells out a date conflict instead of a generic warning", () => {
    const e = evaluateRow({
      ...ready,
      dateConflict: true,
      sourceDay: "Jul 24",
      correctedDay: "Jul 25",
    });
    expect(e.state).toBe("NEEDS_ATTENTION");
    expect(e.blockerCode).toBe("date_conflict");
    expect(e.blocker).toBe("Date conflict: SMS says Jul 24; correction says Jul 25.");
  });

  it("names the mismatched recipient", () => {
    const e = evaluateRow({
      ...ready,
      requiresLink: true,
      recipientMismatch: true,
      messageParty: "Alexo Bekele",
      linkedParty: "Alexo",
    });
    expect(e.blockerCode).toBe("recipient_mismatch");
    expect(e.blocker).toContain("Alexo Bekele");
    expect(e.canImport).toBe(false);
  });

  it("returns structured codes for the ordinary gates", () => {
    const codes = (i: ReadinessInput) => evaluateRow(i).blockers.map((b) => b.code);
    expect(codes({ ...ready, hasDate: false })).toContain("choose_date");
    expect(codes({ ...ready, accountSelected: false })).toContain("choose_account");
    expect(codes({ ...ready, requiresLink: true, linkSatisfied: false })).toContain("choose_agent");
    expect(
      codes({ ...ready, requiresLink: true, linkSatisfied: false, linkKind: "distributor" }),
    ).toContain("choose_distributor");
    expect(codes({ ...ready, duplicateRisk: true })).toContain("duplicate_collision");
  });

  it("permits manual agent selection even if the message party differs", () => {
    const input: ReadinessInput = {
      ...ready,
      requiresLink: true,
      linkSatisfied: true,
      linkCertain: true, // Manual selection is authoritative/certain
      recipientMismatch: false, // Should be false because it's manual
    };
    expect(rowReadiness(input)).toBe("READY");
    expect(evaluateRow(input).blockers).toHaveLength(0);
  });

  it("permits manual distributor selection even if no exact match was found", () => {
    const input: ReadinessInput = {
      ...ready,
      requiresLink: true,
      linkKind: "distributor",
      linkSatisfied: true,
      linkCertain: true,
    };
    expect(rowReadiness(input)).toBe("READY");
  });

  it("never shows the generic message when a precise reason exists", () => {
    const e = evaluateRow({ ...ready, hasDate: false });
    expect(e.blocker).toBe("Choose date");
    expect(e.blockers.map((b) => b.code)).not.toContain("needs_review");
  });
});
