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
import type { Corner } from "./track";
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

/**
 * A car already in a bend and over its speed brakes as if the limit started
 * this far ahead, m. (The free-road term, with v0 capped at the bend's speed,
 * does most of the in-bend correction; this stops a badly late car coasting.)
 */
export const INSIDE_CORNER_DISTANCE = 5;

/**
 * A driver starts braking for a bend once making it would take at least
 * this fraction of their comfortable braking. Until then the bend is too far
 * to matter and they drive for the road in front of them.
 */
export const CORNER_BRAKING_ONSET = 0.5;

/**
 * Braking for the bends ahead, or +Infinity when none is close enough to
 * matter; the driver's request is the lesser of this and car-following.
 *
 * For each bend at distance d whose speed v_c is below the current speed v,
 * the steady deceleration that would just reach v_c at its start is
 * b_kin = (v² − v_c²) / (2d). Once b_kin reaches CORNER_BRAKING_ONSET × b the
 * driver asks for −b_kin²/b: the same braking strategy as IDM's interaction
 * term for a slower car ahead (Treiber et al. 2000). Braking below what is
 * needed lets b_kin grow, so the request firms up towards b and settles
 * there: the car arrives at the bend close to its speed, having braked
 * progressively rather than all at once. The road is known in advance, so
 * no reaction delay applies to this term. A car already in a bend and over
 * its speed brakes as if the limit began INSIDE_CORNER_DISTANCE ahead.
 */
export function cornerAcceleration(speed: number, corners: readonly Corner[], params: DriverParams): number {
  let request = Infinity;
  for (const corner of corners) {
    if (speed <= corner.limit) continue;
    const distance = Math.max(corner.distance, INSIDE_CORNER_DISTANCE);
    const needed = (speed * speed - corner.limit * corner.limit) / (2 * distance);
    if (needed < CORNER_BRAKING_ONSET * params.comfortableBraking) continue;
    request = Math.min(request, -(needed * needed) / params.comfortableBraking);
  }
  return request;
}
