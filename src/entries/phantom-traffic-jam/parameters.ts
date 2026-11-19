/**
 * Road, slider domains and presets. Everything here is SI internally; slider
 * min/max/step are in display units (see SliderSpec).
 */
import { RING_LENGTH, type TrackId } from "./track";
import type { DriverParamKey, DriverParams, ExperimentConfig, MergingParams, Preset, Road, SliderSpec } from "./types";

/** Ring road after Sugiyama et al. (2008), New J. Phys. 10, 033001: 230 m circumference. */
export const ROAD: Road = { length: RING_LENGTH, vehicleLength: 4.5, minimumGap: 2 };

/** Fixed integration step, s. Small against the shortest delay and wave time scales. */
export const DEFAULT_DT = 0.05;

/*
 * Slider domains (plausible human and vehicle values, not tuned to a result):
 *  - desired speed 30-80 km/h: Sugiyama's drivers aimed for 30 km/h; the top
 *    end is a generous urban limit. The model is one-dimensional, so the
 *    ring's curvature places no limit of its own. With many cars the flow
 *    speed is set by the gap and this matters mainly leaving a jam.
 *  - time gap 0.6-2.5 s: tailgating to very relaxed (IDM literature uses 1-2 s).
 *  - reaction delay 0-1.2 s: 0 is plain IDM; ~0.5-1 s is typical for humans.
 *  - acceleration 0.3-3 m/s²: heavy vehicle to sporty car.
 *  - comfortable braking 1-4 m/s²: gentle to firm.
 * Some extreme combinations (a long delay against a short time gap, on a
 * dense ring) crash. That is the model being honest, not a bug.
 */
export const DRIVER_SLIDERS: Record<DriverParamKey, SliderSpec> = {
  desiredSpeed: { label: "Desired speed", unit: "km/h", displayPerSI: 3.6, min: 30, max: 80, step: 5 },
  timeGap: { label: "Following time gap", unit: "s", displayPerSI: 1, min: 0.6, max: 2.5, step: 0.1 },
  reactionDelay: { label: "Reaction delay", unit: "s", displayPerSI: 1, min: 0, max: 1.2, step: 0.1 },
  maxAcceleration: { label: "Acceleration", unit: "m/s²", displayPerSI: 1, min: 0.3, max: 3, step: 0.1 },
  comfortableBraking: { label: "Comfortable braking", unit: "m/s²", displayPerSI: 1, min: 1, max: 4, step: 0.1 },
};

export const CAR_COUNT_SLIDER: SliderSpec = {
  label: "Cars on the ring",
  unit: "cars",
  displayPerSI: 1,
  min: 8,
  max: 30, // 7.7 m per car: still 1.2 m of room beyond minimumGap
  step: 1,
};

/** The same slider on the other tracks (both main lanes are longer than the ring, so the densest case stays roomier). */
export const TRACK_CAR_COUNT_SLIDER: SliderSpec = { ...CAR_COUNT_SLIDER, label: "Cars on the track" };

export function carCountSlider(track: TrackId): SliderSpec {
  return track === "ring" ? CAR_COUNT_SLIDER : TRACK_CAR_COUNT_SLIDER;
}

/*
 * Cornering: the sideways acceleration drivers accept sets each bend's speed,
 * v = sqrt(a_lat × radius). 1.5 m/s² is cautious, 4 m/s² brisk (about 0.4 g).
 * Shared by every driver; it is a road-reading rule, not a personality.
 */
export const CORNERING_SLIDER: SliderSpec = { label: "Cornering comfort", unit: "m/s²", displayPerSI: 1, min: 1.5, max: 4, step: 0.5 };
export const DEFAULT_CORNERING = 3;

/*
 * Merging. Cooperation is how hard a main-road driver will brake, as a share
 * of their comfortable braking, to let a ramp car in ahead of them.
 * Acceptable braking is the most a merge may ask of the merging driver or
 * the car behind them (the MOBIL safety criterion's b_safe). The ramp share
 * is fixed per car for a run.
 */
export const COOPERATION_SLIDER: SliderSpec = { label: "Cooperation", unit: "%", displayPerSI: 100, min: 0, max: 100, step: 10 };
export const ACCEPTABLE_BRAKING_SLIDER: SliderSpec = { label: "Acceptable merge braking", unit: "m/s²", displayPerSI: 1, min: 1, max: 4, step: 0.5 };
export const RAMP_SHARE_SLIDER: SliderSpec = { label: "Ramp users", unit: "%", displayPerSI: 100, min: 0, max: 50, step: 10 };
export const DEFAULT_MERGING: MergingParams = { cooperation: 0.5, acceptableBraking: 3, rampShare: 0.3 };

export const VARIATION_SLIDER: SliderSpec = {
  label: "Driver variation",
  unit: "%",
  displayPerSI: 100,
  min: 0,
  max: 20,
  step: 5,
};

/** The one scheduled tap the "tap" and "slow" experiments share: car 0 brakes lightly at 5 s. */
export const SCHEDULED_TAP = { time: 5, car: 0 } as const;

/*
 * The three experiments. Every one is 14 cars on the 230 m ring, a 1.6 s time
 * gap, 60 km/h desired speed, a = 1.5 m/s², b = 2 m/s², seed 7, an even start
 * (equal gaps, equal speeds). What differs:
 *  - "tap":   reaction delay 0.4 s, identical drivers, one scheduled tap at 5 s.
 *  - "slow":  as "tap" but reaction delay 0.8 s. That one number is the only
 *             difference from "tap".
 *  - "mixed": as "slow" but the drivers differ (variation 10%) and there is NO
 *             scheduled tap. Variation scales all five driver parameters, the
 *             reaction delay included (so delays run about 0.72-0.88 s).
 *
 * Measured with this code (dt = 0.05 s, 600 s; "jam" = mean speed spread over
 * 300-600 s above 1.5 m/s). The reproducible numbers are in the model tests.
 *  - "tap" and "slow" with the tap: calm and jam respectively (identical
 *    drivers, so with no tap, either would stay perfectly even forever).
 *  - "mixed" with seed 7: a jam is evident (spread above 1.5 m/s) at 58 s
 *    (46-66 s with dt = 0.1-0.025 s) and persists to 600 s; no collision. Over 59 other seeds (1-60): 59 jammed
 *    (first evident between 30 s and 104 s, median 51 s), 0 stayed calm,
 *    0 collided.
 *  - Why not "tap" plus variation: at 5, 10, 15 and 20% the 0.4 s ring
 *    absorbed the tap and stayed calm on all 60 seeds tried, so it shows no
 *    effect of differing drivers. "slow" without variation and without a tap
 *    stays perfectly even.
 */
const BASE_DRIVER: DriverParams = {
  desiredSpeed: 60 / 3.6,
  timeGap: 1.6,
  reactionDelay: 0.4,
  maxAcceleration: 1.5,
  comfortableBraking: 2,
};

const TAP_CONFIG: ExperimentConfig = {
  carCount: 14,
  driver: BASE_DRIVER,
  variation: 0,
  start: "even",
  seed: 7,
  scheduledTap: SCHEDULED_TAP,
};

const SLOW_CONFIG: ExperimentConfig = { ...TAP_CONFIG, driver: { ...BASE_DRIVER, reactionDelay: 0.8 } };

const MIXED_CONFIG: ExperimentConfig = {
  carCount: SLOW_CONFIG.carCount,
  driver: SLOW_CONFIG.driver,
  variation: 0.1,
  start: SLOW_CONFIG.start,
  seed: SLOW_CONFIG.seed,
};

/*
 * The two road experiments use the quicker (0.4 s) drivers of "tap", no tap,
 * identical drivers and an even start, so what they show is the road.
 *  - "corners": 14 cars on the B circuit. Cars brake before each bend and
 *               pull away after it; the bunching that results is the road's.
 *  - "merge":   18 cars on the ring with the on-ramp, 30% of them ramp
 *               users, half-cooperative main-road drivers.
 */
const CORNERS_CONFIG: ExperimentConfig = {
  carCount: 14,
  driver: BASE_DRIVER,
  variation: 0,
  start: "even",
  seed: 7,
  track: "b",
  cornering: DEFAULT_CORNERING,
};

const MERGE_CONFIG: ExperimentConfig = {
  carCount: 18,
  driver: BASE_DRIVER,
  variation: 0,
  start: "even",
  seed: 7,
  track: "merge",
  cornering: DEFAULT_CORNERING,
  merging: DEFAULT_MERGING,
};

export const PRESETS: readonly Preset[] = [
  { id: "tap", label: "One brake tap", config: TAP_CONFIG },
  { id: "slow", label: "Slow reactions", config: SLOW_CONFIG },
  { id: "mixed", label: "Mixed drivers", config: MIXED_CONFIG },
  { id: "corners", label: "B circuit", config: CORNERS_CONFIG },
  { id: "merge", label: "On-ramp merge", config: MERGE_CONFIG },
];

export const DEFAULT_PRESET_ID = "slow";

export const DEFAULT_CONFIG: ExperimentConfig = SLOW_CONFIG;
