/**
 * The Intelligent Driver Model: Treiber, Hennecke & Helbing (2000),
 * "Congested traffic states in empirical observations and microscopic
 * simulations", https://arxiv.org/abs/cond-mat/0002177 (Eqs. 1-2).
 *
 * Pure: an observation and a driver's parameters in, a requested acceleration
 * out. Reaction delay is NOT applied here; the caller decides how old the
 * observation is (see simulation.ts). Time gap and reaction delay are
 * separate parameters.
 */
import type { DriverParams, Observation, Road } from "./types";

/** IDM free-acceleration exponent δ. */
export const ACCELERATION_EXPONENT = 4;

/**
 * Gaps below this (m) are treated as this in the interaction term so the
 * result stays finite. A real overlap is still detected by the vehicle layer.
 */
const GAP_FLOOR = 1e-3;

/** s* = s0 + max(0, v·T + v·Δv / (2·sqrt(a·b))): the gap the driver wants. */
export function desiredGap(observation: Observation, params: DriverParams, road: Road): number {
  const { speed, closingSpeed } = observation;
  const steadyHeadway = speed * params.timeGap;
  const brakingTerm = (speed * closingSpeed) / (2 * Math.sqrt(params.maxAcceleration * params.comfortableBraking));
  return road.minimumGap + Math.max(0, steadyHeadway + brakingTerm);
}

/** a·[1 − (v/v0)^δ − (s_star/s)²]: free-road term minus interaction term. */
export function desiredAcceleration(observation: Observation, params: DriverParams, road: Road): number {
  const wantedGap = desiredGap(observation, params, road);
  const gap = Math.max(observation.gap, GAP_FLOOR);
  const freeRoadTerm = (observation.speed / params.desiredSpeed) ** ACCELERATION_EXPONENT;
  const interactionTerm = (wantedGap / gap) ** 2;
  return params.maxAcceleration * (1 - freeRoadTerm - interactionTerm);
}
