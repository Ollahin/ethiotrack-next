// Business-purpose review.
//
// Every captured money movement must be given ONE explicit business purpose
// before it can be saved. The default is always "unresolved": the app never
// decides what the operator's money was for, and never offers to create an
// entity to make a purpose fit.

export type BusinessPurpose =
  | "agent_settlement"
  | "other_income"
  | "distributor_payment"
  | "agent_payment"
  | "business_expense"
  | "personal"
  | "unresolved";

export const PURPOSE_LABEL: Record<BusinessPurpose, string> = {
  agent_settlement: "Agent settlement",
  other_income: "Other business income",
  distributor_payment: "Distributor payment",
  agent_payment: "Payment to agent",
  business_expense: "Business expense",
  personal: "Personal",
  unresolved: "Unresolved",
};

export type MoneyDirection = "in" | "out" | "unknown";

export const INCOMING_PURPOSES: BusinessPurpose[] = [
  "agent_settlement",
  "other_income",
  "personal",
  "unresolved",
];

export const OUTGOING_PURPOSES: BusinessPurpose[] = [
  "distributor_payment",
  "agent_payment",
  "business_expense",
  "personal",
  "unresolved",
];

export function purposeOptions(direction: MoneyDirection): BusinessPurpose[] {
  if (direction === "in") return INCOMING_PURPOSES;
  if (direction === "out") return OUTGOING_PURPOSES;
  return ["unresolved"];
}

/** The purpose a freshly captured row starts with. Never a guess. */
export function defaultPurpose(): BusinessPurpose {
  return "unresolved";
}

export function isPurposeResolved(p: BusinessPurpose): boolean {
  return p !== "unresolved";
}

export function isPurposeAllowed(direction: MoneyDirection, p: BusinessPurpose): boolean {
  return purposeOptions(direction).includes(p);
}

/** Purposes that cannot be saved without an explicit, exact agent selection. */
export function requiresAgent(p: BusinessPurpose): boolean {
  return p === "agent_settlement" || p === "agent_payment";
}

export function requiresDistributor(p: BusinessPurpose): boolean {
  return p === "distributor_payment";
}

/** Only an agent settlement feeds the existing FIFO credit settlement path. */
export function settlesAgentCredits(p: BusinessPurpose): boolean {
  return p === "agent_settlement";
}

/** A personal movement is excluded from business ledgers. */
export function isPersonal(p: BusinessPurpose): boolean {
  return p === "personal";
}
