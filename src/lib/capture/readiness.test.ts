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
};

describe("duplicate-risk gate", () => {
  it("holds a colliding row at NEEDS_ATTENTION until it is confirmed", () => {
    expect(rowReadiness({ ...ready, duplicateRisk: true })).toBe("NEEDS_ATTENTION");
    expect(
      rowReadiness({ ...ready, duplicateRisk: true, duplicateRiskAcknowledged: true }),
    ).toBe("READY");
  });

  it("never asks about duplicates for an ordinary unique message", () => {
    expect(evaluateRow(ready)).toEqual({ state: "READY", blocker: null, canImport: true });
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
