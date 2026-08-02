import { describe, expect, it } from "vitest";
import {
  appendToBatch,
  applyBatchDate,
  buildBatch,
  removeCandidates,
  resolveCandidateDate,
  setRowDate,
  undatedCandidates,
} from "./batch";

const UNDATED = "Dear Customer, ETB 500.00 has been debited from your account 1000****1234.";

describe("canonical capture batch", () => {
  it("keeps one candidate per message, in source order, including unreadable ones", () => {
    const batch = buildBatch(`${UNDATED}\n\nnot a transaction at all`)!;
    expect(batch.candidates.length).toBeGreaterThanOrEqual(1);
    expect(batch.candidates.map((c) => c.index)).toEqual(
      batch.candidates.map((_, i) => i),
    );
  });

  it("never invents a date and reports its provenance", () => {
    const batch = buildBatch(UNDATED)!;
    const c = batch.candidates[0];
    expect(resolveCandidateDate(batch, c)).toBeNull();
    const dated = applyBatchDate(batch, { date: "2026-02-01" });
    expect(resolveCandidateDate(dated, c)).toMatchObject({
      provenance: "batch",
      dayOnly: true,
    });
    const overridden = setRowDate(dated, c.id, { date: "2026-02-02", time: "09:30" });
    expect(resolveCandidateDate(overridden, c)).toMatchObject({
      provenance: "manual",
      dayOnly: false,
    });
  });

  it("lists undated candidates so one date can cover the whole batch", () => {
    const batch = buildBatch(`${UNDATED}\n\n${UNDATED}`)!;
    expect(undatedCandidates(batch).length).toBe(
      batch.candidates.filter((c) => c.row.ok).length,
    );
  });

  it("appends a second paste without disturbing existing candidate ids", () => {
    const first = buildBatch(UNDATED)!;
    const keptId = first.candidates[0].id;
    const merged = appendToBatch(first, UNDATED);
    expect(merged.candidates[0].id).toBe(keptId);
    expect(merged.candidates.length).toBe(first.candidates.length * 2);
  });

  it("removes only imported candidates and prunes their decisions", () => {
    const batch = buildBatch(`${UNDATED}\n\n${UNDATED}`)!;
    const [a, b] = batch.candidates;
    const withDates = setRowDate(setRowDate(batch, a.id, { date: "2026-02-01" }), b.id, {
      date: "2026-02-02",
    });
    const left = removeCandidates(withDates, [a.id])!;
    expect(left.candidates.map((c) => c.id)).toEqual([b.id]);
    expect(left.overrides[a.id]).toBeUndefined();
    expect(left.overrides[b.id]?.date).toBe("2026-02-02");
  });

  it("returns null once every candidate has been imported", () => {
    const batch = buildBatch(UNDATED)!;
    expect(removeCandidates(batch, batch.candidates.map((c) => c.id))).toBeNull();
  });
});