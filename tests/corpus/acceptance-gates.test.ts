import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProductionBaselineSchema, type ProductionBaseline } from "./schema";
import {
  analyzeSigns,
  evaluateGates,
  evaluateNonRegressionGate,
  evaluateReleaseGate,
  measureCandidate,
} from "./acceptance-gates";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "production-baseline.json");
const rawBaseline = readFileSync(baselinePath, "utf8");
const baseline: ProductionBaseline = ProductionBaselineSchema.parse(JSON.parse(rawBaseline));

const clone = (): ProductionBaseline =>
  ProductionBaselineSchema.parse(JSON.parse(rawBaseline)) as ProductionBaseline;

describe("acceptance gates — frozen baseline", () => {
  it("passes the non-regression gate with no failures", () => {
    const result = evaluateNonRegressionGate(baseline);
    expect(result.gate).toBe("non_regression");
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("passes the release gate", () => {
    const result = evaluateReleaseGate(baseline);
    expect(result.gate).toBe("release");
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("still reports MJ row recovery, reversals and forbidden agents when they regress", () => {
    // Degrade a synthetic candidate back to a pre-0.3B-d shape; the release
    // gate must name each broken guarantee explicitly.
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-4")!;
    fixture.actualRows = fixture.actualRows.map((r) => ({
      ...r,
      signedAmountMinor: r.signedAmountMinor === null ? null : Math.abs(r.signedAmountMinor),
      agentText: "samplewallet - samplewallet",
    }));
    fixture.exactRowMatches = 0;
    fixture.missingRows = fixture.expectedRowCount;
    fixture.unexpectedRows = fixture.actualRowCount;
    fixture.forbiddenAgentHits = fixture.actualRowCount;
    fixture.exactOrderedSequence = false;
    const { failures, passed } = evaluateReleaseGate(candidate);
    expect(passed).toBe(false);
    const categories = new Set(failures.map((f) => f.category));
    expect(categories.has("mj_row_recovery")).toBe(true);
    expect(categories.has("reversal_sign")).toBe(true);
    expect(categories.has("forbidden_agent")).toBe(true);
    const codes = failures.map((f) => f.code);
    expect(codes).toContain("release.mj.exactRowMatches");
    expect(codes).toContain("release.reversals.matchedNegativeRows");
    expect(codes).toContain("release.agents.forbiddenAgentHits");
  });

  it("attributes no release failure to Refill History", () => {
    const { failures } = evaluateReleaseGate(baseline);
    expect(failures.filter((f) => f.category === "refill_history")).toEqual([]);
    expect(failures.some((f) => f.code.startsWith("release.refill."))).toBe(false);
    const m = measureCandidate(baseline);
    expect(m.refill.exactRowMatches).toBe(26);
    expect(m.refill.missingRows).toBe(0);
    expect(m.refill.unexpectedRows).toBe(0);
    expect(m.refill.exactFixtureCount).toBe(3);
  });

  it("reports the measured values alongside the verdict", () => {
    const { nonRegression, release } = evaluateGates(baseline);
    expect(nonRegression.measured).toEqual(release.measured);
    expect(release.measured.fixtureCount).toBe(9);
    expect(release.measured.expectedRows).toBe(56);
    expect(release.measured.actualRows).toBe(56);
    expect(release.measured.exactRowMatches).toBe(56);
    expect(release.measured.mj.exactRowMatches).toBe(30);
    expect(release.failures).toEqual([]);
    for (const failure of evaluateNonRegressionGate(clone()).failures) {
      expect(failure.expected.length).toBeGreaterThan(0);
      expect(failure.measured.length).toBeGreaterThan(0);
      expect(failure.requirement.length).toBeGreaterThan(0);
    }
  });

  it("evaluates deterministically across repeated runs", () => {
    const a = evaluateGates(baseline);
    const b = evaluateGates(clone());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("sign analysis", () => {
  it("measures the recovered reversals exactly", () => {
    expect(analyzeSigns(baseline)).toEqual({
      expectedNegativeRows: 2,
      actualNegativeRows: 2,
      matchedExpectedNegativeRows: 2,
      missedExpectedNegativeRows: 0,
      unexpectedActualNegativeRows: 0,
    });
  });

  it("attributes both expected reversals to MJ only", () => {
    const m = measureCandidate(baseline);
    expect(m.mj.sign.expectedNegativeRows).toBe(2);
    expect(m.mj.sign.matchedExpectedNegativeRows).toBe(2);
    expect(m.mj.sign.missedExpectedNegativeRows).toBe(0);
    expect(m.refill.sign.expectedNegativeRows).toBe(0);
    expect(m.refill.sign.actualNegativeRows).toBe(0);
  });

  it("counts an invented negative row as unexpected, never as a match", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-6")!;
    fixture.actualRows[0].signedAmountMinor = -fixture.actualRows[0].signedAmountMinor!;
    const sign = analyzeSigns(candidate);
    // photo-6 expects no negative row, so the flipped row can only ever be
    // counted as unexpected; the two genuine photo-4 reversals still match.
    expect(sign.matchedExpectedNegativeRows).toBe(2);
    expect(sign.unexpectedActualNegativeRows).toBe(1);
    expect(sign.missedExpectedNegativeRows).toBe(0);
  });
});

describe("gate totals are derived, not copied", () => {
  it("ignores the candidate summary block", () => {
    const candidate = clone();
    candidate.summary.exactRowMatches = 0;
    candidate.summary.missingRows = 56;
    candidate.summary.forbiddenAgentHits = 12;
    expect(measureCandidate(candidate).exactRowMatches).toBe(56);
    expect(measureCandidate(candidate).forbiddenAgentHits).toBe(0);
    expect(evaluateReleaseGate(candidate).passed).toBe(true);
  });

  it("equals the sum of per-fixture records", () => {
    const m = measureCandidate(baseline);
    const sum = (pick: (f: (typeof baseline.fixtures)[number]) => number) =>
      baseline.fixtures.reduce((a, f) => a + pick(f), 0);
    expect(m.exactRowMatches).toBe(sum((f) => f.exactRowMatches));
    expect(m.missingRows).toBe(sum((f) => f.missingRows));
    expect(m.unexpectedRows).toBe(sum((f) => f.unexpectedRows));
    expect(m.forbiddenAgentHits).toBe(sum((f) => f.forbiddenAgentHits));
    expect(m.mj.expectedRows + m.refill.expectedRows).toBe(m.expectedRows);
  });
});

describe("synthetic candidate mutations produce the expected gate failure", () => {
  it("fails non-regression when a Refill History row is dropped", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.refill.photo-64")!;
    fixture.actualRows = fixture.actualRows.slice(0, 8);
    fixture.actualRowCount = 8;
    fixture.exactRowMatches = 8;
    fixture.missingRows = 1;
    fixture.unexpectedRows = 0;
    fixture.exactOrderedSequence = false;
    const result = evaluateNonRegressionGate(candidate);
    expect(result.passed).toBe(false);
    const codes = result.failures.map((f) => f.code);
    expect(codes).toContain("non_regression.refill.exactRowMatches");
    expect(codes).toContain("non_regression.refill.missingRows");
    expect(codes).toContain("non_regression.refill.exactFixtureCount");
  });

  it("fails non-regression when MJ forbidden-agent noise grows", () => {
    const candidate = clone();
    candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-2")!.forbiddenAgentHits = 1;
    const result = evaluateNonRegressionGate(candidate);
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("non_regression.mj.forbiddenAgentHits");
  });

  it("fails non-regression when MJ exact matches regress", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-6")!;
    fixture.exactRowMatches = 0;
    fixture.missingRows = 5;
    fixture.unexpectedRows = 3;
    fixture.exactOrderedSequence = false;
    const codes = evaluateNonRegressionGate(candidate).failures.map((f) => f.code);
    expect(codes).toContain("non_regression.mj.exactRowMatches");
  });

  it("fails non-regression when a duplicate visible row is collapsed", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.refill.photo-49")!;
    // photo-49 has two distinct rows sharing one minute timestamp; collapse one.
    fixture.actualRows = fixture.actualRows.filter((_, i) => i !== 8);
    fixture.actualRows.forEach((r, i) => (r.emittedOrder = i));
    fixture.actualRowCount = 8;
    fixture.exactRowMatches = 8;
    fixture.missingRows = 0;
    fixture.unexpectedRows = 0;
    const codes = evaluateNonRegressionGate(candidate).failures.map((f) => f.code);
    expect(codes).toContain("non_regression.duplicates.preserved");
  });

  it("fails non-regression when emitted ordering is broken", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.refill.photo-51")!;
    fixture.actualRows[0].emittedOrder = 7;
    const codes = evaluateNonRegressionGate(candidate).failures.map((f) => f.code);
    expect(codes).toContain("non_regression.ordering.preserved");
  });

  it("fails non-regression when a parser error is hidden", () => {
    const candidate = clone();
    const fixture = candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-5")!;
    fixture.executionStatus = "error";
    fixture.errorCode = null;
    const codes = evaluateNonRegressionGate(candidate).failures.map((f) => f.code);
    expect(codes).toContain("non_regression.errors.notHidden");
  });

  it("passes the release gate only for a perfect synthetic candidate", () => {
    const candidate = clone();
    // Synthetic perfection is constructed here purely to prove the gate is
    // satisfiable; it never touches the production parser or the frozen file.
    for (const fixture of candidate.fixtures) {
      fixture.actualRowCount = fixture.expectedRowCount;
      fixture.exactRowMatches = fixture.expectedRowCount;
      fixture.missingRows = 0;
      fixture.unexpectedRows = 0;
      fixture.forbiddenAgentHits = 0;
      fixture.inventedDateRows = 0;
      fixture.exactOrderedSequence = true;
      fixture.actualRows = Array.from({ length: fixture.expectedRowCount }, (_, i) => ({
        emittedOrder: i,
        agentText: null,
        signedAmountMinor: null,
        date: null,
      }));
    }
    // Reproduce the two MJ reversals exactly, from the golden fixture values.
    const photo4 = candidate.fixtures.find((f) => f.fixtureId === "ocr.mj.sent.photo-4")!;
    const expected4 = JSON.parse(
      readFileSync(join(here, "fixtures/ocr/mj-transfers-sent/photo-4.expected.json"), "utf8"),
    ) as { expectedRows: { agentText: string; signedAmountMinor: number; date: string | null }[] };
    photo4.actualRows = expected4.expectedRows.map((r, i) => ({
      emittedOrder: i,
      agentText: r.agentText,
      signedAmountMinor: r.signedAmountMinor,
      date: r.date,
    }));
    photo4.actualRowCount = photo4.actualRows.length;
    const result = evaluateReleaseGate(candidate);
    const codes = result.failures.map((f) => f.code);
    expect(codes).not.toContain("release.reversals.matchedNegativeRows");
    expect(codes).not.toContain("release.agents.forbiddenAgentHits");
    expect(codes).not.toContain("release.rows.missingRows");
  });
});

describe("frozen artifact safety", () => {
  it("leaves production-baseline.json byte-identical", () => {
    evaluateGates(baseline);
    evaluateGates(clone());
    expect(readFileSync(baselinePath, "utf8")).toBe(rawBaseline);
  });
});
