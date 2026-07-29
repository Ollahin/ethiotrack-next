import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FixtureCatalog, type FixtureCatalogEntry } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "catalog.json"), "utf8");
const parsed: unknown = JSON.parse(raw);
const catalog: FixtureCatalogEntry[] = FixtureCatalog.parse(parsed);

// Structural privacy checks. We do NOT commit any original identifying
// tokens (agent names, account labels, receipt IDs, raw messages). Instead,
// we enforce that every string value in catalog.json conforms to a small set
// of sanitized shapes, and that free-form/raw-message shapes never appear.

const ID_RE = /^ocr\.(mj\.sent|refill)\.photo-\d+$/;
const FILENAME_RE = /^photo_\d+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/;
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "url", re: /https?:\/\//i },
  { name: "masked-account", re: /\d\*{1,}\d/ },
  { name: "receipt-reference", re: /\b[A-Z]{2,}[A-Z0-9]{6,}\b/ },
  { name: "etb-amount", re: /\bETB\s*\d/i },
  { name: "birr-amount", re: /\bBirr\b/i },
  { name: "raw-message-opening", re: /^\s*Dear\b/i },
  { name: "multiline-raw", re: /\r?\n/ },
];

const ALLOWED_STRING_FIELDS = new Set([
  "id",
  "sourceFileName",
  "inputKind",
  "sourceFamily",
  "platformHint",
  "status",
  "privacyStatus",
  "notes",
  "rawFixturePath",
  "expectedFixturePath",
]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function walkStrings(
  value: JsonValue,
  path: string,
  visit: (s: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, path ? `${path}.${k}` : k, visit);
    }
  }
}

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

  it("IDs match the sanitized fixture-ID structure", () => {
    for (const e of catalog) {
      expect(e.id, `unexpected id: ${e.id}`).toMatch(ID_RE);
    }
  });

  it("source filenames match the sanitized screenshot pattern", () => {
    for (const e of catalog) {
      expect(e.sourceFileName, `unexpected filename shape`).toMatch(FILENAME_RE);
    }
  });

  it("tags are lowercase kebab-case", () => {
    for (const e of catalog) {
      for (const tag of e.tags) {
        expect(tag).toMatch(TAG_RE);
        expect(tag.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("contains no free-form or raw-message strings anywhere", () => {
    walkStrings(parsed as JsonValue, "", (s, path) => {
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        expect(re.test(s), `forbidden pattern '${name}' at ${path}`).toBe(false);
      }
      // No unusually long free-form text is allowed in any string field.
      expect(s.length, `string too long at ${path}`).toBeLessThanOrEqual(120);
    });
  });

  it("has no string values outside the approved metadata fields", () => {
    walkStrings(parsed as JsonValue, "", (_s, path) => {
      // Path segments look like: "[0].id", "[0].tags[2]", "[0].expected.completeRowCount".
      const segments = path.split(".").map((seg) => seg.replace(/\[\d+\]$/g, ""));
      const leaf = segments[segments.length - 1];
      // Strings are only allowed at top-level metadata fields or inside `tags`.
      const isTagLeaf = segments.includes("tags");
      expect(
        isTagLeaf || ALLOWED_STRING_FIELDS.has(leaf),
        `unexpected string field at ${path}`,
      ).toBe(true);
    });
  });
});
