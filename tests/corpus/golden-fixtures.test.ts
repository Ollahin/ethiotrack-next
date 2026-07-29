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

  it("has six active fixtures", () => {
    expect(active.length).toBe(6);
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
          // rawAmountText is the authoritative normalized signed value.
          expect(amountToMinor(row.rawAmountText)).toBe(row.signedAmountMinor);
          if (row.rawAmountText.startsWith("-")) {
            expect(row.isReversal, `negative amount on non-reversal row`).toBe(true);
          }
          if (row.signedAmountMinor < 0) {
            expect(row.isReversal).toBe(true);
            expect(row.eventKind).toBe("evd_reversal");
          }
          if (row.isReversal) {
            expect(row.signedAmountMinor).toBeLessThan(0);
            expect(row.rawAmountText.startsWith("-")).toBe(true);
          } else {
            expect(row.signedAmountMinor).toBeGreaterThan(0);
            expect(row.rawAmountText.startsWith("-")).toBe(false);
            expect(row.eventKind).toBe("evd_sent_to_agent");
          }
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

      it("keeps amount evidence consistent with the raw fixture and the signed amount", () => {
        const raw = readFileSync(join(repoRoot, rawPath), "utf8");
        const expected = GoldenOcrExpectationSchema.parse(
          JSON.parse(readFileSync(join(repoRoot, expectedPath), "utf8")),
        );

        for (const row of expected.expectedRows) {
          const evidence = row.amountEvidence;
          if (!evidence) continue;

          expect(
            raw.includes(evidence.observedText),
            `observedText missing from raw: ${evidence.observedText}`,
          ).toBe(true);

          const numeric = evidence.observedText.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})?/);
          expect(numeric, `no amount inside observedText: ${evidence.observedText}`).not.toBeNull();
          expect(numeric?.[0]).toBe(row.rawAmountText.replace(/^-/, ""));

          if (evidence.prefixDisposition === "ocr_noise") {
            expect(row.signedAmountMinor).toBeGreaterThan(0);
            expect(row.isReversal).toBe(false);
            expect(row.eventKind).toBe("evd_sent_to_agent");
            expect(row.rawAmountText.startsWith("-")).toBe(false);
          } else {
            expect(row.signedAmountMinor).toBeLessThan(0);
            expect(row.isReversal).toBe(true);
            expect(row.eventKind).toBe("evd_reversal");
            expect(row.rawAmountText.startsWith("-")).toBe(true);
            expect(amountToMinor(row.rawAmountText)).toBe(row.signedAmountMinor);
          }
        }
      });

      it("never nets or deduplicates rows during validation", () => {
        const expected = GoldenOcrExpectationSchema.parse(
          JSON.parse(readFileSync(join(repoRoot, expectedPath), "utf8")),
        );
        expect(expected.expectedRows.length).toBe(entry.expected.completeRowCount);
        expect(expected.expectedRows.map((r) => r.sourceOrder)).toEqual(
          [...expected.expectedRows].map((r) => r.sourceOrder).sort((a, b) => a - b),
        );
      });
    });
  }
});

function loadExpected(id: string) {
  const entry = catalog.find((e) => e.id === id) as FixtureCatalogEntry;
  const raw = readFileSync(join(repoRoot, entry.rawFixturePath as string), "utf8");
  const expected = GoldenOcrExpectationSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, entry.expectedFixturePath as string), "utf8")),
  );
  return { raw, expected };
}

describe("ocr.mj.sent.photo-2 — punctuation noise and long agent name", () => {
  const { raw, expected } = loadExpected("ocr.mj.sent.photo-2");

  it("has exactly 5 expected rows", () => {
    expect(expected.expectedRows.length).toBe(5);
  });

  it("has five distinct expected agents", () => {
    const names = expected.expectedRows.map((r) => r.agentText);
    expect(new Set(names).size).toBe(5);
  });

  it("keeps the long agent name as one complete value", () => {
    const long = expected.expectedRows.find((r) => r.agentText.split(/\s+/).length === 4);
    expect(long?.agentText).toBe("Sample Agent Lambda Meridian");
    expect(raw).toContain("Sample Agent Lambda Meridian");
  });

  it("contains punctuation noise adjacent to an amount in the raw fixture", () => {
    expect(raw).toMatch(/^\s*[:.\-;]\s*\d{1,3}(,\d{3})*\.\d{2}\s*$/m);
  });

  it("keeps every expected signed amount positive", () => {
    for (const row of expected.expectedRows) {
      expect(row.signedAmountMinor).toBeGreaterThan(0);
      expect(row.isReversal).toBe(false);
    }
  });
});

describe("ocr.mj.sent.photo-9 — repeated agents and false agent token", () => {
  const { raw, expected } = loadExpected("ocr.mj.sent.photo-9");

  it("has exactly 5 expected rows", () => {
    expect(expected.expectedRows.length).toBe(5);
  });

  it("contains the false OCR token in the raw fixture", () => {
    expect(raw).toMatch(/^fo\)?$/m);
  });

  it("declares the false token as a forbidden agent candidate", () => {
    expect(expected.forbiddenAgentCandidates).toContain("fo");
  });

  it("never uses the false token as an expected agent", () => {
    for (const row of expected.expectedRows) {
      expect(row.agentText).not.toBe("fo");
    }
  });

  it("keeps both repeated legitimate agent rows", () => {
    const rho = expected.expectedRows.filter((r) => r.agentText === "Sample Agent Rho");
    expect(rho.length).toBe(2);
    expect(rho[0].signedAmountMinor).not.toBe(rho[1].signedAmountMinor);
    expect(rho[0].rawAmountText).not.toBe(rho[1].rawAmountText);
  });

  it("keeps every expected signed amount positive", () => {
    for (const row of expected.expectedRows) {
      expect(row.signedAmountMinor).toBeGreaterThan(0);
      expect(row.isReversal).toBe(false);
    }
  });
});

describe("ocr.mj.sent.photo-6 — OCR sign noise and repeated agents", () => {
  const { raw, expected } = loadExpected("ocr.mj.sent.photo-6");
  const withEvidence = expected.expectedRows.filter((r) => r.amountEvidence);

  it("has exactly 5 expected rows", () => {
    expect(expected.expectedRows.length).toBe(5);
  });

  it("has exactly 2 rows carrying amount evidence", () => {
    expect(withEvidence.length).toBe(2);
  });

  it("treats both amount prefixes as OCR noise", () => {
    for (const row of withEvidence) {
      expect(row.amountEvidence?.prefixDisposition).toBe("ocr_noise");
    }
    expect(
      expected.expectedRows.some(
        (r) => r.amountEvidence?.prefixDisposition === "confirmed_reversal",
      ),
    ).toBe(false);
  });

  it("contains the noisy amount prefixes verbatim in the raw fixture", () => {
    expect(raw).toContain("- 3,875.00");
    expect(raw).toContain(": 2,735.00");
  });

  it("keeps the noise-prefixed amounts positive", () => {
    for (const row of withEvidence) {
      expect(row.signedAmountMinor).toBeGreaterThan(0);
    }
  });

  it("keeps every row a positive non-reversal transfer", () => {
    for (const row of expected.expectedRows) {
      expect(row.eventKind).toBe("evd_sent_to_agent");
      expect(row.signedAmountMinor).toBeGreaterThan(0);
    }
    expect(expected.expectedRows.filter((r) => r.isReversal).length).toBe(0);
  });

  it("keeps both repeated legitimate agent rows", () => {
    const tau = expected.expectedRows.filter((r) => r.agentText === "Sample Agent Tau");
    expect(tau.length).toBe(2);
    expect(tau[0].signedAmountMinor).not.toBe(tau[1].signedAmountMinor);
    expect(tau[0].rawAmountText).not.toBe(tau[1].rawAmountText);
  });

  it("forbids the repeated synthetic sender label as an agent", () => {
    expect(expected.forbiddenAgentCandidates).toContain("samplewallet - samplewallet");
    expect(expected.expectedRows.some((r) => r.agentText === "samplewallet - samplewallet")).toBe(
      false,
    );
  });
});
