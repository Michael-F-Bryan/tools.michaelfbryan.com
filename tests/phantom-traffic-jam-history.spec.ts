import { test, expect } from "@playwright/test";
import { COALESCE_MS, createHistory, newestTime, noteChange, noteTap, oldestTime, recordSample, slotOf } from "../src/entries/phantom-traffic-jam/history";
import { DEFAULT_CONFIG } from "../src/entries/phantom-traffic-jam/parameters";
import { createSimulation, stepSimulation, summarise } from "../src/entries/phantom-traffic-jam/simulation";

const describe = (from: number, to: number) => `delay ${from} → ${to} s`;

/** Runs `steps` model steps, recording after each, but in uneven chunks as a variable frame rate would. */
function run(chunks: readonly number[]) {
  const sim = createSimulation(DEFAULT_CONFIG);
  const history = createHistory(sim);
  for (const chunk of chunks) {
    for (let step = 0; step < chunk; step += 1) {
      stepSimulation(sim);
      recordSample(history, sim);
    }
  }
  return { sim, history };
}

test("samples on a fixed simulated-time cadence, independent of how steps are grouped into frames", () => {
  const steps = 400;
  const fine = run(Array.from({ length: steps }, () => 1));
  const coarse = run(Array.from({ length: steps / 8 }, () => 8));
  expect(fine.history.every * fine.sim.dt).toBeCloseTo(0.25, 9);
  expect(fine.history.count).toBe(steps / fine.history.every + 1);
  expect(Array.from(coarse.history.time)).toEqual(Array.from(fine.history.time));
  expect(Array.from(coarse.history.position)).toEqual(Array.from(fine.history.position));
  for (let i = 0; i < fine.history.count; i += 1) {
    expect(fine.history.time[slotOf(fine.history, i)]).toBeCloseTo(i * 0.25, 9);
  }
});

test("each sample stores every car and the summary at that instant", () => {
  const { sim, history } = run([40]);
  const slot = slotOf(history, history.count - 1);
  const n = sim.carCount;
  expect(newestTime(history)).toBeCloseTo(sim.time, 9);
  for (let car = 0; car < n; car += 1) {
    expect(history.position[slot * n + car]).toBeCloseTo(sim.position[car], 4);
    expect(history.speed[slot * n + car]).toBeCloseTo(sim.speed[car], 4);
  }
  const summary = summarise(sim);
  expect(history.meanSpeed[slot]).toBeCloseTo(summary.meanSpeed, 4);
  expect(history.speedSpread[slot]).toBeCloseTo(summary.speedSpread, 4);
  // Recording the same step twice adds nothing.
  expect(recordSample(history, sim)).toBe(false);
});

test("keeps a bounded rolling window and prunes markers that fall out of it", () => {
  const sim = createSimulation(DEFAULT_CONFIG);
  const history = createHistory(sim, { windowSeconds: 10 });
  noteTap(history, sim, 3);
  expect(history.markers).toEqual([{ kind: "tap", time: 0, car: 3, position: sim.position[3] }]);
  for (let step = 0; step < 15 / sim.dt; step += 1) {
    stepSimulation(sim);
    recordSample(history, sim);
  }
  expect(history.count).toBe(history.capacity);
  expect(newestTime(history) - oldestTime(history)).toBeCloseTo(10, 9);
  expect(oldestTime(history)).toBeCloseTo(5, 9);
  expect(history.markers).toEqual([]);
});

test("coalesces a run of edits to one parameter into one marker", () => {
  const sim = createSimulation(DEFAULT_CONFIG);
  const history = createHistory(sim);
  noteChange(history, { time: 1, key: "reactionDelay", from: 0.8, to: 0.7, describe }, 0);
  noteChange(history, { time: 1.2, key: "reactionDelay", from: 0.7, to: 0.6, describe }, 300);
  noteChange(history, { time: 1.4, key: "reactionDelay", from: 0.6, to: 0.4, describe }, 600);
  expect(history.markers).toEqual([{ kind: "change", time: 1, key: "reactionDelay", from: 0.8, to: 0.4, label: "delay 0.8 → 0.4 s" }]);

  // A pause longer than the coalescing window starts a new marker.
  noteChange(history, { time: 5, key: "reactionDelay", from: 0.4, to: 0.5, describe }, 600 + COALESCE_MS + 1);
  expect(history.markers.map((marker) => marker.time)).toEqual([1, 5]);

  // A different parameter is its own marker; dragging back to the start removes it.
  noteChange(history, { time: 5.1, key: "timeGap", from: 1.6, to: 1.7, describe }, 2000);
  noteChange(history, { time: 5.2, key: "timeGap", from: 1.7, to: 1.6, describe }, 2100);
  expect(history.markers.map((marker) => marker.time)).toEqual([1, 5]);
});
