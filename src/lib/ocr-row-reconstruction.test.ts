import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectEvidence,
  looksLikeParty,
  reconstructRows,
  tokenizeOcrLine,
} from "./ocr-row-reconstruction";

const FIXTURES = resolve(__dirname, "../../tests/corpus/fixtures/ocr");
const refill = (n: string) =>
  readFileSync(resolve(FIXTURES, `refill-history/${n}.raw.txt`), "utf8");
const mj = (n: string) => readFileSync(resolve(FIXTURES, `mj-transfers-sent/${n}.raw.txt`), "utf8");

describe("evidence tokenization", () => {
  it("splits a party+amount line into ordered tokens", () => {
    const t = tokenizeOcrLine({ text: "Sample Agent Aspen 310,000 Birr" }, 4);
    expect(t.map((x) => x.kind)).toEqual(["party", "amount"]);
    expect(t[0].column).toBe(0);
    expect(t[1].amountSantim).toBe(31_000_000);
    expect(t.every((x) => x.lineIndex === 4)).toBe(true);
  });

  it("reads a date+amount line without confusing the two", () => {
    const t = tokenizeOcrLine({ text: "2026-08-02 4:51 PM  -1,250.00" }, 0);
    expect(t.map((x) => x.kind)).toEqual(["date", "amount"]);
    expect(t[1].amountSantim).toBe(125_000);
    expect(t[1].isReversal).toBe(true);
  });

  it("keeps optional bounding coordinates on every token from a line", () => {
    const bbox = { x: 1, y: 2, width: 3, height: 4 };
    const t = tokenizeOcrLine({ text: "Agent Larch 19,640 Birr", bbox }, 1);
    expect(t.every((x) => x.bbox === bbox)).toBe(true);
  });

  it("never treats a bare year or app chrome as evidence", () => {
    expect(tokenizeOcrLine({ text: "2026" }, 0)).toHaveLength(0);
    expect(tokenizeOcrLine({ text: "Refill History" }, 0)).toHaveLength(0);
    expect(looksLikeParty("Add Agent")).toBe(false);
    expect(looksLikeParty("Jul")).toBe(false);
    expect(looksLikeParty("67%")).toBe(false);
  });

  it("recovers evidence from noisy status-bar lines", () => {
    const { tokens } = collectEvidence("22:10 8 ® BNC 67% =\n< Refill History\n");
    expect(tokens).toHaveLength(0);
  });
});

describe("row reconstruction on sanitized Refill fixtures", () => {
  it("reconstructs every row of photo-64 in source order", () => {
    const r = reconstructRows(refill("photo-64"));
    expect(r.rows).toHaveLength(9);
    expect(r.rows.every((x) => x.complete)).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.coverage).toBe(1);
    expect(r.rows[0].agentName).toBe("Sample Agent Cedar");
    expect(r.rows[0].amountSantim).toBe(20_500_000);
    expect(r.rows[0].dateText).toBe("2026-08-02 4:51 PM");
    expect(r.rows.map((x) => x.sourceOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("preserves repeated same-party rows and repeated amounts", () => {
    const rows = reconstructRows(refill("photo-64")).rows;
    expect(rows.filter((x) => x.agentName === "Sample Agent Cedar")).toHaveLength(5);
    expect(rows.filter((x) => x.amountSantim === 3_250_000)).toHaveLength(2);
  });

  it("handles the other Refill fixtures with full coverage", () => {
    for (const name of ["photo-49", "photo-51"]) {
      const r = reconstructRows(refill(name));
      expect(r.rows.length, name).toBeGreaterThanOrEqual(8);
      expect(r.partial, name).toBe(false);
    }
  });

  it("finds amount anchors in MJ transfer screenshots", () => {
    const r = reconstructRows(mj("photo-5"));
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
    expect(r.rows.every((x) => x.amountSantim > 0)).toBe(true);
  });
});

describe("layout variations", () => {
  it("handles party → amount → date", () => {
    const rows = reconstructRows(
      [
        "Agent One",
        "12,000.00",
        "2026-08-02 4:51 PM",
        "Agent Two",
        "9,500.00",
        "2026-08-02 5:00 PM",
      ].join("\n"),
    ).rows;
    expect(rows.map((r) => [r.agentName, r.amountSantim, r.dateText])).toEqual([
      ["Agent One", 1_200_000, "2026-08-02 4:51 PM"],
      ["Agent Two", 950_000, "2026-08-02 5:00 PM"],
    ]);
  });

  it("handles date → party → amount", () => {
    const rows = reconstructRows(
      [
        "2026-08-02 4:51 PM",
        "Agent One",
        "12,000.00",
        "2026-08-02 5:00 PM",
        "Agent Two",
        "9,500.00",
      ].join("\n"),
    ).rows;
    expect(rows.map((r) => [r.agentName, r.dateText])).toEqual([
      ["Agent One", "2026-08-02 4:51 PM"],
      ["Agent Two", "2026-08-02 5:00 PM"],
    ]);
  });

  it("handles party+amount on one line with the date below", () => {
    const rows = reconstructRows(
      [
        "Agent One 12,000 Birr",
        "2026-08-02 4:51 PM",
        "Agent Two 9,500 Birr",
        "2026-08-02 5:00 PM",
      ].join("\n"),
    ).rows;
    expect(rows.map((r) => [r.agentName, r.amountSantim, r.dateText])).toEqual([
      ["Agent One", 1_200_000, "2026-08-02 4:51 PM"],
      ["Agent Two", 950_000, "2026-08-02 5:00 PM"],
    ]);
  });

  it("handles date+amount on one line with the party above", () => {
    const rows = reconstructRows(
      [
        "Agent One",
        "2026-08-02 4:51 PM 12,000 Birr",
        "Agent Two",
        "2026-08-02 5:00 PM 9,500 Birr",
      ].join("\n"),
    ).rows;
    expect(rows.map((r) => [r.agentName, r.amountSantim, r.dateText])).toEqual([
      ["Agent One", 1_200_000, "2026-08-02 4:51 PM"],
      ["Agent Two", 950_000, "2026-08-02 5:00 PM"],
    ]);
  });

  it("tolerates adjacent line reordering within a row", () => {
    const rows = reconstructRows(
      [
        "Agent One",
        "2026-08-02 4:51 PM",
        "12,000.00",
        "Agent Two",
        "2026-08-02 5:00 PM",
        "9,500.00",
      ].join("\n"),
    ).rows;
    expect(rows.map((r) => [r.agentName, r.dateText])).toEqual([
      ["Agent One", "2026-08-02 4:51 PM"],
      ["Agent Two", "2026-08-02 5:00 PM"],
    ]);
  });
});

describe("abstention and non-overlap", () => {
  it("keeps repeated same-party/same-amount/same-day rows", () => {
    const rows = reconstructRows(
      [
        "Agent One 12,000 Birr",
        "2026-08-02 4:51 PM",
        "Agent One 12,000 Birr",
        "2026-08-02 4:51 PM",
        "Agent One 12,000 Birr",
        "2026-08-02 4:51 PM",
      ].join("\n"),
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.complete)).toBe(true);
  });

  it("marks a missing party as incomplete without borrowing a neighbour's", () => {
    const r = reconstructRows(
      ["Agent One 12,000 Birr", "2026-08-02 4:51 PM", "9,500 Birr", "2026-08-02 5:00 PM"].join(
        "\n",
      ),
    );
    expect(r.rows[0].agentName).toBe("Agent One");
    expect(r.rows[1].agentName).toBeUndefined();
    expect(r.rows[1].missing).toEqual(["party"]);
    expect(r.rows[1].complete).toBe(false);
    expect(r.partial).toBe(true);
  });

  it("marks a missing date as incomplete without borrowing a neighbour's", () => {
    const r = reconstructRows(
      ["Agent One 12,000 Birr", "Agent Two 9,500 Birr", "2026-08-02 5:00 PM"].join("\n"),
    );
    expect(r.rows[0].dateText).toBeUndefined();
    expect(r.rows[0].missing).toEqual(["date"]);
    expect(r.rows[1].dateText).toBe("2026-08-02 5:00 PM");
  });

  it("consumes each evidence token at most once", () => {
    const r = reconstructRows(
      ["Agent One", "12,000.00", "9,500.00", "2026-08-02 5:00 PM"].join("\n"),
    );
    const parties = r.rows.filter((x) => x.agentName).length;
    const dates = r.rows.filter((x) => x.dateText).length;
    expect(parties).toBe(1);
    expect(dates).toBe(1);
    expect(r.rows).toHaveLength(2);
  });

  it("keeps a cropped first and last row visible as incomplete", () => {
    const r = reconstructRows(
      ["48,500.00", "Agent One 12,000 Birr", "2026-08-02 4:51 PM", "31,000.00"].join("\n"),
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].complete).toBe(false);
    expect(r.rows[2].complete).toBe(false);
    expect(r.rows[0].amountSantim).toBe(4_850_000);
    expect(r.rows[2].amountSantim).toBe(3_100_000);
    expect(r.partial).toBe(true);
    expect(r.coverage).toBeLessThan(1);
  });

  it("keeps a negative amount as a reversal anchor", () => {
    const r = reconstructRows(["Agent One", "-12,000.00", "2026-08-02 4:51 PM"].join("\n"));
    expect(r.rows[0].isReversal).toBe(true);
    expect(r.rows[0].amountSantim).toBe(1_200_000);
  });

  it("never invents fields on an unresolved row", () => {
    const r = reconstructRows("48,500.00\n");
    expect(r.rows[0].agentName).toBeUndefined();
    expect(r.rows[0].dateText).toBeUndefined();
    expect(r.rows[0].missing).toEqual(["party", "date"]);
  });
});
