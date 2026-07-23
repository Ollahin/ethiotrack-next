import type { Distributor, Transaction, Telecom, AirtimeForm } from "../types";

export type BucketKey = `${Telecom}:${AirtimeForm}`;

export interface FlowBucket {
  telecom: Telecom;
  form: AirtimeForm;
  purchasedSantim: number;   // subdistributor bought from upstream distributors
  soldSantim: number;         // distributed / sold to agents
  netSantim: number;          // purchased − sold (positive = leftover stock built up)
  purchaseTxnIds: string[];
  saleTxnIds: string[];
}

export interface FlowMatch {
  buckets: Record<BucketKey, FlowBucket>;
  unmatchedPurchases: Transaction[]; // `out` to a distributor with no telecom/form tags
  unmatchedSales: Transaction[];      // airtime txn missing distributorId or distributor
}

const TELECOMS: Telecom[] = ["ethiotelecom", "safaricom"];
const FORMS: AirtimeForm[] = ["evd", "float"];

function emptyBucket(t: Telecom, f: AirtimeForm): FlowBucket {
  return {
    telecom: t,
    form: f,
    purchasedSantim: 0,
    soldSantim: 0,
    netSantim: 0,
    purchaseTxnIds: [],
    saleTxnIds: [],
  };
}

function emptyBuckets(): Record<BucketKey, FlowBucket> {
  const out = {} as Record<BucketKey, FlowBucket>;
  for (const t of TELECOMS) for (const f of FORMS) {
    out[`${t}:${f}` as BucketKey] = emptyBucket(t, f);
  }
  return out;
}

/**
 * Split an amount evenly across the (telecom × form) buckets a distributor
 * declares support for. If tags are missing, returns null so the caller can
 * park the txn in the unmatched pile.
 */
function splitAcrossTags(
  amountSantim: number,
  telecoms: Telecom[] | undefined,
  forms: AirtimeForm[] | undefined,
): Array<{ telecom: Telecom; form: AirtimeForm; share: number }> | null {
  const ts = telecoms && telecoms.length ? telecoms : null;
  const fs = forms && forms.length ? forms : null;
  if (!ts || !fs) return null;
  const combos: Array<{ telecom: Telecom; form: AirtimeForm }> = [];
  for (const t of ts) for (const f of fs) combos.push({ telecom: t, form: f });
  if (!combos.length) return null;
  const share = Math.floor(amountSantim / combos.length);
  const remainder = amountSantim - share * combos.length;
  return combos.map((c, i) => ({ ...c, share: share + (i === 0 ? remainder : 0) }));
}

/**
 * Reconcile subdistributor purchases (money `out` to a distributor) against
 * agent-facing airtime sales, using each distributor's telecom + form tags as
 * the classifier. Every airtime txn contributes to `sold`; every `out` txn
 * whose party is a tagged distributor contributes to `purchased`.
 */
export function computeTelecomFlow(
  txns: Transaction[],
  distributors: Distributor[],
): FlowMatch {
  const distMap = new Map(distributors.map((d) => [d.id, d]));
  const buckets = emptyBuckets();
  const unmatchedPurchases: Transaction[] = [];
  const unmatchedSales: Transaction[] = [];

  for (const t of txns) {
    if (t.isPersonal) continue;

    // Purchase leg: money out to a distributor.
    if (t.type === "out" && t.partyType === "distributor" && t.partyId) {
      const d = distMap.get(t.partyId);
      const split = splitAcrossTags(t.amountSantim, d?.telecoms, d?.forms);
      if (!split) { unmatchedPurchases.push(t); continue; }
      for (const s of split) {
        const b = buckets[`${s.telecom}:${s.form}` as BucketKey];
        b.purchasedSantim += s.share;
        if (!b.purchaseTxnIds.includes(t.id)) b.purchaseTxnIds.push(t.id);
      }
      continue;
    }

    // Sale leg: airtime distributed to an agent, drawn from a distributor's stock.
    if (t.type === "airtime_evd" || t.type === "airtime_float") {
      const form: AirtimeForm = t.type === "airtime_evd" ? "evd" : "float";
      const d = t.distributorId ? distMap.get(t.distributorId) : undefined;
      const telecoms = d?.telecoms;
      if (!d || !telecoms || !telecoms.length) { unmatchedSales.push(t); continue; }
      const share = Math.floor(t.amountSantim / telecoms.length);
      const remainder = t.amountSantim - share * telecoms.length;
      telecoms.forEach((tel, i) => {
        const b = buckets[`${tel}:${form}` as BucketKey];
        b.soldSantim += share + (i === 0 ? remainder : 0);
        if (!b.saleTxnIds.includes(t.id)) b.saleTxnIds.push(t.id);
      });
    }
  }

  for (const key of Object.keys(buckets) as BucketKey[]) {
    const b = buckets[key];
    b.netSantim = b.purchasedSantim - b.soldSantim;
  }

  return { buckets, unmatchedPurchases, unmatchedSales };
}