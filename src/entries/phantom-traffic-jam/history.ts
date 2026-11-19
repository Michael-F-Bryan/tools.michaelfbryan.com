/**
 * A rolling record of a run for the space-time view and the sparklines.
 *
 * Pure and DOM-free. It only reads the simulation: sampling is keyed to
 * `sim.steps` (every `every` model steps), never to wall-clock time or the
 * frame rate, so the recording is identical at any playback rate.
 */
import { summarise } from "./simulation";
import { cornerRanges } from "./track";
import type { Intervention, MergeEvent, Simulation } from "./types";

/** Simulated seconds kept, about three laps of the default jam wave. */
export const HISTORY_WINDOW_SECONDS = 120;
/** Target simulated seconds between samples (rounded to whole model steps). */
export const SAMPLE_SECONDS = 0.25;
/** Edits to one parameter within this much real time are one change marker, ms. */
export const COALESCE_MS = 1000;

/** One experimenter intervention from the model's log; a held brake is one marker at its start. */
export type InterventionMarker = Readonly<{ kind: "intervention"; action: Intervention["kind"]; time: number; car: number; lane: number; position: number }>;
export type ChangeMarker = Readonly<{ kind: "change"; time: number; key: string; from: number; to: number; label: string }>;
export type HistoryMarker = InterventionMarker | ChangeMarker;

const ACTION_NAMES: Record<Intervention["kind"], string> = { tap: "tap", scheduled: "scheduled tap", hold: "hold" };

/** "tap · car 6", "hold · car 6", "scheduled tap · car 1". */
export function markerLabel(marker: HistoryMarker): string {
  return marker.kind === "change" ? marker.label : `${ACTION_NAMES[marker.action]} · car ${marker.car + 1}`;
}

/** What the view needs to know about one lane of the track. */
export type HistoryLane = Readonly<{ name: string; length: number; closed: boolean; corners: readonly (readonly [number, number])[] }>;

/** The merge zone in each lane's metres, if the track has one. */
export type HistoryZone = Readonly<{ mainStart: number; mainEnd: number; rampStart: number; rampEnd: number }>;

export type History = {
  readonly carCount: number;
  /** Main-lane length, m. */
  readonly roadLength: number;
  readonly lanes: readonly HistoryLane[];
  readonly zone: HistoryZone | null;
  /** Model steps per sample. */
  readonly every: number;
  /** Samples the ring buffer holds; covers `windowSeconds`. */
  readonly capacity: number;
  readonly windowSeconds: number;
  readonly time: Float64Array;
  /** capacity × carCount, slot-major. */
  readonly position: Float32Array;
  readonly speed: Float32Array;
  readonly lane: Uint8Array;
  readonly meanSpeed: Float32Array;
  readonly speedSpread: Float32Array;
  /** Slot of the oldest sample. */
  start: number;
  count: number;
  /** `sim.steps` of the newest sample (guards against double recording). */
  lastStep: number;
  /** Oldest first. */
  markers: HistoryMarker[];
  /** Merges inside the window, oldest first. */
  merges: MergeEvent[];
  /** Real time (ms) the newest change marker was last extended; only used for coalescing. */
  lastChangeAt: number;
  /** How many of `sim.interventions` have been turned into markers. */
  seenInterventions: number;
  /** How many of `sim.merges` have been copied. */
  seenMerges: number;
};

export function createHistory(sim: Simulation, options: { windowSeconds?: number; sampleSeconds?: number } = {}): History {
  const windowSeconds = options.windowSeconds ?? HISTORY_WINDOW_SECONDS;
  const every = Math.max(1, Math.round((options.sampleSeconds ?? SAMPLE_SECONDS) / sim.dt));
  const capacity = Math.round(windowSeconds / (every * sim.dt)) + 1;
  const n = sim.carCount;
  const { junction } = sim.track;
  const history: History = {
    carCount: n,
    roadLength: sim.road.length,
    lanes: sim.track.lanes.map((lane) => ({ name: lane.name, length: lane.length, closed: lane.closed, corners: cornerRanges(lane) })),
    zone: junction ? { mainStart: junction.zoneMainStart, mainEnd: junction.zoneMainEnd, rampStart: junction.zoneStart, rampEnd: junction.zoneEnd } : null,
    every,
    capacity,
    windowSeconds,
    time: new Float64Array(capacity),
    position: new Float32Array(capacity * n),
    speed: new Float32Array(capacity * n),
    lane: new Uint8Array(capacity * n),
    meanSpeed: new Float32Array(capacity),
    speedSpread: new Float32Array(capacity),
    start: 0,
    count: 0,
    lastStep: -1,
    markers: [],
    merges: [],
    lastChangeAt: -Infinity,
    seenInterventions: 0,
    seenMerges: 0,
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
  syncInterventions(history, sim);
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
    history.lane[slot * n + car] = sim.lane[car];
  }
  const summary = summarise(sim);
  history.meanSpeed[slot] = summary.meanSpeed;
  history.speedSpread[slot] = summary.speedSpread;
  const oldest = oldestTime(history);
  if (history.markers.length && history.markers[0].time < oldest) {
    history.markers = history.markers.filter((marker) => marker.time >= oldest);
  }
  if (history.merges.length && history.merges[0].time < oldest) {
    history.merges = history.merges.filter((merge) => merge.time >= oldest);
  }
  return true;
}

/**
 * Marks every intervention the model has logged since the last call: taps,
 * the scheduled tap and the starts of held brakes alike, one marker each,
 * and copies any new merges. Cheap when nothing is new, so it can run after
 * every step and right after an explicit action. The position is the car's
 * when this runs: call it at the latest one step after the intervention.
 * Returns true if it added anything.
 */
export function syncInterventions(history: History, sim: Simulation): boolean {
  let added = false;
  const log = sim.interventions;
  if (history.seenInterventions < log.length) {
    for (let index = history.seenInterventions; index < log.length; index += 1) {
      const { time, car, kind } = log[index];
      history.markers.push({ kind: "intervention", action: kind, time, car, lane: sim.lane[car], position: sim.position[car] });
    }
    history.seenInterventions = log.length;
    added = true;
  }
  if (history.seenMerges < sim.merges.length) {
    for (let index = history.seenMerges; index < sim.merges.length; index += 1) history.merges.push(sim.merges[index]);
    history.seenMerges = sim.merges.length;
    added = true;
  }
  return added;
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
