// Date extraction for bank SMS. Never invents a date or a clock time.

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

export interface ParsedDateInfo {
  iso: string;
  /** The source stated a calendar day but no clock time. */
  dayOnly: boolean;
}

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const up = meridiem.toUpperCase();
  if (up === "AM") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/**
 * Parse the many date shapes bank SMS use. Returns the ISO value plus whether
 * the source stated a clock time.
 */
export function parseDateInfo(raw: string): ParsedDateInfo | undefined {
  const m1 = raw.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i,
  );
  if (m1) {
    const hasTime = m1[4] !== undefined;
    const dt = new Date(
      Date.UTC(
        +m1[3],
        +m1[2] - 1,
        +m1[1],
        hasTime ? to24h(+m1[4], m1[7]) : 0,
        +(m1[5] ?? 0),
        +(m1[6] ?? 0),
      ),
    );
    if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
  }
  const m2 = raw.match(
    /\bON\s+(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2}))?/i,
  );
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const hasTime = m2[4] !== undefined;
      const dt = new Date(Date.UTC(+m2[3], mo, +m2[1], +(m2[4] ?? 0), +(m2[5] ?? 0)));
      if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
    }
  }
  const m3 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (m3) {
    const hasTime = m3[4] !== undefined;
    const dt = new Date(
      `${m3[1]}-${m3[2]}-${m3[3]}T${m3[4] ?? "00"}:${m3[5] ?? "00"}:${m3[6] ?? "00"}Z`,
    );
    if (!isNaN(dt.getTime())) return { iso: dt.toISOString(), dayOnly: !hasTime };
  }
  return undefined;
}
