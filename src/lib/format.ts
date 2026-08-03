export function santimToEtb(santim: number): number {
  return santim / 100;
}

const nf = new Intl.NumberFormat("en-ET", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEtb(santim: number, withSymbol = true): string {
  const val = nf.format(santimToEtb(santim));
  return withSymbol ? `${val} ETB` : val;
}

export function parseEtbToSantim(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * A calendar day is rendered from the digits it was stored with. Day-only
 * values must never travel through the local timezone, or a saved Aug 02 can
 * be shown as Aug 01.
 */
export function formatDate(iso: string): string {
  const day = dayFromIso(iso);
  if (day) return formatDayLong(day);
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/**
 * Parse the many date shapes we see in Ethiopian bank SMS and OCR text.
 * Returns a Date (local for AM/PM variants, UTC for ISO/DMY variants) or null.
 */
export function parseEthiopianDate(raw: string): Date | null {
  const MONTHS: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const m1 = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (m1) {
    const dt = new Date(
      Date.UTC(+m1[3], +m1[2] - 1, +m1[1], +(m1[4] ?? 0), +(m1[5] ?? 0), +(m1[6] ?? 0)),
    );
    if (!isNaN(dt.getTime())) return dt;
  }
  const m2 = raw.match(/\bON\s+(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\b/i);
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const dt = new Date(Date.UTC(+m2[3], mo, +m2[1], +(m2[4] ?? 0), +(m2[5] ?? 0)));
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  const m3 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (m3) {
    const dt = new Date(`${m3[1]}-${m3[2]}-${m3[3]}T${m3[4]}:${m3[5]}:${m3[6] ?? "00"}Z`);
    if (!isNaN(dt.getTime())) return dt;
  }
  const m4 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (m4) {
    let h = parseInt(m4[4], 10);
    const ampm = m4[6].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const dt = new Date(
      parseInt(m4[1], 10),
      parseInt(m4[2], 10) - 1,
      parseInt(m4[3], 10),
      h,
      parseInt(m4[5], 10),
    );
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayISO(): string {
  return new Date().toISOString();
}

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Render a transaction timestamp at the precision the source actually gave.
 * Day-only captures (e.g. an MJ screenshot showing "24 Jul 2026") never get a
 * fabricated clock time; genuine source times are kept.
 */
export function formatTxnDate(iso: string, dayOnly?: boolean): string {
  return dayOnly ? formatDate(iso) : formatDateTime(iso);
}
