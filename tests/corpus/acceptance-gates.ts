// Deterministic acceptance gates for the sanitized-corpus parser evaluator.
//
// A "candidate" is any `ProductionBaseline`-shaped evaluator result: the frozen
// baseline, a fresh `runEvaluator()` run, or a synthetic result used in tests.
// Gates only read the candidate and the golden fixtures; they never call the
// production parser, never branch on a fixture id and never relax a threshold.

import {
  loadActiveFixtures,
  multisetIntersectionSize,
  normalizeAgentForComparison,
  readFixture,
  rowKey,
} from "./evaluator";
import type { ProductionBaseline, ProductionFixtureRecord } from "./schema";

export type GateName = "non_regression" | "release";

export type GateCategory =
  | "coverage"
  | "parser_error"
  | "ordering"
  | "duplicates"
  | "mj_row_recovery"
  | "reversal_sign"
  | "forbidden_agent"
  | "invented_date"
  | "refill_history";

export interface GateFailure {
  code: string;
  category: GateCategory;
  requirement: string;
  expected: string;
  measured: string;
}

export interface SignAnalysis {
  expectedNegativeRows: number;
  actualNegativeRows: number;
  matchedExpectedNegativeRows: number;
  missedExpectedNegativeRows: number;
  unexpectedActualNegativeRows: number;
}

export interface FamilyMeasurements {
  fixtureCount: number;
  expectedRows: number;
  actualRows: number;
  exactRowMatches: number;
  missingRows: number;
  unexpectedRows: number;
  forbiddenAgentHits: number;
  inventedDateRows: number;
  exactFixtureCount: number;
  orderedFixtureCount: number;
  sign: SignAnalysis;
}

export interface GateMeasurements {
  fixtureCount: number;
  expectedRows: number;
  actualRows: number;
  exactRowMatches: number;
  missingRows: number;
  unexpectedRows: number;
  forbiddenAgentHits: number;
  inventedDateRows: number;
  exactFixtureCount: number;
  orderedFixtureCount: number;
  executionErrorFixtures: number;
  hiddenErrorFixtures: number;
  orderingViolationFixtures: number;
  duplicateCollapseFixtures: number;
  sign: SignAnalysis;
  mj: FamilyMeasurements;
  refill: FamilyMeasurements;
}

export interface GateResult {
  gate: GateName;
  passed: boolean;
  failures: GateFailure[];
  measured: GateMeasurements;
}

/** Expected rows per active fixture id, loaded once from the golden fixtures. */
function loadExpectedRowsById(): Map<
  string,
  { agentText: string; signedAmountMinor: number; date: string | null }[]
> {
  const map = new Map<
    string,
    { agentText: string; signedAmountMinor: number; date: string | null }[]
  >();
  for (const entry of loadActiveFixtures()) {
    const { expected } = readFixture(entry);
    map.set(
      entry.id,
      expected.expectedRows.map((r) => ({
        agentText: r.agentText,
        signedAmountMinor: r.signedAmountMinor,
        date: r.date,
      })),
    );
  }
  return map;
}

function emptySign(): SignAnalysis {
  return {
    expectedNegativeRows: 0,
    actualNegativeRows: 0,
    matchedExpectedNegativeRows: 0,
    missedExpectedNegativeRows: 0,
    unexpectedActualNegativeRows: 0,
  };
}

function addSign(a: SignAnalysis, b: SignAnalysis): SignAnalysis {
  return {
    expectedNegativeRows: a.expectedNegativeRows + b.expectedNegativeRows,
    actualNegativeRows: a.actualNegativeRows + b.actualNegativeRows,
    matchedExpectedNegativeRows: a.matchedExpectedNegativeRows + b.matchedExpectedNegativeRows,
    missedExpectedNegativeRows: a.missedExpectedNegativeRows + b.missedExpectedNegativeRows,
    unexpectedActualNegativeRows: a.unexpectedActualNegativeRows + b.unexpectedActualNegativeRows,
  };
}

/**
 * Exact multiset sign analysis for one fixture. A negative expected row counts
 * as matched only when an emitted row carries the identical
 * (agent, signed amount, date) identity. No fuzzy matching, no netting and no
 * deduplication is applied.
 */
export function analyzeFixtureSigns(
  fixture: ProductionFixtureRecord,
  expectedRows: { agentText: string; signedAmountMinor: number; date: string | null }[],
): SignAnalysis {
  const expectedNegative = expectedRows.filter((r) => r.signedAmountMinor < 0);
  const actualNegative = fixture.actualRows.filter(
    (r) => r.signedAmountMinor !== null && r.signedAmountMinor < 0,
  );
  const matched = multisetIntersectionSize(
    expectedNegative.map((r) =>
      rowKey({
        agentText: r.agentText,
        signedAmountMinor: r.signedAmountMinor,
        date: r.date,
      }),
    ),
    actualNegative.map(rowKey),
  );
  return {
    expectedNegativeRows: expectedNegative.length,
    actualNegativeRows: actualNegative.length,
    matchedExpectedNegativeRows: matched,
    missedExpectedNegativeRows: expectedNegative.length - matched,
    unexpectedActualNegativeRows: actualNegative.length - matched,
  };
}

/**
 * True when the fixture emitted every expected row (missingRows === 0) but
 * collapsed a legitimately repeated visible row into fewer emitted copies.
 */
function collapsesDuplicates(
  fixture: ProductionFixtureRecord,
  expectedRows: { agentText: string; signedAmountMinor: number; date: string | null }[],
): boolean {
  if (fixture.missingRows !== 0) return false;
  const counts = new Map<string, number>();
  for (const r of expectedRows) {
    const key = rowKey({
      agentText: r.agentText,
      signedAmountMinor: r.signedAmountMinor,
      date: r.date,
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const actualCounts = new Map<string, number>();
  for (const r of fixture.actualRows) {
    const key = rowKey(r);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }
  for (const [key, want] of counts) {
    if ((actualCounts.get(key) ?? 0) < want) return true;
  }
  return false;
}

function violatesOrdering(fixture: ProductionFixtureRecord): boolean {
  const contiguous = fixture.actualRows.every((r, i) => r.emittedOrder === i);
  if (!contiguous) return true;
  if (fixture.actualRowCount !== fixture.actualRows.length) return true;
  // A fixture with no missing and no unexpected row must also be in order.
  if (fixture.missingRows === 0 && fixture.unexpectedRows === 0 && !fixture.exactOrderedSequence) {
    return true;
  }
  return false;
}

function hidesError(fixture: ProductionFixtureRecord): boolean {
  if (fixture.executionStatus === "error") {
    // An errored fixture may not be reported as if it had produced results.
    return fixture.errorCode === null || fixture.exactRowMatches > 0;
  }
  return fixture.errorCode !== null;
}

function measureFamily(
  fixtures: ProductionFixtureRecord[],
  expectedById: Map<
    string,
    { agentText: string; signedAmountMinor: number; date: string | null }[]
  >,
): FamilyMeasurements {
  const sum = (pick: (f: ProductionFixtureRecord) => number) =>
    fixtures.reduce((acc, f) => acc + pick(f), 0);
  return {
    fixtureCount: fixtures.length,
    expectedRows: sum((f) => f.expectedRowCount),
    actualRows: sum((f) => f.actualRowCount),
    exactRowMatches: sum((f) => f.exactRowMatches),
    missingRows: sum((f) => f.missingRows),
    unexpectedRows: sum((f) => f.unexpectedRows),
    forbiddenAgentHits: sum((f) => f.forbiddenAgentHits),
    inventedDateRows: sum((f) => f.inventedDateRows),
    exactFixtureCount: fixtures.filter(
      (f) => f.exactOrderedSequence && f.missingRows === 0 && f.unexpectedRows === 0,
    ).length,
    orderedFixtureCount: fixtures.filter((f) => f.exactOrderedSequence).length,
    sign: fixtures.reduce(
      (acc, f) => addSign(acc, analyzeFixtureSigns(f, expectedById.get(f.fixtureId) ?? [])),
      emptySign(),
    ),
  };
}

/**
 * Every gate number is derived from the fixture records, never copied from the
 * candidate's own `summary` block.
 */
export function measureCandidate(candidate: ProductionBaseline): GateMeasurements {
  const expectedById = loadExpectedRowsById();
  const all = candidate.fixtures;
  const mj = measureFamily(
    all.filter((f) => f.sourceFamily === "mj_transfers_sent"),
    expectedById,
  );
  const refill = measureFamily(
    all.filter((f) => f.sourceFamily === "refill_history"),
    expectedById,
  );
  const total = measureFamily(all, expectedById);
  return {
    fixtureCount: total.fixtureCount,
    expectedRows: total.expectedRows,
    actualRows: total.actualRows,
    exactRowMatches: total.exactRowMatches,
    missingRows: total.missingRows,
    unexpectedRows: total.unexpectedRows,
    forbiddenAgentHits: total.forbiddenAgentHits,
    inventedDateRows: total.inventedDateRows,
    exactFixtureCount: total.exactFixtureCount,
    orderedFixtureCount: total.orderedFixtureCount,
    executionErrorFixtures: all.filter((f) => f.executionStatus === "error").length,
    hiddenErrorFixtures: all.filter(hidesError).length,
    orderingViolationFixtures: all.filter(violatesOrdering).length,
    duplicateCollapseFixtures: all.filter((f) =>
      collapsesDuplicates(f, expectedById.get(f.fixtureId) ?? []),
    ).length,
    sign: total.sign,
    mj,
    refill,
  };
}

/** Convenience re-export so callers can read sign totals without a gate run. */
export function analyzeSigns(candidate: ProductionBaseline): SignAnalysis {
  return measureCandidate(candidate).sign;
}

interface Check {
  code: string;
  category: GateCategory;
  requirement: string;
  expected: string;
  measured: number | string | boolean;
  ok: boolean;
}

function collect(checks: Check[]): GateFailure[] {
  return checks
    .filter((c) => !c.ok)
    .map((c) => ({
      code: c.code,
      category: c.category,
      requirement: c.requirement,
      expected: c.expected,
      measured: String(c.measured),
    }));
}

/** Frozen non-regression floor. A future parser must never fall below it. */
export const NON_REGRESSION_LIMITS = {
  fixtureCount: 9,
  expectedRows: 56,
  refill: {
    exactRowMatches: 26,
    actualRows: 26,
    missingRows: 0,
    unexpectedRows: 0,
    exactFixtureCount: 3,
    negativeRows: 0,
    forbiddenAgentHits: 0,
    inventedDateRows: 0,
  },
  // Ratcheted in task 0.3B-d: MJ parsing now runs through the deterministic
  // amount-anchored reconstruction and reproduces all 30 MJ rows exactly.
  mj: {
    minExactRowMatches: 30,
    maxMissingRows: 0,
    maxUnexpectedRows: 0,
    maxForbiddenAgentHits: 0,
    inventedDateRows: 0,
  },
} as const;

/** Release target. The corpus must be parsed exactly, including reversals. */
export const RELEASE_TARGETS = {
  exactFixtureCount: 9,
  exactRowMatches: 56,
  actualRows: 56,
  missingRows: 0,
  unexpectedRows: 0,
  matchedExpectedNegativeRows: 2,
  unexpectedActualNegativeRows: 0,
  forbiddenAgentHits: 0,
  inventedDateRows: 0,
  orderedFixtureCount: 9,
  refillExactRowMatches: 26,
  mjExactRowMatches: 30,
} as const;

export function evaluateNonRegressionGate(candidate: ProductionBaseline): GateResult {
  const m = measureCandidate(candidate);
  const L = NON_REGRESSION_LIMITS;
  const checks: Check[] = [
    {
      code: "non_regression.coverage.fixtureCount",
      category: "coverage",
      requirement: "all nine active fixtures are evaluated",
      expected: `= ${L.fixtureCount}`,
      measured: m.fixtureCount,
      ok: m.fixtureCount === L.fixtureCount,
    },
    {
      code: "non_regression.coverage.expectedRows",
      category: "coverage",
      requirement: "all 56 expected rows are represented",
      expected: `= ${L.expectedRows}`,
      measured: m.expectedRows,
      ok: m.expectedRows === L.expectedRows,
    },
    {
      code: "non_regression.refill.exactRowMatches",
      category: "refill_history",
      requirement: "Refill History stays fully exact",
      expected: `= ${L.refill.exactRowMatches}`,
      measured: m.refill.exactRowMatches,
      ok: m.refill.exactRowMatches === L.refill.exactRowMatches,
    },
    {
      code: "non_regression.refill.actualRows",
      category: "refill_history",
      requirement: "Refill History emits 26 rows",
      expected: `= ${L.refill.actualRows}`,
      measured: m.refill.actualRows,
      ok: m.refill.actualRows === L.refill.actualRows,
    },
    {
      code: "non_regression.refill.missingRows",
      category: "refill_history",
      requirement: "Refill History loses no row",
      expected: `= 0`,
      measured: m.refill.missingRows,
      ok: m.refill.missingRows === L.refill.missingRows,
    },
    {
      code: "non_regression.refill.unexpectedRows",
      category: "refill_history",
      requirement: "Refill History invents no row",
      expected: `= 0`,
      measured: m.refill.unexpectedRows,
      ok: m.refill.unexpectedRows === L.refill.unexpectedRows,
    },
    {
      code: "non_regression.refill.exactFixtureCount",
      category: "refill_history",
      requirement: "all three Refill History fixtures stay exact and ordered",
      expected: `= 3`,
      measured: m.refill.exactFixtureCount,
      ok: m.refill.exactFixtureCount === L.refill.exactFixtureCount,
    },
    {
      code: "non_regression.refill.negativeRows",
      category: "reversal_sign",
      requirement: "Refill History emits no negative row",
      expected: `= 0`,
      measured: m.refill.sign.actualNegativeRows,
      ok: m.refill.sign.actualNegativeRows === L.refill.negativeRows,
    },
    {
      code: "non_regression.refill.forbiddenAgentHits",
      category: "forbidden_agent",
      requirement: "Refill History emits no forbidden agent",
      expected: `= 0`,
      measured: m.refill.forbiddenAgentHits,
      ok: m.refill.forbiddenAgentHits === L.refill.forbiddenAgentHits,
    },
    {
      code: "non_regression.refill.inventedDateRows",
      category: "invented_date",
      requirement: "Refill History invents no date",
      expected: `= 0`,
      measured: m.refill.inventedDateRows,
      ok: m.refill.inventedDateRows === L.refill.inventedDateRows,
    },
    {
      code: "non_regression.mj.exactRowMatches",
      category: "mj_row_recovery",
      requirement: "MJ exact row matches do not fall below the frozen baseline",
      expected: `>= ${L.mj.minExactRowMatches}`,
      measured: m.mj.exactRowMatches,
      ok: m.mj.exactRowMatches >= L.mj.minExactRowMatches,
    },
    {
      code: "non_regression.mj.missingRows",
      category: "mj_row_recovery",
      requirement: "MJ missing rows do not grow",
      expected: `<= ${L.mj.maxMissingRows}`,
      measured: m.mj.missingRows,
      ok: m.mj.missingRows <= L.mj.maxMissingRows,
    },
    {
      code: "non_regression.mj.unexpectedRows",
      category: "mj_row_recovery",
      requirement: "MJ unexpected rows do not grow",
      expected: `<= ${L.mj.maxUnexpectedRows}`,
      measured: m.mj.unexpectedRows,
      ok: m.mj.unexpectedRows <= L.mj.maxUnexpectedRows,
    },
    {
      code: "non_regression.mj.forbiddenAgentHits",
      category: "forbidden_agent",
      requirement: "MJ forbidden-agent hits do not grow",
      expected: `<= ${L.mj.maxForbiddenAgentHits}`,
      measured: m.mj.forbiddenAgentHits,
      ok: m.mj.forbiddenAgentHits <= L.mj.maxForbiddenAgentHits,
    },
    {
      code: "non_regression.mj.inventedDateRows",
      category: "invented_date",
      requirement: "MJ invents no date",
      expected: `= 0`,
      measured: m.mj.inventedDateRows,
      ok: m.mj.inventedDateRows === L.mj.inventedDateRows,
    },
    {
      code: "non_regression.duplicates.preserved",
      category: "duplicates",
      requirement: "repeated visible transactions are never collapsed",
      expected: `= 0 fixtures`,
      measured: m.duplicateCollapseFixtures,
      ok: m.duplicateCollapseFixtures === 0,
    },
    {
      code: "non_regression.ordering.preserved",
      category: "ordering",
      requirement: "emitted row ordering is contiguous and preserved",
      expected: `= 0 fixtures`,
      measured: m.orderingViolationFixtures,
      ok: m.orderingViolationFixtures === 0,
    },
    {
      code: "non_regression.errors.notHidden",
      category: "parser_error",
      requirement: "parser errors are recorded, never hidden",
      expected: `= 0 fixtures`,
      measured: m.hiddenErrorFixtures,
      ok: m.hiddenErrorFixtures === 0,
    },
  ];
  const failures = collect(checks);
  return { gate: "non_regression", passed: failures.length === 0, failures, measured: m };
}

export function evaluateReleaseGate(candidate: ProductionBaseline): GateResult {
  const m = measureCandidate(candidate);
  const T = RELEASE_TARGETS;
  const checks: Check[] = [
    {
      code: "release.fixtures.exactFixtureCount",
      category: "coverage",
      requirement: "every fixture is parsed exactly",
      expected: `= ${T.exactFixtureCount}`,
      measured: m.exactFixtureCount,
      ok: m.exactFixtureCount === T.exactFixtureCount,
    },
    {
      code: "release.rows.exactRowMatches",
      category: "mj_row_recovery",
      requirement: "all 56 expected rows match exactly",
      expected: `= ${T.exactRowMatches}`,
      measured: m.exactRowMatches,
      ok: m.exactRowMatches === T.exactRowMatches,
    },
    {
      code: "release.rows.actualRows",
      category: "mj_row_recovery",
      requirement: "exactly 56 rows are emitted",
      expected: `= ${T.actualRows}`,
      measured: m.actualRows,
      ok: m.actualRows === T.actualRows,
    },
    {
      code: "release.rows.missingRows",
      category: "mj_row_recovery",
      requirement: "no expected row is missing",
      expected: `= 0`,
      measured: m.missingRows,
      ok: m.missingRows === T.missingRows,
    },
    {
      code: "release.rows.unexpectedRows",
      category: "mj_row_recovery",
      requirement: "no unexpected row is emitted",
      expected: `= 0`,
      measured: m.unexpectedRows,
      ok: m.unexpectedRows === T.unexpectedRows,
    },
    {
      code: "release.mj.exactRowMatches",
      category: "mj_row_recovery",
      requirement: "MJ reaches 30 / 30 exact rows",
      expected: `= ${T.mjExactRowMatches}`,
      measured: m.mj.exactRowMatches,
      ok: m.mj.exactRowMatches === T.mjExactRowMatches,
    },
    {
      code: "release.refill.exactRowMatches",
      category: "refill_history",
      requirement: "Refill History remains 26 / 26 exact rows",
      expected: `= ${T.refillExactRowMatches}`,
      measured: m.refill.exactRowMatches,
      ok: m.refill.exactRowMatches === T.refillExactRowMatches,
    },
    {
      code: "release.reversals.matchedNegativeRows",
      category: "reversal_sign",
      requirement: "both confirmed reversals match with the correct negative sign",
      expected: `= ${T.matchedExpectedNegativeRows}`,
      measured: m.sign.matchedExpectedNegativeRows,
      ok: m.sign.matchedExpectedNegativeRows === T.matchedExpectedNegativeRows,
    },
    {
      code: "release.reversals.falseNegativeRows",
      category: "reversal_sign",
      requirement: "OCR sign noise never produces a negative row",
      expected: `= 0`,
      measured: m.sign.unexpectedActualNegativeRows,
      ok: m.sign.unexpectedActualNegativeRows === T.unexpectedActualNegativeRows,
    },
    {
      code: "release.agents.forbiddenAgentHits",
      category: "forbidden_agent",
      requirement: "no account-label or handle noise enters the agent slot",
      expected: `= 0`,
      measured: m.forbiddenAgentHits,
      ok: m.forbiddenAgentHits === T.forbiddenAgentHits,
    },
    {
      code: "release.dates.inventedDateRows",
      category: "invented_date",
      requirement: "no date is invented",
      expected: `= 0`,
      measured: m.inventedDateRows,
      ok: m.inventedDateRows === T.inventedDateRows,
    },
    {
      code: "release.ordering.exactOrderedSequence",
      category: "ordering",
      requirement: "every fixture reproduces the exact ordered sequence",
      expected: `= ${T.orderedFixtureCount}`,
      measured: m.orderedFixtureCount,
      ok: m.orderedFixtureCount === T.orderedFixtureCount,
    },
    {
      code: "release.duplicates.preserved",
      category: "duplicates",
      requirement: "repeated visible transactions are never collapsed",
      expected: `= 0 fixtures`,
      measured: m.duplicateCollapseFixtures,
      ok: m.duplicateCollapseFixtures === 0,
    },
    {
      code: "release.errors.none",
      category: "parser_error",
      requirement: "no fixture errors and no error is hidden",
      expected: `= 0 fixtures`,
      measured: m.executionErrorFixtures + m.hiddenErrorFixtures,
      ok: m.executionErrorFixtures === 0 && m.hiddenErrorFixtures === 0,
    },
  ];
  const failures = collect(checks);
  return { gate: "release", passed: failures.length === 0, failures, measured: m };
}

/** Both gates for one candidate. */
export function evaluateGates(candidate: ProductionBaseline): {
  nonRegression: GateResult;
  release: GateResult;
} {
  return {
    nonRegression: evaluateNonRegressionGate(candidate),
    release: evaluateReleaseGate(candidate),
  };
}

/** Kept exported so report tooling shares the evaluator's agent normalization. */
export { normalizeAgentForComparison };
