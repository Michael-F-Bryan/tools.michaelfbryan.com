"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { advance, dispatch as apply, newRun, type Action, type State } from "./model";
import { loadCodex, loadRun, saveCodex, saveRun } from "./storage";

const TICK_MS = 250;

/**
 * The one live game on this page, kept outside React as an external store:
 * localStorage is read lazily on the first client snapshot, every change is
 * saved straight back, and the server snapshot is null so the statically
 * rendered shell never shows a run the player does not have.
 */
let current: State | null = null;
const listeners = new Set<() => void>();

function initialise(): State {
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  const seed = seedParam === null ? Number.NaN : Number.parseInt(seedParam, 10);
  const saved = loadRun();
  if (saved && (Number.isNaN(seed) || saved.seed === seed)) return saved;
  return newRun(Number.isNaN(seed) ? undefined : seed, loadCodex());
}

function getSnapshot(): State {
  if (current === null) current = initialise();
  return current;
}

function getServerSnapshot(): State | null {
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: State): void {
  if (next === current) return;
  current = next;
  saveRun(next);
  if (next.codex.length > 0) saveCodex(next.codex);
  for (const listener of listeners) listener();
}

/**
 * Ticks game time from `Date.now()` while the tab is visible and the game is
 * unpaused, pauses on `visibilitychange`, and autosaves every change. `state`
 * is null only during server rendering and hydration.
 *
 * `?seed=N` in the URL starts a fresh run with that tide table when the saved
 * run has a different seed, which gives browser tests a known schedule.
 */
export function useGame(): { state: State | null; dispatch: (action: Action) => void } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dispatch = useCallback((action: Action) => {
    update(apply(getSnapshot(), action));
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
      if (dt > 0) update(advance(getSnapshot(), dt));
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

  return { state, dispatch };
}
