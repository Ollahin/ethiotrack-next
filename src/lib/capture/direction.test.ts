import { describe, expect, it } from "vitest";
import { resolveDirection } from "./direction";
import { segmentSourceRecords } from "./segmentation";
import { buildCandidates } from "./candidate";

describe("direction engine", () => {
  it("reads 'transferred to your account' as incoming", () => {
    const v = resolveDirection(
      "Dear Customer, ETB 12,000.00 has been transferred to your account 1234 on 01/02/2026.",
    );
    expect(v.direction).toBe("in");
    expect(v.resolved).toBe(true);
  });

  it("reads 'you have transferred' as outgoing", () => {
    const v = resolveDirection("Dear Sir, You have transferred ETB 900.00 to ABC Trading.");
    expect(v.direction).toBe("out");
  });

  it("reads credited / debited clauses", () => {
    expect(resolveDirection("Your account has been credited with ETB 50.00").direction).toBe("in");
    expect(resolveDirection("Your account has been debited with ETB 50.00").direction).toBe("out");
  });

  it("never guesses when both roles appear", () => {
    const v = resolveDirection(
      "You have transferred ETB 100 and your account has been credited with ETB 100.",
    );
    expect(v.direction).toBe("unknown");
    expect(v.resolved).toBe(false);
    expect(v.conflicts.length).toBeGreaterThan(0);
  });

  it("stays unresolved without a grammatical role", () => {
    expect(resolveDirection("Balance ETB 400.00").resolved).toBe(false);
  });
});

describe("batch segmentation", () => {
  const sms = [
    "Dear Customer, ETB 5,000.00 has been transferred to your account 1234 by ALEMU KEBEDE on 01/02/2026. Ref FT26011ABCD.\nThank you for banking with us.\nhttps://receipt.example/FT26011ABCD",
    "Dear Customer, your account 1234 has been debited with ETB 2,000.00 on 01/02/2026. Ref FT26011EFGH.",
    "Dear Customer, ETB 750.00 has been transferred to your account 1234 by MARTA T on 02/02/2026. Ref FT26012IJKL.",
  ].join("\n");

  it("keeps footers and URLs inside their own message", () => {
    const records = segmentSourceRecords(sms);
    expect(records).toHaveLength(3);
    expect(records[0].raw).toContain("Thank you");
    expect(records[1].raw).toContain("FT26011EFGH");
  });

  it("preserves source order and repeated transactions", () => {
    const repeated = [
      "Dear Customer, ETB 100.00 has been transferred to your account 1234 by SAME SENDER on 01/02/2026. Ref A1.",
      "Dear Customer, ETB 100.00 has been transferred to your account 1234 by SAME SENDER on 01/02/2026. Ref A2.",
    ].join("\n\n");
    const records = segmentSourceRecords(repeated);
    expect(records).toHaveLength(2);
    expect(records[0].raw).toContain("A1");
    expect(records[1].raw).toContain("A2");
  });

  it("one malformed message does not discard the parsed ones", () => {
    const mixed = `${sms}\n\nDear Customer, ETB ??? something went wrong.`;
    const candidates = buildCandidates(mixed);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.filter((c) => c.direction !== "unknown").length).toBeGreaterThanOrEqual(3);
  });

  it("gives every candidate its own direction", () => {
    const candidates = buildCandidates(sms);
    expect(candidates.map((c) => c.direction)).toEqual(["in", "out", "in"]);
  });
});
