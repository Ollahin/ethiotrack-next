import { describe, expect, it } from "vitest";
import {
  applyApproval,
  familyOf,
  findMapping,
  keyOfMapping,
  mappingKey,
  markUsed,
  pruneMappings,
  type ApprovedMapping,
} from "./approved-mappings";

const approval = {
  id: "m1",
  label: "  Abebe   Shop ",
  sourceFamily: "airtime_sms" as const,
  targetType: "agent" as const,
  targetId: "a1",
  targetName: "Abebe Shop",
  approvedAt: "2026-02-01T00:00:00.000Z",
};

describe("approved mappings", () => {
  it("keys a mapping by source family, target type and normalized label", () => {
    expect(mappingKey("airtime_sms", "agent", "  Abebe   SHOP ")).toBe(
      "airtime_sms::agent::abebe shop",
    );
  });

  it("never reuses a bank-learned label for an airtime capture", () => {
    const list = applyApproval([], { ...approval, sourceFamily: "bank_message" });
    expect(findMapping("Abebe Shop", "bank_message", "agent", list)).not.toBeNull();
    expect(findMapping("Abebe Shop", "airtime_sms", "agent", list)).toBeNull();
  });

  it("matches only byte-identical labels after case and whitespace folding", () => {
    const list = applyApproval([], approval);
    expect(findMapping("abebe   shop", "airtime_sms", "agent", list)?.targetId).toBe("a1");
    expect(findMapping("Abebe Shp", "airtime_sms", "agent", list)).toBeNull();
    expect(findMapping("   ", "airtime_sms", "agent", list)).toBeNull();
  });

  it("resets the usage counter when the same label is re-pointed", () => {
    let list = applyApproval([], approval);
    list = markUsed(list, list[0].id, "2026-02-02T00:00:00.000Z");
    expect(list[0].useCount).toBe(1);
    list = applyApproval(list, { ...approval, id: "m2", targetId: "a2", targetName: "Other" });
    expect(list).toHaveLength(1);
    expect(list[0].targetId).toBe("a2");
    expect(list[0].useCount).toBe(0);
  });

  it("keeps same-label mappings from different families apart", () => {
    let list = applyApproval([], approval);
    list = applyApproval(list, {
      ...approval,
      id: "m2",
      sourceFamily: "distributor_statement",
      targetId: "a2",
      targetName: "Other",
    });
    expect(list).toHaveLength(2);
    expect(new Set(list.map(keyOfMapping)).size).toBe(2);
  });

  it("treats a mapping written before families existed as manual", () => {
    const legacy = {
      id: "old",
      label: "Abebe Shop",
      normalizedLabel: "abebe shop",
      targetType: "agent",
      targetId: "a1",
      targetName: "Abebe Shop",
      approvedAt: approval.approvedAt,
      useCount: 0,
    } as ApprovedMapping;
    expect(familyOf(legacy)).toBe("manual");
    expect(findMapping("Abebe Shop", "airtime_sms", "agent", [legacy])).toBeNull();
  });

  it("drops mappings whose target entity was deleted", () => {
    const list = applyApproval([], approval);
    const { kept, dropped } = pruneMappings(list, {
      agent: new Set<string>(),
      distributor: new Set<string>(),
      bank: new Set<string>(),
    });
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
});
