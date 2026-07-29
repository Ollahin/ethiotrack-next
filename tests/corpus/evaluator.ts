// Deterministic production-parser evaluator for the sanitized corpus.
//
// This module calls the REAL production parser entry point
// (`parseStatementText` from `src/lib/distributor-parser.ts`) on each active
// sanitized fixture and reduces its output to a small, comparable shape.
//
// It never improves, mocks or special-cases parser behavior, and it never
// branches on a fixture id. The measured result may be poor; recording the
// truth is the point of this module.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStatementText } from "../../src/lib/distributor-parser";
import type { DistributorStatementFormat } from "../../src/lib/types";
import {
  FixtureCatalog,
  GoldenOcrExpectationSchema,
  type FixtureCatalogEntry,
  type GoldenOcrExpectation,
  type ProductionBaseline,
  type ProductionFixtureRecord,
  type NormalizedParserRow,
} from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

/** Adapter = the production entry point plus the format argument it is given. */
interface Adapter {
  id: string;
  format: DistributorStatementFormat;
}

/**
 * Source family → production adapter. `mj` and `alami` are the production
 * `statementFormat` values that route to the MJ transfer template and the
 * Yunus/Alami Refill History template respectively.
 */
const ADAPTERS: Record<"mj_transfers_sent" | "refill_history", Adapter> = {
  mj_transfers_sent: { id: "parseStatementText(text,'mj')", format: "mj" },
  refill_history: { id: "parseStatementText(text,'alami')", format: "alami" },
};

/** Comparison-only agent normalization: trim, collapse whitespace, case fold. */
export function normalizeAgentForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Deterministic string arithmetic for a Refill History timestamp
 * (`2026-08-13 8:48 AM` → `2026-08-13T08:48`). No Date object, no machine
 * timezone, no timezone suffix. Returns null when the text does not match.
 */
export function normalizeRefillDate(text: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text.trim());
  if (!m) return null;
  const [, day, hourText, minute, meridiem] = m;
  const hour12 = Number(hourText);
  if (hour12 < 1 || hour12 > 12) return null;
  const upper = meridiem.toUpperCase();
  const hour24 = upper === "AM" ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return `${day}T${String(hour24).padStart(2, "0")}:${minute}`;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * Deterministic conversion of an MJ card date (`5 Jul 2025` → `2025-07-05`).
 * Returns null when the text does not match; nothing is guessed.
 */
export function normalizeMjDate(text: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

function normalizeDate(
  family: "mj_transfers_sent" | "refill_history",
  raw?: string,
): string | null {
  if (!raw) return null;
  return family === "refill_history" ? normalizeRefillDate(raw) : normalizeMjDate(raw);
}

/** Row identity key used for full-row multiset comparison. */
export function rowKey(row: {
  agentText: string | null;
  signedAmountMinor: number | null;
  date: string | null;
}): string {
  return [
    row.agentText === null ? "\u0000" : normalizeAgentForComparison(row.agentText),
    row.signedAmountMinor === null ? "\u0000" : String(row.signedAmountMinor),
    row.date === null ? "\u0000" : row.date,
  ].join("|");
}

export function multisetIntersectionSize(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1);
  let hits = 0;
  for (const key of b) {
    const left = counts.get(key) ?? 0;
    if (left > 0) {
      counts.set(key, left - 1);
      hits++;
    }
  }
  return hits;
}

export function readFixture(entry: FixtureCatalogEntry): {
  raw: string;
  expected: GoldenOcrExpectation;
} {
  const raw = readFileSync(join(repoRoot, entry.rawFixturePath as string), "utf8");
  const expected = GoldenOcrExpectationSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, entry.expectedFixturePath as string), "utf8")),
  );
  return { raw, expected };
}

export function loadActiveFixtures(): FixtureCatalogEntry[] {
  const catalog = FixtureCatalog.parse(
    JSON.parse(readFileSync(join(here, "catalog.json"), "utf8")),
  );
  return catalog.filter((e) => e.status === "active");
}

/**
 * Run the production parser on one fixture and reduce every emitted row to
 * `{ emittedOrder, agentText, signedAmountMinor, date }`, keeping the
 * parser-emitted order. Missing or unusable fields become null; nothing is
 * inferred, guessed or fuzzy-matched.
 */
export function evaluateFixture(entry: FixtureCatalogEntry): ProductionFixtureRecord {
  const family = entry.sourceFamily as "mj_transfers_sent" | "refill_history";
  const adapter = ADAPTERS[family];
  const { raw, expected } = readFixture(entry);

  let actualRows: NormalizedParserRow[] = [];
  let executionStatus: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  try {
    actualRows = parseStatementText(raw, adapter.format).map((row, index) => {
      const amount =
        typeof row.amountSantim === "number" && Number.isFinite(row.amountSantim)
          ? Math.round(row.isReversal ? -Math.abs(row.amountSantim) : Math.abs(row.amountSantim))
          : null;
      const agent =
        typeof row.agentName === "string" && row.agentName.trim().length > 0
          ? row.agentName.trim()
          : null;
      return {
        emittedOrder: index,
        agentText: agent,
        signedAmountMinor: amount === 0 ? null : amount,
        date: normalizeDate(family, row.dateText),
      };
    });
  } catch {
    // No stack trace, path or message is recorded — only a stable code.
    executionStatus = "error";
    errorCode = "parser_threw";
    actualRows = [];
  }

  const expectedRows = expected.expectedRows;
  const expectedKeys = expectedRows.map((r) =>
    rowKey({ agentText: r.agentText, signedAmountMinor: r.signedAmountMinor, date: r.date }),
  );
  const actualKeys = actualRows.map(rowKey);
  const exactRowMatches = multisetIntersectionSize(expectedKeys, actualKeys);

  const exactAgentMultisetMatches = multisetIntersectionSize(
    expectedRows.map((r) => normalizeAgentForComparison(r.agentText)),
    actualRows.map((r) =>
      r.agentText === null ? "\u0000" : normalizeAgentForComparison(r.agentText),
    ),
  );
  const exactAmountMultisetMatches = multisetIntersectionSize(
    expectedRows.map((r) => String(r.signedAmountMinor)),
    actualRows.map((r) => (r.signedAmountMinor === null ? "\u0000" : String(r.signedAmountMinor))),
  );
  const exactDateMultisetMatches = multisetIntersectionSize(
    expectedRows.map((r) => r.date ?? "\u0000"),
    actualRows.map((r) => r.date ?? "\u0000"),
  );

  const forbidden = new Set(expected.forbiddenAgentCandidates.map(normalizeAgentForComparison));
  const forbiddenAgentHits = actualRows.filter(
    (r) => r.agentText !== null && forbidden.has(normalizeAgentForComparison(r.agentText)),
  ).length;

  // A date is invented when the parser emitted one that no expected row in the
  // fixture carries. MJ expected dates are all unknown, so every MJ-emitted
  // date counts as invented.
  const expectedDates = new Set(
    expectedRows.map((r) => r.date).filter((d): d is string => d !== null),
  );
  const inventedDateRows = actualRows.filter(
    (r) => r.date !== null && !expectedDates.has(r.date),
  ).length;

  const exactOrderedSequence =
    actualRows.length === expectedRows.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);

  return {
    fixtureId: entry.id,
    sourceFamily: family,
    adapterId: adapter.id,
    executionStatus,
    errorCode,
    expectedRowCount: expectedRows.length,
    actualRowCount: actualRows.length,
    actualRows,
    exactRowMatches,
    missingRows: expectedRows.length - exactRowMatches,
    unexpectedRows: actualRows.length - exactRowMatches,
    exactAgentMultisetMatches,
    exactAmountMultisetMatches,
    exactDateMultisetMatches,
    expectedNegativeRows: expectedRows.filter((r) => r.signedAmountMinor < 0).length,
    actualNegativeRows: actualRows.filter(
      (r) => r.signedAmountMinor !== null && r.signedAmountMinor < 0,
    ).length,
    forbiddenAgentHits,
    inventedDateRows,
    exactOrderedSequence,
  };
}

/** Full deterministic evaluation across every active fixture, in catalog order. */
export function runEvaluator(): ProductionBaseline {
  const fixtures = loadActiveFixtures().map(evaluateFixture);
  const sum = (pick: (f: ProductionFixtureRecord) => number) =>
    fixtures.reduce((acc, f) => acc + pick(f), 0);
  return {
    schemaVersion: 1,
    fixtures,
    summary: {
      fixtureCount: fixtures.length,
      expectedRows: sum((f) => f.expectedRowCount),
      actualRows: sum((f) => f.actualRowCount),
      exactRowMatches: sum((f) => f.exactRowMatches),
      missingRows: sum((f) => f.missingRows),
      unexpectedRows: sum((f) => f.unexpectedRows),
      expectedNegativeRows: sum((f) => f.expectedNegativeRows),
      actualNegativeRows: sum((f) => f.actualNegativeRows),
      forbiddenAgentHits: sum((f) => f.forbiddenAgentHits),
      inventedDateRows: sum((f) => f.inventedDateRows),
      exactFixtureCount: fixtures.filter(
        (f) => f.exactOrderedSequence && f.missingRows === 0 && f.unexpectedRows === 0,
      ).length,
    },
  };
}
