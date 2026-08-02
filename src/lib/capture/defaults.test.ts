import { describe, expect, it } from "vitest";
import { autoBank, autoPurpose } from "./defaults";

const banks = [
  { id: "b1", channel: "CBE", accountNumber: "1000123454599" },
  { id: "b2", channel: "Telebirr", accountNumber: "0911118755" },
];

describe("autoBank", () => {
  it("selects the configured bank from an exact account tail", () => {
    expect(autoBank({ accountTail: "4599", channel: "CBE" }, banks)?.id).toBe("b1");
  });

  it("falls back to an unambiguous channel", () => {
    expect(autoBank({ channel: "Telebirr" }, banks)?.id).toBe("b2");
  });

  it("selects nothing when two accounts share the channel", () => {
    const two = [...banks, { id: "b3", channel: "CBE", accountNumber: "1000000001111" }];
    expect(autoBank({ channel: "CBE" }, two)).toBeNull();
  });

  it("never guesses from a tail that matches nothing", () => {
    expect(autoBank({ accountTail: "0000" }, banks)).toBeNull();
  });
});

describe("autoPurpose", () => {
  it("makes incoming money from a linked agent an agent settlement", () => {
    expect(autoPurpose({ direction: "in", agentLinked: true })).toBe("agent_settlement");
  });

  it("makes outgoing money to a matched distributor a distributor payment", () => {
    expect(autoPurpose({ direction: "out", distributorLinked: true })).toBe("distributor_payment");
  });

  it("stays unresolved with nothing linked", () => {
    expect(autoPurpose({ direction: "in" })).toBe("unresolved");
    expect(autoPurpose({ direction: "out" })).toBe("unresolved");
    expect(autoPurpose({ direction: "unknown", agentLinked: true })).toBe("unresolved");
  });
});