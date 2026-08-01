import { describe, expect, it } from "vitest";
import {
  SMS_EVENT_MAPPING,
  adaptSmsEvent,
  adaptSmsEvents,
  isDistributorCompatible,
  matchDistributorByLabel,
  matchDistributorForEvent,
  normalizeName,
  resolveSmsDate,
} from "./float-evd-sms-adapter";
import type { SmsEventKind, SmsResolvedEvent } from "./float-evd-sms-parser";
import { airtimeStockDelta } from "./airtime-movement";
import { duplicateKey, referenceKey } from "./db";

function event(kind: SmsEventKind, over: Partial<SmsResolvedEvent> = {}): SmsResolvedEvent {
  const outbound = kind === "float_sent_to_agent";
  return {
    sourceOrder: 0,
    eventKind: kind,
    direction: outbound ? "outbound" : "inbound",
    amountMinor: outbound ? -1_250_000 : 800_000,
    rawAmountText: "12,500.00",
    resultingBalanceMinor: null,
    rawBalanceText: null,
    transactionReference: "SYN4471035",
    occurredAt: "2026-08-15T16:12",
    datePrecision: "minute",
    dateSource: "in_message",
    counterpartyLabel: "Sample Distributor B",
    shopLabel: null,
    counterpartyMatch: "unassigned",
    senderCode: null,
    recipientCode: null,
    pairing: "paired",
    pairingStatus: "complete",
    amharicEvidenceText: null,
    evidence: {},
    ...over,
  };
}

const dist = { distributorId: "d1", distributorName: "Sample Distributor B" };

describe("event mapping", () => {
  it("maps float sent to an agent", () => {
    const res = adaptSmsEvent(event("float_sent_to_agent"), {
      ...dist,
      agentId: "a1",
      agentName: "Sample Agent",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.type).toBe("airtime_float");
    expect(res.input.airtimeDirection).toBe("sent");
    expect(res.input.telecom).toBe("safaricom");
    expect(res.input.amountSantim).toBe(1_250_000);
    expect(res.input.partyName).toBe("Sample Agent");
    expect(res.input.partyType).toBe("agent");
    expect(res.input.distributorId).toBe("d1");
    expect(res.input.source).toBe("sms_import");
  });

  it("maps EVD received from a distributor", () => {
    const res = adaptSmsEvent(event("evd_received_from_distributor"), dist);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.type).toBe("airtime_evd");
    expect(res.input.airtimeDirection).toBe("received");
    expect(res.input.telecom).toBe("ethiotelecom");
    expect(res.input.partyName).toBe("Sample Distributor B");
    expect(res.input.partyType).toBe("distributor");
  });

  it("maps float received from a distributor", () => {
    const res = adaptSmsEvent(event("float_received_from_distributor"), dist);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.type).toBe("airtime_float");
    expect(res.input.airtimeDirection).toBe("received");
    expect(res.input.telecom).toBe("safaricom");
  });

  it("exposes exactly the three mappings", () => {
    expect(Object.keys(SMS_EVENT_MAPPING).sort()).toEqual([
      "evd_received_from_distributor",
      "float_received_from_distributor",
      "float_sent_to_agent",
    ]);
  });
});

describe("inventory direction", () => {
  it("received increases stock and sent decreases it", () => {
    const recv = adaptSmsEvent(event("evd_received_from_distributor"), dist);
    const sent = adaptSmsEvent(event("float_sent_to_agent"), dist);
    expect(recv.ok && airtimeStockDelta(recv.input)).toBe(800_000);
    expect(sent.ok && airtimeStockDelta(sent.input)).toBe(-1_250_000);
  });
});

describe("safety blocks", () => {
  it("blocks a missing date and never substitutes the current time", () => {
    const res = adaptSmsEvent(
      event("evd_received_from_distributor", { occurredAt: null, datePrecision: "none" }),
      dist,
    );
    expect(res).toEqual({ ok: false, reason: "missing_date" });
  });

  it("accepts a user-selected date when the message carries none", () => {
    const res = adaptSmsEvent(
      event("evd_received_from_distributor", { occurredAt: null, datePrecision: "none" }),
      { ...dist, userSelectedDate: "2026-08-15" },
    );
    expect(res.ok && res.input.date).toBe("2026-08-15");
  });

  it("blocks a missing distributor selection", () => {
    const res = adaptSmsEvent(event("evd_received_from_distributor"), {});
    expect(res).toEqual({ ok: false, reason: "missing_distributor" });
  });

  it("preserves the reference and the source-local date string", () => {
    const res = adaptSmsEvent(event("float_sent_to_agent"), dist);
    expect(res.ok && res.input.reference).toBe("SYN4471035");
    expect(res.ok && res.input.date).toBe("2026-08-15T16:12");
  });
});

describe("review flags", () => {
  it("flags an outbound event with no agent selected", () => {
    const res = adaptSmsEvent(event("float_sent_to_agent"), dist);
    expect(res.ok && res.input.needsReview).toBe(true);
    expect(res.ok && res.input.partyId).toBeUndefined();
  });

  it("does not flag a complete, linked outbound event", () => {
    const res = adaptSmsEvent(event("float_sent_to_agent"), {
      ...dist,
      agentId: "a1",
      agentName: "Sample Agent",
    });
    expect(res.ok && res.input.needsReview).toBe(false);
  });

  it("flags a reference-less EVD receipt", () => {
    const noRef = adaptSmsEvent(
      event("evd_received_from_distributor", { transactionReference: null }),
      dist,
    );
    expect(noRef.ok && noRef.input.needsReview).toBe(true);
    expect(noRef.ok && noRef.input.reference).toBeUndefined();
  });

  it("does not flag a complete incoming receipt that was never paired", () => {
    const evd = adaptSmsEvent(
      event("evd_received_from_distributor", { pairing: "english_only", pairingStatus: "pending" }),
      dist,
    );
    expect(evd.ok && evd.input.needsReview).toBe(false);
  });

  it("flags outbound distribution with pending pairing", () => {
    const pending = adaptSmsEvent(
      event("float_sent_to_agent", { pairing: "english_only", pairingStatus: "pending" }),
      { ...dist, agentId: "a1", agentName: "Sample Agent" },
    );
    expect(pending.ok && pending.input.needsReview).toBe(true);
  });
});

describe("distributor preselection", () => {
  it("matches on case and whitespace only", () => {
    const list = [{ id: "d1", name: "Sample  Distributor B" }];
    expect(matchDistributorByLabel("sample distributor b", list)?.id).toBe("d1");
    expect(matchDistributorByLabel("Sample Distributor", list)).toBeNull();
    expect(matchDistributorByLabel(null, list)).toBeNull();
    expect(normalizeName("  A   b ")).toBe("a b");
  });
});

describe("distributor compatibility", () => {
  const evd = { forms: ["evd" as const], telecoms: ["ethiotelecom" as const] };
  const float = { forms: ["float" as const], telecoms: ["safaricom" as const] };

  it("accepts matching form and telecom", () => {
    expect(isDistributorCompatible("evd_received_from_distributor", evd)).toBe(true);
    expect(isDistributorCompatible("float_sent_to_agent", float)).toBe(true);
    expect(isDistributorCompatible("float_received_from_distributor", float)).toBe(true);
  });

  it("rejects a form mismatch and a telecom mismatch", () => {
    expect(isDistributorCompatible("evd_received_from_distributor", float)).toBe(false);
    expect(
      isDistributorCompatible("evd_received_from_distributor", {
        forms: ["evd"],
        telecoms: ["safaricom"],
      }),
    ).toBe(false);
  });

  it("treats absent or empty metadata as compatible", () => {
    expect(isDistributorCompatible("evd_received_from_distributor", {})).toBe(true);
    expect(isDistributorCompatible("float_sent_to_agent", { forms: [], telecoms: [] })).toBe(true);
  });

  it("preselects only a compatible exact match", () => {
    const ok = [{ id: "d1", name: "Sample Distributor B", ...evd }];
    const bad = [{ id: "d2", name: "Sample Distributor B", ...float }];
    expect(
      matchDistributorByLabel("Sample Distributor B", ok, "evd_received_from_distributor")?.id,
    ).toBe("d1");
    expect(
      matchDistributorByLabel("Sample Distributor B", bad, "evd_received_from_distributor"),
    ).toBeNull();
  });

  it("blocks persistence for an incompatible selected distributor", () => {
    expect(
      adaptSmsEvent(event("evd_received_from_distributor"), {
        ...dist,
        distributorForms: float.forms,
        distributorTelecoms: float.telecoms,
      }),
    ).toEqual({ ok: false, reason: "missing_distributor" });
    expect(
      adaptSmsEvent(event("float_sent_to_agent"), {
        ...dist,
        distributorForms: ["float"],
        distributorTelecoms: ["ethiotelecom"],
      }),
    ).toEqual({ ok: false, reason: "missing_distributor" });
    expect(adaptSmsEvent(event("float_sent_to_agent"), { ...dist }).ok).toBe(true);
  });

  it("resolves an exact configured alias to the canonical distributor", () => {
    const list = [
      {
        id: "moderntech",
        name: "Moderntech",
        aliases: ["Moderntech_Adama Amede Asela menahariya_DD"],
        ...float,
      },
    ];
    expect(
      matchDistributorByLabel(
        "Moderntech_Adama Amede Asela menahariya_DD",
        list,
        "float_sent_to_agent",
      )?.id,
    ).toBe("moderntech");
    // Case and whitespace only.
    expect(
      matchDistributorByLabel(
        "  moderntech_adama   amede asela menahariya_dd ",
        list,
        "float_sent_to_agent",
      )?.id,
    ).toBe("moderntech");
    // Similar, partial, reordered and misspelled labels stay unresolved.
    for (const label of [
      "Moderntech_Adama Amede Asela menahariya_D",
      "Moderntech_Adama Amede Asela",
      "Adama Amede Asela menahariya_DD Moderntech",
      "Modernteck_Adama Amede Asela menahariya_DD",
    ]) {
      expect(matchDistributorByLabel(label, list, "float_sent_to_agent")).toBeNull();
    }
  });

  it("rejects a duplicate compatible alias and an incompatible alias", () => {
    const alias = "Shop Label X";
    const dup = [
      { id: "d1", name: "One", aliases: [alias], ...float },
      { id: "d2", name: "Two", aliases: [alias], ...float },
    ];
    expect(matchDistributorByLabel(alias, dup, "float_sent_to_agent")).toBeNull();
    // Only one is compatible, so the other no longer creates ambiguity.
    const mixed = [
      { id: "d1", name: "One", aliases: [alias], ...float },
      { id: "d2", name: "Two", aliases: [alias], ...evd },
    ];
    expect(matchDistributorByLabel(alias, mixed, "float_sent_to_agent")?.id).toBe("d1");
    expect(
      matchDistributorByLabel(
        alias,
        [{ id: "d2", name: "Two", aliases: [alias], ...evd }],
        "float_sent_to_agent",
      ),
    ).toBeNull();
  });

  it("falls back to the shop label when the counterparty label does not match", () => {
    const list = [{ id: "moderntech", name: "Moderntech", aliases: ["Sample Shop A"], ...float }];
    expect(
      matchDistributorForEvent(
        event("float_sent_to_agent", {
          counterpartyLabel: "Sample Administrator",
          shopLabel: "Sample Shop A",
        }),
        list,
      )?.id,
    ).toBe("moderntech");
    expect(
      matchDistributorForEvent(
        event("float_sent_to_agent", {
          counterpartyLabel: "Sample Administrator",
          shopLabel: "Sample Shop B",
        }),
        list,
      ),
    ).toBeNull();
  });
});

describe("batch adaptation", () => {
  it("keeps source order and reports blocked rows", () => {
    const batch = adaptSmsEvents([
      { event: event("evd_received_from_distributor", { sourceOrder: 0 }), selection: dist },
      { event: event("float_sent_to_agent", { sourceOrder: 1 }), selection: {} },
    ]);
    expect(batch.inputs).toHaveLength(1);
    expect(batch.blocked).toEqual([{ sourceOrder: 1, reason: "missing_distributor" }]);
  });

  it("resolveSmsDate prefers the in-message stamp", () => {
    expect(resolveSmsDate({ occurredAt: "2026-08-15T16:12" }, "2026-01-01")).toBe(
      "2026-08-15T16:12",
    );
    expect(resolveSmsDate({ occurredAt: null })).toBeNull();
  });
});

describe("direction-aware deduplication identity", () => {
  const base = {
    type: "airtime_float" as const,
    amountSantim: 1_000,
    partyName: "Sample",
    channel: "Safaricom",
  };

  it("separates sent from received in the heuristic key", () => {
    expect(duplicateKey({ ...base, airtimeDirection: "sent" })).not.toBe(
      duplicateKey({ ...base, airtimeDirection: "received" }),
    );
  });

  it("treats a legacy missing direction as sent", () => {
    expect(duplicateKey({ ...base })).toBe(duplicateKey({ ...base, airtimeDirection: "sent" }));
  });

  it("separates sent from received in the reference key", () => {
    expect(referenceKey({ ...base, airtimeDirection: "sent" }, "SYN1")).not.toBe(
      referenceKey({ ...base, airtimeDirection: "received" }, "SYN1"),
    );
  });

  it("keeps the same identity for the same proven reference", () => {
    expect(referenceKey({ ...base, airtimeDirection: "received" }, " syn1 ")).toBe(
      referenceKey({ ...base, airtimeDirection: "received" }, "SYN1"),
    );
  });

  it("separates different types on the same reference", () => {
    expect(referenceKey({ ...base, type: "airtime_evd" }, "SYN1")).not.toBe(
      referenceKey(base, "SYN1"),
    );
  });
});
