import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyMjLines,
  findMjAmountAnchors,
  parseMjAmount,
  stripMjDecorationPrefix,
  collectMjAgentCandidates,
  reconstructMjRows,
  signedMjAmountMinor,
  toMjAgentCandidate,
  type MjLine,
} from "./mj-row-reconstruction";

const FIXTURE_DIR = join(process.cwd(), "tests/corpus/fixtures/ocr/mj-transfers-sent");

const MJ_FIXTURES = ["photo-2", "photo-4", "photo-5", "photo-6", "photo-9", "photo-38"] as const;

/** Expected synthetic agent lines, in source order, per sanitized fixture. */
const EXPECTED_AGENTS: Record<string, string[]> = {
  "photo-2": [
    "Sample Agent Kappa",
    "Sample Agent Lambda Meridian",
    "Sample Agent Mu",
    "Sample Agent Nu",
    "Sample Agent Xi",
  ],
  "photo-4": [
    "Sample Agent Psi",
    "Sample Agent Psi",
    "Sample Agent Omega",
    "Sample Agent Alder",
    "Sample Agent Birch",
  ],
  "photo-5": [
    "Sample Agent Alpha",
    "Sample Agent Beta",
    "Sample Agent Gamma",
    "Sample Agent Delta",
    "Sample Agent Epsilon",
  ],
  "photo-6": [
    "Sample Agent Tau",
    "Sample Agent Upsilon",
    "Sample Agent Phi",
    "Sample Agent Chi",
    "Sample Agent Tau",
  ],
  "photo-9": [
    "Sample Agent Omicron",
    "Sample Agent Pi",
    "Sample Agent Rho",
    "Sample Agent Sigma",
    "Sample Agent Rho",
  ],
  "photo-38": [
    "Sample Agent Zeta",
    "Sample Agent Eta",
    "Sample Agent Theta",
    "Sample Agent Iota",
    "Sample Agent Eta",
  ],
};

function readFixture(id: string): string {
  return readFileSync(join(FIXTURE_DIR, `${id}.raw.txt`), "utf8");
}

interface ExpectedRow {
  sourceOrder: number;
  agentText: string;
  signedAmountMinor: number;
}

function readExpectedRows(id: string): ExpectedRow[] {
  const json = JSON.parse(readFileSync(join(FIXTURE_DIR, `${id}.expected.json`), "utf8"));
  return json.expectedRows as ExpectedRow[];
}

function classified(id: string): MjLine[] {
  return classifyMjLines(readFixture(id));
}

describe("stripMjDecorationPrefix", () => {
  it("removes generic OCR decoration prefixes only from the left", () => {
    expect(stripMjDecorationPrefix("2 Sample Agent Alpha")).toBe("Sample Agent Alpha");
    expect(stripMjDecorationPrefix("E 5 Sample Agent Psi")).toBe("Sample Agent Psi");
    expect(stripMjDecorationPrefix("E 3 Sample Agent Omega")).toBe("Sample Agent Omega");
    expect(stripMjDecorationPrefix("E Sample Agent Epsilon")).toBe("Sample Agent Epsilon");
    expect(stripMjDecorationPrefix("& samplewallet - samplewallet")).toBe(
      "samplewallet - samplewallet",
    );
    expect(stripMjDecorationPrefix("oo samplewallet - samplewallet")).toBe(
      "samplewallet - samplewallet",
    );
  });

  it("never empties a line that carries real substance", () => {
    expect(stripMjDecorationPrefix("Sample Agent Mu")).toBe("Sample Agent Mu");
    expect(stripMjDecorationPrefix("wl")).toBe("wl");
  });
});

describe("parseMjAmount", () => {
  it("converts amounts exactly to minor units", () => {
    expect(parseMjAmount("21,000.00")?.amountSantim).toBe(2_100_000);
    expect(parseMjAmount("2,735.00")?.amountSantim).toBe(273_500);
    expect(parseMjAmount("12,480.00")?.amountSantim).toBe(1_248_000);
    expect(parseMjAmount("0.05")?.amountSantim).toBe(5);
    expect(parseMjAmount("1,364,000.99")?.amountSantim).toBe(136_400_099);
  });

  it("treats a normal amount as positive", () => {
    const amount = parseMjAmount("31,250.00");
    expect(amount).not.toBeNull();
    expect(amount?.isReversal).toBe(false);
    expect(amount?.signEvidence).toBe("none");
  });

  it("treats an attached minus as a confirmed reversal", () => {
    const amount = parseMjAmount("-5,250.00");
    expect(amount?.isReversal).toBe(true);
    expect(amount?.signEvidence).toBe("attached_minus");
    expect(amount?.amountSantim).toBe(525_000);
  });

  it("treats a spaced minus as OCR noise, keeping the amount positive", () => {
    const amount = parseMjAmount("- 302,500.00");
    expect(amount?.isReversal).toBe(false);
    expect(amount?.signEvidence).toBe("spaced_prefix_ignored");
    expect(amount?.amountSantim).toBe(30_250_000);
  });

  it("treats a punctuation prefix as OCR noise, keeping it positive", () => {
    const amount = parseMjAmount(": 2,735.00");
    expect(amount?.isReversal).toBe(false);
    expect(amount?.signEvidence).toBe("punctuation_prefix_ignored");
  });

  it("rejects percentages, timestamps and non-financial numeric noise", () => {
    expect(parseMjAmount("57%=")).toBeNull();
    expect(parseMjAmount("2233 m@ 7 oN 8 al 57%=")).toBeNull();
    expect(parseMjAmount("4:50 PM")).toBeNull();
    expect(parseMjAmount("2026-08-09 16:50")).toBeNull();
    expect(parseMjAmount("3")).toBeNull();
    expect(parseMjAmount("[1] . Ir . oe")).toBeNull();
    expect(parseMjAmount("2 Sample Agent Alpha")).toBeNull();
    expect(parseMjAmount("")).toBeNull();
  });
});

describe("classifyMjLines over the sanitized MJ corpus", () => {
  it("finds exactly 5 amount anchors per fixture and 30 in total", () => {
    let total = 0;
    for (const id of MJ_FIXTURES) {
      const anchors = findMjAmountAnchors(classified(id));
      expect(anchors, id).toHaveLength(5);
      total += anchors.length;
    }
    expect(total).toBe(30);
  });

  it("keeps photo-4 attached-minus anchors negative and the spaced-minus positive", () => {
    const anchors = findMjAmountAnchors(classified("photo-4"));
    const reversals = anchors.filter((a) => a.amount.isReversal);
    expect(reversals).toHaveLength(2);
    expect(reversals.map((a) => a.amount.amountSantim)).toEqual([525_000, 897_500]);
    expect(reversals.every((a) => a.amount.signEvidence === "attached_minus")).toBe(true);

    const spaced = anchors.find((a) => a.amount.signEvidence === "spaced_prefix_ignored");
    expect(spaced?.amount.isReversal).toBe(false);
    expect(spaced?.amount.amountSantim).toBe(30_250_000);
  });

  it("finds zero negative anchors in photo-6", () => {
    const anchors = findMjAmountAnchors(classified("photo-6"));
    expect(anchors.filter((a) => a.amount.isReversal)).toHaveLength(0);
    expect(anchors.map((a) => a.amount.signEvidence).filter((e) => e !== "none")).toEqual([
      "spaced_prefix_ignored",
      "punctuation_prefix_ignored",
    ]);
  });

  it("never classifies a repeated sender-label variant as an agent", () => {
    for (const id of MJ_FIXTURES) {
      const lines = classified(id);
      const labels = lines.filter((l) => l.kind === "account_label");
      expect(labels.length, id).toBe(5);
      for (const label of labels) {
        expect(label.stripped).toBe("samplewallet - samplewallet");
      }
      const agents = lines.filter((l) => l.kind === "agent_candidate");
      expect(
        agents.some((a) => a.stripped.toLowerCase().includes("samplewallet")),
        id,
      ).toBe(false);
    }
  });

  it("keeps every expected synthetic agent line a candidate after decoration removal", () => {
    for (const id of MJ_FIXTURES) {
      const agents = classified(id)
        .filter((l) => l.kind === "agent_candidate")
        .map((l) => l.stripped);
      expect(agents, id).toEqual(EXPECTED_AGENTS[id]);
    }
  });

  it("keeps UI chrome and false OCR tokens off the agent list", () => {
    const forbidden = new Set([
      "wl",
      "fo",
      "fo)",
      "[wl",
      "[]",
      "ir",
      "oe",
      "nr",
      "transfers",
      "sent",
      "cs ee",
    ]);
    for (const id of MJ_FIXTURES) {
      const lines = classified(id);
      for (const line of lines.filter((l) => l.kind === "agent_candidate")) {
        expect(forbidden.has(line.stripped.toLowerCase()), line.text).toBe(false);
      }
      const chrome = lines.filter((l) => l.kind === "chrome");
      expect(chrome.length, id).toBeGreaterThanOrEqual(3);
      expect(
        chrome.some((l) => l.reason === "status_bar_percent"),
        id,
      ).toBe(true);
      expect(chrome.filter((l) => l.stripped.toLowerCase() === "transfers").length, id).toBe(2);
      expect(
        chrome.some((l) => l.stripped.toLowerCase() === "sent"),
        id,
      ).toBe(true);
    }
  });

  it("emits no dates, because the MJ corpus contains none", () => {
    for (const id of MJ_FIXTURES) {
      expect(
        classified(id).filter((l) => l.kind === "date"),
        id,
      ).toHaveLength(0);
    }
  });

  it("is deterministic and preserves source order", () => {
    for (const id of MJ_FIXTURES) {
      const first = classified(id);
      const second = classified(id);
      expect(second).toEqual(first);

      const indexes = first.map((l) => l.sourceIndex);
      expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
      expect(new Set(indexes).size).toBe(indexes.length);

      const anchors = findMjAmountAnchors(first).map((a) => a.sourceIndex);
      expect([...anchors].sort((a, b) => a - b)).toEqual(anchors);

      for (const line of first) {
        expect(typeof line.kind).toBe("string");
        expect(line.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
