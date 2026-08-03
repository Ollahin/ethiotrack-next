import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalDate,
  dayFromIso,
  formatDayShort,
  storageIso,
  timeFromIso,
  todayDay,
  yesterdayDay,
} from "./date";
import { formatDate, formatTxnDate } from "../format";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("calendar days never move", () => {
  it("keeps the day the SMS stated, in every offset", () => {
    // A day-only capture is stored as midnight; reading it back must give the
    // same calendar day whether the reader sits in +03:00 or -08:00.
    const iso = storageIso("2026-08-02");
    expect(dayFromIso(iso)).toBe("2026-08-02");
    expect(formatDate(iso)).toBe("Aug 02, 2026");
    expect(formatTxnDate(iso, true)).toBe("Aug 02, 2026");
    expect(formatDayShort(dayFromIso(iso))).toBe("Aug 02");
  });

  it("keeps a genuine source time exactly as captured", () => {
    const iso = storageIso("2026-07-24", "23:45");
    expect(iso).toBe("2026-07-24T23:45:00.000Z");
    expect(timeFromIso(iso)).toBe("23:45");
    expect(formatTxnDate(iso, false)).toBe("Jul 24, 23:45");
  });

  it("reads today and yesterday from the local calendar", () => {
    const now = new Date(2026, 7, 2, 1, 30);
    expect(todayDay(now)).toBe("2026-08-02");
    expect(yesterdayDay(now)).toBe("2026-08-01");
  });
});

describe("canonical date resolution", () => {
  it("never lets a batch date overwrite a genuine source date", () => {
    const d = canonicalDate({ sourceDate: "2026-07-24", batchDate: "2026-08-02" });
    expect(d.effectiveDate).toBe("2026-07-24");
    expect(d.effectiveProvenance).toBe("message");
    expect(d.hasGenuineDate).toBe(true);
  });

  it("uses the batch date only for undated rows", () => {
    const d = canonicalDate({ batchDate: "2026-08-02" });
    expect(d.effectiveDate).toBe("2026-08-02");
    expect(d.effectiveProvenance).toBe("batch");
    expect(d.hasGenuineDate).toBe(false);
  });

  it("holds a correction of a genuine date until it is confirmed", () => {
    const proposed = { sourceDate: "2026-07-24", reviewerDateOverride: "2026-07-25" };
    const held = canonicalDate(proposed);
    expect(held.conflict).toBe(true);
    expect(held.effectiveDate).toBe("2026-07-24");

    const confirmed = canonicalDate({ ...proposed, correctionConfirmed: true });
    expect(confirmed.conflict).toBe(false);
    expect(confirmed.effectiveDate).toBe("2026-07-25");
    expect(confirmed.effectiveProvenance).toBe("correction");
  });

  it("prefers sharing metadata over a batch date but not over the message", () => {
    expect(
      canonicalDate({ metadataDate: "2026-08-01", batchDate: "2026-08-02" }).effectiveDate,
    ).toBe("2026-08-01");
    expect(
      canonicalDate({ sourceDate: "2026-07-24", metadataDate: "2026-08-01" }).effectiveDate,
    ).toBe("2026-07-24");
  });

  it("has no date at all when nothing supplied one", () => {
    const d = canonicalDate({});
    expect(d.effectiveDate).toBeUndefined();
    expect(d.effectiveProvenance).toBe("none");
  });
});
