/**
 * Sensorimotor controller: turns a genome, sensor readings and time into joint
 * angles, plus a per-part drag multiplier for passive feathering.
 *
 * joint angle = angle + amplitude * ampMul * wave(phase)
 *   ampMul  = clamp(1 + w . inputs, 0, 2)  with w = ampWeights
 *   freqMul = clamp(1 + w . inputs, 0.25, 2.5)  with w = freqWeights
 *
 * Inputs, for n sensors, are [s_1..s_n, ds_1..ds_n, 1]: the scent readings, then each
 * reading's rate of change, then a constant bias. Weight arrays therefore have length
 * 2n + 1. The rate input is the reading minus a slow running average of itself
 * (time constant `RATE_TAU`), scaled by `RATE_GAIN` and clamped to [-1, 1]: it is
 * positive while the reading is rising (swimming up a gradient) and zero in steady
 * water. It lets one sensor, moving through space, act as a gradient detector.
 *
 * The oscillator phase is integrated (phase += 2*pi*f*freqMul*dt) instead of
 * computed as 2*pi*f*freqMul*t, because a slowly varying freqMul would otherwise
 * make the phase jump by (change in freqMul) * t each step. With freqMul = 1 the
 * result is identical to 2*pi*f*t + phase.
 *
 * There is no steering logic here: the weights are whatever evolution produced.
 */
import type { Organism } from "./types";

const TAU = Math.PI * 2;
const MIN_SKEW = 0.05;
const MAX_SKEW = 0.95;
const MAX_FEATHER = 0.98;
/** Amplitude (radians) below which a joint is treated as rigid for feathering. */
const FEATHER_FULL_AMPLITUDE = 0.1;

/** Time constant (s) of the running average that the rate-of-change input is measured against. */
export const RATE_TAU = 0.4;
/** Scale from (reading - running average) to the rate input; a ramp of r per second gives r * RATE_TAU * RATE_GAIN. */
export const RATE_GAIN = 12;

/** Oscillator phase accumulators, one array per organism. Held weakly. */
const phases = new WeakMap<Organism, Float64Array>();
/** Running average of each sensor reading, one array per organism. Held weakly. */
const averages = new WeakMap<Organism, Float64Array>();

/**
 * Update the rate-of-change inputs (`organism.senseRates`) from the current readings
 * and advance the running averages. First sight of a sensor sets its average to its
 * reading, so a newborn does not see a spurious jump.
 */
export function updateSenseRates(organism: Organism, dt: number): number[] {
  const senses = organism.senses;
  const n = senses.length;
  let avg = averages.get(organism);
  if (!avg || avg.length !== n) {
    avg = new Float64Array(n);
    for (let i = 0; i < n; i++) avg[i] = finite(senses[i], 0);
    averages.set(organism, avg);
  }
  const rates = organism.senseRates ?? (organism.senseRates = []);
  rates.length = n;
  const k = 1 - Math.exp(-Math.max(0, dt) / RATE_TAU);
  for (let i = 0; i < n; i++) {
    const reading = finite(senses[i], 0);
    rates[i] = clamp((reading - avg[i]) * RATE_GAIN, -1, 1);
    avg[i] += (reading - avg[i]) * k;
  }
  return rates;
}

/** Fractional position of `x` radians within a stroke cycle, shifted so the cycle starts at the trough. */
function cycleFraction(x: number): number {
  const psi = x / TAU + 0.25;
  return psi - Math.floor(psi);
}

function clampSkew(skew: number): number {
  if (!Number.isFinite(skew)) return 0.5;
  return skew < MIN_SKEW ? MIN_SKEW : skew > MAX_SKEW ? MAX_SKEW : skew;
}

/**
 * Skewed periodic wave in [-1, 1]. With skew 0.5 it equals sin(x). Otherwise the
 * rising half-stroke (trough to crest) takes a `skew` fraction of the period and the
 * falling return takes the rest: a time-warped cosine.
 */
export function wave(x: number, skew: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = clampSkew(skew);
  const psi = cycleFraction(x);
  const u = psi < s ? (0.5 * psi) / s : 0.5 + (0.5 * (psi - s)) / (1 - s);
  return -Math.cos(TAU * u);
}

/**
 * True while `wave` is falling (the return half-stroke). Rising angle is the power
 * stroke for a fin angled out from the body: it sweeps the tip backwards.
 */
export function isReturnStroke(x: number, skew: number): boolean {
  if (!Number.isFinite(x)) return false;
  return cycleFraction(x) >= clampSkew(skew);
}

function modulation(
  weights: readonly number[] | undefined,
  senses: readonly number[],
  rates: readonly number[],
  sensorCount: number,
): number {
  if (!weights) return 0;
  let sum = 0;
  const m = Math.min(sensorCount, senses.length);
  for (let i = 0; i < m; i++) {
    const w = weights[i];
    if (w === undefined) break;
    const term = w * senses[i];
    if (Number.isFinite(term)) sum += term;
  }
  for (let i = 0; i < m; i++) {
    const w = weights[sensorCount + i];
    if (w === undefined) break;
    const term = w * (rates[i] ?? 0);
    if (Number.isFinite(term)) sum += term;
  }
  const bias = weights[2 * sensorCount];
  if (bias !== undefined && Number.isFinite(bias)) sum += bias;
  return sum;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Fill `angles` (full joint angle per part, index 0 = 0) and `dragScale` (multiplier
 * on normal drag area, 1 = full, 1 - feather during the return stroke) for the
 * organism's current age and senses, then advance the oscillator phases by `dt`.
 */
export function driveJoints(organism: Organism, dt: number, angles: number[], dragScale: number[]): void {
  const parts = organism.genome.parts;
  const n = parts.length;
  let sensorCount = 0;
  for (let i = 0; i < n; i++) if (parts[i].kind === "sensor") sensorCount++;

  let phase = phases.get(organism);
  if (!phase || phase.length !== n) {
    phase = new Float64Array(n);
    for (let i = 0; i < n; i++) phase[i] = TAU * finite(parts[i].frequency, 0) * organism.age;
    phases.set(organism, phase);
  }

  const rates = updateSenseRates(organism, dt);

  angles.length = n;
  dragScale.length = n;
  if (n > 0) {
    angles[0] = 0;
    dragScale[0] = 1;
  }
  for (let i = 1; i < n; i++) {
    const gene = parts[i];
    const rest = finite(gene.angle, 0);
    const amplitude = finite(gene.amplitude, 0);
    const ampMul = clamp(1 + modulation(gene.ampWeights, organism.senses, rates, sensorCount), 0, 2);
    const freqMul = clamp(1 + modulation(gene.freqWeights, organism.senses, rates, sensorCount), 0.25, 2.5);

    const x = phase[i] + finite(gene.phase, 0);
    const swing = amplitude * ampMul;
    angles[i] = rest + swing * wave(x, gene.skew);

    // Feather only while stroking; a rigid joint must not flicker with the phase.
    const feather = clamp(finite(gene.feather, 0), 0, MAX_FEATHER);
    let scale = 1;
    if (feather > 0 && swing !== 0) {
      const falling = isReturnStroke(x, gene.skew);
      if (falling !== swing < 0) scale = 1 - feather * Math.min(1, Math.abs(swing) / FEATHER_FULL_AMPLITUDE);
    }
    dragScale[i] = scale;

    const next = phase[i] + TAU * finite(gene.frequency, 0) * freqMul * dt;
    phase[i] = next % (TAU * 1024);
  }
}
