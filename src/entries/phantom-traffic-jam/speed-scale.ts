/**
 * The one speed colour scale, shared by the ring and the
 * space-time history view so a colour means the same speed everywhere on the page.
 *
 * Viridis, sampled at nine points: perceptually uniform, monotonic in
 * lightness (dark = slow, light = fast) and readable with the common forms
 * of colour blindness. It contains no red, which is reserved for brake lights.
 *
 * The domain is fixed (0 to the desired-speed slider's maximum) so a colour
 * never changes meaning while sliders move, and the mapping is linear.
 */
import { DRIVER_SLIDERS } from "./parameters";

/** The speed colour domain, m/s: fixed at the desired-speed slider's maximum so colours never shift with the sliders. */
export const MAX_SPEED = DRIVER_SLIDERS.desiredSpeed.max / DRIVER_SLIDERS.desiredSpeed.displayPerSI;

export const SPEED_STOPS: readonly string[] = [
  "#440154",
  "#472d7b",
  "#3b528b",
  "#2c728e",
  "#21918c",
  "#28ae80",
  "#5ec962",
  "#addc30",
  "#fde725",
];

const RGB = SPEED_STOPS.map((hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)));

/** Where a speed sits along the ramp, 0..1 (clamped). */
export function speedFraction(speedMs: number, maxMs: number): number {
  return Math.min(1, Math.max(0, maxMs > 0 && Number.isFinite(speedMs) ? speedMs / maxMs : 0));
}

/** Labelled legend speeds, km/h. */
export const SPEED_TICKS_KMH: readonly number[] = [0, 20, 40, 60, 80];

/** Colour for a speed in m/s on a fixed 0..maxMs domain (clamped). */
export function speedColour(speedMs: number, maxMs: number): string {
  const t = speedFraction(speedMs, maxMs);
  const scaled = t * (RGB.length - 1);
  const index = Math.min(RGB.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const [r, g, b] = RGB[index].map((channel, k) => Math.round(channel + (RGB[index + 1][k] - channel) * fraction));
  return `rgb(${r} ${g} ${b})`;
}

/** A CSS gradient through the same stops, for legends. */
export function speedGradient(direction = "to right"): string {
  return `linear-gradient(${direction}, ${SPEED_STOPS.join(", ")})`;
}
