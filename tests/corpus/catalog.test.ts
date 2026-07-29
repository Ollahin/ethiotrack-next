import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FixtureCatalog, type FixtureCatalogEntry } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "catalog.json"), "utf8");
const parsed: unknown = JSON.parse(raw);
const catalog: FixtureCatalogEntry[] = FixtureCatalog.parse(parsed);

// Privacy deny-list — kept inside the test only. These must not appear in
// catalog.json. Values reflect identifying tokens from the original private
// Parser corpus.docx and its screenshots.
const DENY_SUBSTRINGS: string[] = ["barisohaji", "Tsegacardddd", "Misges", "Misgee", "Zeddd"];
const DENY_PATTERNS: RegExp[] = [
  /https?:\/\//i, // URLs
  /\bFT[A-Z0-9]{6,}\b/, // CBE reference IDs
  /\d\*{1,}\d/, // masked account numbers like 1**5058
  /\bETB\s*\d/i, // raw amounts
  /\bBirr\b/i,
];

describe("parser corpus catalog", () => {
  it("has exactly 9 entries", () => {
    expect(catalog.length).toBe(9);
  });

  it("has unique IDs", () => {
    const ids = catalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique source filenames", () => {
    const names = catalog.map((e) => e.sourceFileName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches expected corpus totals", () => {
    const sum = (fn: (e: FixtureCatalogEntry) => number) => catalog.reduce((a, e) => a + fn(e), 0);
    expect(sum((e) => e.expected.completeRowCount)).toBe(56);
    expect(sum((e) => e.expected.partialRowCount)).toBe(0);
    expect(sum((e) => e.expected.reversalRowCount)).toBe(2);
    expect(sum((e) => e.currentBaseline.parsedRowCount)).toBe(40);
  });

  it("matches MJ Transfers → Sent source totals", () => {
    const mj = catalog.filter((e) => e.sourceFamily === "mj_transfers_sent");
    expect(mj.length).toBe(6);
    expect(mj.reduce((a, e) => a + e.expected.completeRowCount, 0)).toBe(30);
    expect(mj.reduce((a, e) => a + e.currentBaseline.parsedRowCount, 0)).toBe(14);
  });

  it("matches Refill History source totals", () => {
    const rh = catalog.filter((e) => e.sourceFamily === "refill_history");
    expect(rh.length).toBe(3);
    expect(rh.reduce((a, e) => a + e.expected.completeRowCount, 0)).toBe(26);
    expect(rh.reduce((a, e) => a + e.currentBaseline.parsedRowCount, 0)).toBe(26);
  });

  it("marks every entry as metadata_only and catalogued", () => {
    for (const e of catalog) {
      expect(e.privacyStatus).toBe("metadata_only");
      expect(e.status).toBe("catalogued");
    }
  });

  it("does not include raw or expected fixture paths yet", () => {
    for (const e of catalog) {
      expect(e.rawFixturePath).toBeUndefined();
      expect(e.expectedFixturePath).toBeUndefined();
    }
  });

  it("contains no private identifying substrings or patterns", () => {
    for (const substr of DENY_SUBSTRINGS) {
      expect(raw.toLowerCase()).not.toContain(substr.toLowerCase());
    }
    for (const pat of DENY_PATTERNS) {
      expect(pat.test(raw)).toBe(false);
    }
  });
});
