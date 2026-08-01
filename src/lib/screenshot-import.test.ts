import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORIENTATIONS,
  defaultSelection,
  failedOutcome,
  isRowComplete,
  outcomeFrom,
  pickOrientation,
  rowDateIso,
  runOrientedOcr,
  scoreCandidate,
  summarizeRows,
  type OcrCandidate,
  type Orientation,
} from "./screenshot-import";

const ROOT = resolve(__dirname, "../../tests/corpus/fixtures");
const IMAGES = resolve(ROOT, "images");

function fixtureText(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const MJ_CLEAN = fixtureText("ocr/mj-transfers-sent/photo-5.raw.txt");
const MJ_REVERSAL = fixtureText("ocr/mj-transfers-sent/photo-4.raw.txt");
const REFILL_CLEAN = fixtureText("ocr/refill-history/photo-64.raw.txt");

/** Deterministic stand-in for tesseract: maps an orientation to fixture text. */
function recognizerFor(map: Partial<Record<Orientation, string>>, confidence = 0.9) {
  return async (orientation: Orientation): Promise<OcrCandidate> => ({
    orientation,
    text: map[orientation] ?? "",
    confidence: map[orientation] ? confidence : 0.42,
  });
}

describe("scoreCandidate", () => {
  it("scores a clean MJ screenshot above unreadable text", () => {
    const good = scoreCandidate({ orientation: 0, text: MJ_CLEAN, confidence: 0.9 });
    const junk = scoreCandidate({ orientation: 180, text: "|||  ~~~  ???", confidence: 0.95 });
    expect(good.match.kind).toBe("mj");
    expect(good.score).toBeGreaterThan(junk.score);
  });

  it("classifies Refill History screenshots", () => {
    const s = scoreCandidate({ orientation: 0, text: REFILL_CLEAN, confidence: 0.88 });
    expect(s.match.kind).toBe("refill");
    expect(s.match.rows.filter((r) => r.ok).length).toBeGreaterThanOrEqual(8);
  });
});

describe("orientation detection", () => {
  it("prefers the upright candidate when several are offered", () => {
    const best = pickOrientation([
      { orientation: 0, text: "garbage", confidence: 0.99 },
      { orientation: 90, text: MJ_CLEAN, confidence: 0.8 },
    ]);
    expect(best?.candidate.orientation).toBe(90);
  });

  it("breaks ties toward the smallest rotation", () => {
    const best = pickOrientation([
      { orientation: 270, text: MJ_CLEAN, confidence: 0.8 },
      { orientation: 0, text: MJ_CLEAN, confidence: 0.8 },
    ]);
    expect(best?.candidate.orientation).toBe(0);
  });

  it("returns null with no candidates", () => {
    expect(pickOrientation([])).toBeNull();
  });

  it("accepts an upright screenshot without probing rotations", async () => {
    const { best, tried } = await runOrientedOcr(recognizerFor({ 0: MJ_CLEAN }));
    expect(best.candidate.orientation).toBe(0);
    expect(tried).toEqual([0]);
  });

  it("recovers a 270°-rotated screenshot", async () => {
    const { best, tried } = await runOrientedOcr(recognizerFor({ 270: REFILL_CLEAN }));
    expect(best.candidate.orientation).toBe(270);
    expect(tried).toEqual([...ORIENTATIONS]);
    expect(best.match.kind).toBe("refill");
  });

  it("survives a recognizer that throws on some orientations", async () => {
    const inner = recognizerFor({ 180: MJ_CLEAN });
    const { best } = await runOrientedOcr(async (o) => {
      if (o === 0 || o === 90) throw new Error("engine crash");
      return inner(o);
    });
    expect(best.candidate.orientation).toBe(180);
  });

  it("throws only when every orientation fails", async () => {
    await expect(
      runOrientedOcr(async () => {
        throw new Error("engine crash");
      }),
    ).rejects.toThrow("engine crash");
  });
});

describe("row completeness and selection", () => {
  it("keeps MJ negative amounts as reversals and still selectable", () => {
    const out = outcomeFrom(scoreCandidate({ orientation: 0, text: MJ_REVERSAL, confidence: 0.9 }));
    const reversals = out.rows.filter((r) => r.isReversal);
    expect(reversals.length).toBeGreaterThanOrEqual(2);
    for (const r of reversals) {
      expect(r.amountSantim).toBeGreaterThan(0);
      expect(isRowComplete(r)).toBe(true);
    }
  });

  it("leaves cropped/incomplete rows unselected", () => {
    const cropped = ["@ Transfers", "Sent", "2 samplewallet - samplewallet", "21,000.00"].join(
      "\n",
    );
    const out = outcomeFrom(scoreCandidate({ orientation: 0, text: cropped, confidence: 0.8 }));
    expect(out.rows.every((r) => !isRowComplete(r))).toBe(true);
    expect(out.selected.every((s) => s === false)).toBe(true);
    expect(out.status).toBe("empty");
  });

  it("never invents fields on unresolved rows", () => {
    const cropped = "@ Transfers\nSent\n48,500.00\n";
    const out = outcomeFrom(scoreCandidate({ orientation: 0, text: cropped, confidence: 0.8 }));
    for (const row of out.rows.filter((r) => !r.ok)) {
      expect(row.agentName).toBeUndefined();
      expect(row.dateText).toBeUndefined();
    }
  });

  it("does not silently drop repeated rows", () => {
    const out = outcomeFrom(
      scoreCandidate({ orientation: 0, text: REFILL_CLEAN, confidence: 0.9 }),
    );
    const maple = out.rows.filter((r) => r.agentName === "Sample Agent Maple");
    expect(maple).toHaveLength(2);
    const cedar = out.rows.filter((r) => r.agentName === "Sample Agent Cedar");
    expect(cedar.length).toBeGreaterThanOrEqual(4);
  });

  it("summarizes complete rows only", () => {
    const out = outcomeFrom(scoreCandidate({ orientation: 0, text: MJ_CLEAN, confidence: 0.9 }));
    const s = summarizeRows(out.rows);
    expect(s.complete).toBe(5);
    expect(s.totalSantim).toBe(
      out.rows.filter(isRowComplete).reduce((a, r) => a + (r.amountSantim ?? 0), 0),
    );
    expect(defaultSelection(out.rows).filter(Boolean)).toHaveLength(5);
  });
});

describe("failure handling", () => {
  it("parses captured row dates and refuses to invent missing ones", () => {
    const pm = rowDateIso("2026-08-02 4:51 PM")!;
    expect(new Date(pm).getHours()).toBe(16);
    expect(new Date(pm).getMinutes()).toBe(51);
    const am = rowDateIso("2026-08-02 12:19 AM")!;
    expect(new Date(am).getHours()).toBe(0);
    const dateOnly = rowDateIso("2026-08-02")!;
    expect(new Date(dateOnly).getHours()).toBe(0);
    expect(rowDateIso(undefined)).toBeNull();
    expect(rowDateIso("yesterday")).toBeNull();
    expect(rowDateIso("2026-13-02 4:51 PM")).toBeNull();
  });

  it("produces a retryable failed outcome that keeps no invented rows", () => {
    const out = failedOutcome(new Error("worker did not load"));
    expect(out.status).toBe("failed");
    expect(out.rows).toHaveLength(0);
    expect(out.error).toBe("worker did not load");
  });
});

describe("sanitized image fixtures", () => {
  // Images are never committed (corpus guard); the generator + README are.
  it("ships the deterministic generator and its documentation", () => {
    for (const n of ["generate.py", "README.md"]) {
      const p = resolve(IMAGES, n);
      expect(existsSync(p), n).toBe(true);
      expect(readFileSync(p, "utf8").length).toBeGreaterThan(200);
    }
  });

  it("documents all five smoke-test screenshots", () => {
    const doc = readFileSync(resolve(IMAGES, "README.md"), "utf8");
    for (const n of [
      "mj-clean.png",
      "mj-reversal.png",
      "refill-clean.png",
      "mj-rotated-90.png",
      "mj-cropped.png",
    ]) {
      expect(doc, n).toContain(n);
    }
  });
});

describe("rowDateParts", () => {
  it("accepts a day-only statement date and flags it", () => {
    const d = rowDateParts("24 Jul 2026");
    expect(d?.dayOnly).toBe(true);
    expect(d?.iso).toBe(new Date(2026, 6, 24, 0, 0, 0, 0).toISOString());
  });

  it("keeps a captured clock time as not day-only", () => {
    expect(rowDateParts("2026-08-02 4:51 PM")?.dayOnly).toBe(false);
  });

  it("refuses a truncated year rather than guessing", () => {
    expect(rowDateParts("24 Jul 202")).toBeNull();
    expect(rowDateParts("Jul 2026")).toBeNull();
  });
});
