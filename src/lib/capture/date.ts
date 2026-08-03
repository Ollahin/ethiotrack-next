// Canonical date model for a captured message.
//
// A calendar day is a STRING (YYYY-MM-DD) from the moment it is read out of a
// message until the moment it is rendered. Day-only values are never passed
// through Date, Date.UTC or toISOString, because every one of those steps can
// move the day by one in a non-UTC timezone. Time is a separate, optional
// value and is only ever the one the source itself stated.

/** Where the day being used actually came from. */
export type SourceDateOrigin = "message" | "metadata" | "none";
export type EffectiveDateOrigin = "message" | "metadata" | "batch" | "correction" | "none";

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export function isDay(v: string | undefined | null): v is string {
  return typeof v === "string" && DAY_RE.test(v);
}

/**
 * The calendar day carried by an ISO timestamp, read as text. The parsers build
 * their ISO values with Date.UTC from the literal digits in the message, so the
 * first ten characters ARE the day the message stated.
 */
export function dayFromIso(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const day = iso.slice(0, 10);
  return DAY_RE.test(day) ? day : undefined;
}

/** The clock time an ISO timestamp carries, or undefined for a day-only value. */
export function timeFromIso(iso: string | undefined, dayOnly?: boolean): string | undefined {
  if (!iso || dayOnly) return undefined;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : undefined;
}

/** Local calendar day as YYYY-MM-DD — used by Today/Yesterday. */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayDay(now: Date = new Date()): string {
  return localDay(now);
}

export function yesterdayDay(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - 1);
  return localDay(d);
}

const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-07-24" -> "Jul 24". Pure string work; no timezone can touch it. */
export function formatDayShort(day: string | undefined): string {
  if (!isDay(day)) return "";
  const month = MONTH_LABEL[Number(day.slice(5, 7)) - 1] ?? day.slice(5, 7);
  return `${month} ${day.slice(8, 10)}`;
}

/** "2026-07-24" -> "Jul 24, 2026". */
export function formatDayLong(day: string | undefined): string {
  if (!isDay(day)) return "";
  return `${formatDayShort(day)}, ${day.slice(0, 4)}`;
}

export interface CanonicalDateInput {
  /** Day stated by the message itself, if any. */
  sourceDate?: string;
  /** Clock time stated by the message itself, if any. */
  sourceTime?: string;
  /** Genuine timestamp handed over by the sharing application. */
  metadataDate?: string;
  metadataTime?: string;
  /** Reviewer day applied to rows that carry no genuine date of their own. */
  batchDate?: string;
  /** Explicit correction of a genuine source date. Requires confirmation. */
  reviewerDateOverride?: string;
  reviewerTimeOverride?: string;
  /** The reviewer confirmed the correction of a genuine source date. */
  correctionConfirmed?: boolean;
}

export interface CanonicalDate {
  sourceDate?: string;
  sourceTime?: string;
  sourceDateProvenance: SourceDateOrigin;
  reviewerDateOverride?: string;
  reviewerTimeOverride?: string;
  /** The day that will be saved. Undefined when nothing has supplied one. */
  effectiveDate?: string;
  effectiveTime?: string;
  effectiveProvenance: EffectiveDateOrigin;
  /** True when the message stated its own day. */
  hasGenuineDate: boolean;
  /** A correction disagrees with a genuine source date and is not confirmed. */
  conflict: boolean;
}

/**
 * Resolve one candidate's date. Order, strictly: a confirmed correction, the
 * message's own day, genuine sharing metadata, then the reviewer's batch day.
 * The batch day can never overwrite a genuine source day.
 */
export function canonicalDate(i: CanonicalDateInput): CanonicalDate {
  const sourceDate = isDay(i.sourceDate) ? i.sourceDate : undefined;
  const metadataDate = isDay(i.metadataDate) ? i.metadataDate : undefined;
  const batchDate = isDay(i.batchDate) ? i.batchDate : undefined;
  const override = isDay(i.reviewerDateOverride) ? i.reviewerDateOverride : undefined;

  const genuine = sourceDate ?? metadataDate;
  const provenance: SourceDateOrigin = sourceDate ? "message" : metadataDate ? "metadata" : "none";
  const genuineTime = sourceDate ? i.sourceTime : metadataDate ? i.metadataTime : undefined;

  // A correction that disagrees with a genuine day is held until confirmed.
  const conflict = Boolean(genuine && override && override !== genuine && !i.correctionConfirmed);

  let effectiveDate: string | undefined;
  let effectiveTime: string | undefined;
  let effectiveProvenance: EffectiveDateOrigin = "none";

  if (override && (!genuine || override === genuine || i.correctionConfirmed)) {
    effectiveDate = override;
    effectiveTime = i.reviewerTimeOverride;
    effectiveProvenance = genuine ? "correction" : "batch";
    if (genuine && override === genuine) {
      effectiveProvenance = provenance === "metadata" ? "metadata" : "message";
      effectiveTime = i.reviewerTimeOverride ?? genuineTime;
    }
  } else if (genuine) {
    effectiveDate = genuine;
    effectiveTime = genuineTime;
    effectiveProvenance = provenance === "metadata" ? "metadata" : "message";
  } else if (batchDate) {
    effectiveDate = batchDate;
    effectiveProvenance = "batch";
  }

  return {
    sourceDate,
    sourceTime: sourceDate ? i.sourceTime : undefined,
    sourceDateProvenance: provenance,
    reviewerDateOverride: override,
    reviewerTimeOverride: i.reviewerTimeOverride,
    effectiveDate,
    effectiveTime: effectiveDate ? effectiveTime : undefined,
    effectiveProvenance,
    hasGenuineDate: Boolean(genuine),
    conflict,
  };
}

/**
 * The value stored on a Transaction. The day is written verbatim into the ISO
 * string, so reading it back with dayFromIso returns exactly the same day in
 * every timezone.
 */
export function storageIso(day: string, time?: string): string {
  const t = time && TIME_RE.test(time) ? (time.length === 5 ? `${time}:00` : time) : "00:00:00";
  return `${day}T${t}.000Z`;
}
