/**
 * A rolling record of a run for the space-time view and the sparklines.
 *
 * Pure and DOM-free. It only reads the simulation: sampling is keyed to
 * `sim.steps` (every `every` model steps), never to wall-clock time or the
 * frame rate, so the recording is identical at any playback rate.
 */
import { summarise } from "./simulation";
import type { Simulation } from "./types";

/** Simulated seconds kept, about three laps of the default jam wave. */
export const HISTORY_WINDOW_SECONDS = 120;
/** Target simulated seconds between samples (rounded to whole model steps). */
export const SAMPLE_SECONDS = 0.25;
/** Edits to one parameter within this much real time are one change marker, ms. */
export const COALESCE_MS = 1000;

export type TapMarker = Readonly<{ kind: "tap"; time: number; car: number; position: number }>;
export type ChangeMarker = Readonly<{ kind: "change"; time: number; key: string; from: number; to: number; label: string }>;
export type HistoryMarker = TapMarker | ChangeMarker;

export type History = {
  readonly carCount: number;
  readonly roadLength: number;
  /** Model steps per sample. */
  readonly every: number;
  /** Samples the ring buffer holds; covers `windowSeconds`. */
  readonly capacity: number;
  readonly windowSeconds: number;
  readonly time: Float64Array;
  /** capacity × carCount, slot-major. */
  readonly position: Float32Array;
  readonly speed: Float32Array;
  readonly meanSpeed: Float32Array;
  readonly speedSpread: Float32Array;
  /** Slot of the oldest sample. */
  start: number;
  count: number;
  /** `sim.steps` of the newest sample (guards against double recording). */
  lastStep: number;
  /** Oldest first. */
  markers: HistoryMarker[];
  /** Real time (ms) the newest change marker was last extended; only used for coalescing. */
  lastChangeAt: number;
};

export function createHistory(sim: Simulation, options: { windowSeconds?: number; sampleSeconds?: number } = {}): History {
  const windowSeconds = options.windowSeconds ?? HISTORY_WINDOW_SECONDS;
  const every = Math.max(1, Math.round((options.sampleSeconds ?? SAMPLE_SECONDS) / sim.dt));
  const capacity = Math.round(windowSeconds / (every * sim.dt)) + 1;
  const n = sim.carCount;
  const history: History = {
    carCount: n,
    roadLength: sim.road.length,
    every,
    capacity,
    windowSeconds,
    time: new Float64Array(capacity),
    position: new Float32Array(capacity * n),
    speed: new Float32Array(capacity * n),
    meanSpeed: new Float32Array(capacity),
    speedSpread: new Float32Array(capacity),
    start: 0,
    count: 0,
    lastStep: -1,
    markers: [],
    lastChangeAt: -Infinity,
  };
  recordSample(history, sim);
  return history;
}

/** Ring-buffer slot of the i-th oldest sample. */
export function slotOf(history: History, i: number): number {
  return (history.start + i) % history.capacity;
}

export function newestTime(history: History): number {
  return history.count ? history.time[slotOf(history, history.count - 1)] : 0;
}

export function oldestTime(history: History): number {
  return history.count ? history.time[history.start] : 0;
}

/**
 * Call after every model step. Records a sample when `sim.steps` is a
 * multiple of `every` (once per step count). Returns true if it sampled.
 */
export function recordSample(history: History, sim: Simulation): boolean {
  if (sim.steps % history.every !== 0 || sim.steps === history.lastStep) return false;
  history.lastStep = sim.steps;
  let slot: number;
  if (history.count < history.capacity) {
    slot = slotOf(history, history.count);
    history.count += 1;
  } else {
    slot = history.start;
    history.start = (history.start + 1) % history.capacity;
  }
  const n = history.carCount;
  history.time[slot] = sim.time;
  for (let car = 0; car < n; car += 1) {
    history.position[slot * n + car] = sim.position[car];
    history.speed[slot * n + car] = sim.speed[car];
  }
  const summary = summarise(sim);
  history.meanSpeed[slot] = summary.meanSpeed;
  history.speedSpread[slot] = summary.speedSpread;
  const oldest = oldestTime(history);
  if (history.markers.length && history.markers[0].time < oldest) {
    history.markers = history.markers.filter((marker) => marker.time >= oldest);
  }
  return true;
}

/** The experimenter tapped `car`'s brakes now. */
export function noteTap(history: History, sim: Simulation, car: number): void {
  history.markers.push({ kind: "tap", time: sim.time, car, position: sim.position[car] });
}

/**
 * A parameter changed from `from` to `to` at simulated `time`. Repeated edits
 * of the same parameter, each within `COALESCE_MS` of real time (`nowMs`) of
 * the last, extend the newest marker (first old value → latest new value)
 * instead of adding one per slider step; dragging back to where it started
 * removes it.
 */
export function noteChange(
  history: History,
  change: Readonly<{ time: number; key: string; from: number; to: number; describe: (from: number, to: number) => string }>,
  nowMs: number,
): void {
  const { markers } = history;
  const last = markers.at(-1);
  if (last?.kind === "change" && last.key === change.key && nowMs - history.lastChangeAt <= COALESCE_MS) {
    markers.pop();
    if (last.from !== change.to) markers.push({ ...last, to: change.to, label: change.describe(last.from, change.to) });
  } else if (change.from !== change.to) {
    markers.push({ kind: "change", time: change.time, key: change.key, from: change.from, to: change.to, label: change.describe(change.from, change.to) });
  }
  history.lastChangeAt = nowMs;
}
