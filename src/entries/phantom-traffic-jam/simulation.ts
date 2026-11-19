/**
 * Traffic on a closed track: IDM drivers (driver.ts) with an explicit
 * reaction delay, stepped synchronously, on one of three roads (track.ts).
 *
 * Sources
 *  - IDM: Treiber, Hennecke & Helbing (2000), https://arxiv.org/abs/cond-mat/0002177
 *  - Reaction delay and ballistic update: Treiber, Kesting & Helbing (2006),
 *    "Delays, inaccuracies and anticipation in microscopic traffic models",
 *    https://ar5iv.labs.arxiv.org/html/cond-mat/0404736. Only the finite
 *    reaction time is used: the stimuli (speed, gap, speed difference) are
 *    evaluated at t − τ, linearly interpolated when τ is not a multiple of dt
 *    (their Sec. 2.1), then advanced with v += a·dt, x += v·dt + a·dt²/2 (Eq. 21).
 *  - Merge safety: the safety criterion of MOBIL, Kesting, Treiber & Helbing
 *    (2007), https://www.akesting.de/download/MOBIL_TGF07.pdf: the car that
 *    would end up behind must not be asked to brake harder than b_safe,
 *    predicted with the car-following model itself. MOBIL's incentive
 *    criterion is for optional lane changes; a ramp car has to merge, so here
 *    it merges as soon as the safety criterion holds, and the rules for
 *    adjusting speed to a gap and for making room are this model's own
 *    (see `decideMerges` and `cooperate`), not part of MOBIL.
 *
 * Layers, one function each: perceive (history) -> desiredAcceleration +
 * cornerAcceleration (driver.ts) -> decideMerges/cooperate (merging) ->
 * applyTap (intervention) -> integrate (vehicle). Every driver decides from
 * the same pre-step state; then every car moves and every accepted merge is
 * committed together; then the cars' order along each lane is re-read. Cars
 * are addressed by identity, never by array order.
 *
 * Nothing random happens after initialisation, and a failed run is frozen
 * rather than repaired.
 */
import { ACCELERATION_EXPONENT, cornerAcceleration, desiredAcceleration, desiredGap } from "./driver";
import { DEFAULT_CORNERING, DEFAULT_DT, DEFAULT_MERGING, ROAD } from "./parameters";
import { createRandom } from "./random";
import { cornersAhead, limitAt, positiveMod, trackFor, type Lane, type Track } from "./track";
import type {
  CarReadout,
  DriverParamKey,
  DriverParams,
  ExperimentConfig,
  Intervention,
  MergeEvent,
  MergingParams,
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

/**
 * A held brake releases itself after this much simulated time (s), even if
 * the experimenter never lets go, so one press is a bounded disturbance and
 * can never become a permanent roadblock. Holding again afterwards is a new,
 * explicit `holdBrake` call.
 */
export const HOLD_LIMIT = 4;

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

/** How far ahead drivers read the road for bends, m. Beyond the longest comfortable braking distance from the fastest slider speed. */
export const CORNER_HORIZON = 120;

/**
 * A merge also needs this much clear road, m, in front and behind in the main
 * lane. The braking criterion alone already implies far more at any speed
 * difference; this keeps "no overlap" true by construction at crawling speeds.
 */
export const MERGE_CLEARANCE = 2;

/** A ramp car in the merge zone below this speed, m/s, counts as waiting. */
export const WAITING_SPEED = 0.5;

/** Flow past the merge is counted over this window, s. */
export const FLOW_WINDOW = 60;

const DRIVER_KEYS: readonly DriverParamKey[] = [
  "desiredSpeed",
  "timeGap",
  "reactionDelay",
  "maxAcceleration",
  "comfortableBraking",
];

/** Smallest fraction of the centre value a varied parameter may take. */
const MIN_PARAMETER_FRACTION = 0.1;

const MAIN = 0;
const RAMP = 1;

/** `Simulation` plus the private state behind it. */
export type InternalSimulation = Simulation & {
  /** The population centre that `setDrivers` last applied. */
  centre: DriverParams;
  variation: number;
  /** Standardised offsets in [-1, 1], DRIVER_KEYS.length per car, drawn once from the seed. */
  offsets: Float64Array;
  /** Seconds of brake tap left per car. */
  tapRemaining: Float64Array;
  /** Steps of held brake left per car before the limit ends it; 0 = not held. Counted in whole steps. */
  holdStepsLeft: Int32Array;
  /** Step number at which the scheduled tap lands, or -1 for none (or an unusable schedule). */
  scheduledStep: number;
  scheduledCar: number;
  /** Mutable backing of `Simulation.interventions`. */
  log: Intervention[];
  /** Mutable backing of `Simulation.merges`. */
  mergeLog: MergeEvent[];
  /** Simulated times at which a car passed the end of the merge zone on the main lane, within FLOW_WINDOW. */
  crossings: number[];
  /** Ring buffer of perceived state, slot (step mod capacity) * carCount + car. */
  historySpeed: Float64Array;
  historyGap: Float64Array;
  historyClosing: Float64Array;
  historyCapacity: number;
  /** Scratch: this step's requested acceleration per car. */
  request: Float64Array;
  /** Scratch: 1 for a car whose merge was accepted this step. */
  accepted: Uint8Array;
  /** Scratch: car ids sorted by lane and position. */
  order: number[];
};

function internal(sim: Simulation): InternalSimulation {
  return sim as InternalSimulation;
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

/**
 * Which cars use the ramp: `share` of them, spread evenly through the car
 * numbers (car 0 never, so the followed car stays on the main road), fixed
 * for the run. Only the merge track has a ramp.
 */
function assignRoutes(track: Track, n: number, share: number): Uint8Array {
  const route = new Uint8Array(n);
  if (!track.junction) return route;
  const count = Math.round(Math.min(Math.max(0, share), 1) * n);
  for (let car = 0; car < n; car++) {
    if (Math.floor(((car + 1) * count) / n) > Math.floor((car * count) / n)) route[car] = RAMP;
  }
  return route;
}

/**
 * The speed a car may start at where it stands: the even-spacing equilibrium,
 * capped by the bend it is in and by what the bends ahead allow at comfortable
 * braking, so a run on a track with corners begins settled, not mid-skid.
 */
function startSpeedAt(lane: Lane, position: number, equilibrium: number, params: DriverParams, cornering: number): number {
  let speed = Math.min(equilibrium, limitAt(lane, position, cornering));
  for (const corner of cornersAhead(lane, position, CORNER_HORIZON, cornering)) {
    speed = Math.min(speed, Math.sqrt(corner.limit ** 2 + 2 * params.comfortableBraking * corner.distance));
  }
  return speed;
}

export function createSimulation(config: ExperimentConfig, options: { dt?: number } = {}): Simulation {
  const dt = options.dt ?? DEFAULT_DT;
  const n = config.carCount;
  const track = trackFor(config.track ?? "ring");
  const main = track.lanes[MAIN];
  const { vehicleLength, minimumGap } = ROAD;
  const road = track.id === "ring" ? ROAD : { length: main.length, vehicleLength, minimumGap };
  const cornering = config.cornering ?? DEFAULT_CORNERING;
  const merging = config.merging ?? DEFAULT_MERGING;
  const random = createRandom(config.seed);

  // Draw order is fixed so that `start` never changes the driver offsets.
  const offsets = new Float64Array(n * DRIVER_KEYS.length);
  for (let i = 0; i < offsets.length; i++) offsets[i] = random.range(-1, 1);
  const jumble = new Float64Array(n);
  for (let i = 0; i < n; i++) jumble[i] = random.range(-1, 1);

  const spacing = main.length / n;
  const spareRoom = Math.max(0, spacing - vehicleLength - minimumGap);
  const position = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const offset = config.start === "jumbled" ? jumble[i] * JUMBLE_FRACTION * spareRoom : 0;
    position[i] = positiveMod(i * spacing + offset, main.length);
  }

  const equilibrium = equilibriumSpeed(config.driver, spacing - vehicleLength, minimumGap);
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) speed[i] = startSpeedAt(main, position[i], equilibrium, config.driver, cornering);
  const historyCapacity = Math.ceil(HISTORY_SECONDS / dt) + 2;

  const scheduledStep = scheduleStep(config, dt);

  const sim: InternalSimulation = {
    road,
    track,
    carCount: n,
    dt,
    time: 0,
    steps: 0,
    status: { kind: "running" },
    leader: new Int32Array(n),
    lane: new Uint8Array(n),
    route: assignRoutes(track, n, merging.rampShare),
    position,
    travelled: new Float64Array(n),
    speed,
    acceleration: new Float64Array(n),
    brakeLight: new Uint8Array(n),
    mergedAt: new Float64Array(n).fill(-Infinity),
    drivers: [],
    cornering,
    merging,
    centre: config.driver,
    variation: config.variation,
    offsets,
    tapRemaining: new Float64Array(n),
    holdStepsLeft: new Int32Array(n),
    scheduledStep,
    scheduledCar: scheduledStep < 0 ? -1 : (config.scheduledTap?.car ?? -1),
    log: [],
    interventions: [],
    mergeLog: [],
    merges: [],
    crossings: [],
    historySpeed: new Float64Array(historyCapacity * n),
    historyGap: new Float64Array(historyCapacity * n),
    historyClosing: new Float64Array(historyCapacity * n),
    historyCapacity,
    request: new Float64Array(n),
    accepted: new Uint8Array(n),
    order: [],
  };
  (sim as { interventions: readonly Intervention[] }).interventions = sim.log;
  (sim as { merges: readonly MergeEvent[] }).merges = sim.mergeLog;
  setDrivers(sim, config.driver, config.variation);
  updateLeaders(sim);
  recordHistory(sim);
  return sim;
}

/**
 * The step count at which the scheduled tap lands: round(time / dt), so it is
 * the same simulated instant at any dt. Time 0 lands before the first step.
 * A car index outside 0..carCount-1 (or a negative or non-finite time) is
 * ignored rather than thrown on: the experiment simply has no scheduled tap.
 */
function scheduleStep(config: ExperimentConfig, dt: number): number {
  const tap = config.scheduledTap;
  if (!tap) return -1;
  if (!Number.isInteger(tap.car) || tap.car < 0 || tap.car >= config.carCount) return -1;
  if (!Number.isFinite(tap.time) || tap.time < 0) return -1;
  return Math.round(tap.time / dt);
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

/** Live change of the cornering comfort. No reset. */
export function setCornering(sim: Simulation, lateral: number): void {
  (sim as { cornering: number }).cornering = lateral;
}

/** Live change of merge behaviour. The ramp share is fixed per run and ignored here. */
export function setMerging(sim: Simulation, merging: Pick<MergingParams, "cooperation" | "acceptableBraking">): void {
  (sim as { merging: MergingParams }).merging = { ...sim.merging, cooperation: merging.cooperation, acceptableBraking: merging.acceptableBraking };
}

function isValidCar(sim: Simulation, car: number): boolean {
  return Number.isInteger(car) && car >= 0 && car < sim.carCount;
}

function log(sim: Simulation, car: number, kind: Intervention["kind"]): void {
  internal(sim).log.push({ time: sim.time, car, kind });
}

/**
 * One experimenter tap on `car`. Does nothing, and logs nothing, on a frozen
 * run, for an invalid car, or while that car's brake is held (the hold already
 * overrides the driver; after release the car behaves as if never tapped).
 */
export function tapBrake(sim: Simulation, car: number): void {
  if (sim.status.kind !== "running" || !isValidCar(sim, car)) return;
  const s = internal(sim);
  if (s.holdStepsLeft[car] > 0) return;
  s.tapRemaining[car] = TAP_DURATION;
  log(s, car, "tap");
}

/**
 * The experimenter starts holding `car`'s brake: at least one tap's worth,
 * then for as long as it stays held, up to HOLD_LIMIT. No-op (nothing logged,
 * limit not extended) when already held, on a frozen run, or for an invalid car.
 */
export function holdBrake(sim: Simulation, car: number): void {
  if (sim.status.kind !== "running" || !isValidCar(sim, car)) return;
  const s = internal(sim);
  if (s.holdStepsLeft[car] > 0) return;
  s.holdStepsLeft[car] = Math.max(1, Math.round(HOLD_LIMIT / s.dt));
  s.tapRemaining[car] = TAP_DURATION;
  log(s, car, "hold");
}

/** The experimenter lets go. Idempotent; the driver resumes once any tap minimum has run out. */
export function releaseBrake(sim: Simulation, car: number): void {
  if (sim.status.kind !== "running" || !isValidCar(sim, car)) return;
  internal(sim).holdStepsLeft[car] = 0;
}

// --- Geometry along lanes --------------------------------------------------

function laneOf(sim: Simulation, car: number): Lane {
  return sim.track.lanes[sim.lane[car]];
}

/** Bumper-to-bumper gap from a car at `follower` to one at `leader`, both metres along `lane`. */
function laneGap(lane: Lane, follower: number, leader: number, vehicleLength: number): number {
  const ahead = lane.closed ? positiveMod(leader - follower, lane.length) : leader - follower;
  return ahead - vehicleLength;
}

/**
 * Gap along the lane to the car ahead; with nothing ahead on an open lane,
 * to the lane's end; alone on a closed lane, a full lap back to itself.
 */
function gapOf(sim: Simulation, car: number): number {
  const lane = laneOf(sim, car);
  const ahead = sim.leader[car];
  if (ahead < 0) return lane.length - sim.position[car];
  if (ahead === car) return lane.length - sim.road.vehicleLength;
  return laneGap(lane, sim.position[car], sim.position[ahead], sim.road.vehicleLength);
}

/** Main-lane metres beside ramp metre `s` in the merge zone. */
function alignedMain(sim: Simulation, s: number): number {
  const { junction } = sim.track;
  if (!junction) return s;
  return positiveMod(junction.zoneMainStart + (s - junction.zoneStart) * junction.zoneScale, sim.track.lanes[MAIN].length);
}

function inZone(sim: Simulation, car: number): boolean {
  const { junction } = sim.track;
  return Boolean(junction) && sim.lane[car] === RAMP && sim.position[car] >= junction!.zoneStart;
}

/**
 * Re-read who is ahead of whom from positions, per lane. Order is physical
 * (position, then car number only to break an exact tie, which is itself an
 * overlap the status check will report).
 */
function updateLeaders(sim: Simulation): void {
  const s = internal(sim);
  const n = s.carCount;
  const order = s.order;
  order.length = 0;
  for (let car = 0; car < n; car++) order.push(car);
  order.sort((a, b) => s.lane[a] - s.lane[b] || s.position[a] - s.position[b] || a - b);
  let laneStart = 0;
  for (let k = 0; k < n; k++) {
    const car = order[k];
    const last = k === n - 1 || s.lane[order[k + 1]] !== s.lane[car];
    if (!last) {
      s.leader[car] = order[k + 1];
    } else {
      s.leader[car] = s.track.lanes[s.lane[car]].closed ? order[laneStart] : -1;
      laneStart = k + 1;
    }
  }
}

// --- Perception ---------------------------------------------------------

/** What `car` can see right now, read straight from the state. */
function observeNow(sim: Simulation, car: number): Observation {
  const ahead = sim.leader[car];
  return {
    speed: sim.speed[car],
    gap: gapOf(sim, car),
    // The end of a lane stands still.
    closingSpeed: sim.speed[car] - (ahead < 0 ? 0 : sim.speed[ahead]),
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
 * A driver who has just merged has been watching the gap they moved into, so
 * their memory of "the car ahead" is of that car, not of the ramp: overwrite
 * their stored gaps with the current one. (The car behind them gets no such
 * favour: it sees the newcomer one reaction delay late.)
 */
function refreshPerception(sim: Simulation, car: number): void {
  const s = internal(sim);
  const seen = observeNow(s, car);
  for (let row = 0; row < s.historyCapacity; row++) {
    s.historyGap[row * s.carCount + car] = seen.gap;
    s.historyClosing[row * s.carCount + car] = seen.closingSpeed;
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

// --- Driver ----------------------------------------------------------------

/** The driver's request for the road ahead on their own lane: IDM following, capped by the bend they are in and braking for the bends to come. */
function roadRequest(sim: Simulation, car: number): number {
  const s = internal(sim);
  const lane = laneOf(s, car);
  const params = s.drivers[car];
  const limit = limitAt(lane, s.position[car], s.cornering);
  const inBend = limit < params.desiredSpeed ? { ...params, desiredSpeed: limit } : params;
  const following = desiredAcceleration(perceive(s, car), inBend, s.road);
  const bends = cornerAcceleration(s.speed[car], cornersAhead(lane, s.position[car], CORNER_HORIZON, s.cornering), params);
  return Math.min(following, bends);
}

// --- Merging ---------------------------------------------------------------

/** A car as seen from the main lane: who it is, main-lane metres and speed. Ramp cars in the zone appear at their aligned position. */
type Occupant = Readonly<{ car: number; position: number; speed: number }>;

/** The nearest occupant ahead of and behind main-lane metre `at` (the same one, or none, when the lane has one or no cars). */
function neighbours(sim: Simulation, occupants: readonly Occupant[], at: number): { ahead: Occupant | null; behind: Occupant | null } {
  const length = sim.track.lanes[MAIN].length;
  let ahead: Occupant | null = null;
  let behind: Occupant | null = null;
  let aheadBy = Infinity;
  let behindBy = Infinity;
  for (const other of occupants) {
    const forward = positiveMod(other.position - at, length);
    if (forward < aheadBy) {
      aheadBy = forward;
      ahead = other;
    }
    const backward = positiveMod(at - other.position, length);
    if (backward < behindBy) {
      behindBy = backward;
      behind = other;
    }
  }
  return { ahead, behind };
}

type Gaps = Readonly<{ ahead: Occupant | null; behind: Occupant | null; front: number; rear: number }>;

/** Where a ramp car in the zone would sit in the main lane, and the gaps it would have. */
function gapsFor(sim: Simulation, occupants: readonly Occupant[], car: number, position: number): Gaps {
  const at = alignedMain(sim, position);
  const { ahead, behind } = neighbours(sim, occupants, at);
  const length = sim.track.lanes[MAIN].length;
  const { vehicleLength } = sim.road;
  const front = ahead ? positiveMod(ahead.position - at, length) - vehicleLength : Infinity;
  const rear = behind ? positiveMod(at - behind.position, length) - vehicleLength : Infinity;
  return { ahead, behind, front, rear };
}

/** What the car behind would do, by its own car-following model, if `car` were in front of it at these gaps. */
function predictedBehind(sim: Simulation, gaps: Gaps, carSpeed: number): number {
  const behind = gaps.behind;
  if (!behind) return Infinity;
  return desiredAcceleration({ speed: behind.speed, gap: gaps.rear, closingSpeed: behind.speed - carSpeed }, sim.drivers[behind.car], sim.road);
}

/** What `car` itself would do once in the lane. */
function predictedOwn(sim: Simulation, gaps: Gaps, car: number): number {
  const ahead = gaps.ahead;
  if (!ahead) return Infinity;
  return desiredAcceleration({ speed: sim.speed[car], gap: gaps.front, closingSpeed: sim.speed[car] - ahead.speed }, sim.drivers[car], sim.road);
}

/** MOBIL's safety criterion, with a clearance floor: the merge asks no one for more than acceptable braking and overlaps nothing. */
function isSafe(sim: Simulation, gaps: Gaps, car: number): boolean {
  const limit = -sim.merging.acceptableBraking;
  return gaps.front > MERGE_CLEARANCE && gaps.rear > MERGE_CLEARANCE && predictedOwn(sim, gaps, car) >= limit && predictedBehind(sim, gaps, sim.speed[car]) >= limit;
}

/**
 * Everything to do with the ramp, from the pre-step snapshot:
 *
 * 1. Each ramp driver in the merge zone keeps to its own lane's rules (the
 *    car ahead on the ramp, the lane's end, the bends) and in addition
 *    adjusts speed for the gap it is aiming at: it will not run into the
 *    main-lane car it means to slot in behind (treated as a leader by IDM),
 *    and if the car behind that gap would have to brake harder than
 *    acceptable and is faster (it is coming through), it eases off at half
 *    its comfortable braking to fall in behind that car instead. At equal
 *    speed it holds its course: the ramp car is ahead, so a main-road driver
 *    who is making room follows it, and one who is not simply passes or is
 *    passed. Both easing off at once would be the "after you" standstill.
 * 2. It asks to merge when the gap is safe: MOBIL's safety criterion for the
 *    car behind, the same test on itself, and clear road either side.
 *    Merging is mandatory, so there is no incentive test.
 * 3. Main-lane drivers may cooperate: the one directly behind a zone car's
 *    aligned position treats it as a car ahead, braking for it up to
 *    `cooperation` × their comfortable braking.
 * 4. Requests from several ramp cars in one step are settled in road order,
 *    the car furthest along the zone first, each later one judged against
 *    the lane as it will be with the earlier ones in it. Two cars can
 *    therefore never be granted the same bit of road in one step.
 *
 * Cross-lane judgements use the current snapshot: a driver looking over
 * their shoulder sees where cars are now. The reaction delay still governs
 * how every driver follows the car in front, so the car behind a newcomer
 * reacts to it late, and a merge that was safe by the criterion can still
 * end in a collision on this model's terms. That is reported, not prevented.
 */
function decideMerges(sim: Simulation): void {
  const s = internal(sim);
  const { junction } = s.track;
  s.accepted.fill(0);
  if (!junction) return;
  const n = s.carCount;
  const occupants: Occupant[] = [];
  const candidates: number[] = [];
  for (let car = 0; car < n; car++) {
    if (s.lane[car] === MAIN) occupants.push({ car, position: s.position[car], speed: s.speed[car] });
    else if (inZone(s, car)) candidates.push(car);
  }
  if (candidates.length === 0) return;
  // Furthest along the zone first.
  candidates.sort((a, b) => s.position[b] - s.position[a] || a - b);
  const { cooperation } = s.merging;
  for (const car of candidates) {
    const gaps = gapsFor(s, occupants, car, s.position[car]);
    // 1. Speed for the gap.
    if (gaps.ahead && gaps.front > 0) s.request[car] = Math.min(s.request[car], predictedOwn(s, gaps, car));
    const behindWould = predictedBehind(s, gaps, s.speed[car]);
    if (gaps.behind && gaps.rear > 0 && behindWould < -s.merging.acceptableBraking && gaps.behind.speed > s.speed[car]) {
      s.request[car] = Math.min(s.request[car], -s.drivers[car].comfortableBraking / 2);
    }
    // 3. Room from behind, if the main-lane driver is willing.
    if (cooperation > 0 && gaps.behind && gaps.rear > 0) {
      const behind = gaps.behind.car;
      const yielding = Math.max(behindWould, -cooperation * s.drivers[behind].comfortableBraking);
      s.request[behind] = Math.min(s.request[behind], yielding);
    }
    // 2 and 4. Move over if safe, against the lane as it will be.
    if (isSafe(s, gaps, car)) {
      s.accepted[car] = 1;
      occupants.push({ car, position: alignedMain(s, s.position[car]), speed: s.speed[car] });
    }
  }
}

// --- Intervention -------------------------------------------------------

/** An active tap caps the driver's request; it never raises it. */
function applyTap(sim: Simulation, car: number, driverRequest: number): number {
  return tapIsActive(sim, car) ? Math.min(driverRequest, -TAP_DECELERATION) : driverRequest;
}

function tapIsActive(sim: Simulation, car: number): boolean {
  return internal(sim).tapRemaining[car] > sim.dt / 2 || isHeld(sim, car);
}

function isHeld(sim: Simulation, car: number): boolean {
  return internal(sim).holdStepsLeft[car] > 0;
}

// --- Vehicle ------------------------------------------------------------

/**
 * Advance one car by `request` over dt with the ballistic update. The request
 * is clamped to the physical braking limit; speed never goes below zero (a
 * stop inside the step is handled exactly). Returns the realised acceleration.
 * The car follows its route: a ramp user reaching the diverge on the main
 * lane carries straight on to the ramp; a car granted a merge arrives beside
 * where it got to in the zone. Nothing else moves a car between lanes.
 */
function integrate(sim: Simulation, car: number, request: number, merge: boolean): number {
  const s = internal(sim);
  const { dt } = s;
  const a = Math.max(request, -PHYSICAL_BRAKING_LIMIT);
  const v = s.speed[car];
  let distance: number;
  let newSpeed: number;
  if (v + a * dt < 0) {
    distance = (v * v) / (2 * -a);
    newSpeed = 0;
  } else {
    newSpeed = v + a * dt;
    distance = v * dt + 0.5 * a * dt * dt;
  }
  s.speed[car] = newSpeed;
  (s.travelled as Float64Array)[car] += distance;
  const lane = laneOf(s, car);
  const { junction } = s.track;
  const from = s.position[car];
  let to = from + distance;
  if (lane.closed) to = positiveMod(to, lane.length);
  if (junction && s.lane[car] === MAIN) {
    const toDiverge = positiveMod(junction.divergeAt - from, lane.length);
    if (s.route[car] === RAMP && distance > 0 && toDiverge <= distance) {
      s.lane[car] = RAMP;
      to = distance - toDiverge;
    } else {
      const zoneEnd = positiveMod(junction.zoneMainEnd, lane.length);
      if (distance > 0 && positiveMod(zoneEnd - from, lane.length) <= distance) s.crossings.push(s.time + dt);
    }
  } else if (junction && merge) {
    if (from < junction.zoneEnd && to >= junction.zoneEnd) s.crossings.push(s.time + dt);
    s.lane[car] = MAIN;
    to = alignedMain(s, to);
    s.mergedAt[car] = s.time + dt;
    s.mergeLog.push({ time: s.time + dt, car, position: to });
  }
  s.position[car] = to;
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

  // 0. The scheduled tap lands as the step that starts at its time begins.
  if (s.steps === s.scheduledStep && s.holdStepsLeft[s.scheduledCar] === 0) {
    s.tapRemaining[s.scheduledCar] = TAP_DURATION;
    log(s, s.scheduledCar, "scheduled");
  }

  // 1. Everyone decides from the same pre-step state: the road, then the ramp, then the experimenter.
  for (let car = 0; car < n; car++) s.request[car] = roadRequest(s, car);
  decideMerges(s);
  for (let car = 0; car < n; car++) s.request[car] = applyTap(s, car, s.request[car]);

  // 2. Then everyone moves, and accepted merges are committed with the move.
  for (let car = 0; car < n; car++) {
    const wasStopped = s.speed[car] === 0;
    const realised = integrate(s, car, s.request[car], s.accepted[car] === 1);
    s.acceleration[car] = realised;
    const heldStationary = wasStopped && s.speed[car] === 0 && s.request[car] <= 0;
    updateBrakeLight(s, car, realised, heldStationary);
    if (s.tapRemaining[car] > 0) s.tapRemaining[car] = Math.max(0, s.tapRemaining[car] - s.dt);
    if (s.holdStepsLeft[car] > 0) s.holdStepsLeft[car] -= 1;
  }

  s.steps += 1;
  s.time = s.steps * s.dt;
  updateLeaders(s);
  for (let car = 0; car < n; car++) if (s.accepted[car] === 1) refreshPerception(s, car);
  while (s.crossings.length && s.crossings[0] < s.time - FLOW_WINDOW) s.crossings.shift();
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
    const lane = laneOf(sim, car);
    if (!lane.closed && sim.position[car] > lane.length) {
      sim.status = { kind: "invalid", time: sim.time, reason: `Car ${car + 1} drove off the end of the ramp` };
      return;
    }
  }
  for (let car = 0; car < sim.carCount; car++) {
    if (sim.leader[car] >= 0 && gapOf(sim, car) <= 0) {
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
    lane: sim.lane[car],
    inZone: inZone(sim, car),
    limit: limitAt(laneOf(sim, car), sim.position[car], sim.cornering),
    speed: sim.speed[car],
    gap: gapOf(sim, car),
    desiredGap: desiredGap(perceived, sim.drivers[car], sim.road),
    acceleration: sim.acceleration[car],
    brakeLight: sim.brakeLight[car] === 1,
    tapActive: tapIsActive(sim, car),
    brakeHeld: isHeld(sim, car),
  };
}

export function summarise(sim: Simulation): TrafficSummary {
  const s = internal(sim);
  const n = s.carCount;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let waiting = 0;
  for (let car = 0; car < n; car++) {
    const v = s.speed[car];
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (v < WAITING_SPEED && inZone(s, car)) waiting += 1;
  }
  const mean = sum / n;
  let variance = 0;
  for (let car = 0; car < n; car++) variance += (s.speed[car] - mean) ** 2;
  const window = Math.min(FLOW_WINDOW, Math.max(s.time, s.dt));
  const flow = s.track.junction ? (s.crossings.length * 60) / window : 0;
  return { meanSpeed: mean, speedSpread: Math.sqrt(variance / n), minSpeed: min, maxSpeed: max, flow, merges: s.mergeLog.length, waiting };
}

/** Main-lane metres beside a ramp car in the merge zone (for drawing the move over). */
export function alignedPosition(sim: Simulation, position: number): number {
  return alignedMain(sim, position);
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
  const remap = (car: number) => (car < 0 ? car : (slotOf.get(car) as number));
  const copy: InternalSimulation = {
    ...s,
    status: s.status,
    leader: Int32Array.from(order, (car) => remap(s.leader[car])),
    lane: Uint8Array.from(order, (car) => s.lane[car]),
    route: Uint8Array.from(order, (car) => s.route[car]),
    position: perCar(s.position),
    travelled: perCar(s.travelled),
    speed: perCar(s.speed),
    acceleration: perCar(s.acceleration),
    brakeLight: Uint8Array.from(order, (car) => s.brakeLight[car]),
    mergedAt: perCar(s.mergedAt),
    drivers: order.map((car) => s.drivers[car]),
    offsets,
    tapRemaining: perCar(s.tapRemaining),
    holdStepsLeft: Int32Array.from(order, (car) => s.holdStepsLeft[car]),
    scheduledCar: s.scheduledCar < 0 ? -1 : (slotOf.get(s.scheduledCar) as number),
    log: s.log.map((entry) => ({ ...entry, car: slotOf.get(entry.car) as number })),
    mergeLog: s.mergeLog.map((entry) => ({ ...entry, car: slotOf.get(entry.car) as number })),
    crossings: [...s.crossings],
    historySpeed: perCarHistory(s.historySpeed),
    historyGap: perCarHistory(s.historyGap),
    historyClosing: perCarHistory(s.historyClosing),
    request: new Float64Array(n),
    accepted: new Uint8Array(n),
    order: [],
  };
  (copy as { interventions: readonly Intervention[] }).interventions = copy.log;
  (copy as { merges: readonly MergeEvent[] }).merges = copy.mergeLog;
  return copy;
}
