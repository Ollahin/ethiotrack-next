import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProductionBaselineSchema, type ProductionBaseline } from "./schema";
import { loadActiveFixtures, runEvaluator } from "./evaluator";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const rawBaseline = readFileSync(join(here, "production-baseline.json"), "utf8");
const baseline: ProductionBaseline = ProductionBaselineSchema.parse(JSON.parse(rawBaseline));

const first = runEvaluator();
const second = runEvaluator();

describe("frozen production-parser baseline", () => {
  it("passes its strict schema", () => {
    expect(() => ProductionBaselineSchema.parse(JSON.parse(rawBaseline))).not.toThrow();
  });

  it("contains no timestamp, path, git identity or stack trace", () => {
    expect(rawBaseline).not.toMatch(/generatedAt|timestamp/i);
    expect(rawBaseline).not.toMatch(/\/(home|Users|dev-server|tmp)\//);
    expect(rawBaseline).not.toMatch(/\bat\s+\w+\s+\(/);
    expect(rawBaseline).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("lists all nine active fixtures exactly once", () => {
    const activeIds = loadActiveFixtures().map((e) => e.id);
    expect(activeIds.length).toBe(9);
    const ids = baseline.fixtures.map((f) => f.fixtureId);
    expect(ids.length).toBe(9);
    expect(new Set(ids).size).toBe(9);
    expect([...ids].sort()).toEqual([...activeIds].sort());
  });

  it("represents all 56 expected corpus rows", () => {
    expect(baseline.summary.expectedRows).toBe(56);
    expect(baseline.fixtures.reduce((a, f) => a + f.expectedRowCount, 0)).toBe(56);
  });

  it("matches the current evaluator output exactly", () => {
    expect(first).toEqual(baseline);
  });

  it("is deterministic across two consecutive runs", () => {
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("summary values equal the sum of fixture values", () => {
    const sum = (pick: (f: (typeof baseline.fixtures)[number]) => number) =>
      baseline.fixtures.reduce((a, f) => a + pick(f), 0);
    expect(baseline.summary.fixtureCount).toBe(baseline.fixtures.length);
    expect(baseline.summary.actualRows).toBe(sum((f) => f.actualRowCount));
    expect(baseline.summary.exactRowMatches).toBe(sum((f) => f.exactRowMatches));
    expect(baseline.summary.missingRows).toBe(sum((f) => f.missingRows));
    expect(baseline.summary.unexpectedRows).toBe(sum((f) => f.unexpectedRows));
    expect(baseline.summary.expectedNegativeRows).toBe(sum((f) => f.expectedNegativeRows));
    expect(baseline.summary.actualNegativeRows).toBe(sum((f) => f.actualNegativeRows));
    expect(baseline.summary.forbiddenAgentHits).toBe(sum((f) => f.forbiddenAgentHits));
    expect(baseline.summary.inventedDateRows).toBe(sum((f) => f.inventedDateRows));
    expect(baseline.summary.exactFixtureCount).toBe(
      baseline.fixtures.filter(
        (f) => f.exactOrderedSequence && f.missingRows === 0 && f.unexpectedRows === 0,
      ).length,
    );
  });

  for (const fixture of baseline.fixtures) {
    describe(fixture.fixtureId, () => {
      it("uses a real production adapter, never a fixture-specific rule", () => {
        expect(fixture.adapterId).toMatch(/^parseStatementText\(text,'(mj|alami)'\)$/);
        expect(fixture.adapterId).not.toContain(fixture.fixtureId);
      });

      it("keeps missingRows and unexpectedRows algebraically consistent", () => {
        expect(fixture.missingRows).toBe(fixture.expectedRowCount - fixture.exactRowMatches);
        expect(fixture.unexpectedRows).toBe(fixture.actualRowCount - fixture.exactRowMatches);
      });

      it("emits a contiguous zero-based order", () => {
        expect(fixture.actualRows.map((r) => r.emittedOrder)).toEqual(
          fixture.actualRows.map((_, i) => i),
        );
        expect(fixture.actualRowCount).toBe(fixture.actualRows.length);
      });

      it("records the parser result even when it performs badly", () => {
        // No fixture may be silently dropped or capped to look better.
        expect(fixture.executionStatus).toBe("ok");
        expect(fixture.exactRowMatches).toBeLessThanOrEqual(fixture.expectedRowCount);
        expect(fixture.exactRowMatches).toBeLessThanOrEqual(fixture.actualRowCount);
      });
    });
  }

  it("counts duplicate legitimate rows through multiset comparison", () => {
    // photo-49 legitimately repeats agents and shares one minute timestamp
    // across two distinct rows; both must remain countable.
    const refill49 = baseline.fixtures.find((f) => f.fixtureId === "ocr.refill.photo-49");
    expect(refill49).toBeDefined();
    const sameMinute = refill49!.actualRows.filter((r) => r.date === "2026-08-09T16:50");
    expect(sameMinute.length).toBe(2);
    expect(refill49!.exactRowMatches).toBe(9);
  });

  it("does not net or deduplicate repeated MJ rows", () => {
    const mj = baseline.fixtures.filter((f) => f.sourceFamily === "mj_transfers_sent");
    for (const f of mj) {
      expect(f.actualRows.every((r) => r.signedAmountMinor !== 0)).toBe(true);
    }
  });

  it("does not write production results back into the corpus fixtures", () => {
    for (const entry of loadActiveFixtures()) {
      const rawBefore = readFileSync(join(repoRoot, entry.rawFixturePath as string), "utf8");
      const expectedBefore = readFileSync(
        join(repoRoot, entry.expectedFixturePath as string),
        "utf8",
      );
      runEvaluator();
      expect(readFileSync(join(repoRoot, entry.rawFixturePath as string), "utf8")).toBe(rawBefore);
      expect(readFileSync(join(repoRoot, entry.expectedFixturePath as string), "utf8")).toBe(
        expectedBefore,
      );
    }
  });

  it("leaves the frozen baseline file untouched when tests run", () => {
    expect(readFileSync(join(here, "production-baseline.json"), "utf8")).toBe(rawBaseline);
  });
});
