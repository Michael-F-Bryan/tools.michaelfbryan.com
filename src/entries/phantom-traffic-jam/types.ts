/**
 * Shared contract between the traffic model and the page that draws it.
 *
 * Everything is SI (metres, seconds, m/s, m/s²). The page converts to km/h
 * for display only.
 *
 * The model is layered so each question has one answer:
 *   geometry    — the track: lanes, bends and the ramp's junction (track.ts)
 *   perception  — what a driver can see, and how stale it is (reaction delay)
 *   driver      — observation + parameters -> requested acceleration (pure)
 *   merging     — a ramp driver's decision to move over, and a main-road
 *                 driver's decision to make room (local rules, same snapshot)
 *   intervention— an experimenter's brake tap overriding one driver's request
 *   vehicle     — physical limits and integration of the request into motion
 * Rendering and playback live outside the model entirely.
 */
import type { Track, TrackId } from "./track";

/** Vehicle geometry and the main lane's length. Not adjustable. */
export type Road = Readonly<{
  /** Main lane length (ring circumference, or the B's lap), m. */
  length: number;
  /** Bumper-to-bumper vehicle length, m. */
  vehicleLength: number;
  /** IDM s0: the bumper-to-bumper gap a driver keeps when stopped, m. */
  minimumGap: number;
}>;

/**
 * One driver's behaviour. `timeGap` (how far behind, in seconds of travel, a
 * driver wants to sit) and `reactionDelay` (how old the information they act
 * on is) are different things and are never derived from one another.
 */
export type DriverParams = Readonly<{
  /** IDM v0: speed on an empty road, m/s. */
  desiredSpeed: number;
  /** IDM T: desired time headway to the car ahead, s. */
  timeGap: number;
  /** Delay between the traffic changing and the driver acting on it, s. 0 is plain IDM. */
  reactionDelay: number;
  /** IDM a: strongest acceleration the driver asks for, m/s². */
  maxAcceleration: number;
  /** IDM b: braking the driver finds comfortable, m/s² (positive). Not an emergency limit. */
  comfortableBraking: number;
}>;

export type DriverParamKey = keyof DriverParams;

/** What a driver perceives: their own speed and the car ahead (or the end of their lane). */
export type Observation = Readonly<{
  /** Own speed, m/s. */
  speed: number;
  /** Bumper-to-bumper gap to the car ahead, m. */
  gap: number;
  /** Own speed minus the leader's speed, m/s. Positive when closing in. */
  closingSpeed: number;
}>;

export type StartArrangement = "even" | "jumbled";

/** How drivers behave at the on-ramp (the merge track). */
export type MergingParams = Readonly<{
  /**
   * How far a main-road driver goes to let a ramp car in ahead of them: they
   * brake up to this fraction of their comfortable braking for it. 0 never
   * makes room; 1 treats the ramp car as if it were already in front.
   */
  cooperation: number;
  /** Braking a merge may ask of the merging driver or the car behind them, m/s². */
  acceptableBraking: number;
  /** Fraction of cars that use the ramp (fixed per car for the whole run). Restarts. */
  rampShare: number;
}>;

/** Everything needed to reproduce a run from t = 0. */
export type ExperimentConfig = Readonly<{
  /** Cars on the track; with fixed roads this is the density control. */
  carCount: number;
  /** Centre of the driver population. */
  driver: DriverParams;
  /**
   * Fractional spread of each driver's parameters around `driver`
   * (0 = identical drivers). Each driver's standardised offsets are drawn
   * once from `seed`; changing `variation` rescales them, it does not redraw.
   */
  variation: number;
  /** "even": equal gaps. "jumbled": equal gaps with small seeded offsets. */
  start: StartArrangement;
  seed: number;
  /**
   * An experimenter's brake tap that is part of the experiment itself: the
   * model applies exactly one `tapBrake` to `car` on the step at which
   * simulated time reaches `time`. It is a stated intervention, not an
   * outcome: what the traffic does with it is up to the drivers.
   */
  scheduledTap?: Readonly<{ time: number; car: number }>;
  /** Which road. Absent means the original ring. */
  track?: TrackId;
  /** Sideways acceleration every driver accepts in a bend, m/s² (sets corner speeds). Absent means the default. */
  cornering?: number;
  /** Merge behaviour. Absent means the defaults. Only the merge track reads it. */
  merging?: MergingParams;
}>;

export type SimulationStatus =
  | Readonly<{ kind: "running" }>
  /** Two cars overlapped. The run is frozen at this instant, not repaired. */
  | Readonly<{ kind: "collision"; time: number; follower: number; leader: number }>
  /** A non-finite or otherwise impossible value appeared (including a car driven off the end of the ramp). */
  | Readonly<{ kind: "invalid"; time: number; reason: string }>;

/** A ramp car moved over into the main lane. */
export type MergeEvent = Readonly<{
  time: number;
  car: number;
  /** Main-lane metres where it arrived. */
  position: number;
}>;

/**
 * A running experiment. Arrays are indexed by car identity, which never
 * changes; `leader[i]` names the car directly ahead of car `i` along its
 * lane (-1 when nothing is ahead before the lane ends), recomputed from the
 * cars' physical order after every step, so nothing depends on where a car
 * happens to sit in the arrays.
 *
 * Treat as read-only outside `simulation.ts`.
 */
export type Simulation = {
  readonly road: Road;
  readonly track: Track;
  readonly carCount: number;
  /** Fixed integration step, s. */
  readonly dt: number;
  /** Simulated seconds since the start. */
  time: number;
  /** Steps taken; `time === steps * dt`. */
  steps: number;
  status: SimulationStatus;
  readonly leader: Int32Array;
  /** Which lane of the track each car is on (0 = main). */
  readonly lane: Uint8Array;
  /** 1 for cars that take the ramp whenever they reach it, 0 for cars that stay on the main road. */
  readonly route: Uint8Array;
  /** Front-bumper position along the car's lane, m; in [0, lane length) on a closed lane. */
  readonly position: Float64Array;
  /** Total distance driven since the start, m (never wraps). */
  readonly travelled: Float64Array;
  /** m/s, never negative. */
  readonly speed: Float64Array;
  /** Acceleration actually realised over the most recent step, m/s². */
  readonly acceleration: Float64Array;
  /** 1 while the brake light is lit. Derived from realised deceleration, not pedal pressure. */
  readonly brakeLight: Uint8Array;
  /** Simulated time each car last merged into the main lane, or -Infinity. For drawing the move; the model is done with it. */
  readonly mergedAt: Float64Array;
  /** Each driver's current parameters (population centre scaled by their fixed offsets). */
  readonly drivers: readonly DriverParams[];
  /** Lateral acceleration accepted in bends, m/s². */
  readonly cornering: number;
  readonly merging: MergingParams;
  /**
   * Every experimenter intervention so far, oldest first, appended by the
   * model when it takes effect (a tap, the scheduled tap, or the start of a
   * held brake). Read-only for the page, which uses it to mark the history.
   */
  readonly interventions: readonly Intervention[];
  /** Every merge so far, oldest first. */
  readonly merges: readonly MergeEvent[];
};

export type Intervention = Readonly<{
  /** Simulated time at which it began, s. */
  time: number;
  car: number;
  /** "tap": fixed short tap. "scheduled": the config's scheduled tap. "hold": a brake held by the experimenter. */
  kind: "tap" | "scheduled" | "hold";
}>;

/** A snapshot of one car for the details panel. */
export type CarReadout = Readonly<{
  car: number;
  /** -1 when nothing is ahead before the lane ends. */
  leader: number;
  lane: number;
  /** On the ramp, inside the merge zone, not yet merged. */
  inZone: boolean;
  /** Corner speed where the car is, m/s, or Infinity on an unlimited stretch. */
  limit: number;
  speed: number;
  /** Actual bumper-to-bumper gap right now (to the lane end if there is no leader), m. */
  gap: number;
  /** IDM s*: the gap this driver currently wants, from what they perceive, m. */
  desiredGap: number;
  /** Realised acceleration over the most recent step, m/s². */
  acceleration: number;
  brakeLight: boolean;
  /** True while an experimenter's brake (tap or hold) is overriding this driver. */
  tapActive: boolean;
  /** True while the experimenter is holding this car's brake and the hold limit has not been reached. */
  brakeHeld: boolean;
}>;

/** Cross-car statistics at one instant. */
export type TrafficSummary = Readonly<{
  meanSpeed: number;
  /** Population standard deviation of speed across cars, m/s. */
  speedSpread: number;
  minSpeed: number;
  maxSpeed: number;
  /** Cars that passed the end of the merge zone on the main lane over the last minute, per minute (merge track; else 0). */
  flow: number;
  /** Merges so far. */
  merges: number;
  /** Ramp cars in the merge zone that are stopped (or nearly), waiting for a gap. */
  waiting: number;
}>;

/** A slider's domain, expressed in the units shown to the reader. */
export type SliderSpec = Readonly<{
  label: string;
  /** Display unit, e.g. "km/h" or "s". */
  unit: string;
  /** Display value = SI value * displayPerSI (3.6 for speeds, otherwise 1). */
  displayPerSI: number;
  /** In display units. */
  min: number;
  max: number;
  step: number;
}>;

/** A curated, reproducible experiment: a whole configuration applied in one tap. */
export type Preset = Readonly<{
  id: string;
  label: string;
  config: ExperimentConfig;
}>;
