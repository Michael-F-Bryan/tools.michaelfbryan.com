/**
 * Shared contract between the traffic model and the page that draws it.
 *
 * Everything is SI (metres, seconds, m/s, m/s²). The page converts to km/h
 * for display only.
 *
 * The model is layered so each question has one answer:
 *   perception  — what a driver can see, and how stale it is (reaction delay)
 *   driver      — observation + parameters -> requested acceleration (pure)
 *   intervention— an experimenter's brake tap overriding one driver's request
 *   vehicle     — physical limits and integration of the request into motion
 * Rendering and playback live outside the model entirely.
 */

/** The fixed road and vehicle geometry. Not adjustable in this version. */
export type Road = Readonly<{
  /** Ring circumference, m. */
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

/** What a driver perceives: their own speed and the car ahead. */
export type Observation = Readonly<{
  /** Own speed, m/s. */
  speed: number;
  /** Bumper-to-bumper gap to the car ahead, m. */
  gap: number;
  /** Own speed minus the leader's speed, m/s. Positive when closing in. */
  closingSpeed: number;
}>;

export type StartArrangement = "even" | "jumbled";

/** Everything needed to reproduce a run from t = 0. */
export type ExperimentConfig = Readonly<{
  /** Cars on the ring; with a fixed ring this is the density control. */
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
}>;

export type SimulationStatus =
  | Readonly<{ kind: "running" }>
  /** Two cars overlapped. The run is frozen at this instant, not repaired. */
  | Readonly<{ kind: "collision"; time: number; follower: number; leader: number }>
  /** A non-finite or otherwise impossible value appeared. */
  | Readonly<{ kind: "invalid"; time: number; reason: string }>;

/**
 * A running experiment. Arrays are indexed by car identity, which never
 * changes; `leader[i]` names the car directly ahead of car `i`, so nothing
 * depends on where a car happens to sit in the arrays.
 *
 * Treat as read-only outside `simulation.ts`.
 */
export type Simulation = {
  readonly road: Road;
  readonly carCount: number;
  /** Fixed integration step, s. */
  readonly dt: number;
  /** Simulated seconds since the start. */
  time: number;
  /** Steps taken; `time === steps * dt`. */
  steps: number;
  status: SimulationStatus;
  readonly leader: Int32Array;
  /** Front-bumper position along the ring, m, always in [0, road.length). */
  readonly position: Float64Array;
  /** Total distance driven since the start, m (never wraps). */
  readonly travelled: Float64Array;
  /** m/s, never negative. */
  readonly speed: Float64Array;
  /** Acceleration actually realised over the most recent step, m/s². */
  readonly acceleration: Float64Array;
  /** 1 while the brake light is lit. Derived from realised deceleration, not pedal pressure. */
  readonly brakeLight: Uint8Array;
  /** Each driver's current parameters (population centre scaled by their fixed offsets). */
  readonly drivers: readonly DriverParams[];
  /**
   * Every experimenter intervention so far, oldest first, appended by the
   * model when it takes effect (a tap, the scheduled tap, or the start of a
   * held brake). Read-only for the page, which uses it to mark the history.
   */
  readonly interventions: readonly Intervention[];
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
  leader: number;
  speed: number;
  /** Actual bumper-to-bumper gap right now, m. */
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

/*
 * Functions the model exports (see the named files):
 *
 * driver.ts
 *   desiredGap(observation: Observation, params: DriverParams, road: Road): number
 *   desiredAcceleration(observation: Observation, params: DriverParams, road: Road): number
 *
 * simulation.ts
 *   createSimulation(config: ExperimentConfig, options?: { dt?: number }): Simulation
 *   stepSimulation(sim: Simulation): void          // one fixed step; no-op unless status is "running"
 *   setDrivers(sim: Simulation, driver: DriverParams, variation: number): void   // live change, no reset
 *   tapBrake(sim: Simulation, car: number): void   // experimenter's brake tap on one car (fixed short duration)
 *   holdBrake(sim: Simulation, car: number): void  // experimenter starts holding this car's brake: at least one
 *                                                  // tap's worth, then for as long as held, up to HOLD_LIMIT seconds
 *   releaseBrake(sim: Simulation, car: number): void // experimenter lets go; the driver has control again once any
 *                                                  // remaining tap minimum has run out. Safe to call when not held.
 *   HOLD_LIMIT: number                             // s of simulated time after which a held brake releases itself
 *   readCar(sim: Simulation, car: number): CarReadout
 *   summarise(sim: Simulation): TrafficSummary
 *
 * parameters.ts
 *   ROAD: Road
 *   DEFAULT_DT: number
 *   DRIVER_SLIDERS: Record<DriverParamKey, SliderSpec>
 *   CAR_COUNT_SLIDER: SliderSpec
 *   VARIATION_SLIDER: SliderSpec          // display unit "%"; displayPerSI 100
 *   PRESETS: readonly Preset[]            // the curated experiments, in display order:
 *                                         //   id "tap"   "One brake tap"   (quick drivers; the tap fades)
 *                                         //   id "slow"  "Slow reactions"  (same, but a longer reaction delay; the tap grows)
 *                                         //   id "mixed" "Mixed drivers"   (drivers differ; variation > 0)
 *   DEFAULT_PRESET_ID: string             // "slow": the page opens on the experiment that shows the phenomenon
 *   DEFAULT_CONFIG: ExperimentConfig      // === the config of the preset with DEFAULT_PRESET_ID
 *   SCHEDULED_TAP: { time: number; car: number }   // the one scheduled tap the experiments share
 */
