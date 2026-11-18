/**
 * Road, slider domains and presets. Everything here is SI internally; slider
 * min/max/step are in display units (see SliderSpec).
 */
import type { DriverParamKey, DriverParams, ExperimentConfig, Preset, Road, SliderSpec } from "./types";

/** Ring road after Sugiyama et al. (2008), New J. Phys. 10, 033001: 230 m circumference. */
export const ROAD: Road = { length: 230, vehicleLength: 4.5, minimumGap: 2 };

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

export const VARIATION_SLIDER: SliderSpec = {
  label: "Driver variation",
  unit: "%",
  displayPerSI: 100,
  min: 0,
  max: 20,
  step: 5,
};

/**
 * The two presets differ in ONE parameter: reaction delay (0.4 s vs 0.8 s).
 * Everything else, including a 1.6 s time gap and 14 cars (~6 m/s flow, so a
 * brake tap is a modest disturbance), is shared. Linear string stability of
 * the IDM is lost when delay eats into the safety margin of the time gap:
 * with 0.4 s a perturbation decays, with 0.8 s it grows into stop-and-go waves.
 * Both start "jumbled", so the jam-prone ring jams without any tap and the
 * steady one smooths the same unevenness away.
 */

/** Population centre shared by both presets; the jam-prone one overrides the reaction delay. */
const BASE_DRIVER: DriverParams = {
  desiredSpeed: 60 / 3.6,
  timeGap: 1.6,
  reactionDelay: 0.4,
  maxAcceleration: 1.5,
  comfortableBraking: 2,
};

export const PRESETS: readonly Preset[] = [
  {
    id: "jam",
    label: "Jam-prone",
    config: {
      carCount: 14,
      driver: { ...BASE_DRIVER, reactionDelay: 0.8 },
      variation: 0,
      start: "jumbled",
      seed: 7,
    },
  },
  {
    id: "steady",
    label: "Steady",
    config: { carCount: 14, driver: BASE_DRIVER, variation: 0, start: "jumbled", seed: 7 },
  },
];

export const DEFAULT_CONFIG: ExperimentConfig = PRESETS[0].config;
