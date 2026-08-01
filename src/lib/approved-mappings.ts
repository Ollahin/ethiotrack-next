// Approved counterparty mappings.
//
// A mapping is created ONLY when a human explicitly approves a link during
// review. It is then reused for byte-identical counterparty labels (case and
// whitespace normalized only — never fuzzy, never phonetic). A mapping can
// pre-select a link; it can never save a transaction on its own.

export type MappingTargetType = "agent" | "distributor" | "bank";

/**
 * Where the label was read. A mapping learned from a bank alert must never
 * pre-select a counterparty for an airtime SMS: the same word means different
 * things in different sources, so the family is part of the key.
 */
export type MappingSourceFamily =
  | "bank_message"
  | "airtime_sms"
  | "distributor_statement"
  | "manual";

export const DEFAULT_SOURCE_FAMILY: MappingSourceFamily = "manual";

export interface ApprovedMapping {
  id: string;
  /** Raw label exactly as it appeared in the source, kept for audit. */
  label: string;
  /** Case/whitespace-normalized label used for lookup. */
  normalizedLabel: string;
  /** Source family the label came from. Older records default to "manual". */
  sourceFamily?: MappingSourceFamily;
  targetType: MappingTargetType;
  targetId: string;
  /** Entity name at approval time — shown when the mapping is reviewed later. */
  targetName: string;
  approvedAt: string;
  lastUsedAt?: string;
  useCount: number;
}

/** Case and whitespace only. No transliteration, no fuzzy folding. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Family of a stored mapping, tolerating records written before families. */
export function familyOf(m: Pick<ApprovedMapping, "sourceFamily">): MappingSourceFamily {
  return m.sourceFamily ?? DEFAULT_SOURCE_FAMILY;
}

export function mappingKey(
  sourceFamily: MappingSourceFamily,
  targetType: MappingTargetType,
  label: string,
): string {
  return `${sourceFamily}::${targetType}::${normalizeLabel(label)}`;
}

export function keyOfMapping(m: ApprovedMapping): string {
  return `${familyOf(m)}::${m.targetType}::${m.normalizedLabel}`;
}

/**
 * Exact-label lookup within one source family. Returns null when the label is
 * empty or unmapped — the caller must then ask the operator, never guess. A
 * near-miss spelling is unmapped by construction: only byte-identical
 * case/whitespace-normalized labels match.
 */
export function findMapping(
  label: string | null | undefined,
  sourceFamily: MappingSourceFamily,
  targetType: MappingTargetType,
  mappings: ApprovedMapping[],
): ApprovedMapping | null {
  if (!label) return null;
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  return (
    mappings.find(
      (m) =>
        familyOf(m) === sourceFamily &&
        m.targetType === targetType &&
        m.normalizedLabel === normalized,
    ) ?? null
  );
}

export interface MappingApproval {
  label: string;
  sourceFamily: MappingSourceFamily;
  targetType: MappingTargetType;
  targetId: string;
  targetName: string;
  approvedAt: string;
  id: string;
}

/**
 * Apply an approval to a mapping list, returning a new list. Re-approving the
 * same label to the same entity keeps the original approval date; re-pointing
 * it at a different entity replaces the target and resets the usage counter,
 * so a mapping's counter never describes a link it no longer represents.
 */
export function applyApproval(
  mappings: ApprovedMapping[],
  approval: MappingApproval,
): ApprovedMapping[] {
  const normalizedLabel = normalizeLabel(approval.label);
  if (!normalizedLabel) return mappings;
  const existing = mappings.find(
    (m) =>
      familyOf(m) === approval.sourceFamily &&
      m.targetType === approval.targetType &&
      m.normalizedLabel === normalizedLabel,
  );
  const next: ApprovedMapping = existing
    ? {
        ...existing,
        label: approval.label,
        sourceFamily: approval.sourceFamily,
        targetId: approval.targetId,
        targetName: approval.targetName,
        ...(existing.targetId === approval.targetId
          ? {}
          : { approvedAt: approval.approvedAt, useCount: 0, lastUsedAt: undefined }),
      }
    : {
        id: approval.id,
        label: approval.label,
        normalizedLabel,
        sourceFamily: approval.sourceFamily,
        targetType: approval.targetType,
        targetId: approval.targetId,
        targetName: approval.targetName,
        approvedAt: approval.approvedAt,
        useCount: 0,
      };
  return existing ? mappings.map((m) => (m.id === existing.id ? next : m)) : [...mappings, next];
}

/** Record a use of a mapping. Purely informational — never affects matching. */
export function markUsed(
  mappings: ApprovedMapping[],
  id: string,
  usedAt: string,
): ApprovedMapping[] {
  return mappings.map((m) =>
    m.id === id ? { ...m, useCount: m.useCount + 1, lastUsedAt: usedAt } : m,
  );
}

export function removeMapping(mappings: ApprovedMapping[], id: string): ApprovedMapping[] {
  return mappings.filter((m) => m.id !== id);
}

export interface EntityIndex {
  agent: Set<string>;
  distributor: Set<string>;
  bank: Set<string>;
}

/**
 * Drop mappings whose target no longer exists. A dangling mapping would either
 * silently fail to link or, worse, resurrect a deleted entity id on a saved
 * transaction.
 */
export function pruneMappings(
  mappings: ApprovedMapping[],
  index: EntityIndex,
): { kept: ApprovedMapping[]; dropped: ApprovedMapping[] } {
  const kept: ApprovedMapping[] = [];
  const dropped: ApprovedMapping[] = [];
  for (const m of mappings) {
    (index[m.targetType].has(m.targetId) ? kept : dropped).push(m);
  }
  return { kept, dropped };
}
