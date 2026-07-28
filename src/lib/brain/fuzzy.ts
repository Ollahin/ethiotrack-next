import levenshtein from "fast-levenshtein";
import type { Agent } from "../types";

/**
 * Fuzzy-match a raw name/phone against the agent list.
 * Returns the best agent above the similarity threshold, or null.
 */
export function matchAgent(
  raw: string | undefined,
  agents: Agent[],
  threshold = 0.8,
): Agent | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  // Exact phone match wins.
  const digits = needle.replace(/\D+/g, "");
  if (digits.length >= 7) {
    const byPhone = agents.find(
      (a) => a.phone && a.phone.replace(/\D+/g, "").endsWith(digits.slice(-7)),
    );
    if (byPhone) return byPhone;
  }

  let best: { agent: Agent; score: number } | null = null;
  for (const a of agents) {
    const cand = a.name.toLowerCase();
    if (!cand) continue;
    // Contains -> strong match.
    if (cand.includes(needle) || needle.includes(cand)) {
      const score = Math.min(cand.length, needle.length) / Math.max(cand.length, needle.length);
      if (!best || score > best.score) best = { agent: a, score: Math.max(score, 0.9) };
      continue;
    }
    const dist = levenshtein.get(cand, needle);
    const score = 1 - dist / Math.max(cand.length, needle.length);
    if (score >= threshold && (!best || score > best.score)) {
      best = { agent: a, score };
    }
  }
  return best?.agent ?? null;
}
