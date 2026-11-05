/**
 * Versioned localStorage persistence for Low Tide. The run is saved whole;
 * the codex (things built at least once) and the best run are saved
 * separately so they survive finished runs and rule changes. Nothing here
 * leaves the browser.
 */

import type { State } from "./model";

export const RUN_KEY = "low-tide:run:v2";
/** The first-pass save. Its rules no longer exist, so it is detected and retired rather than loaded. */
export const LEGACY_RUN_KEY = "low-tide:run:v1";
export const CODEX_KEY = "low-tide:codex:v1";
/**
 * v3: the score is now cargo sold at the turns, a different scale from the structure-and-salvage
 * scores stored under v2 and v1, so older bests are not read (they would be unbeatable).
 */
export const BEST_KEY = "low-tide:best:v3";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveRun(state: State): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RUN_KEY, JSON.stringify(state));
  } catch {
    // Quota or privacy mode: play on without persistence.
  }
}

export function loadRun(): State | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) return null;
    const run = upgradeRun(parsed);
    // A reloaded run always resumes paused: time away never counts.
    return run && { ...run, paused: true };
  } catch {
    return null;
  }
}

/** True if the stored run is well formed but was retired by `upgradeRun` (finished under the old rules), so `loadRun` gave null. */
export function hasRetiredRun(): boolean {
  try {
    const raw = storage()?.getItem(RUN_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) && upgradeRun(parsed) === null;
  } catch {
    return false;
  }
}

export const RETIRED_NOTICE = "Your earlier run had already finished under the old rules, so a fresh one begins.";

export const RULES_NOTICE = "Low Tide's rules changed: traders now buy your cargo at every turn, and the run always lasts twelve tides. Your run carries on from here.";

/**
 * Brings a saved run from before the cargo rules up to date, additively: the sales ledger starts at zero and a
 * notice explains the change. A standing beacon or boat simply becomes an engine; old in-flight jobs keep their
 * `floodsAt: null` for one tide, which is harmless. A run that had already finished under the old scoring is
 * retired (null) so a new one starts; the codex is kept. Pure, so it is tested without a `localStorage`.
 */
export function upgradeRun(saved: State): State | null {
  const record = saved as unknown as { ended?: { trader?: unknown; leftover?: unknown } | null; sales?: unknown; turnSales?: unknown };
  if (record.ended && (typeof record.ended.trader !== "number" || typeof record.ended.leftover !== "object" || record.ended.leftover === null)) return null;
  const hasSales = typeof record.sales === "object" && record.sales !== null;
  const sales = hasSales ? (record.sales as State["sales"]) : { trader: 0, boat: 0, ship: 0 };
  // `turnSales[i]` is the sale at turn i, so a run upgraded at tide k starts with k zeros.
  const turnSales = Array.isArray(record.turnSales) ? (record.turnSales as number[]) : Array<number>(Math.max(0, saved.tide)).fill(0);
  if (hasSales && Array.isArray(record.turnSales)) return saved;
  return { ...saved, sales, turnSales, ...(hasSales ? {} : { notice: saved.notice ?? RULES_NOTICE }) };
}

export function clearRun(): void {
  storage()?.removeItem(RUN_KEY);
}

/** True if a first-pass run is stored. Call `retireLegacyRun` after telling the player. */
export function hasLegacyRun(): boolean {
  try {
    return storage()?.getItem(LEGACY_RUN_KEY) !== null && storage()?.getItem(LEGACY_RUN_KEY) !== undefined;
  } catch {
    return false;
  }
}

export function retireLegacyRun(): void {
  storage()?.removeItem(LEGACY_RUN_KEY);
}

export type Best = Readonly<{ score: number; beacon: boolean; seed: number; beacons: number; boats: number; runs: number }>;

/** Records a finished run: keeps the higher score and counts runs, beacons and boats. Returns what is now stored. */
export function recordBest(candidate: { score: number; beacon: boolean; boat?: boolean; seed: number }): Best {
  const existing = loadBest();
  const top = existing && existing.score >= candidate.score ? existing : candidate;
  const best: Best = {
    score: top.score,
    beacon: top.beacon,
    seed: top.seed,
    beacons: (existing?.beacons ?? 0) + (candidate.beacon ? 1 : 0),
    boats: (existing?.boats ?? 0) + (candidate.boat ? 1 : 0),
    runs: (existing?.runs ?? 0) + 1,
  };
  try {
    storage()?.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // Ignore: a best score is a nicety.
  }
  return best;
}

export function loadBest(): Best | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(BEST_KEY);
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.score !== "number" || typeof record.beacon !== "boolean" || typeof record.seed !== "number") return null;
    return {
      score: record.score,
      beacon: record.beacon,
      seed: record.seed,
      beacons: typeof record.beacons === "number" ? record.beacons : record.beacon ? 1 : 0,
      boats: typeof record.boats === "number" ? record.boats : 0,
      runs: typeof record.runs === "number" ? record.runs : 1,
    };
  } catch {
    return null;
  }
}

export function saveCodex(codex: readonly string[]): void {
  const store = storage();
  if (!store) return;
  try {
    const merged = [...new Set([...loadCodex(), ...codex])].sort();
    store.setItem(CODEX_KEY, JSON.stringify(merged));
  } catch {
    // Ignore: the codex is a convenience, not progress that can be lost mid-run.
  }
}

/** Blueprint ids built at least once. First-pass "a+b" recipe keys are dropped as they no longer mean anything. */
export function loadCodex(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(CODEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string" && !key.includes("+")) : [];
  } catch {
    return [];
  }
}

function isState(value: unknown): value is State {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 2 &&
    typeof record.time === "number" &&
    typeof record.tide === "number" &&
    typeof record.food === "number" &&
    Array.isArray(record.tides) &&
    Array.isArray(record.crew) &&
    Array.isArray(record.jobs) &&
    Array.isArray(record.built) &&
    Array.isArray(record.codex) &&
    Array.isArray(record.log) &&
    typeof record.inventory === "object" &&
    record.inventory !== null
  );
}
