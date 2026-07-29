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

describe("MJ agent-candidate filtering", () => {
  it("promotes only agent_candidate lines and preserves multiword names", () => {
    const lines = classified("photo-2");
    const names = collectMjAgentCandidates(lines).map((c) => c.agentName);
    expect(names).toEqual(EXPECTED_AGENTS["photo-2"]);
    expect(names).toContain("Sample Agent Lambda Meridian");
  });

  it("rejects chrome, account labels, amounts and noise", () => {
    for (const id of MJ_FIXTURES) {
      for (const line of classified(id)) {
        if (line.kind === "agent_candidate") continue;
        expect(toMjAgentCandidate(line), line.text).toBeNull();
      }
    }
  });

  it("records a stable transform code when a decoration prefix was removed", () => {
    const candidate = collectMjAgentCandidates(classified("photo-4"))[0];
    expect(candidate.agentName).toBe("Sample Agent Psi");
    expect(candidate.transforms).toContain("decoration_prefix_stripped");
  });
});

describe("reconstructMjRows over the sanitized MJ corpus", () => {
  it("reconstructs exactly 5 resolved rows per fixture and 30 in total", () => {
    let total = 0;
    for (const id of MJ_FIXTURES) {
      const rows = reconstructMjRows(classified(id));
      expect(rows, id).toHaveLength(5);
      expect(
        rows.every((r) => r.status === "resolved"),
        id,
      ).toBe(true);
      total += rows.length;
    }
    expect(total).toBe(30);
  });

  it("matches each fixture's expected agent, signed amount and source order", () => {
    for (const id of MJ_FIXTURES) {
      const rows = reconstructMjRows(classified(id));
      const actual = rows.map((r) => ({
        sourceOrder: r.sourceOrder,
        agentText: r.agentName,
        signedAmountMinor: signedMjAmountMinor(r),
      }));
      expect(actual, id).toEqual(
        readExpectedRows(id).map((e) => ({
          sourceOrder: e.sourceOrder,
          agentText: e.agentText,
          signedAmountMinor: e.signedAmountMinor,
        })),
      );
    }
  });

  it("preserves photo-4's two reversals and its positive spaced-minus row", () => {
    const rows = reconstructMjRows(classified("photo-4"));
    const reversals = rows.filter((r) => r.isReversal);
    expect(reversals).toHaveLength(2);
    expect(reversals.map(signedMjAmountMinor)).toEqual([-525_000, -897_500]);
    expect(reversals.every((r) => r.warnings.includes("reversal"))).toBe(true);

    const spaced = rows.find((r) => r.amount.signEvidence === "spaced_prefix_ignored");
    expect(spaced?.isReversal).toBe(false);
    expect(signedMjAmountMinor(spaced!)).toBe(30_250_000);
  });

  it("produces no reversals for photo-6", () => {
    const rows = reconstructMjRows(classified("photo-6"));
    expect(rows.filter((r) => r.isReversal)).toHaveLength(0);
    expect(rows.every((r) => signedMjAmountMinor(r) > 0)).toBe(true);
  });

  it("keeps repeated agents as separate rows without netting", () => {
    const rows = reconstructMjRows(classified("photo-4"));
    const psi = rows.filter((r) => r.agentName === "Sample Agent Psi");
    expect(psi).toHaveLength(2);
    expect(psi.map(signedMjAmountMinor)).toEqual([-525_000, 1_575_000]);
    expect(psi[0].amountLineIndex).not.toBe(psi[1].amountLineIndex);
  });

  it("never binds a false OCR token or an account label to a row", () => {
    const forbidden = ["wl", "fo", "fo)", "[]", "ir", "oe", "transfers", "sent"];
    for (const id of MJ_FIXTURES) {
      for (const row of reconstructMjRows(classified(id))) {
        const name = (row.agentName ?? "").toLowerCase();
        expect(name.includes("samplewallet"), id).toBe(false);
        expect(forbidden.includes(name), id).toBe(false);
      }
    }
  });

  it("keeps every row dateless, because the MJ corpus contains no date", () => {
    for (const id of MJ_FIXTURES) {
      for (const row of reconstructMjRows(classified(id))) {
        expect(row.date).toBeNull();
        expect(row.warnings).toContain("no_date_in_source");
      }
    }
  });

  it("is deterministic and preserves ascending anchor order", () => {
    for (const id of MJ_FIXTURES) {
      const first = reconstructMjRows(classified(id));
      expect(reconstructMjRows(classified(id))).toEqual(first);
      const indexes = first.map((r) => r.amountLineIndex);
      expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
      expect(first.map((r) => r.sourceOrder)).toEqual([0, 1, 2, 3, 4]);
    }
  });
});

describe("reconstructMjRows ambiguity handling", () => {
  it("reports missing_agent without inventing a name", () => {
    const rows = reconstructMjRows(
      classifyMjLines(["samplewallet - samplewallet", "1,000.00", "wl"].join("\n")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("missing_agent");
    expect(rows[0].agentName).toBeNull();
    expect(rows[0].agentLineIndex).toBeNull();
    expect(rows[0].candidateLineIndexes).toEqual([]);
    expect(rows[0].warnings).toContain("missing_agent");
    expect(rows[0].amount.amountSantim).toBe(100_000);
  });

  it("reports ambiguous_agent without picking one of the candidates", () => {
    const rows = reconstructMjRows(
      classifyMjLines(
        [
          "2,000.00",
          "Sample Agent Alpha",
          "Sample Agent Beta",
          "3,000.00",
          "Sample Agent Gamma",
        ].join("\n"),
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("ambiguous_agent");
    expect(rows[0].agentName).toBeNull();
    expect(rows[0].agentLineIndex).toBeNull();
    expect(rows[0].candidateLineIndexes).toEqual([1, 2]);
    expect(rows[1].status).toBe("resolved");
    expect(rows[1].agentName).toBe("Sample Agent Gamma");
  });
});

describe("adaptMjTransfersSent production-shape adapter", () => {
  it("adapts all six MJ fixtures to exactly 30 production-shaped rows", () => {
    let total = 0;
    for (const id of MJ_FIXTURES) {
      const { rows, unresolved } = adaptMjTransfersSent(rawText(id));
      expect(unresolved).toEqual([]);
      expect(rows).toHaveLength(EXPECTED_AGENTS[id].length);
      for (const row of rows) {
        expect(row.ok).toBe(true);
        expect(row.airtimeType).toBe("airtime_evd");
        expect(row.amountSantim).toBeGreaterThan(0);
        expect(Number.isInteger(row.amountSantim)).toBe(true);
        expect(row.dateText).toBeUndefined();
        expect(row.needsReview).toBe(true);
        expect(row.phone).toBeUndefined();
        expect(row.reference).toBeUndefined();
        expect(row.sender).toBeUndefined();
      }
      total += rows.length;
    }
    expect(total).toBe(30);
  });

  it("matches expected agent, signed amount and order for every golden row", () => {
    for (const id of MJ_FIXTURES) {
      const { rows } = adaptMjTransfersSent(rawText(id));
      const expected = expectation(id);
      expect(rows.map((r) => r.agentName)).toEqual(expected.expectedRows.map((r) => r.agentText));
      expect(rows.map((r) => (r.isReversal ? -r.amountSantim! : r.amountSantim!))).toEqual(
        expected.expectedRows.map((r) => r.signedAmountMinor),
      );
      expect(rows.map((r) => r.isReversal)).toEqual(
        expected.expectedRows.map((r) => r.isReversal),
      );
    }
  });

  it("emits exactly two negative rows for photo-4 and none for photo-6", () => {
    const four = adaptMjTransfersSent(rawText("photo-4")).rows;
    expect(four.filter((r) => r.isReversal)).toHaveLength(2);
    const six = adaptMjTransfersSent(rawText("photo-6")).rows;
    expect(six.filter((r) => r.isReversal)).toHaveLength(0);
  });

  it("keeps repeated agents as separate rows", () => {
    const rows = adaptMjTransfersSent(rawText("photo-4")).rows;
    const psi = rows.filter((r) => r.agentName === "Sample Agent Psi");
    expect(psi).toHaveLength(2);
    expect(psi[0].amountSantim).not.toBe(psi[1].amountSantim);
  });

  it("never emits a forbidden sender label or OCR decoration token", () => {
    for (const id of MJ_FIXTURES) {
      const forbidden = expectation(id).forbiddenAgentCandidates ?? [];
      const { rows } = adaptMjTransfersSent(rawText(id));
      for (const row of rows) {
        for (const bad of forbidden) {
          expect(row.agentName?.toLowerCase()).not.toContain(bad.toLowerCase());
          expect(row.raw.toLowerCase()).not.toContain(bad.toLowerCase());
        }
        expect(row.agentName).toMatch(/^[\p{L}][\p{L} .'-]*$/u);
      }
    }
  });

  it("leaves missing-agent and ambiguous-agent windows unresolved", () => {
    const missing = adaptMjTransfersSent(["1,000.00", "wl"].join("\n"));
    expect(missing.rows).toEqual([]);
    expect(missing.unresolved).toHaveLength(1);
    expect(missing.unresolved[0].status).toBe("missing_agent");
    expect(missing.unresolved[0].amountSantim).toBe(100_000);

    const ambiguous = adaptMjTransfersSent(
      ["2,000.00", "Sample Agent Alpha", "Sample Agent Beta"].join("\n"),
    );
    expect(ambiguous.rows).toEqual([]);
    expect(ambiguous.unresolved).toHaveLength(1);
    expect(ambiguous.unresolved[0].status).toBe("ambiguous_agent");
  });

  it("does not mutate its input and is deterministic", () => {
    for (const id of MJ_FIXTURES) {
      const text = rawText(id);
      const snapshot = `${text}`;
      const first = adaptMjTransfersSent(text);
      const second = adaptMjTransfersSent(text);
      expect(text).toBe(snapshot);
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it("leaves parseStatementText behavior unchanged", () => {
    for (const id of MJ_FIXTURES) {
      const text = rawText(id);
      const before = JSON.stringify(parseStatementText(text, "mj"));
      adaptMjTransfersSent(text);
      expect(JSON.stringify(parseStatementText(text, "mj"))).toBe(before);
    }
  });

  it("keeps the frozen production baseline byte-identical", () => {
    const path = join(process.cwd(), "tests/corpus/production-baseline.json");
    expect(createHash("md5").update(readFileSync(path)).digest("hex")).toBe(
      "277473947e2f4e627caed6892cfb0484",
    );
  });
});
