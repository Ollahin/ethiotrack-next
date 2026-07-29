import { describe, it, expect } from "vitest";
import { parseStatementText } from "./distributor-parser";

// Fixtures reproduce the OCR shape we get from real screenshots:
// amounts are always right-aligned on their own or end-of-line, dates and
// times sit on separate lines, and agent names are alphabet-only.

describe("parseStatementText — MJ layout", () => {
  // MJ "Transfers → Sent" screens carry no date column: each visible card is a
  // repeated account label, an amount on its own line and an agent name.
  // Parsing is deterministic amount-anchored reconstruction; one amount anchor
  // opens one row, and an agent binds only when the window holds exactly one
  // defensible candidate.
  it("parses an account-label / amount / agent card", () => {
    const text = ["sampleagent - sampleagent", "20,000.00", "Abebe Kebede"].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ok).toBe(true);
    expect(r.agentName).toBe("Abebe Kebede");
    expect(r.amountSantim).toBe(2_000_000);
    expect(r.isReversal).toBeFalsy();
    expect(r.airtimeType).toBe("airtime_evd");
  });

  it("captures a confirmed reversal as positive amount with isReversal", () => {
    const text = ["sampleagent - sampleagent", "-50,000.00", "Chala Bekele"].join("\n");
    const [r] = parseStatementText(text, "mj");
    expect(r.ok).toBe(true);
    expect(r.amountSantim).toBe(5_000_000);
    expect(r.isReversal).toBe(true);
    expect(r.needsReview).toBe(true);
  });

  it("treats a detached minus as OCR sign noise, never as a reversal", () => {
    const text = ["sampleagent - sampleagent", "- 50,000.00", "Chala Bekele"].join("\n");
    const [r] = parseStatementText(text, "mj");
    expect(r.ok).toBe(true);
    expect(r.amountSantim).toBe(5_000_000);
    expect(r.isReversal).toBe(false);
  });

  it("never binds the repeated account label as the agent", () => {
    const text = ["sampleagent - sampleagent", "10,000.00", "Selam Alemu"].join("\n");
    const [r] = parseStatementText(text, "mj");
    expect(r.agentName).toBe("Selam Alemu");
    expect(r.amountSantim).toBe(1_000_000);
  });

  it("parses multiple stacked cards and keeps repeated agents separate", () => {
    const text = [
      "sampleagent - sampleagent",
      "20,000.00",
      "Abebe Kebede",
      "sampleagent - sampleagent",
      "15,000.00",
      "Meron Tadesse",
      "sampleagent - sampleagent",
      "15,000.00",
      "Meron Tadesse",
    ].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Abebe Kebede",
      "Meron Tadesse",
      "Meron Tadesse",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([2_000_000, 1_500_000, 1_500_000]);
  });

  it("surfaces an amount with no defensible agent as a review row, never a guess", () => {
    const text = ["sampleagent - sampleagent", "20,000.00"].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows.filter((r) => r.ok)).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].reason).toBe("no agent");
  });

  it("surfaces an ambiguous window as a review row, never a guess", () => {
    const text = ["2,000.00", "Sample Agent Alpha", "Sample Agent Beta"].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows.filter((r) => r.ok)).toHaveLength(0);
    expect(rows[0].reason).toBe("ambiguous agent");
  });
});

describe("parseStatementText — Refill History layout (Alami / Yenus / Modern App)", () => {
  it("parses name / date-time / amount triplet", () => {
    const text = ["Hana Girma", "2025-07-05 10:22 AM", "5,000 Birr"].join("\n");
    const [r] = parseStatementText(text, "alami");
    expect(r.ok).toBe(true);
    expect(r.agentName).toBe("Hana Girma");
    expect(r.amountSantim).toBe(500_000);
    expect(r.airtimeType).toBe("airtime_evd");
  });

  it("rejects a numeric string as a name", () => {
    const text = ["2025-07-05", "10:22 AM", "5,000 Birr"].join("\n");
    const rows = parseStatementText(text, "yenus");
    // No alphabetic name in scope — parser must NOT accept the date as name.
    expect(rows[0]?.ok).toBeFalsy();
  });

  it("only treats right-aligned '<n> Birr' as an amount", () => {
    const text = [
      "Sara Bekele",
      "2025-07-06 03:15 PM",
      "12,500 Birr",
      "Note: 5,000 Birr reserved earlier in day", // mid-line, must be ignored
    ].join("\n");
    const rows = parseStatementText(text, "modern-app");
    // Only the anchored line should produce a row.
    const okRows = rows.filter((r) => r.ok);
    expect(okRows).toHaveLength(1);
    expect(okRows[0].amountSantim).toBe(1_250_000);
  });

  it("parses multiple refill rows in sequence", () => {
    const text = [
      "Abel Mekonnen",
      "2025-07-05 09:10 AM",
      "3,000 Birr",
      "Tsion Haile",
      "2025-07-05 11:45 AM",
      "7,500 Birr",
    ].join("\n");
    const rows = parseStatementText(text, "alami").filter((r) => r.ok);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.agentName)).toEqual(["Abel Mekonnen", "Tsion Haile"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([300_000, 750_000]);
  });
});

describe("parseStatementText — junk-row guards (regression)", () => {
  it("parses an MJ Transfers screenshot into one row per visible amount", () => {
    // Mirrors the OCR of a Transfers → Sent screenshot: chrome header, then a
    // repeated account label, a right-aligned amount and the agent name.
    const text = [
      "Transfers",
      "Received Sent",
      "sampleagent - sampleagent",
      "20,000.00",
      "Bokiii",
      "sampleagent - sampleagent",
      "10,000.00",
      "Dammeeeecard",
      "sampleagent - sampleagent",
      "257,300.00",
      "Abduyyeee",
      "sampleagent - sampleagent",
      "50,000.00",
      "Nasreddddinnncarddd",
      "sampleagent - sampleagent",
      "21,620.00",
      "SampleZ",
    ].join("\n");
    const rows = parseStatementText(text, "mj").filter((r) => r.ok);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Bokiii",
      "Dammeeeecard",
      "Abduyyeee",
      "Nasreddddinnncarddd",
      "SampleZ",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([
      2_000_000, 1_000_000, 25_730_000, 5_000_000, 2_162_000,
    ]);
    // MJ screens carry no date token; the parser must never invent one.
    expect(rows.every((r) => r.dateText === undefined)).toBe(true);
    expect(rows.every((r) => r.needsReview)).toBe(true);
  });

  it("parses MJ Transfers list where amount and '& Agent' are on separate lines with no date", () => {
    const text = [
      "Transfers",
      "Sent",
      "sampleagent - sampleagent",
      "15,000.00",
      "-",
      "& Sintayehu",
      "sampleagent - sampleagent",
      "10,000.00",
      "& Jireeeeee",
      "sampleagent - sampleagent",
      "5,000.00",
      "& Baliyyuuu",
      "sampleagent - sampleagent",
      "10,000.00",
      "& Kaleebbbbb",
      "sampleagent - sampleagent",
      "25,000.00",
      "oA Gojeeeee",
    ].join("\n");
    const rows = parseStatementText(text, "mj").filter((r) => r.ok);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Sintayehu",
      "Jireeeeee",
      "Baliyyuuu",
      "Kaleebbbbb",
      "Gojeeeee",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([
      1_500_000, 1_000_000, 500_000, 1_000_000, 2_500_000,
    ]);
  });

  it("parses transfer screenshot rows with OCR list-number prefixes", () => {
    const text = [
      "2236 Me @@ Qf 8 al 56%m",
      "@ Transfers",
      "Sent",
      "2 sampleagent - sampleagent",
      "50,000.00",
      "2 Biruke",
      "2 sampleagent - sampleagent",
      "5,000.00",
      "2 Jireeeeee",
      "2 sampleagent - sampleagent",
      "20,000.00",
      "5 AbdiBalee",
    ].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.agentName)).toEqual(["Biruke", "Jireeeeee", "AbdiBalee"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([5_000_000, 500_000, 2_000_000]);
    expect(rows.every((r) => r.needsReview)).toBe(true);
  });

  it("strips trailing 'Birr' label from a name line", () => {
    // OCR often glues the currency label onto the name row.
    const text = ["Birukeee Birr", "2026-07-22 4:51 PM", "200,000.00 Birr"].join("\n");
    const [r] = parseStatementText(text, "alami").filter((x) => x.ok);
    expect(r.agentName).toBe("Birukeee");
    expect(r.amountSantim).toBe(20_000_000);
  });

  it("never treats a 4-digit year rendered as '2,026' as an amount", () => {
    // Reproduces the bug where the year 2026 was parsed as ETB 2,026.00.
    const text = ["-07-22 4 51 PM", "2,026.00 Birr"].join("\n");
    const rows = parseStatementText(text, "yenus").filter((r) => r.ok);
    expect(rows).toHaveLength(0);
  });

  it("rejects a date-fragment / loose-time line as an agent name", () => {
    const text = ["-07-22 4 51 PM", "2026-07-22 4:51 PM", "20,000 Birr"].join("\n");
    const rows = parseStatementText(text, "modern-app").filter((r) => r.ok);
    // No valid alphabetic name in scope → nothing should commit.
    expect(rows).toHaveLength(0);
  });

  it("parses refill screenshot lists only from inline agent-amount rows", () => {
    const text = [
      "2237 MO LICH lal] GL",
      "« Refill History",
      "Birukeee 200,000 Birr",
      "2026-07-22 4:51 PM",
      "Tsegaaa 20,000 Birr",
      "2026-07-22 1:05 PM",
      "Tsegaaa 20,000 Birr",
      "2026-07-22 12:19 PM",
      "Birukeee 30,000 Birr",
      "2026-07-22 10:51 AM",
      "Birukeee 30,000 Birr",
      "2026-07-22 7:51 AM",
      "SampleZ 21,620 Birr",
      "2026-07-22 6:44 AM",
      "Enginer Abdi 75,675 Birr",
      "2026-07-22 6:42 AM",
      "Birukeee 200,000 Birr",
      "2026-07-21 4:59 PM",
      "Birukeee 1,600 Birr",
      "2026-07-20 4:38 PM",
      "i= + $ x)",
      "Agents Add Agent Refill Refill History",
    ].join("\n");

    const rows = parseStatementText(text, "yenus").filter((r) => r.ok);
    const genericRows = parseStatementText(text, "generic").filter((r) => r.ok);

    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Birukeee",
      "Tsegaaa",
      "Tsegaaa",
      "Birukeee",
      "Birukeee",
      "SampleZ",
      "Enginer Abdi",
      "Birukeee",
      "Birukeee",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([
      20_000_000, 2_000_000, 2_000_000, 3_000_000, 3_000_000, 2_162_000, 7_567_500, 20_000_000,
      160_000,
    ]);
    expect(rows.map((r) => r.dateText)).toEqual([
      "2026-07-22 4:51 PM",
      "2026-07-22 1:05 PM",
      "2026-07-22 12:19 PM",
      "2026-07-22 10:51 AM",
      "2026-07-22 7:51 AM",
      "2026-07-22 6:44 AM",
      "2026-07-22 6:42 AM",
      "2026-07-21 4:59 PM",
      "2026-07-20 4:38 PM",
    ]);
    expect(genericRows).toEqual(rows);
  });

  it("parses annotated MJ cards and ignores interleaved footer noise", () => {
    const text = [
      "236m e@® Nl 8 al 56%",
      "@ Transfers",
      "Received Sent",
      "sampleagent - sampleagent",
      "20,000.00",
      "Bokiii",
      "sampleagent - sampleagent",
      "10,000.00",
      "Dammeeeecard",
      "sampleagent - sampleagent",
      "257,300.00",
      "Abduyyeee",
    ].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.agentName)).toEqual(["Bokiii", "Dammeeeecard", "Abduyyeee"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([2_000_000, 1_000_000, 25_730_000]);
    expect(rows.every((r) => r.dateText === undefined)).toBe(true);
  });

  it("does not guess rows from a Transfers screenshot when no MJ card is complete", () => {
    const text = [
      "@ Transfers",
      "Sent",
      "sampleagent - sampleagent",
      "2026-07-22 4:51 PM",
      "2,026.00",
      "Agents Add Agent Refill",
    ].join("\n");

    expect(parseStatementText(text, "generic").filter((r) => r.ok)).toHaveLength(0);
  });

  it("keeps legitimate 2,026 Birr refill rows when the agent is on the same line", () => {
    const text = ["Refill History", "Mulugeta 2,026 Birr", "2026-07-22 4:51 PM"].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Mulugeta");
    expect(rows[0].amountSantim).toBe(202_600);
    expect(rows[0].dateText).toBe("2026-07-22 4:51 PM");
  });

  it("strips OCR chrome (bullets, arrows, ticks, NBSP, zero-width) from MJ cards", () => {
    const text = [
      "•", // bullet-only chrome line
      "» sampleagent - sampleagent", // arrow leader
      "\u200B 20,000.00", // zero-width + right-aligned amount
      "✓ Birukeee ✓", // status ticks around the name
      "———", // divider noise
    ].join("\n");

    const rows = parseStatementText(text, "mj").filter((r) => r.ok);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Birukeee");
    expect(rows[0].amountSantim).toBe(2_000_000);
  });

  it("drops UI chrome labels (Success, Details, Close) from refill screenshots", () => {
    const text = [
      "Refill History",
      "Success",
      "Mulugeta 500 Birr",
      "2026-07-22 4:51 PM",
      "Details",
      "Close",
    ].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Mulugeta");
    expect(rows[0].amountSantim).toBe(50_000);
  });

  it("normalizes non-breaking spaces inside amounts and names", () => {
    const text = ["Refill History", "Mulu\u00A0geta 1,500 Birr", "2026-07-22 4:51 PM"].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Mulu geta");
    expect(rows[0].amountSantim).toBe(150_000);
  });
});

describe("parseStatementText — generic repeated-handle sender label", () => {
  it("rejects a repeated-handle label as an agent (case- and whitespace-insensitive)", () => {
    const text = ["SampleAgent  -  SAMPLEAGENT", "10,000.00", "Real Agent Name"].join("\n");
    const rows = parseStatementText(text, "mj").filter((r) => r.ok);
    // The repeated-handle label is recognized case- and whitespace-insensitively
    // and can never be bound as an agent; the alphabetic line is the real agent.
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Real Agent Name");
  });

  it("retains a real agent immediately after a repeated-handle label", () => {
    const text = ["sampleagent - sampleagent", "20,000.00", "Kebede Alemu"].join("\n");
    const [r] = parseStatementText(text, "mj").filter((x) => x.ok);
    expect(r.agentName).toBe("Kebede Alemu");
    expect(r.amountSantim).toBe(2_000_000);
  });

  it("does not reject ordinary hyphenated names as repeated-handle labels", () => {
    const text = ["Refill History", "Abebe-Kebede 3,000 Birr", "2026-07-22 4:51 PM"].join("\n");
    const [r] = parseStatementText(text, "generic").filter((x) => x.ok);
    expect(r.agentName).toBe("Abebe-Kebede");
    expect(r.amountSantim).toBe(300_000);
  });

  it("does not treat '<A> - <B>' with different sides as a repeated-handle label", () => {
    const text = ["Refill History", "Abebe - Kebede 2,500 Birr", "2026-07-22 4:51 PM"].join("\n");
    const [r] = parseStatementText(text, "generic").filter((x) => x.ok);
    // Not a repeated handle → allowed to be parsed as an inline refill row.
    expect(r?.ok).toBe(true);
    expect(r.agentName).toBe("Abebe - Kebede");
  });
});

// ---------------------------------------------------------------------------
// Task 0.3B-e — MJ unresolved-window diagnostics contract.
//
// Every defensible amount window yields exactly one production row: either a
// resolved (`ok: true`) transaction or a review (`ok: false`) diagnostic. No
// window is ever silently dropped, merged, netted, duplicated or reordered,
// and an unresolved window never carries an invented agent or date.
// ---------------------------------------------------------------------------
describe("parseStatementText — MJ unresolved-window diagnostics", () => {
  const mj = (lines: string[]) => parseStatementText(lines.join("\n"), "mj");

  it("emits a missing_agent review row when a window has zero candidates", () => {
    const rows = mj(["@ Transfers", "Sent", "1,000.00", "[wl]"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].reason).toBe("no agent");
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].amountSantim).toBe(100_000);
    expect(rows[0].isReversal).toBe(false);
    expect(rows[0].agentName).toBeUndefined();
    expect(rows[0].dateText).toBeUndefined();
  });

  it("emits an ambiguous_agent review row when a window has several candidates", () => {
    const rows = mj(["2,000.00", "Sample Agent Alpha", "Sample Agent Beta"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].reason).toBe("ambiguous agent");
    expect(rows[0].amountSantim).toBe(200_000);
    expect(rows[0].agentName).toBeUndefined();
  });

  it("preserves source order across mixed resolved and unresolved windows", () => {
    const rows = mj([
      "@ Transfers",
      "Sent",
      "1,000.00",
      "Sample Agent Alpha",
      "2,000.00",
      "[wl]",
      "3,000.00",
      "Sample Agent Beta",
      "4,000.00",
      "Sample Agent Gamma",
      "Sample Agent Delta",
    ]);
    expect(rows.map((r) => r.ok)).toEqual([true, false, true, false]);
    expect(rows.map((r) => r.amountSantim)).toEqual([100_000, 200_000, 300_000, 400_000]);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Sample Agent Alpha",
      undefined,
      "Sample Agent Beta",
      undefined,
    ]);
  });

  it("keeps attached-minus reversal evidence on an unresolved window", () => {
    const rows = mj(["-5,250.00", "[wl]"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].isReversal).toBe(true);
    expect(rows[0].amountSantim).toBe(525_000);
  });

  it("treats a spaced-minus prefix as positive OCR noise, not a reversal", () => {
    const rows = mj(["- 3,875.00", "[wl]"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isReversal).toBe(false);
    expect(rows[0].amountSantim).toBe(387_500);
    const punctuation = mj([": 2,735.00", "[wl]"]);
    expect(punctuation[0].isReversal).toBe(false);
    expect(punctuation[0].amountSantim).toBe(273_500);
  });

  it("never resolves an agent from an account label alone", () => {
    const rows = mj(["9,000.00", "2 samplewallet - samplewallet"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].reason).toBe("no agent");
    expect(rows[0].raw.toLowerCase()).not.toContain("samplewallet");
  });

  it("keeps repeated legitimate agents as separate resolved rows", () => {
    const rows = mj([
      "1,000.00",
      "Sample Agent Alpha",
      "2,000.00",
      "Sample Agent Alpha",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.map((r) => r.agentName)).toEqual(["Sample Agent Alpha", "Sample Agent Alpha"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([100_000, 200_000]);
  });

  it("creates no financial row from unrelated numeric or UI noise", () => {
    const rows = mj(["2233 me® oN 8 al 57%=", "@ Transfers", "Sent", "4:50", "3", "Transfers"]);
    expect(rows).toEqual([]);
  });

  it("is deterministic and does not mutate its input", () => {
    const text = ["1,000.00", "Sample Agent Alpha", "2,000.00", "[wl]"].join("\n");
    const snapshot = `${text}`;
    const first = parseStatementText(text, "mj");
    const second = parseStatementText(text, "mj");
    expect(text).toBe(snapshot);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
