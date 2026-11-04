/**
 * Versioned localStorage persistence for Low Tide. The run is saved whole;
 * the codex (discovered recipe keys) is saved separately so it survives
 * finished runs and corrupt saves. Nothing here leaves the browser.
 */

import type { State } from "./model";

export const RUN_KEY = "low-tide:run:v1";
export const CODEX_KEY = "low-tide:codex:v1";

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
    // A reloaded run always resumes paused: time away never counts.
    return { ...parsed, paused: true };
  } catch {
    return null;
  }
}

export function clearRun(): void {
  storage()?.removeItem(RUN_KEY);
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

export const BEST_KEY = "low-tide:best:v1";

export type Best = Readonly<{ score: number; beacon: boolean; seed: number }>;

/** Keeps the higher of the stored and offered scores. Returns what is now stored. */
export function recordBest(candidate: Best): Best {
  const existing = loadBest();
  const best = existing && existing.score >= candidate.score ? existing : candidate;
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
    const parsed: unknown = JSON.parse(store.getItem(BEST_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.score !== "number" || typeof record.beacon !== "boolean" || typeof record.seed !== "number") return null;
    return { score: record.score, beacon: record.beacon, seed: record.seed };
  } catch {
    return null;
  }
}

export function loadCodex(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(CODEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function isState(value: unknown): value is State {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.time === "number" &&
    typeof record.tide === "number" &&
    Array.isArray(record.tides) &&
    Array.isArray(record.crew) &&
    Array.isArray(record.jobs) &&
    Array.isArray(record.food) &&
    Array.isArray(record.built) &&
    Array.isArray(record.codex) &&
    Array.isArray(record.log) &&
    typeof record.inventory === "object" &&
    record.inventory !== null
  );
}
