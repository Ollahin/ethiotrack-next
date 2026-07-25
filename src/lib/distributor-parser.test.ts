import { describe, it, expect } from "vitest";
import { parseStatementText } from "./distributor-parser";

// Fixtures reproduce the OCR shape we get from real screenshots:
// amounts are always right-aligned on their own or end-of-line, dates and
// times sit on separate lines, and agent names are alphabet-only.

describe("parseStatementText — MJ layout", () => {
  it("parses a paired sender/date/agent card", () => {
    const text = [
      "barisohaji - barisohaji",
      "5 Jul 2025                          20,000.00",
      "Abebe Kebede",
    ].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ok).toBe(true);
    expect(r.agentName).toBe("Abebe Kebede");
    expect(r.amountSantim).toBe(2_000_000);
    expect(r.isReversal).toBeFalsy();
    expect(r.airtimeType).toBe("airtime_evd");
  });

  it("captures reversals as positive amount with isReversal", () => {
    const text = [
      "barisohaji - barisohaji                 -50,000.00",
      "6 Jul 2025",
      "Chala Bekele",
    ].join("\n");
    const [r] = parseStatementText(text, "mj");
    expect(r.ok).toBe(true);
    expect(r.amountSantim).toBe(5_000_000);
    expect(r.isReversal).toBe(true);
    expect(r.needsReview).toBe(true);
  });

  it("does not mistake the date for the amount or the name", () => {
    const text = [
      "barisohaji - barisohaji",
      "5 Jul 2025                          10,000.00",
      "Selam Alemu",
    ].join("\n");
    const [r] = parseStatementText(text, "mj");
    expect(r.agentName).toBe("Selam Alemu");
    expect(r.amountSantim).toBe(1_000_000);
  });

  it("parses multiple stacked cards", () => {
    const text = [
      "barisohaji - barisohaji",
      "5 Jul 2025                          20,000.00",
      "Abebe Kebede",
      "barisohaji - barisohaji",
      "5 Jul 2025                          15,000.00",
      "Meron Tadesse",
    ].join("\n");
    const rows = parseStatementText(text, "mj");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.agentName)).toEqual(["Abebe Kebede", "Meron Tadesse"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([2_000_000, 1_500_000]);
  });
});

describe("parseStatementText — Refill History layout (Alami / Yenus / Modern App)", () => {
  it("parses name / date-time / amount triplet", () => {
    const text = [
      "Hana Girma",
      "2025-07-05 10:22 AM",
      "5,000 Birr",
    ].join("\n");
    const [r] = parseStatementText(text, "alami");
    expect(r.ok).toBe(true);
    expect(r.agentName).toBe("Hana Girma");
    expect(r.amountSantim).toBe(500_000);
    expect(r.airtimeType).toBe("airtime_evd");
  });

  it("rejects a numeric string as a name", () => {
    const text = [
      "2025-07-05",
      "10:22 AM",
      "5,000 Birr",
    ].join("\n");
    const rows = parseStatementText(text, "yenus");
    // No alphabetic name in scope — parser must NOT accept the date as name.
    expect(rows[0]?.ok).toBeFalsy();
  });

  it("only treats right-aligned '<n> Birr' as an amount", () => {
    const text = [
      "Sara Bekele",
      "2025-07-06 03:15 PM",
      "12,500 Birr",
      "Note: 5,000 Birr reserved earlier in day",   // mid-line, must be ignored
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
  it("parses MJ Transfers card layout: sender / date+amount / agent (screenshot sample)", () => {
    // Mirrors the OCR of the user's Transfers screenshot: each row is a
    // three-line card where the middle line carries the date on the left and
    // the amount right-aligned, and the third line is the agent name only.
    const text = [
      "Transfers",
      "Received Sent",
      "barisohaji - barisohaji",
      "25 Jul 2026                          20,000.00",
      "Bokiii",
      "barisohaji - barisohaji",
      "25 Jul 2026                          10,000.00",
      "Dammeeeecard",
      "barisohaji - barisohaji",
      "24 Jul 2026                         257,300.00",
      "Abduyyeee",
      "barisohaji - barisohaji",
      "24 Jul 2026                          50,000.00",
      "Nasreddddinnncarddd",
      "barisohaji - barisohaji",
      "24 Jul 2026                          21,620.00",
      "Zeddd",
    ].join("\n");
    const rows = parseStatementText(text, "mj").filter((r) => r.ok);
    expect(rows.map((r) => r.agentName)).toEqual([
      "Bokiii",
      "Dammeeeecard",
      "Abduyyeee",
      "Nasreddddinnncarddd",
      "Zeddd",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([
      2_000_000,
      1_000_000,
      25_730_000,
      5_000_000,
      2_162_000,
    ]);
    expect(rows.map((r) => r.dateText)).toEqual([
      "25 Jul 2026",
      "25 Jul 2026",
      "24 Jul 2026",
      "24 Jul 2026",
      "24 Jul 2026",
    ]);
    expect(rows.every((r) => r.sender === "barisohaji")).toBe(true);
  });

  it("parses MJ Transfers list where amount and '& Agent' are on separate lines with no date", () => {
    const text = [
      "Transfers",
      "Sent",
      "barisohaji - barisohaji",
      "15,000.00",
      "-",
      "& Sintayehu",
      "barisohaji - barisohaji",
      "10,000.00",
      "& Jireeeeee",
      "barisohaji - barisohaji",
      "5,000.00",
      "& Baliyyuuu",
      "barisohaji - barisohaji",
      "10,000.00",
      "& Kaleebbbbb",
      "barisohaji - barisohaji",
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
      1_500_000,
      1_000_000,
      500_000,
      1_000_000,
      2_500_000,
    ]);
  });

  it("strips trailing 'Birr' label from a name line", () => {
    // OCR often glues the currency label onto the name row.
    const text = [
      "Birukeee Birr",
      "2026-07-22 4:51 PM",
      "200,000.00 Birr",
    ].join("\n");
    const [r] = parseStatementText(text, "alami").filter((x) => x.ok);
    expect(r.agentName).toBe("Birukeee");
    expect(r.amountSantim).toBe(20_000_000);
  });

  it("never treats a 4-digit year rendered as '2,026' as an amount", () => {
    // Reproduces the bug where the year 2026 was parsed as ETB 2,026.00.
    const text = [
      "-07-22 4 51 PM",
      "2,026.00 Birr",
    ].join("\n");
    const rows = parseStatementText(text, "yenus").filter((r) => r.ok);
    expect(rows).toHaveLength(0);
  });

  it("rejects a date-fragment / loose-time line as an agent name", () => {
    const text = [
      "-07-22 4 51 PM",
      "2026-07-22 4:51 PM",
      "20,000 Birr",
    ].join("\n");
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
      "Zeddd 21,620 Birr",
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
      "Zeddd",
      "Enginer Abdi",
      "Birukeee",
      "Birukeee",
    ]);
    expect(rows.map((r) => r.amountSantim)).toEqual([
      20_000_000,
      2_000_000,
      2_000_000,
      3_000_000,
      3_000_000,
      2_162_000,
      7_567_500,
      20_000_000,
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

  it("parses annotated MJ cards as subdistributor / date-right-amount / agent only", () => {
    const text = [
      "236m e@® Nl 8 al 56%",
      "@ Transfers",
      "Received Sent",
      "barisohaji - barisohaji",
      "25 Jul 2026                          20,000.00",
      "Bokiii",
      "random footer",
      "barisohaji - barisohaji",
      "25 Jul 2026                          10,000.00",
      "Dammeeeecard",
      "barisohaji - barisohaji",
      "24 Jul 2026                         257,300.00",
      "Abduyyeee",
    ].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sender)).toEqual(["barisohaji", "barisohaji", "barisohaji"]);
    expect(rows.map((r) => r.dateText)).toEqual(["25 Jul 2026", "25 Jul 2026", "24 Jul 2026"]);
    expect(rows.map((r) => r.agentName)).toEqual(["Bokiii", "Dammeeeecard", "Abduyyeee"]);
    expect(rows.map((r) => r.amountSantim)).toEqual([2_000_000, 1_000_000, 25_730_000]);
  });

  it("does not guess rows from a Transfers screenshot when no MJ card is complete", () => {
    const text = [
      "@ Transfers",
      "Sent",
      "barisohaji - barisohaji",
      "2026-07-22 4:51 PM",
      "2,026.00",
      "Agents Add Agent Refill",
    ].join("\n");

    expect(parseStatementText(text, "generic").filter((r) => r.ok)).toHaveLength(0);
  });

  it("keeps legitimate 2,026 Birr refill rows when the agent is on the same line", () => {
    const text = [
      "Refill History",
      "Mulugeta 2,026 Birr",
      "2026-07-22 4:51 PM",
    ].join("\n");

    const rows = parseStatementText(text, "generic").filter((r) => r.ok);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Mulugeta");
    expect(rows[0].amountSantim).toBe(202_600);
    expect(rows[0].dateText).toBe("2026-07-22 4:51 PM");
  });
});