/**
 * Ring-road traffic: IDM drivers (driver.ts) with an explicit reaction delay,
 * stepped synchronously.
 *
 * Sources
 *  - IDM: Treiber, Hennecke & Helbing (2000), https://arxiv.org/abs/cond-mat/0002177
 *  - Reaction delay and ballistic update: Treiber, Kesting & Helbing (2006),
 *    "Delays, inaccuracies and anticipation in microscopic traffic models",
 *    https://ar5iv.labs.arxiv.org/html/cond-mat/0404736. Only the finite
 *    reaction time is used: the stimuli (speed, gap, speed difference) are
 *    evaluated at t − τ, linearly interpolated when τ is not a multiple of dt
 *    (their Sec. 2.1), then advanced with v += a·dt, x += v·dt + a·dt²/2 (Eq. 21).
 *
 * Layers, one function each: perceive (history) -> desiredAcceleration
 * (driver.ts) -> applyTap (intervention) -> integrate (vehicle). All cars
 * request from the same pre-step state and then advance together; cars are
 * addressed by identity through `leader[i]`, never by array order.
 *
 * Nothing random happens after initialisation, and a failed run is frozen
 * rather than repaired.
 */
import { ACCELERATION_EXPONENT, desiredAcceleration, desiredGap } from "./driver";
import { DEFAULT_DT, ROAD } from "./parameters";
import { createRandom } from "./random";
import type {
  CarReadout,
  DriverParamKey,
  DriverParams,
  ExperimentConfig,
  Observation,
  Simulation,
  TrafficSummary,
} from "./types";

/**
 * Emergency braking limit set by tyre grip (about 0.8 g), m/s². This is what
 * the vehicle can physically do; it is unrelated to the driver's comfortable
 * braking parameter.
 */
export const PHYSICAL_BRAKING_LIMIT = 8;

/**
 * An experimenter's brake tap: the car's request becomes at most
 * -TAP_DECELERATION for TAP_DURATION. 2.5 m/s² for 1 s sheds about 2.5 m/s
 * (9 km/h) from a cruising car: noticeable but far short of a stop, and
 * within what a driver would call a firm touch of the brake.
 */
export const TAP_DECELERATION = 2.5;
export const TAP_DURATION = 1;

/** Brake light turns on at or below this realised acceleration, m/s². */
export const BRAKE_LIGHT_ON = -0.8;
/** ...and off again at or above this. Between the two it keeps its state. */
export const BRAKE_LIGHT_OFF = -0.3;

/**
 * Initial "jumbled" offsets: each car moves by up to this fraction of the
 * spare room, the mean gap minus the stopped gap. Two neighbours can close
 * at most twice this, so no car starts nearer than the stopped gap.
 */
export const JUMBLE_FRACTION = 0.13;

/** History kept for perception, s. Longer delays (beyond the slider range) are clamped. */
export const HISTORY_SECONDS = 3;

const DRIVER_KEYS: readonly DriverParamKey[] = [
  "desiredSpeed",
  "timeGap",
  "reactionDelay",
  "maxAcceleration",
  "comfortableBraking",
];

/** Smallest fraction of the centre value a varied parameter may take. */
const MIN_PARAMETER_FRACTION = 0.1;

/** `Simulation` plus the private state behind it. */
export type InternalSimulation = Simulation & {
  /** The population centre that `setDrivers` last applied. */
  centre: DriverParams;
  variation: number;
  /** Standardised offsets in [-1, 1], DRIVER_KEYS.length per car, drawn once from the seed. */
  offsets: Float64Array;
  /** Seconds of brake tap left per car. */
  tapRemaining: Float64Array;
  /** Ring buffer of perceived state, slot (step mod capacity) * carCount + car. */
  historySpeed: Float64Array;
  historyGap: Float64Array;
  historyClosing: Float64Array;
  historyCapacity: number;
  /** Scratch: this step's requested acceleration per car. */
  request: Float64Array;
};

function internal(sim: Simulation): InternalSimulation {
  return sim as InternalSimulation;
}

function positiveMod(x: number, length: number): number {
  const r = x % length;
  return r < 0 ? r + length : r;
}

/** Bumper-to-bumper gap from `follower` to `leader` given front-bumper positions. */
function ringGap(follower: number, leader: number, length: number, vehicleLength: number): number {
  return positiveMod(leader - follower, length) - vehicleLength;
}

function driverFromOffsets(
  centre: DriverParams,
  variation: number,
  offsets: Float64Array,
  car: number,
): DriverParams {
  const out: Record<DriverParamKey, number> = { ...centre };
  DRIVER_KEYS.forEach((key, k) => {
    const z = offsets[car * DRIVER_KEYS.length + k];
    const factor = 1 + variation * z;
    out[key] = key === "reactionDelay"
      ? Math.max(0, centre[key] * factor)
      : centre[key] * Math.max(MIN_PARAMETER_FRACTION, factor);
  });
  return out;
}

/** Homogeneous-flow speed where IDM acceleration is zero at gap `gap` (bisection). */
export function equilibriumSpeed(params: DriverParams, gap: number, minimumGap: number): number {
  const balance = (v: number): number => {
    const wanted = minimumGap + v * params.timeGap;
    return 1 - (v / params.desiredSpeed) ** ACCELERATION_EXPONENT - (wanted / gap) ** 2;
  };
  if (balance(0) <= 0) return 0;
  let low = 0;
  let high = params.desiredSpeed;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (balance(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function createSimulation(config: ExperimentConfig, options: { dt?: number } = {}): Simulation {
  const dt = options.dt ?? DEFAULT_DT;
  const n = config.carCount;
  const { length, vehicleLength, minimumGap } = ROAD;
  const random = createRandom(config.seed);

  // Draw order is fixed so that `start` never changes the driver offsets.
  const offsets = new Float64Array(n * DRIVER_KEYS.length);
  for (let i = 0; i < offsets.length; i++) offsets[i] = random.range(-1, 1);
  const jumble = new Float64Array(n);
  for (let i = 0; i < n; i++) jumble[i] = random.range(-1, 1);

  const spacing = length / n;
  const spareRoom = Math.max(0, spacing - vehicleLength - minimumGap);
  const position = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const offset = config.start === "jumbled" ? jumble[i] * JUMBLE_FRACTION * spareRoom : 0;
    position[i] = positiveMod(i * spacing + offset, length);
  }
  const leader = new Int32Array(n);
  for (let i = 0; i < n; i++) leader[i] = (i + 1) % n;

  const startSpeed = equilibriumSpeed(config.driver, spacing - vehicleLength, minimumGap);
  const historyCapacity = Math.ceil(HISTORY_SECONDS / dt) + 2;

  const sim: InternalSimulation = {
    road: ROAD,
    carCount: n,
    dt,
    time: 0,
    steps: 0,
    status: { kind: "running" },
    leader,
    position,
    travelled: new Float64Array(n),
    speed: new Float64Array(n).fill(startSpeed),
    acceleration: new Float64Array(n),
    brakeLight: new Uint8Array(n),
    drivers: [],
    centre: config.driver,
    variation: config.variation,
    offsets,
    tapRemaining: new Float64Array(n),
    historySpeed: new Float64Array(historyCapacity * n),
    historyGap: new Float64Array(historyCapacity * n),
    historyClosing: new Float64Array(historyCapacity * n),
    historyCapacity,
    request: new Float64Array(n),
  };
  setDrivers(sim, config.driver, config.variation);
  recordHistory(sim);
  return sim;
}

/** Live change of the population: same offsets, new centre and spread. No reset. */
export function setDrivers(sim: Simulation, driver: DriverParams, variation: number): void {
  const s = internal(sim);
  s.centre = driver;
  s.variation = variation;
  (s as { drivers: readonly DriverParams[] }).drivers = Array.from({ length: s.carCount }, (_, car) =>
    driverFromOffsets(driver, variation, s.offsets, car),
  );
}

export function tapBrake(sim: Simulation, car: number): void {
  internal(sim).tapRemaining[car] = TAP_DURATION;
}

function gapOf(sim: Simulation, car: number): number {
  return ringGap(sim.position[car], sim.position[sim.leader[car]], sim.road.length, sim.road.vehicleLength);
}

// --- Perception ---------------------------------------------------------

/** What `car` can see right now, read straight from the state. */
function observeNow(sim: Simulation, car: number): Observation {
  return {
    speed: sim.speed[car],
    gap: gapOf(sim, car),
    closingSpeed: sim.speed[car] - sim.speed[sim.leader[car]],
  };
}

/** Store the current observations as step `sim.steps` of the history. */
function recordHistory(sim: Simulation): void {
  const s = internal(sim);
  const base = (s.steps % s.historyCapacity) * s.carCount;
  for (let car = 0; car < s.carCount; car++) {
    const seen = observeNow(s, car);
    s.historySpeed[base + car] = seen.speed;
    s.historyGap[base + car] = seen.gap;
    s.historyClosing[base + car] = seen.closingSpeed;
  }
}

/**
 * What `car` saw `stepsBack` whole steps ago: the current state for 0,
 * otherwise the stored snapshot. Before step 0 the initial state is held.
 */
function observedStepsAgo(sim: Simulation, car: number, stepsBack: number): Observation {
  if (stepsBack === 0) return observeNow(sim, car);
  const s = internal(sim);
  const slot = (Math.max(0, s.steps - stepsBack) % s.historyCapacity) * s.carCount + car;
  return { speed: s.historySpeed[slot], gap: s.historyGap[slot], closingSpeed: s.historyClosing[slot] };
}

/**
 * What `car` perceives: its observation `reactionDelay` seconds ago.
 * x(t−τ) = β·x[t−n−1] + (1−β)·x[t−n], n = floor(τ/dt), β = τ/dt − n
 * (Treiber et al. 2006), where x[t−k] is the observation k steps ago. Delays
 * beyond the stored history are clamped to it.
 */
export function perceive(sim: Simulation, car: number): Observation {
  const s = internal(sim);
  const delaySteps = s.drivers[car].reactionDelay / s.dt;
  const n = Math.min(Math.floor(delaySteps), s.historyCapacity - 2);
  const beta = Math.min(delaySteps - n, 1);
  const newer = observedStepsAgo(s, car, n);
  if (beta === 0) return newer;
  const older = observedStepsAgo(s, car, n + 1);
  return {
    speed: beta * older.speed + (1 - beta) * newer.speed,
    gap: beta * older.gap + (1 - beta) * newer.gap,
    closingSpeed: beta * older.closingSpeed + (1 - beta) * newer.closingSpeed,
  };
}

// --- Intervention -------------------------------------------------------

/** An active tap caps the driver's request; it never raises it. */
function applyTap(sim: Simulation, car: number, driverRequest: number): number {
  return tapIsActive(sim, car) ? Math.min(driverRequest, -TAP_DECELERATION) : driverRequest;
}

function tapIsActive(sim: Simulation, car: number): boolean {
  return internal(sim).tapRemaining[car] > sim.dt / 2;
}

// --- Vehicle ------------------------------------------------------------

/**
 * Advance one car by `request` over dt with the ballistic update. The request
 * is clamped to the physical braking limit; speed never goes below zero (a
 * stop inside the step is handled exactly). Returns the realised acceleration.
 */
function integrate(sim: Simulation, car: number, request: number): number {
  const { dt } = sim;
  const a = Math.max(request, -PHYSICAL_BRAKING_LIMIT);
  const v = sim.speed[car];
  let distance: number;
  let newSpeed: number;
  if (v + a * dt < 0) {
    distance = (v * v) / (2 * -a);
    newSpeed = 0;
  } else {
    newSpeed = v + a * dt;
    distance = v * dt + 0.5 * a * dt * dt;
  }
  sim.speed[car] = newSpeed;
  (sim.travelled as Float64Array)[car] += distance;
  sim.position[car] = positiveMod(sim.position[car] + distance, sim.road.length);
  return (newSpeed - v) / dt;
}

/**
 * Brake light from realised deceleration with hysteresis. This approximates
 * brake lights from motion; it does not model pedals. A car held stationary
 * while still asking not to accelerate keeps its light as it was.
 */
function updateBrakeLight(sim: Simulation, car: number, realised: number, heldStationary: boolean): void {
  if (heldStationary) return;
  if (realised <= BRAKE_LIGHT_ON) sim.brakeLight[car] = 1;
  else if (realised >= BRAKE_LIGHT_OFF) sim.brakeLight[car] = 0;
}

// --- Step ---------------------------------------------------------------

export function stepSimulation(sim: Simulation): void {
  if (sim.status.kind !== "running") return;
  const s = internal(sim);
  const n = s.carCount;

  // 1. Everyone decides from the same pre-step state.
  for (let car = 0; car < n; car++) {
    const driverRequest = desiredAcceleration(perceive(s, car), s.drivers[car], s.road);
    s.request[car] = applyTap(s, car, driverRequest);
  }

  // 2. Then everyone moves.
  for (let car = 0; car < n; car++) {
    const wasStopped = s.speed[car] === 0;
    const realised = integrate(s, car, s.request[car]);
    s.acceleration[car] = realised;
    const heldStationary = wasStopped && s.speed[car] === 0 && s.request[car] <= 0;
    updateBrakeLight(s, car, realised, heldStationary);
    if (s.tapRemaining[car] > 0) s.tapRemaining[car] = Math.max(0, s.tapRemaining[car] - s.dt);
  }

  s.steps += 1;
  s.time = s.steps * s.dt;
  recordHistory(s);
  checkStatus(s);
}

/** Flag, never repair, a run that has gone wrong. */
function checkStatus(sim: Simulation): void {
  for (let car = 0; car < sim.carCount; car++) {
    const gap = gapOf(sim, car);
    const values = [sim.position[car], sim.speed[car], sim.acceleration[car], gap];
    if (!values.every(Number.isFinite)) {
      sim.status = { kind: "invalid", time: sim.time, reason: `Car ${car + 1} has a non-finite value` };
      return;
    }
  }
  for (let car = 0; car < sim.carCount; car++) {
    if (gapOf(sim, car) <= 0) {
      sim.status = { kind: "collision", time: sim.time, follower: car, leader: sim.leader[car] };
      return;
    }
  }
}

// --- Readouts -----------------------------------------------------------

export function readCar(sim: Simulation, car: number): CarReadout {
  const perceived = perceive(sim, car);
  return {
    car,
    leader: sim.leader[car],
    speed: sim.speed[car],
    gap: gapOf(sim, car),
    desiredGap: desiredGap(perceived, sim.drivers[car], sim.road),
    acceleration: sim.acceleration[car],
    brakeLight: sim.brakeLight[car] === 1,
    tapActive: tapIsActive(sim, car),
  };
}

export function summarise(sim: Simulation): TrafficSummary {
  const n = sim.carCount;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let car = 0; car < n; car++) {
    const v = sim.speed[car];
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const mean = sum / n;
  let variance = 0;
  for (let car = 0; car < n; car++) variance += (sim.speed[car] - mean) ** 2;
  return { meanSpeed: mean, speedSpread: Math.sqrt(variance / n), minSpeed: min, maxSpeed: max };
}

/**
 * Test helper: the same simulation with cars stored in a different order.
 * Storage slot k of the result holds car `order[k]` of `sim`; leaders are
 * remapped, so by-identity behaviour must be unchanged.
 */
export function permuteStorage(sim: Simulation, order: readonly number[]): Simulation {
  const s = internal(sim);
  const n = s.carCount;
  const slotOf = new Map(order.map((car, slot) => [car, slot]));
  const perCar = (a: Float64Array): Float64Array => Float64Array.from(order, (car) => a[car]);
  const perCarHistory = (a: Float64Array): Float64Array => {
    const out = new Float64Array(a.length);
    for (let row = 0; row < s.historyCapacity; row++)
      order.forEach((car, slot) => (out[row * n + slot] = a[row * n + car]));
    return out;
  };
  const keys = DRIVER_KEYS.length;
  const offsets = new Float64Array(n * keys);
  order.forEach((car, slot) => {
    for (let k = 0; k < keys; k++) offsets[slot * keys + k] = s.offsets[car * keys + k];
  });
  const copy: InternalSimulation = {
    ...s,
    status: s.status,
    leader: Int32Array.from(order, (car) => slotOf.get(s.leader[car]) as number),
    position: perCar(s.position),
    travelled: perCar(s.travelled),
    speed: perCar(s.speed),
    acceleration: perCar(s.acceleration),
    brakeLight: Uint8Array.from(order, (car) => s.brakeLight[car]),
    drivers: order.map((car) => s.drivers[car]),
    offsets,
    tapRemaining: perCar(s.tapRemaining),
    historySpeed: perCarHistory(s.historySpeed),
    historyGap: perCarHistory(s.historyGap),
    historyClosing: perCarHistory(s.historyClosing),
    request: new Float64Array(n),
  };
  return copy;
}
