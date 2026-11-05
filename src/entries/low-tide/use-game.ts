"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { advance, dispatch as apply, hasBuilt, newRun, type Action, type State } from "./model";
import { hasLegacyRun, hasRetiredRun, loadBest, loadCodex, loadRun, recordBest, RETIRED_NOTICE, retireLegacyRun, saveCodex, saveRun, type Best } from "./storage";

const LEGACY_NOTICE = "The flat has changed since your last visit: blueprints are all visible now, the whole tide chart is shown, and nobody starves. Your earlier run could not be carried over, so a fresh one begins. Your best score is kept.";

const TICK_MS = 250;

export type Snapshot = Readonly<{ state: State; best: Best | null }>;

/**
 * The one live game on this page, kept outside React as an external store:
 * localStorage is read lazily on the first client snapshot, every change is
 * saved straight back, and the server snapshot is null so the statically
 * rendered shell never shows a run the player does not have.
 */
let current: Snapshot | null = null;
const listeners = new Set<() => void>();

function initialise(): Snapshot {
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  const seed = seedParam === null ? Number.NaN : Number.parseInt(seedParam, 10);
  const saved = loadRun();
  let state: State;
  if (saved && (Number.isNaN(seed) || saved.seed === seed)) {
    state = saved;
  } else {
    const legacy = hasLegacyRun();
    const notice = legacy ? LEGACY_NOTICE : !saved && hasRetiredRun() ? RETIRED_NOTICE : null;
    state = newRun(Number.isNaN(seed) ? undefined : seed, loadCodex(), notice);
    if (legacy) retireLegacyRun();
  }
  return { state, best: loadBest() };
}

function getSnapshot(): Snapshot {
  if (current === null) current = initialise();
  return current;
}

function getServerSnapshot(): Snapshot | null {
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(state: State): void {
  const previous = getSnapshot();
  if (state === previous.state) return;
  saveRun(state);
  if (state.codex.length > 0) saveCodex(state.codex);
  let best = previous.best;
  if (state.ended && !previous.state.ended) {
    best = recordBest({ score: state.ended.score, beacon: hasBuilt(state, "beacon"), boat: hasBuilt(state, "boat"), seed: state.seed });
  }
  current = { state, best };
  for (const listener of listeners) listener();
}

/**
 * Ticks game time from `Date.now()` while the tab is visible and the game is
 * unpaused, pauses on `visibilitychange`, and autosaves every change. `state`
 * is null only during server rendering and hydration. `best` is the highest
 * finished score on this browser, for the end screen.
 *
 * `?seed=N` in the URL starts a fresh run with that tide table when the saved
 * run has a different seed, which gives browser tests a known schedule.
 */
export function useGame(): { state: State | null; best: Best | null; dispatch: (action: Action) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = snapshot?.state ?? null;

  const dispatch = useCallback((action: Action) => {
    update(apply(getSnapshot().state, action));
  }, []);

  const running = state !== null && !state.paused && state.ended === null;

  // Game time comes from the wall clock, so a throttled tab or a Playwright
  // fake clock both move it correctly; pause and `visibilitychange` stop it.
  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      if (dt > 0) update(advance(getSnapshot().state, dt));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "pause" });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [dispatch]);

  return { state, best: snapshot?.best ?? null, dispatch };
}
