import { test, expect } from "@playwright/test";
import { desiredAcceleration, desiredGap } from "../src/entries/phantom-traffic-jam/driver";
import {
  BRAKE_LIGHT_OFF,
  BRAKE_LIGHT_ON,
  PHYSICAL_BRAKING_LIMIT,
  TAP_DECELERATION,
  JUMBLE_FRACTION,
  TAP_DURATION,
  createSimulation,
  equilibriumSpeed,
  perceive,
  permuteStorage,
  readCar,
  setDrivers,
  stepSimulation,
  summarise,
  tapBrake,
} from "../src/entries/phantom-traffic-jam/simulation";
import {
  CAR_COUNT_SLIDER,
  DEFAULT_CONFIG,
  DEFAULT_DT,
  DRIVER_SLIDERS,
  PRESETS,
  ROAD,
  VARIATION_SLIDER,
} from "../src/entries/phantom-traffic-jam/parameters";
import type { DriverParams, ExperimentConfig, Simulation, SliderSpec } from "../src/entries/phantom-traffic-jam/types";

const JAM = PRESETS.find((p) => p.id === "jam")!.config;
/** The jam preset from a perfectly even start: the matched partner of STEADY for the brake-tap trials. */
const JAM_EVEN = { ...JAM, start: "even" as const };
const STEADY_PRESET = PRESETS.find((p) => p.id === "steady")!.config;
/** The steady preset from a perfectly even start, for tests that need an exact equilibrium. */
const STEADY = { ...STEADY_PRESET, start: "even" as const };
const PLAIN: DriverParams = {
  desiredSpeed: 20,
  timeGap: 1.5,
  reactionDelay: 0,
  maxAcceleration: 1.2,
  comfortableBraking: 2,
};

function run(sim: Simulation, seconds: number): void {
  const steps = Math.round(seconds / sim.dt);
  for (let k = 0; k < steps; k++) stepSimulation(sim);
}

function wrapHalf(x: number): number {
  return ((((x + ROAD.length / 2) % ROAD.length) + ROAD.length) % ROAD.length) - ROAD.length / 2;
}

function gaps(sim: Simulation): number[] {
  return Array.from(sim.position, (x, i) => {
    const d = (((sim.position[sim.leader[i]] - x) % ROAD.length) + ROAD.length) % ROAD.length;
    return d - ROAD.vehicleLength;
  });
}

type Trial = {
  status: string;
  peakSpread: number;
  spreadAt: Record<number, number>;
  /** Mean spread over t in [from, end]. */
  lateMeanSpread: number;
  /** Largest spread over [from, end]. */
  lateMaxSpread: number;
  minSpeed: number;
  stops: number;
  stopsPerCar: number[];
  /** First time spread exceeded 1.5 m/s (after the tap, if any), or null. */
  jamTime: number | null;
  /** Mean velocity of the jam along the ring (m/s), from stop events of successive followers. */
  waveVelocity: number | null;
  minTravelledRate: number;
};

/** One matched trial: fresh simulation, optional tap on car 0 at t = 10 s. */
function trial(config: ExperimentConfig, opts: { dt: number; tap: boolean; seconds?: number; lateFrom?: number }): Trial {
  const sim = createSimulation(config, { dt: opts.dt });
  const seconds = opts.seconds ?? 600;
  const lateFrom = opts.lateFrom ?? 300;
  const n = sim.carCount;
  const total = Math.round(seconds / opts.dt);
  const tapStep = Math.round(10 / opts.dt);
  const out: Trial = {
    status: "running",
    peakSpread: 0,
    spreadAt: {},
    lateMeanSpread: 0,
    lateMaxSpread: 0,
    minSpeed: Infinity,
    stops: 0,
    stopsPerCar: new Array(n).fill(0),
    jamTime: null,
    waveVelocity: null,
    minTravelledRate: Infinity,
  };
  const stopped = new Array<boolean>(n).fill(false);
  const events: { car: number; t: number; x: number }[] = [];
  let lateSum = 0;
  let lateCount = 0;
  for (let k = 0; k < total; k++) {
    if (opts.tap && k === tapStep) tapBrake(sim, 0);
    stepSimulation(sim);
    if (sim.status.kind !== "running") {
      out.status = sim.status.kind;
      break;
    }
    const s = summarise(sim);
    out.peakSpread = Math.max(out.peakSpread, s.speedSpread);
    out.minSpeed = Math.min(out.minSpeed, s.minSpeed);
    if (out.jamTime === null && s.speedSpread > 1.5 && sim.time > 10.5) out.jamTime = sim.time;
    for (const t of [60, 120, 300, 600]) if (Math.abs(sim.time - t) < opts.dt / 2) out.spreadAt[t] = s.speedSpread;
    if (sim.time >= lateFrom) {
      lateSum += s.speedSpread;
      lateCount++;
      out.lateMaxSpread = Math.max(out.lateMaxSpread, s.speedSpread);
    }
    if (sim.time > 60) {
      for (let i = 0; i < n; i++) {
        const isStopped = sim.speed[i] < 0.5;
        if (isStopped && !stopped[i]) {
          out.stops++;
          out.stopsPerCar[i]++;
          events.push({ car: i, t: sim.time, x: sim.position[i] });
        }
        stopped[i] = isStopped;
      }
    }
  }
  out.lateMeanSpread = lateCount ? lateSum / lateCount : 0;
  // A jam moves backwards: the follower of car i stops a moment after car i, further back.
  const velocities: number[] = [];
  for (const e of events) {
    const follower = (e.car - 1 + n) % n;
    const next = events.find((f) => f.car === follower && f.t > e.t && f.t - e.t < 8);
    if (next) velocities.push(wrapHalf(next.x - e.x) / (next.t - e.t));
  }
  out.waveVelocity = velocities.length >= 20 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : null;
  out.minTravelledRate = Math.min(...Array.from(sim.travelled, (d) => d / sim.time));
  return out;
}

test.describe("driver (IDM)", () => {
  const road = ROAD;

  test("zero acceleration at the equilibrium gap", () => {
    for (const v of [0, 3, 10, 18]) {
      const s = equilibriumGapFor(v);
      const a = desiredAcceleration({ speed: v, gap: s, closingSpeed: 0 }, PLAIN, road);
      expect(Math.abs(a)).toBeLessThan(1e-9);
    }
  });

  function equilibriumGapFor(v: number): number {
    // From a[1 - (v/v0)^4 - (s*/s)^2] = 0 with closing speed 0.
    return (road.minimumGap + v * PLAIN.timeGap) / Math.sqrt(1 - (v / PLAIN.desiredSpeed) ** 4);
  }

  test("free road: accelerates at a from rest, nothing at the desired speed", () => {
    const rest = desiredAcceleration({ speed: 0, gap: 1e6, closingSpeed: 0 }, PLAIN, road);
    expect(rest).toBeCloseTo(PLAIN.maxAcceleration, 6);
    const cruise = desiredAcceleration({ speed: PLAIN.desiredSpeed, gap: 1e6, closingSpeed: 0 }, PLAIN, road);
    expect(Math.abs(cruise)).toBeLessThan(1e-6);
  });

  test("brakes harder when closing in than when matching speed", () => {
    const matched = desiredAcceleration({ speed: 15, gap: 30, closingSpeed: 0 }, PLAIN, road);
    const closing = desiredAcceleration({ speed: 15, gap: 30, closingSpeed: 8 }, PLAIN, road);
    expect(closing).toBeLessThan(matched);
    expect(desiredGap({ speed: 15, gap: 30, closingSpeed: 8 }, PLAIN, road)).toBeGreaterThan(
      desiredGap({ speed: 15, gap: 30, closingSpeed: 0 }, PLAIN, road),
    );
    // Opening gap never makes the desired gap smaller than s0.
    expect(desiredGap({ speed: 15, gap: 30, closingSpeed: -100 }, PLAIN, road)).toBe(road.minimumGap);
  });

  test("a vanishing gap gives a large finite braking request", () => {
    const a = desiredAcceleration({ speed: 10, gap: 0, closingSpeed: 5 }, PLAIN, road);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeLessThan(-100);
  });

  test("time gap and reaction delay are independent parameters", () => {
    const obs = { speed: 8, gap: 14, closingSpeed: 1.5 };
    const base = desiredAcceleration(obs, PLAIN, road);
    for (const delay of [0, 0.5, 1.2]) {
      expect(desiredAcceleration(obs, { ...PLAIN, reactionDelay: delay }, road)).toBe(base);
    }
    expect(desiredAcceleration(obs, { ...PLAIN, timeGap: 2.5 }, road)).not.toBe(base);
  });
});

test.describe("parameters", () => {
  const onGrid = (value: number, spec: SliderSpec) => {
    const display = value * spec.displayPerSI;
    const steps = (display - spec.min) / spec.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9 && display >= spec.min - 1e-9 && display <= spec.max + 1e-9;
  };

  test("presets sit inside the slider domain on the step grid, first is the default", () => {
    expect(PRESETS[0].config).toBe(DEFAULT_CONFIG);
    expect(PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(["jam", "steady"]));
    for (const { config } of PRESETS) {
      expect(onGrid(config.carCount, CAR_COUNT_SLIDER)).toBe(true);
      expect(onGrid(config.variation, VARIATION_SLIDER)).toBe(true);
      for (const key of Object.keys(DRIVER_SLIDERS) as (keyof DriverParams)[]) {
        expect(onGrid(config.driver[key], DRIVER_SLIDERS[key]), key).toBe(true);
      }
      expect(config.variation).toBe(0);
    }
  });

  test("the two presets differ only in reaction delay (and the jam one starts jumbled)", () => {
    const differing = (Object.keys(JAM.driver) as (keyof DriverParams)[]).filter((k) => JAM.driver[k] !== STEADY.driver[k]);
    expect(differing).toEqual(["reactionDelay"]);
    expect(JAM.carCount).toBe(STEADY.carCount);
  });

  test("the densest ring still leaves room beyond the minimum gap", () => {
    const gap = ROAD.length / CAR_COUNT_SLIDER.max - ROAD.vehicleLength;
    expect(gap).toBeGreaterThan(ROAD.minimumGap + 1);
  });
});

test.describe("initialisation and reproducibility", () => {
  test("even start has equal gaps at the homogeneous equilibrium speed", () => {
    const sim = createSimulation(STEADY);
    const g = gaps(sim);
    for (const x of g) expect(x).toBeCloseTo(ROAD.length / STEADY.carCount - ROAD.vehicleLength, 9);
    const v = equilibriumSpeed(STEADY.driver, g[0], ROAD.minimumGap);
    for (const s of sim.speed) expect(s).toBeCloseTo(v, 9);
    const a = desiredAcceleration({ speed: v, gap: g[0], closingSpeed: 0 }, STEADY.driver, ROAD);
    expect(Math.abs(a)).toBeLessThan(1e-9);
  });

  test("jumbled start is a slight disturbance and never overlaps", () => {
    const mean = ROAD.length / JAM.carCount - ROAD.vehicleLength;
    for (const count of [CAR_COUNT_SLIDER.min, 14, CAR_COUNT_SLIDER.max]) {
      for (let seed = 1; seed <= 20; seed++) {
        const sim = createSimulation({ ...JAM, carCount: count, seed });
        const spacing = ROAD.length / count;
        for (const g of gaps(sim)) {
          expect(Math.abs(g - (spacing - ROAD.vehicleLength))).toBeLessThanOrEqual(2 * JUMBLE_FRACTION * (spacing - ROAD.vehicleLength - ROAD.minimumGap) + 1e-9);
          expect(g).toBeGreaterThan(ROAD.minimumGap);
        }
      }
    }
    expect(mean).toBeGreaterThan(0);
  });

  test("same config gives identical trajectories", () => {
    const a = createSimulation({ ...JAM, variation: 0.1 });
    const b = createSimulation({ ...JAM, variation: 0.1 });
    for (const sim of [a, b]) {
      run(sim, 5);
      tapBrake(sim, 3);
      run(sim, 55);
    }
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
    expect(Array.from(a.speed)).toEqual(Array.from(b.speed));
    expect(Array.from(a.brakeLight)).toEqual(Array.from(b.brakeLight));
  });

  test("a different seed gives a different jumbled start and different drivers", () => {
    const a = createSimulation({ ...JAM, seed: 1, variation: 0.1 });
    const b = createSimulation({ ...JAM, seed: 2, variation: 0.1 });
    expect(Array.from(a.position)).not.toEqual(Array.from(b.position));
    expect(a.drivers.map((d) => d.timeGap)).not.toEqual(b.drivers.map((d) => d.timeGap));
    // An even start does not depend on the seed.
    expect(Array.from(createSimulation({ ...JAM, start: "even", seed: 1 }).position)).toEqual(
      Array.from(createSimulation({ ...JAM, start: "even", seed: 2 }).position),
    );
  });

  test("simulations created from one config share no mutable state", () => {
    const a = createSimulation(JAM);
    const b = createSimulation(JAM);
    const before = {
      position: Array.from(b.position),
      speed: Array.from(b.speed),
      travelled: Array.from(b.travelled),
      leader: Array.from(b.leader),
    };
    tapBrake(a, 0);
    run(a, 120);
    setDrivers(a, { ...JAM.driver, timeGap: 2 }, 0.2);
    expect(b.time).toBe(0);
    expect(b.steps).toBe(0);
    expect(Array.from(b.position)).toEqual(before.position);
    expect(Array.from(b.speed)).toEqual(before.speed);
    expect(Array.from(b.travelled)).toEqual(before.travelled);
    expect(b.drivers[0].timeGap).toBe(JAM.driver.timeGap);
    const fresh = createSimulation(JAM);
    run(b, 30);
    run(fresh, 30);
    expect(Array.from(b.speed)).toEqual(Array.from(fresh.speed));
  });

  test("time is steps times dt", () => {
    const sim = createSimulation(JAM, { dt: 0.04 });
    run(sim, 3);
    expect(sim.steps).toBe(75);
    expect(sim.time).toBe(75 * 0.04);
    expect(createSimulation(JAM).dt).toBe(DEFAULT_DT);
  });
});

test.describe("snapshot semantics and order independence", () => {
  test("a step equals plain IDM computed from the pre-step snapshot", () => {
    const config = { ...JAM, driver: { ...JAM.driver, reactionDelay: 0 }, variation: 0.1 };
    const sim = createSimulation(config);
    run(sim, 40);
    const pre = {
      speed: Array.from(sim.speed),
      position: Array.from(sim.position),
      gap: gaps(sim),
    };
    stepSimulation(sim);
    for (let i = 0; i < sim.carCount; i++) {
      const l = sim.leader[i];
      const a = Math.max(
        desiredAcceleration(
          { speed: pre.speed[i], gap: pre.gap[i], closingSpeed: pre.speed[i] - pre.speed[l] },
          sim.drivers[i],
          ROAD,
        ),
        -PHYSICAL_BRAKING_LIMIT,
      );
      const dt = sim.dt;
      let v = pre.speed[i] + a * dt;
      let dx = pre.speed[i] * dt + 0.5 * a * dt * dt;
      if (v < 0) {
        dx = (pre.speed[i] * pre.speed[i]) / (2 * -a);
        v = 0;
      }
      expect(sim.speed[i]).toBeCloseTo(v, 12);
      expect(sim.position[i]).toBeCloseTo((pre.position[i] + dx) % ROAD.length, 9);
    }
  });

  test("storage order does not change any car's behaviour", () => {
    const base = createSimulation({ ...JAM, variation: 0.1 });
    const n = base.carCount;
    const order = Array.from({ length: n }, (_, k) => (k * 5 + 3) % n); // a permutation: 5 and 14 are coprime
    expect(new Set(order).size).toBe(n);
    const permuted = permuteStorage(base, order);
    const slotOf = (car: number) => order.indexOf(car);
    const sims = [base, permuted];
    for (let step = 0; step < 4000; step++) {
      if (step === 100) {
        tapBrake(base, 4);
        tapBrake(permuted, slotOf(4));
      }
      for (const sim of sims) stepSimulation(sim);
    }
    expect(base.status.kind).toBe("running");
    for (let car = 0; car < n; car++) {
      const slot = slotOf(car);
      expect(permuted.position[slot]).toBe(base.position[car]);
      expect(permuted.speed[slot]).toBe(base.speed[car]);
      expect(permuted.acceleration[slot]).toBe(base.acceleration[car]);
      expect(permuted.brakeLight[slot]).toBe(base.brakeLight[car]);
      expect(permuted.travelled[slot]).toBe(base.travelled[car]);
      expect(order[permuted.leader[slot]]).toBe(base.leader[car]);
    }
  });
});

test.describe("ring geometry", () => {
  test("positions wrap, gaps stay consistent, travelled is monotonic, order never changes", () => {
    const sim = createSimulation(JAM);
    const start = Array.from(sim.position);
    const previous = Array.from(sim.travelled);
    const totalGap = ROAD.length - sim.carCount * ROAD.vehicleLength;
    let seamCrossings = 0;
    // Hot loop: collect violations instead of calling expect() hundreds of thousands of times.
    const violations: string[] = [];
    for (let step = 1; step <= 12000; step++) {
      const lastPosition = Array.from(sim.position);
      stepSimulation(sim);
      for (let i = 0; i < sim.carCount; i++) {
        if (!(sim.position[i] >= 0 && sim.position[i] < ROAD.length)) violations.push(`position ${i} @${step}`);
        if (sim.travelled[i] < previous[i]) violations.push(`travelled ${i} @${step}`);
        previous[i] = sim.travelled[i];
        if (sim.position[i] < lastPosition[i]) seamCrossings++;
      }
      if (step % 100 === 0) {
        const g = gaps(sim);
        if (Math.abs(g.reduce((a, b) => a + b, 0) - totalGap) > 1e-6) violations.push(`gap sum @${step}`);
        if (g.some((x) => x <= 0)) violations.push(`gap @${step}`);
        for (let i = 0; i < sim.carCount; i++) {
          const expected = (((start[i] + sim.travelled[i]) % ROAD.length) + ROAD.length) % ROAD.length;
          if (Math.abs(wrapHalf(sim.position[i] - expected)) > 1e-6) violations.push(`travelled/position ${i} @${step}`);
        }
        // Cyclic order of identities is unchanged: sorted by position, ids run 0..n-1 from some rotation.
        const byPosition = Array.from(sim.position.keys()).sort((a, b) => sim.position[a] - sim.position[b]);
        const first = byPosition.indexOf(0);
        byPosition.forEach((_, k) => {
          if (byPosition[(first + k) % byPosition.length] !== k) violations.push(`order @${step}`);
        });
      }
    }
    expect(violations).toEqual([]);
    expect(seamCrossings).toBeGreaterThan(sim.carCount); // the run really did go round the seam
  });

  test("gaps across the seam are measured correctly", () => {
    const sim = createSimulation({ ...STEADY, carCount: 8 });
    // Move the last car to just before the seam and car 0 just after it.
    sim.position[7] = ROAD.length - 3;
    sim.position[0] = 4;
    expect(readCar(sim, 7).gap).toBeCloseTo(4 + 3 - ROAD.vehicleLength, 9);
  });
});

test.describe("finite state", () => {
  test("long runs of both presets stay finite, non-negative and running", () => {
    for (const config of [JAM, STEADY, { ...JAM, variation: 0.2 }]) {
      const sim = createSimulation(config);
      const violations: string[] = [];
      tapBrake(sim, 0);
      for (let k = 0; k < 12000; k++) {
        stepSimulation(sim);
        if (k % 50 === 0) {
          for (let i = 0; i < sim.carCount; i++) {
            const ok =
              Number.isFinite(sim.position[i] + sim.speed[i] + sim.acceleration[i]) &&
              sim.speed[i] >= 0 &&
              sim.acceleration[i] >= -PHYSICAL_BRAKING_LIMIT - 1e-9;
            if (!ok) violations.push(`car ${i} @${k}`);
          }
        }
      }
      expect(violations).toEqual([]);
      expect(sim.status.kind).toBe("running");
    }
  });
});

test.describe("reaction delay", () => {
  test("zero delay is plain IDM on the current snapshot", () => {
    const sim = createSimulation({ ...JAM, driver: { ...JAM.driver, reactionDelay: 0 }, variation: 0.1 });
    tapBrake(sim, 0);
    for (let k = 0; k < 300; k++) {
      for (let i = 0; i < sim.carCount; i++) {
        const l = sim.leader[i];
        const perceived = perceive(sim, i);
        expect(perceived.speed).toBe(sim.speed[i]);
        expect(perceived.closingSpeed).toBe(sim.speed[i] - sim.speed[l]);
        expect(perceived.gap).toBeCloseTo(gaps(sim)[i], 12);
      }
      stepSimulation(sim);
    }
  });

  test("history before t = 0 is the initial state held constant", () => {
    const sim = createSimulation({ ...JAM, driver: { ...JAM.driver, reactionDelay: 1 } });
    const initial = Array.from({ length: sim.carCount }, (_, i) => perceive(sim, i));
    tapBrake(sim, 0);
    run(sim, 0.5); // still within the first second, so everyone still sees the start
    for (let i = 0; i < sim.carCount; i++) expect(perceive(sim, i)).toEqual(initial[i]);
    run(sim, 1);
    expect(perceive(sim, 0)).not.toEqual(initial[0]);
  });

  test("a delay that is not a multiple of dt interpolates between stored snapshots", () => {
    const dt = 0.05;
    const delay = 0.32; // 6.4 steps: n = 6, beta = 0.4
    const sim = createSimulation({ ...JAM, driver: { ...JAM.driver, reactionDelay: delay } }, { dt });
    tapBrake(sim, 2);
    const recorded: { speed: number[]; gap: number[] }[] = [];
    const record = () => recorded.push({ speed: Array.from(sim.speed), gap: gaps(sim) });
    record();
    for (let k = 0; k < 60; k++) {
      stepSimulation(sim);
      record();
    }
    const now = recorded.length - 1;
    const n = Math.floor(delay / dt);
    const beta = delay / dt - n;
    expect(n).toBe(6);
    for (let i = 0; i < sim.carCount; i++) {
      const perceived = perceive(sim, i);
      const older = recorded[now - n - 1];
      const newer = recorded[now - n];
      expect(perceived.speed).toBeCloseTo(beta * older.speed[i] + (1 - beta) * newer.speed[i], 9);
      expect(perceived.gap).toBeCloseTo(beta * older.gap[i] + (1 - beta) * newer.gap[i], 9);
    }
    // The tapped car's speed really changed within the window, so this is not a vacuous match.
    expect(recorded[now - n - 1].speed[2]).not.toBeCloseTo(recorded[now - n].speed[2], 4);
  });

  test("readCar reports the desired gap from what the driver perceives, not the true state", () => {
    const sim = createSimulation({ ...JAM, driver: { ...JAM.driver, reactionDelay: 0.8 } });
    tapBrake(sim, 5);
    run(sim, 1.5);
    const r = readCar(sim, 5);
    expect(r.desiredGap).toBeCloseTo(desiredGap(perceive(sim, 5), sim.drivers[5], ROAD), 12);
    expect(r.desiredGap).not.toBeCloseTo(
      desiredGap({ speed: sim.speed[5], gap: r.gap, closingSpeed: sim.speed[5] - sim.speed[6] }, sim.drivers[5], ROAD),
      6,
    );
  });
});

test.describe("brake tap", () => {
  test("is small, deterministic, and expires", () => {
    const make = () => {
      const sim = createSimulation(STEADY);
      run(sim, 2);
      return sim;
    };
    const a = make();
    const b = make();
    const cruise = a.speed[0];
    tapBrake(a, 0);
    tapBrake(b, 0);
    expect(readCar(a, 0).tapActive).toBe(true);
    run(a, TAP_DURATION);
    run(b, TAP_DURATION);
    expect(readCar(a, 0).tapActive).toBe(false);
    expect(Array.from(a.speed)).toEqual(Array.from(b.speed));
    const shed = cruise - a.speed[0];
    expect(shed).toBeGreaterThan(1.5);
    expect(shed).toBeLessThan(3);
    expect(shed).toBeLessThanOrEqual(TAP_DECELERATION * TAP_DURATION + 1e-9);
    // Only car 0 was tapped; the others had no reason to move in one second (their request is delayed).
    expect(readCar(a, 0).tapActive).toBe(false);
    expect(Math.abs(a.speed[5] - cruise)).toBeLessThan(0.1);
  });

  test("tapping again while active restarts the tap", () => {
    const once = createSimulation(STEADY);
    const twice = createSimulation(STEADY);
    tapBrake(once, 0);
    tapBrake(twice, 0);
    run(once, 0.5);
    run(twice, 0.5);
    tapBrake(twice, 0);
    run(once, 0.6);
    run(twice, 0.6);
    expect(readCar(once, 0).tapActive).toBe(false);
    expect(readCar(twice, 0).tapActive).toBe(true);
    expect(twice.speed[0]).toBeLessThan(once.speed[0]);
  });

  test("an untapped run is unaffected by the existence of taps elsewhere in time", () => {
    const a = createSimulation(STEADY);
    const b = createSimulation(STEADY);
    run(a, 30);
    run(b, 30);
    expect(Array.from(a.speed)).toEqual(Array.from(b.speed));
    expect(summarise(a).speedSpread).toBeLessThan(1e-9);
  });
});

test.describe("brake lights", () => {
  /** Set every car's desired speed so its IDM request is `target` right now (cars are identical on an even ring). */
  function requestEverywhere(sim: Simulation, target: number): void {
    let low = 0.1;
    let high = 100;
    const request = (v0: number) =>
      desiredAcceleration(perceive(sim, 0), { ...sim.drivers[0], desiredSpeed: v0 }, ROAD);
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      if (request(mid) < target) low = mid;
      else high = mid;
    }
    setDrivers(sim, { ...sim.drivers[0], desiredSpeed: (low + high) / 2 }, 0);
  }

  test("hysteresis: no flicker between the on and off thresholds", () => {
    const sim = createSimulation({ ...STEADY, carCount: 8, driver: { ...STEADY.driver, reactionDelay: 0 } });
    const mid = (BRAKE_LIGHT_ON + BRAKE_LIGHT_OFF) / 2;
    const light = () => sim.brakeLight[0];
    const stage = (target: number) => {
      for (let k = 0; k < 4; k++) {
        requestEverywhere(sim, target);
        stepSimulation(sim);
      }
    };
    stage(mid);
    expect(light()).toBe(0); // never crossed ON
    stage(BRAKE_LIGHT_ON - 0.4);
    expect(light()).toBe(1);
    stage(mid);
    expect(sim.acceleration[0]).toBeGreaterThan(BRAKE_LIGHT_ON);
    expect(sim.acceleration[0]).toBeLessThan(BRAKE_LIGHT_OFF);
    expect(light()).toBe(1); // between thresholds: stays on
    stage(BRAKE_LIGHT_OFF + 0.2);
    expect(light()).toBe(0);
    stage(mid);
    expect(light()).toBe(0); // between thresholds: stays off
  });

  test("a stopped car held with a non-positive request keeps its light until it pulls away", () => {
    const sim = createSimulation(JAM);
    let heldWithLight = 0;
    let pulledAway = 0;
    for (let k = 0; k < 12000; k++) {
      const wasStopped = Array.from(sim.speed, (v) => v === 0);
      const wasLit = Array.from(sim.brakeLight);
      stepSimulation(sim);
      for (let i = 0; i < sim.carCount; i++) {
        if (wasStopped[i] && sim.speed[i] === 0) {
          expect(sim.brakeLight[i]).toBe(wasLit[i]);
          if (wasLit[i]) heldWithLight++;
        }
        if (wasStopped[i] && sim.speed[i] > 0 && sim.acceleration[i] >= BRAKE_LIGHT_OFF) {
          expect(sim.brakeLight[i]).toBe(0);
          pulledAway++;
        }
      }
    }
    expect(heldWithLight).toBeGreaterThan(50);
    expect(pulledAway).toBeGreaterThan(20);
  });
});

test.describe("honest failure", () => {
  /** Eight even cars; car 0 is made to arrive far too fast on a stationary car 1. */
  function doomed(): Simulation {
    const sim = createSimulation({ ...STEADY, carCount: 8, driver: { ...STEADY.driver, reactionDelay: 0 } });
    sim.speed.fill(0);
    sim.position[1] = sim.position[0] + ROAD.vehicleLength + 0.2;
    sim.speed[0] = 15;
    return sim;
  }

  test("an overlap is reported, frozen, and never repaired", () => {
    const sim = doomed();
    expect(sim.status.kind).toBe("running");
    stepSimulation(sim);
    expect(sim.status).toMatchObject({ kind: "collision", follower: 0, leader: 1 });
    const frozen = {
      position: Array.from(sim.position),
      speed: Array.from(sim.speed),
      travelled: Array.from(sim.travelled),
      acceleration: Array.from(sim.acceleration),
      time: sim.time,
      steps: sim.steps,
      status: sim.status,
    };
    expect(gaps(sim)[0]).toBeLessThanOrEqual(0);
    for (let k = 0; k < 50; k++) stepSimulation(sim);
    expect(Array.from(sim.position)).toEqual(frozen.position);
    expect(Array.from(sim.speed)).toEqual(frozen.speed);
    expect(Array.from(sim.travelled)).toEqual(frozen.travelled);
    expect(Array.from(sim.acceleration)).toEqual(frozen.acceleration);
    expect(sim.time).toBe(frozen.time);
    expect(sim.steps).toBe(frozen.steps);
    expect(sim.status).toBe(frozen.status);
    expect(gaps(sim)[0]).toBeLessThanOrEqual(0);
  });

  test("the vehicle layer caps braking at the physical limit", () => {
    const sim = doomed();
    stepSimulation(sim);
    expect(sim.acceleration[0]).toBeCloseTo(-PHYSICAL_BRAKING_LIMIT, 9);
  });

  test("a non-finite value is reported as invalid", () => {
    const sim = createSimulation(STEADY);
    sim.speed[3] = Number.NaN;
    stepSimulation(sim);
    expect(sim.status.kind).toBe("invalid");
    const frozen = Array.from(sim.position);
    stepSimulation(sim);
    expect(Array.from(sim.position)).toEqual(frozen);
  });

  test("a car that would stop inside a step stops exactly, with no negative speed", () => {
    const sim = createSimulation({ ...STEADY, carCount: 8, driver: { ...STEADY.driver, reactionDelay: 0 } });
    // Hard braking request: leader is stopped right ahead.
    sim.speed.fill(0);
    sim.speed[0] = 0.1;
    sim.position[1] = sim.position[0] + ROAD.vehicleLength + 0.8;
    const before = sim.travelled[0];
    stepSimulation(sim);
    expect(sim.speed[0]).toBe(0);
    expect(sim.travelled[0] - before).toBeGreaterThan(0);
    expect(sim.travelled[0] - before).toBeLessThanOrEqual((0.1 * 0.1) / (2 * PHYSICAL_BRAKING_LIMIT) + 1e-12);
    expect(sim.acceleration[0]).toBeCloseTo(-0.1 / sim.dt, 9);
  });
});

test.describe("live driver changes", () => {
  test("setDrivers changes parameters without resetting state or redrawing offsets", () => {
    const sim = createSimulation({ ...JAM, variation: 0.1 });
    run(sim, 20);
    const state = {
      time: sim.time,
      steps: sim.steps,
      position: Array.from(sim.position),
      speed: Array.from(sim.speed),
      travelled: Array.from(sim.travelled),
    };
    const original = sim.drivers.map((d) => ({ ...d }));
    const centre = JAM.driver;

    setDrivers(sim, centre, 0.2);
    expect(sim.time).toBe(state.time);
    expect(sim.steps).toBe(state.steps);
    expect(Array.from(sim.position)).toEqual(state.position);
    expect(Array.from(sim.speed)).toEqual(state.speed);
    expect(Array.from(sim.travelled)).toEqual(state.travelled);
    // Offsets are reused: each deviation from the centre exactly doubles.
    for (const key of ["timeGap", "reactionDelay", "maxAcceleration", "comfortableBraking", "desiredSpeed"] as const) {
      sim.drivers.forEach((d, i) => {
        const before = original[i][key] - centre[key];
        const after = d[key] - centre[key];
        expect(after).toBeCloseTo(2 * before, 9);
      });
    }
    setDrivers(sim, centre, 0.1);
    expect(sim.drivers).toEqual(original);

    const slower = { ...centre, desiredSpeed: 10 };
    setDrivers(sim, slower, 0);
    for (const d of sim.drivers) expect(d).toEqual(slower);
    // And the run carries on from where it was.
    stepSimulation(sim);
    expect(sim.steps).toBe(state.steps + 1);
  });

  test("varied parameters stay positive and delay is clamped at zero", () => {
    const sim = createSimulation({ ...STEADY, driver: { ...STEADY.driver, reactionDelay: 0.1 }, variation: 0.2 });
    setDrivers(sim, { ...STEADY.driver, reactionDelay: 0.1 }, 5);
    for (const d of sim.drivers) {
      expect(d.reactionDelay).toBeGreaterThanOrEqual(0);
      expect(d.timeGap).toBeGreaterThan(0);
      expect(d.maxAcceleration).toBeGreaterThan(0);
    }
  });
});

test.describe("acceptance experiment: jams form without obstacles", () => {
  for (const dt of [DEFAULT_DT / 2, DEFAULT_DT, DEFAULT_DT * 2]) {
    test(`steady preset: the tap decays (dt = ${dt})`, () => {
      const r = trial(STEADY, { dt, tap: true });
      expect(r.status).toBe("running");
      expect(r.peakSpread).toBeGreaterThan(0.2); // the tap really disturbed the flow
      expect(r.peakSpread).toBeLessThan(1.2); // ...modestly
      expect(r.spreadAt[60]).toBeLessThan(r.peakSpread / 2);
      expect(r.spreadAt[120]).toBeLessThan(0.15);
      expect(r.lateMaxSpread).toBeLessThan(0.02); // t >= 300 s
      expect(r.minSpeed).toBeGreaterThan(2);
      expect(r.stops).toBe(0);
    });

    test(`jam preset, even start, one tap: stop-and-go waves that run backwards (dt = ${dt})`, () => {
      const r = trial(JAM_EVEN, { dt, tap: true });
      expect(r.status).toBe("running");
      expect(r.jamTime).not.toBeNull();
      expect(r.jamTime!).toBeLessThan(70);
      expect(r.spreadAt[120]).toBeGreaterThan(1.5);
      expect(r.spreadAt[600]).toBeGreaterThan(1);
      expect(r.lateMeanSpread).toBeGreaterThan(1.5); // t in [300, 600]
      expect(r.minSpeed).toBeLessThan(0.1); // cars really stop
      expect(Math.min(...r.stopsPerCar)).toBeGreaterThan(15); // ...and again and again, every car
      expect(r.waveVelocity).not.toBeNull();
      expect(r.waveVelocity!).toBeLessThan(-3);
      expect(r.waveVelocity!).toBeGreaterThan(-12);
      expect(r.minTravelledRate).toBeGreaterThan(2); // every car keeps driving forwards
    });
  }

  for (const dt of [DEFAULT_DT / 2, DEFAULT_DT]) {
    test(`jam preset, jumbled start, no tap: a jam emerges on its own (dt = ${dt})`, () => {
      const r = trial(JAM, { dt, tap: false });
      expect(r.status).toBe("running");
      expect(r.jamTime).not.toBeNull();
      expect(r.jamTime!).toBeLessThan(120);
      expect(r.lateMeanSpread).toBeGreaterThan(1.5);
      expect(r.minSpeed).toBeLessThan(0.1);
      expect(r.waveVelocity!).toBeLessThan(-3);
    });
  }

  test("without a tap or a jumble, the steady preset stays perfectly steady", () => {
    const r = trial(STEADY, { dt: DEFAULT_DT, tap: false, seconds: 300 });
    expect(r.peakSpread).toBeLessThan(1e-6);
  });

  test("the jam preset's start really is only a slight disturbance", () => {
    const sim = createSimulation(JAM);
    const s = summarise(sim);
    expect(s.speedSpread).toBeLessThan(1e-9);
    const g = gaps(sim);
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    expect(Math.max(...g.map((x) => Math.abs(x - mean) / (mean + ROAD.vehicleLength)))).toBeLessThan(2 * JUMBLE_FRACTION);
  });

  test("the presets differ only in reaction delay", () => {
    const { reactionDelay: jamDelay, ...jamDriver } = JAM.driver;
    const { reactionDelay: steadyDelay, ...steadyDriver } = STEADY_PRESET.driver;
    expect({ ...JAM, driver: jamDriver }).toEqual({ ...STEADY_PRESET, driver: steadyDriver });
    expect(jamDelay).toBeGreaterThan(steadyDelay);
  });

  test("steady preset as shipped: the same jumbled start smooths out instead of jamming", () => {
    expect(Array.from(createSimulation(STEADY_PRESET).position)).toEqual(Array.from(createSimulation(JAM).position));
    const r = trial(STEADY_PRESET, { dt: DEFAULT_DT, tap: false });
    expect(r.status).toBe("running");
    expect(r.jamTime).toBeNull();
    expect(r.stops).toBe(0);
    expect(r.lateMaxSpread).toBeLessThan(0.02);
  });
});
