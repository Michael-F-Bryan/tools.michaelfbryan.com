import { test, expect } from "@playwright/test";
import { cornerAcceleration, desiredAcceleration, CORNER_BRAKING_ONSET } from "../src/entries/phantom-traffic-jam/driver";
import { DEFAULT_CORNERING, DEFAULT_MERGING, PRESETS, ROAD } from "../src/entries/phantom-traffic-jam/parameters";
import {
  CORNER_HORIZON,
  MERGE_CLEARANCE,
  createSimulation,
  perceive,
  permuteStorage,
  readCar,
  setCornering,
  setMerging,
  stepSimulation,
  summarise,
} from "../src/entries/phantom-traffic-jam/simulation";
import { LANE_WIDTH, cornerLimit, cornerRanges, cornersAhead, limitAt, offsetPose, poseAt, trackFor } from "../src/entries/phantom-traffic-jam/track";
import type { ExperimentConfig, Simulation } from "../src/entries/phantom-traffic-jam/types";

const preset = (id: string): ExperimentConfig => PRESETS.find((p) => p.id === id)!.config;
const CORNERS = preset("corners");
const MERGE = preset("merge");

function run(sim: Simulation, seconds: number): void {
  const steps = Math.round(seconds / sim.dt);
  for (let k = 0; k < steps; k++) stepSimulation(sim);
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + Math.PI) % (2 * Math.PI)) - Math.PI);

test.describe("track geometry", () => {
  test("the ring is the original: 230 m, one segment, no corners, cars at the top driving clockwise", () => {
    const ring = trackFor("ring");
    expect(ring.lanes).toHaveLength(1);
    const lane = ring.lanes[0];
    expect(lane.length).toBe(ROAD.length);
    expect(lane.closed).toBe(true);
    expect(cornerRanges(lane)).toEqual([]);
    expect(cornersAhead(lane, 10, CORNER_HORIZON, DEFAULT_CORNERING)).toEqual([]);
    expect(limitAt(lane, 100, DEFAULT_CORNERING)).toBe(Infinity);
    const top = poseAt(lane, 0);
    expect(top.x).toBeCloseTo(0, 9);
    expect(top.y).toBeCloseTo(-ROAD.length / (2 * Math.PI), 9);
    expect(top.heading).toBeCloseTo(0, 9);
    // A quarter of the way round is three o'clock, heading down the screen.
    const quarter = poseAt(lane, ROAD.length / 4);
    expect(quarter.x).toBeCloseTo(ROAD.length / (2 * Math.PI), 6);
    expect(quarter.y).toBeCloseTo(0, 6);
    expect(quarter.heading).toBeCloseTo(Math.PI / 2, 9);
  });

  test("closed lanes return to their start pose; the B has five bends and its waist nearly touches its spine", () => {
    for (const id of ["ring", "b"] as const) {
      const lane = trackFor(id).lanes[0];
      const start = lane.poses[0];
      const end = lane.poses[lane.poses.length - 1];
      expect(end.x).toBeCloseTo(start.x, 6);
      expect(end.y).toBeCloseTo(start.y, 6);
      expect(angleDiff(end.heading, start.heading)).toBeLessThan(1e-9);
    }
    const b = trackFor("b").lanes[0];
    expect(cornerRanges(b)).toHaveLength(5);
    expect(b.length).toBeGreaterThan(250);
    // Nearest approach between the spine (first segment) and the waist (sixth), by straight line.
    const [waistFrom, waistTo] = cornerRanges(b)[2];
    let nearest = Infinity;
    for (let s = 0; s < b.starts[1]; s += 0.5) {
      const p = poseAt(b, s);
      for (let u = waistFrom; u <= waistTo; u += 0.5) {
        const q = poseAt(b, u);
        nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
    expect(nearest).toBeLessThan(2 * LANE_WIDTH);
    expect(nearest).toBeGreaterThan(LANE_WIDTH);
    // ...while they are over a hundred metres apart by road.
    expect(waistFrom - b.starts[1]).toBeGreaterThan(80);
  });

  test("bend speeds come from curvature and the lateral acceleration drivers accept", () => {
    expect(cornerLimit(1 / 20, 3)).toBeCloseTo(Math.sqrt(60), 9);
    expect(cornerLimit(-1 / 5.5, 2)).toBeCloseTo(Math.sqrt(11), 9);
    const b = trackFor("b").lanes[0];
    const [from, to] = cornerRanges(b)[1];
    expect(limitAt(b, (from + to) / 2, 3)).toBeCloseTo(Math.sqrt(3 * 20), 6);
    expect(limitAt(b, 10, 3)).toBe(Infinity);
    // Bends ahead are listed in road order with their distance, following the lap round.
    const ahead = cornersAhead(b, 10, CORNER_HORIZON, 3);
    expect(ahead[0].distance).toBeCloseTo(b.starts[1] - 10, 9);
    expect(ahead.every((c, i) => i === 0 || c.distance > ahead[i - 1].distance)).toBe(true);
    const inside = cornersAhead(b, (from + to) / 2, 1, 3);
    expect(inside[0].distance).toBe(0);
    expect(inside[0].length).toBeCloseTo((to - from) / 2, 6);
  });

  test("the on-ramp leaves the ring and arrives exactly beside it for the whole merge zone", () => {
    const track = trackFor("merge");
    const [main, ramp] = track.lanes;
    const j = track.junction!;
    expect(ramp.closed).toBe(false);
    expect(ramp.length).toBeCloseTo(j.zoneEnd, 9);
    expect(ramp.length).toBeLessThan(j.zoneMainEnd - j.divergeAt);
    const diverge = poseAt(main, j.divergeAt);
    expect(ramp.poses[0]).toEqual(diverge);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const s = j.zoneStart + fraction * (j.zoneEnd - j.zoneStart);
      const onRamp = poseAt(ramp, s);
      const beside = offsetPose(poseAt(main, j.zoneMainStart + (s - j.zoneStart) * j.zoneScale), LANE_WIDTH);
      expect(onRamp.x).toBeCloseTo(beside.x, 6);
      expect(onRamp.y).toBeCloseTo(beside.y, 6);
      expect(angleDiff(onRamp.heading, beside.heading)).toBeLessThan(1e-6);
    }
    expect(cornerRanges(ramp)).toHaveLength(2);
    expect(limitAt(ramp, j.zoneStart + 1, DEFAULT_CORNERING)).toBe(Infinity);
  });
});

test.describe("cornering", () => {
  test("the corner term ignores bends that are too far to matter and firms up towards comfortable braking", () => {
    const params = CORNERS.driver;
    const b = params.comfortableBraking;
    expect(cornerAcceleration(10, [], params)).toBe(Infinity);
    expect(cornerAcceleration(5, [{ distance: 20, length: 10, limit: 6 }], params)).toBe(Infinity);
    // Needed deceleration (100 - 25) / 200 = 0.375 < onset × b.
    expect(cornerAcceleration(10, [{ distance: 100, length: 10, limit: 5 }], params)).toBe(Infinity);
    // Exactly at the onset the request is onset² × b, and it reaches b when b_kin does.
    const onsetDistance = 75 / (2 * CORNER_BRAKING_ONSET * b);
    expect(cornerAcceleration(10, [{ distance: onsetDistance, length: 10, limit: 5 }], params)).toBeCloseTo(-(CORNER_BRAKING_ONSET ** 2) * b, 9);
    expect(cornerAcceleration(10, [{ distance: 75 / (2 * b), length: 10, limit: 5 }], params)).toBeCloseTo(-b, 9);
    // The most demanding bend wins.
    const two = cornerAcceleration(10, [{ distance: 75 / (2 * b), length: 10, limit: 5 }, { distance: 20, length: 10, limit: 3 }], params);
    expect(two).toBeLessThan(-b);
  });

  test("a lone car brakes before each bend, is near its speed inside, and pulls away after it", () => {
    const sim = createSimulation({ ...CORNERS, carCount: 1 });
    const lane = sim.track.lanes[0];
    run(sim, 200);
    while (sim.position[0] >= 5) stepSimulation(sim);
    const samples: { s: number; v: number; a: number }[] = [];
    const from = sim.travelled[0];
    while (sim.travelled[0] - from < lane.length - 6) {
      stepSimulation(sim);
      samples.push({ s: sim.position[0], v: sim.speed[0], a: sim.acceleration[0] });
    }
    expect(sim.status.kind).toBe("running");
    const ranges = cornerRanges(lane);
    for (const [index, [start, end]] of ranges.entries()) {
      const limit = limitAt(lane, (start + end) / 2, sim.cornering);
      const nextStart = ranges[(index + 1) % ranges.length][0] + (index + 1 === ranges.length ? lane.length : 0);
      const entry = samples.find((p) => p.s >= start)!;
      const inside = samples.filter((p) => p.s >= start && p.s < end);
      const firstBrake = samples.find((p) => p.s > start - 60 && p.s < start && p.a < -0.3);
      // Braking begins on the approach, well before the bend...
      expect(firstBrake, `bend at ${start}`).toBeDefined();
      expect(start - firstBrake!.s).toBeGreaterThan(5);
      // ...the car arrives close to the bend's speed and never far over it inside...
      expect(entry.v).toBeLessThan(limit * 1.35);
      // (the long lobes end with braking for the waist, so their floor is lower)
      expect(Math.min(...inside.map((p) => p.v))).toBeGreaterThan(limit * 0.7);
      expect(Math.max(...inside.map((p) => p.v))).toBeLessThan(limit * 1.35);
      // ...and accelerates again once out, unless the next bend is right there.
      const after = samples.filter((p) => p.s >= end + 1 && p.s < end + 6);
      if (after.length && nextStart - end > 15) expect(Math.max(...after.map((p) => p.a))).toBeGreaterThan(0.5);
    }
    // On the long spine it gets well above every bend's speed.
    const spine = samples.filter((p) => p.s > 30 && p.s < 50);
    expect(Math.max(...spine.map((p) => p.v))).toBeGreaterThan(cornerLimit(1 / 20, sim.cornering) * 1.2);
  });

  test("B circuit presets run 600 s at every density without collision; denser is slower", () => {
    const means: number[] = [];
    for (const carCount of [8, 14, 22, 30]) {
      const sim = createSimulation({ ...CORNERS, carCount });
      run(sim, 600);
      expect(sim.status).toEqual({ kind: "running" });
      means.push(summarise(sim).meanSpeed);
    }
    expect(means).toEqual([...means].sort((a, b) => b - a));
    expect(means[0]).toBeGreaterThan(means[3] * 2);
  });

  test("cornering comfort changes live: brisker drivers take the bends faster", () => {
    const cautious = createSimulation({ ...CORNERS, carCount: 8, cornering: 1.5 });
    const brisk = createSimulation({ ...CORNERS, carCount: 8, cornering: 1.5 });
    setCornering(brisk, 4);
    run(cautious, 300);
    run(brisk, 300);
    expect(summarise(brisk).meanSpeed).toBeGreaterThan(summarise(cautious).meanSpeed * 1.2);
  });

  test("a step equals the lesser of IDM (capped at the bend's speed) and the corner term, from the pre-step snapshot", () => {
    const sim = createSimulation({ ...CORNERS, carCount: 14, start: "jumbled" });
    run(sim, 40);
    const expected = Array.from({ length: sim.carCount }, (_, car) => {
      const lane = sim.track.lanes[sim.lane[car]];
      const params = sim.drivers[car];
      const limit = limitAt(lane, sim.position[car], sim.cornering);
      const capped = limit < params.desiredSpeed ? { ...params, desiredSpeed: limit } : params;
      const following = desiredAcceleration(perceive(sim, car), capped, sim.road);
      const bends = cornerAcceleration(sim.speed[car], cornersAhead(lane, sim.position[car], CORNER_HORIZON, sim.cornering), params);
      return Math.max(-8, Math.min(following, bends));
    });
    const speedsBefore = Array.from(sim.speed);
    stepSimulation(sim);
    for (let car = 0; car < sim.carCount; car++) {
      if (speedsBefore[car] + expected[car] * sim.dt < 0) continue;
      expect(sim.acceleration[car]).toBeCloseTo(expected[car], 9);
    }
  });
});

test.describe("gaps follow the road, not the map", () => {
  test("a car on the spine follows the car ahead on the spine, not the one beside it on the waist", () => {
    const sim = createSimulation({ ...CORNERS, carCount: 8 });
    const lane = sim.track.lanes[0];
    const [waistFrom, waistTo] = cornerRanges(lane)[2];
    // Find the spine metre nearest the waist's apex by straight line.
    const apex = poseAt(lane, (waistFrom + waistTo) / 2);
    let nearestS = 0;
    let nearest = Infinity;
    for (let s = 0; s < lane.starts[1]; s += 0.25) {
      const p = poseAt(lane, s);
      const d = Math.hypot(p.x - apex.x, p.y - apex.y);
      if (d < nearest) {
        nearest = d;
        nearestS = s;
      }
    }
    expect(nearest).toBeLessThan(2 * LANE_WIDTH);
    // Car 0 on the spine beside the waist, car 1 at the waist apex, car 2 twenty metres up the spine,
    // car 3 on the bottom lobe (next by road after the waist), the rest on the top lobe behind the waist.
    const apexS = (waistFrom + waistTo) / 2;
    const positions = [nearestS, apexS, nearestS + 20, 200, 100, 110, 120, 130];
    positions.forEach((s, car) => (sim.position[car] = s));
    sim.speed.fill(3);
    stepSimulation(sim);
    expect(sim.leader[0]).toBe(2);
    expect(readCar(sim, 0).gap).toBeCloseTo(20 - ROAD.vehicleLength, 1);
    expect(sim.leader[1]).toBe(3);
    expect(readCar(sim, 1).gap).toBeCloseTo(200 - apexS - ROAD.vehicleLength, 1);
    expect(sim.leader[7]).toBe(1);
  });

  test("ramp cars in the zone are beside the ring but not in it: a ring car's leader is the next ring car", () => {
    const sim = createSimulation(MERGE);
    run(sim, 30);
    for (let car = 0; car < sim.carCount; car++) {
      const ahead = sim.leader[car];
      if (ahead >= 0) expect(sim.lane[ahead]).toBe(sim.lane[car]);
      else expect(sim.lane[car]).toBe(1);
    }
    expect(Array.from(sim.lane).some((lane) => lane === 1)).toBe(true);
  });
});

test.describe("merging", () => {
  test("routes: the ramp share is spread through the car numbers, car 1 stays on the ring, and only the merge track has routes", () => {
    const sim = createSimulation(MERGE);
    const ramp = Array.from(sim.route).filter((r) => r === 1).length;
    expect(ramp).toBe(Math.round(DEFAULT_MERGING.rampShare * MERGE.carCount));
    expect(sim.route[0]).toBe(0);
    expect(Array.from(createSimulation({ ...MERGE, merging: { ...DEFAULT_MERGING, rampShare: 0 } }).route).every((r) => r === 0)).toBe(true);
    expect(Array.from(createSimulation({ ...MERGE, track: "ring" }).route).every((r) => r === 0)).toBe(true);
    expect(Array.from(createSimulation(CORNERS).route).every((r) => r === 0)).toBe(true);
  });

  test("a ramp user carries straight on to the ramp at the diverge; distance driven stays continuous", () => {
    const sim = createSimulation(MERGE);
    const j = sim.track.junction!;
    const car = Array.from(sim.route).indexOf(1);
    let before = { lane: sim.lane[car], position: sim.position[car], travelled: sim.travelled[car] };
    let switched = false;
    for (let k = 0; k < 60 / sim.dt && !switched; k++) {
      stepSimulation(sim);
      if (sim.lane[car] === 1) {
        switched = true;
        const driven = sim.travelled[car] - before.travelled;
        const toDiverge = (j.divergeAt - before.position + ROAD.length) % ROAD.length;
        expect(sim.position[car]).toBeCloseTo(driven - toDiverge, 9);
      }
      before = { lane: sim.lane[car], position: sim.position[car], travelled: sim.travelled[car] };
    }
    expect(switched).toBe(true);
    const main = Array.from(sim.route).indexOf(0);
    run(sim, 120);
    expect(sim.lane[main]).toBe(0);
  });

  test("light traffic with cooperative drivers: ramp cars merge, nobody waits, no overlap is ever created by a merge", () => {
    const sim = createSimulation({ ...MERGE, carCount: 8, merging: { ...DEFAULT_MERGING, cooperation: 1 } });
    let seen = 0;
    let minGap = Infinity;
    let maxWaiting = 0;
    for (let k = 0; k < 600 / sim.dt; k++) {
      stepSimulation(sim);
      expect(sim.status.kind).toBe("running");
      maxWaiting = Math.max(maxWaiting, summarise(sim).waiting);
      while (seen < sim.merges.length) {
        const { car, time } = sim.merges[seen];
        expect(time).toBeCloseTo(sim.time, 9);
        expect(sim.lane[car]).toBe(0);
        const follower = Array.from(sim.leader).indexOf(car);
        minGap = Math.min(minGap, readCar(sim, car).gap, follower >= 0 ? readCar(sim, follower).gap : Infinity);
        seen++;
      }
    }
    expect(sim.merges.length).toBeGreaterThan(40);
    expect(maxWaiting).toBe(0);
    expect(minGap).toBeGreaterThanOrEqual(MERGE_CLEARANCE);
    expect(summarise(sim).flow).toBeGreaterThan(15);
  });

  test("dense traffic: merges happen by yielding, the lane never deadlocks, and cars are never asked to overlap", () => {
    for (const cooperation of [0.5, 1]) {
      const sim = createSimulation({ ...MERGE, carCount: 26, merging: { ...DEFAULT_MERGING, cooperation } });
      let seen = 0;
      let minGap = Infinity;
      let allStopped = 0;
      for (let k = 0; k < 600 / sim.dt; k++) {
        stepSimulation(sim);
        expect(sim.status.kind).toBe("running");
        const summary = summarise(sim);
        if (sim.time > 10 && summary.maxSpeed < 0.01) allStopped++;
        while (seen < sim.merges.length) {
          const { car } = sim.merges[seen];
          const follower = Array.from(sim.leader).indexOf(car);
          minGap = Math.min(minGap, readCar(sim, car).gap, follower >= 0 ? readCar(sim, follower).gap : Infinity);
          seen++;
        }
      }
      expect(sim.merges.length, `cooperation ${cooperation}`).toBeGreaterThan(40);
      expect(allStopped).toBe(0);
      expect(minGap).toBeGreaterThanOrEqual(MERGE_CLEARANCE);
    }
  });

  test("without cooperation and at the default time gap, nobody gets in: ramp cars wait at the lane end, the ring keeps flowing", () => {
    const sim = createSimulation({ ...MERGE, merging: { ...DEFAULT_MERGING, cooperation: 0 } });
    const ramp = sim.track.lanes[1];
    run(sim, 300);
    expect(sim.status).toEqual({ kind: "running" });
    expect(sim.merges).toEqual([]);
    const summary = summarise(sim);
    expect(summary.waiting).toBeGreaterThan(0);
    expect(summary.flow).toBeGreaterThan(10);
    for (let car = 0; car < sim.carCount; car++) {
      if (sim.lane[car] === 1) expect(sim.position[car]).toBeLessThanOrEqual(ramp.length - ROAD.minimumGap + 0.1);
    }
    // Cooperation can be turned up live, and the queue clears.
    setMerging(sim, { cooperation: 1, acceptableBraking: DEFAULT_MERGING.acceptableBraking });
    run(sim, 120);
    expect(sim.merges.length).toBeGreaterThan(0);
    expect(summarise(sim).waiting).toBe(0);
  });

  test("the merge is the same at dt, dt/2 and 2dt, to within a step", () => {
    const results = [0.05, 0.025, 0.1].map((dt) => {
      const sim = createSimulation(MERGE, { dt });
      run(sim, 300);
      return { status: sim.status.kind, merges: sim.merges.length, first: sim.merges[0]?.time ?? -1, car: sim.merges[0]?.car };
    });
    for (const r of results) expect(r.status).toBe("running");
    expect(results[1].merges).toBe(results[0].merges);
    expect(Math.abs(results[2].merges - results[0].merges)).toBeLessThanOrEqual(1);
    expect(results.every((r) => r.car === results[0].car)).toBe(true);
    expect(Math.abs(results[1].first - results[0].first)).toBeLessThan(0.2);
    expect(Math.abs(results[2].first - results[0].first)).toBeLessThan(0.2);
  });

  test("deterministic, and storage order does not matter with merges in progress", () => {
    const a = createSimulation(MERGE);
    const b = createSimulation(MERGE);
    run(a, 20);
    run(b, 20);
    const order = Array.from({ length: a.carCount }, (_, i) => (i * 7 + 3) % a.carCount);
    const c = permuteStorage(a, order);
    run(a, 200);
    run(b, 200);
    run(c, 200);
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
    expect(a.merges).toEqual(b.merges);
    expect(a.merges.length).toBeGreaterThan(10);
    order.forEach((car, slot) => {
      expect(c.position[slot]).toBe(a.position[car]);
      expect(c.speed[slot]).toBe(a.speed[car]);
      expect(c.lane[slot]).toBe(a.lane[car]);
      expect(c.leader[slot]).toBe(a.leader[car] < 0 ? -1 : order.indexOf(a.leader[car]));
    });
    expect(c.merges.map((m) => ({ ...m, car: order[m.car] }))).toEqual(a.merges);
  });

  test("the same track with no ramp users is the plain ring with a longer name for its road", () => {
    const withRamp = createSimulation({ ...MERGE, merging: { ...DEFAULT_MERGING, rampShare: 0 } });
    const ring = createSimulation({ ...MERGE, track: "ring" });
    run(withRamp, 120);
    run(ring, 120);
    expect(Array.from(withRamp.position)).toEqual(Array.from(ring.position));
    expect(withRamp.merges).toEqual([]);
  });

  test("honest failure: a ramp car that cannot stop drives off the end and the run is frozen as invalid", () => {
    const sim = createSimulation(MERGE);
    const ramp = sim.track.lanes[1];
    run(sim, 30);
    const car = Array.from(sim.lane).indexOf(1);
    expect(car).toBeGreaterThanOrEqual(0);
    sim.position[car] = ramp.length - 1;
    sim.speed[car] = 25;
    stepSimulation(sim);
    expect(sim.status.kind).toBe("invalid");
    if (sim.status.kind === "invalid") expect(sim.status.reason).toContain("off the end of the ramp");
    const frozenAt = sim.time;
    stepSimulation(sim);
    expect(sim.time).toBe(frozenAt);
  });

  test("a merge is reported where it happened, and the newcomer's memory of the car ahead is of that car", () => {
    const sim = createSimulation({ ...MERGE, carCount: 8, merging: { ...DEFAULT_MERGING, cooperation: 1 } });
    while (sim.merges.length === 0 && sim.time < 300) stepSimulation(sim);
    const merge = sim.merges[0];
    expect(sim.position[merge.car]).toBe(merge.position);
    expect(sim.mergedAt[merge.car]).toBe(merge.time);
    const j = sim.track.junction!;
    expect(merge.position).toBeGreaterThanOrEqual(j.zoneMainStart - 1e-9);
    expect(merge.position).toBeLessThanOrEqual(j.zoneMainEnd + 2);
    // Perceived gap equals the actual gap right after the merge, whatever the reaction delay.
    expect(perceive(sim, merge.car).gap).toBeCloseTo(readCar(sim, merge.car).gap, 9);
  });
});
