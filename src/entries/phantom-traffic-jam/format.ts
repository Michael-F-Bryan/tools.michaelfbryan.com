import type { SliderSpec } from "./types";

const MINUS = "−";

/** Decimal places implied by a slider's step. */
export function decimalsOf(step: number): number {
  const text = String(step);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

/** An SI value as a slider's display value, rounded to its step. */
export function toDisplay(spec: SliderSpec, si: number): number {
  return Number((si * spec.displayPerSI).toFixed(decimalsOf(spec.step)));
}

export function formatDisplay(spec: SliderSpec, si: number): string {
  const value = (si * spec.displayPerSI).toFixed(decimalsOf(spec.step));
  return spec.unit ? `${value}${spec.unit === "%" ? "" : " "}${spec.unit}` : value;
}

export function kmh(speedMs: number): string {
  return `${(speedMs * 3.6).toFixed(1)} km/h`;
}

export function metres(value: number): string {
  return `${value.toFixed(1)} m`;
}

export function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return ` ${text}`;
  return `${value < 0 ? MINUS : "+"}${text}`;
}

export function seconds(value: number): string {
  return `${value.toFixed(1)} s`;
}
