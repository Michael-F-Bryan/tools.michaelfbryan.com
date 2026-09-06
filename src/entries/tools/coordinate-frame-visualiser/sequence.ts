import type { EulerInterpretation, LocalConvention, TaitBryanOrder } from "./math";

export type Axis = "x" | "y" | "z";

/** The axis letter used by the given stage (1, 2, or 3) of a Tait-Bryan order, e.g. "zyx" stage 2 is "y". */
export function orderAxis(order: TaitBryanOrder, stageIndex: 1 | 2 | 3): Axis {
  return order[stageIndex - 1] as Axis;
}

const PRIMES = ["", "′", "″"] as const;

/** The intrinsic label for a stage: the axis letter with `stageIndex - 1` primes, e.g. "y′". */
export function intrinsicAxisLabel(order: TaitBryanOrder, stageIndex: 1 | 2 | 3): string {
  return `${orderAxis(order, stageIndex)}${PRIMES[stageIndex - 1]}`;
}

/**
 * The name of the local frame's basis direction that generic axis letter
 * `x`/`y`/`z` (first/second/third components of a local-frame vector)
 * corresponds to, in the given convention.
 */
export function localAxisName(convention: LocalConvention, axis: Axis): string {
  const names: Record<LocalConvention, Record<Axis, string>> = {
    ned: { x: "N", y: "E", z: "D" },
    enu: { x: "E", y: "N", z: "U" },
  };
  return names[convention][axis];
}

/**
 * The human-readable description of the axis a given stage actually turns
 * about: `z`, `y′`, `x″` for intrinsic; the fixed local axis's letter and
 * frame name for extrinsic, e.g. "y — the fixed local E axis".
 */
export function stageAxisLabel(
  order: TaitBryanOrder,
  interpretation: EulerInterpretation,
  convention: LocalConvention,
  stageIndex: 1 | 2 | 3,
): string {
  const letter = orderAxis(order, stageIndex);
  if (interpretation === "intrinsic") {
    return intrinsicAxisLabel(order, stageIndex);
  }
  return `${letter} — the fixed local ${localAxisName(convention, letter)} axis`;
}

const HUMAN_NAMES: Partial<Record<TaitBryanOrder, readonly [string, string, string]>> = {
  zyx: ["yaw", "pitch", "roll"],
};

/** A human name for a stage's angle, when the order has a conventional one (only "zyx" does here). */
export function stageHumanName(order: TaitBryanOrder, stageIndex: 1 | 2 | 3): string | undefined {
  return HUMAN_NAMES[order]?.[stageIndex - 1];
}

/** The display name for a Tait-Bryan order, e.g. "z–y′–x″ · yaw, pitch, roll". */
export function orderDisplayName(order: TaitBryanOrder): string {
  const primed = `${order[0]}–${order[1]}′–${order[2]}″`;
  const human = HUMAN_NAMES[order];
  return human ? `${primed} · ${human.join(", ")}` : primed;
}

export const ALL_ORDERS: readonly TaitBryanOrder[] = ["zyx", "zxy", "yxz", "yzx", "xzy", "xyz"];
