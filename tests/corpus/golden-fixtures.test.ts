import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FixtureCatalog, GoldenOcrExpectationSchema, type FixtureCatalogEntry } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const catalog: FixtureCatalogEntry[] = FixtureCatalog.parse(
  JSON.parse(readFileSync(join(here, "catalog.json"), "utf8")),
);

const active = catalog.filter((e) => e.status === "active");

const FORBIDDEN = [
  { name: "http-url", re: /https?:\/\//i },
  { name: "masked-account", re: /\d\*{1,}\d/ },
  { name: "phone-number", re: /(?:\+251|\b0)\d{8,9}\b/ },
  { name: "receipt-reference", re: /\b[A-Z]{2,}[A-Z0-9]{6,}\b/ },
  { name: "raw-sms-opening", re: /^\s*Dear\b/im },
];

function amountToMinor(raw: string): number {
  const normalized = raw.replace(/,/g, "");
  expect(normalized, `unexpected amount shape: ${raw}`).toMatch(/^-?\d+(\.\d{2})?$/);
  return Math.round(Number(normalized) * 100);
}

describe("golden OCR fixtures", () => {
  it("has at least one active fixture", () => {
    expect(active.length).toBeGreaterThan(0);
  });

  it("has four active fixtures", () => {
    expect(active.length).toBe(4);
  });

  it("does not commit original screenshot images", () => {
    const dir = join(here, "fixtures");
    const walk = (p: string): string[] =>
      readdirSync(p, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(p, d.name)) : [d.name],
      );
    for (const name of walk(dir)) {
      expect(name, `image committed: ${name}`).not.toMatch(/\.(jpe?g|png|gif|webp|heic|bmp)$/i);
    }
  });

  for (const entry of active) {
    describe(entry.id, () => {
      const rawPath = entry.rawFixturePath as string;
      const expectedPath = entry.expectedFixturePath as string;

      it("uses safe repository-relative paths", () => {
        for (const p of [rawPath, expectedPath]) {
          expect(isAbsolute(p)).toBe(false);
          expect(p.split(/[\\/]/)).not.toContain("..");
          expect(p.startsWith("tests/corpus/fixtures/")).toBe(true);
        }
      });

      it("has both fixture files on disk", () => {
        expect(existsSync(join(repoRoot, rawPath))).toBe(true);
        expect(existsSync(join(repoRoot, expectedPath))).toBe(true);
      });

      it("matches the golden expectation contract", () => {
        const raw = readFileSync(join(repoRoot, rawPath), "utf8");
        const expected = GoldenOcrExpectationSchema.parse(
          JSON.parse(readFileSync(join(repoRoot, expectedPath), "utf8")),
        );

        expect(expected.fixtureId).toBe(entry.id);
        expect(expected.sourceFamily).toBe(entry.sourceFamily);
        expect(expected.expectedRows.length).toBe(entry.expected.completeRowCount);
        expect(expected.expectedRows.filter((r) => r.isReversal).length).toBe(
          entry.expected.reversalRowCount,
        );
        expect(expected.expectedRows.map((r) => r.sourceOrder)).toEqual(
          expected.expectedRows.map((_r, i) => i),
        );

        for (const row of expected.expectedRows) {
          expect(amountToMinor(row.rawAmountText)).toBe(Math.abs(row.signedAmountMinor));
          expect(row.date).toBeNull();
          expect(row.datePrecision).toBe("unknown");
          expect(row.agentResolution).toBe("unassigned");
          expect(row.agentText.startsWith("Sample Agent ")).toBe(true);
        }

        for (const candidate of expected.forbiddenAgentCandidates) {
          expect(raw.includes(candidate), `missing candidate in raw: ${candidate}`).toBe(true);
          expect(expected.expectedRows.some((r) => r.agentText === candidate)).toBe(false);
        }

        expect(raw).toContain("Transfers");
        expect(raw).toContain("Sent");
        expect(raw).toMatch(/(\S+)\s-\s\1/);

        for (const { name, re } of FORBIDDEN) {
          expect(re.test(raw), `forbidden pattern '${name}' in raw fixture`).toBe(false);
        }
      });
    });
  }
});
