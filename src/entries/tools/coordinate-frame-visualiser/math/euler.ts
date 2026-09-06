import { degToRad, multiply, multiplyMat3Vec3, normaliseVec3, radToDeg, wrapDegrees } from "./linalg";
import type { Mat3, Vec3 } from "./types";

/**
 * All six Tait-Bryan (three distinct axes) rotation orders. The letters
 * name the axis of the first, second, and third elementary rotation in the
 * *intrinsic* reading, e.g. `"zyx"` is z-y'-x'' = yaw, pitch, roll.
 */
export type TaitBryanOrder = "xyz" | "xzy" | "yxz" | "yzx" | "zxy" | "zyx";

/**
 * - "intrinsic": a-b'-c'' about successively-rotated body axes.
 *   `R = R_a(first) . R_b(second) . R_c(third)`.
 * - "extrinsic": a-b-c about the same three FIXED local axes, applied in
 *   the order a, then b, then c.
 *   `R = R_c(third) . R_b(second) . R_a(first)`.
 */
export type EulerInterpretation = "extrinsic" | "intrinsic";

/**
 * The three angles of a Tait-Bryan sequence, in degrees. `first`/`second`/
 * `third` refer to the position in the chosen {@link TaitBryanOrder}, e.g.
 * for `"zyx"` (yaw, pitch, roll), `first` is yaw, `second` is pitch, and
 * `third` is roll.
 */
export type EulerAngles = {
  readonly first: number;
  readonly second: number;
  readonly third: number;
};

/**
 * `rotationToEuler`'s result. `gimbalLock` is true when the middle angle is
 * within ~1e-6 of +/-90 degrees, i.e. `|sin(second)|` is within ~1e-6 of 1.
 *
 * Gimbal-lock convention: the first and third rotations become coupled
 * (only their sum or difference is observable). For the intrinsic
 * decomposition this module deterministically sets `third` to 0 and assigns
 * all of the coupled rotation to `first`. The extrinsic decomposition is
 * derived from the intrinsic one via order/angle reversal (see
 * {@link rotationToEuler}), so at gimbal lock it instead sets `first` to 0
 * and assigns the coupled rotation to `third`.
 */
export type EulerDecomposition = EulerAngles & { readonly gimbalLock: boolean };

type Axis = "x" | "y" | "z";

function elementaryRotation(axis: Axis, deg: number): Mat3 {
  const rad = degToRad(deg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  switch (axis) {
    case "x":
      return [
        [1, 0, 0],
        [0, c, -s],
        [0, s, c],
      ];
    case "y":
      return [
        [c, 0, s],
        [0, 1, 0],
        [-s, 0, c],
      ];
    case "z":
      return [
        [c, -s, 0],
        [s, c, 0],
        [0, 0, 1],
      ];
  }
}

const ORDER_AXES: Record<TaitBryanOrder, readonly [Axis, Axis, Axis]> = {
  zyx: ["z", "y", "x"],
  zxy: ["z", "x", "y"],
  yxz: ["y", "x", "z"],
  yzx: ["y", "z", "x"],
  xzy: ["x", "z", "y"],
  xyz: ["x", "y", "z"],
};

function standardBasisVector(axis: Axis): Vec3 {
  switch (axis) {
    case "x":
      return [1, 0, 0];
    case "y":
      return [0, 1, 0];
    case "z":
      return [0, 0, 1];
  }
}

const REVERSED_ORDER: Record<TaitBryanOrder, TaitBryanOrder> = {
  xyz: "zyx",
  xzy: "yzx",
  yxz: "zxy",
  yzx: "xzy",
  zxy: "yxz",
  zyx: "xyz",
};

function reverseOrder(order: TaitBryanOrder): TaitBryanOrder {
  return REVERSED_ORDER[order];
}

/**
 * Builds `R = R_a(first) . R_b(second) . R_c(third)` (intrinsic) or the
 * equivalent extrinsic composition, for the given order and interpretation.
 */
export function eulerToRotation(
  angles: EulerAngles,
  order: TaitBryanOrder,
  interpretation: EulerInterpretation,
): Mat3 {
  const [a, b, c] = ORDER_AXES[order];
  const ra = elementaryRotation(a, angles.first);
  const rb = elementaryRotation(b, angles.second);
  const rc = elementaryRotation(c, angles.third);

  return interpretation === "intrinsic"
    ? multiply(multiply(ra, rb), rc)
    : multiply(multiply(rc, rb), ra);
}

const clampToUnit = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Intrinsic decomposition, hard-coded per order from the elementary-matrix
 * products (each verified against the module's fixtures). Extrinsic
 * decomposition is derived from this via the identity
 * `extrinsic(order, [a,b,c]) === intrinsic(reverse(order), [c,b,a])`.
 */
function decomposeIntrinsic(m: Mat3, order: TaitBryanOrder): EulerDecomposition {
  const GIMBAL_EPSILON = 1e-6;

  switch (order) {
    case "zyx": {
      const raw = -m[2][0];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(-m[0][1], m[1][1])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(m[1][0], m[0][0])),
        second,
        third: radToDeg(Math.atan2(m[2][1], m[2][2])),
        gimbalLock,
      };
    }
    case "zxy": {
      const raw = m[2][1];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(m[1][0], m[0][0])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(-m[0][1], m[1][1])),
        second,
        third: radToDeg(Math.atan2(-m[2][0], m[2][2])),
        gimbalLock,
      };
    }
    case "yxz": {
      const raw = -m[1][2];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(-m[2][0], m[0][0])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(m[0][2], m[2][2])),
        second,
        third: radToDeg(Math.atan2(m[1][0], m[1][1])),
        gimbalLock,
      };
    }
    case "yzx": {
      const raw = m[1][0];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(m[0][2], m[2][2])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(-m[2][0], m[0][0])),
        second,
        third: radToDeg(Math.atan2(-m[1][2], m[1][1])),
        gimbalLock,
      };
    }
    case "xzy": {
      const raw = -m[0][1];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(-m[1][2], m[2][2])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(m[2][1], m[1][1])),
        second,
        third: radToDeg(Math.atan2(m[0][2], m[0][0])),
        gimbalLock,
      };
    }
    case "xyz": {
      const raw = m[0][2];
      const gimbalLock = Math.abs(Math.abs(raw) - 1) < GIMBAL_EPSILON;
      const second = radToDeg(Math.asin(clampToUnit(raw)));
      if (gimbalLock) {
        return { first: radToDeg(Math.atan2(m[2][1], m[1][1])), second, third: 0, gimbalLock };
      }
      return {
        first: radToDeg(Math.atan2(-m[1][2], m[2][2])),
        second,
        third: radToDeg(Math.atan2(-m[0][1], m[0][0])),
        gimbalLock,
      };
    }
  }
}

/**
 * Recovers the Tait-Bryan angles that produce `m` under the given order and
 * interpretation. `first`/`third` are wrapped to `(-180, 180]`; `second` is
 * always in `[-90, 90]` (the range of `asin`).
 */
export function rotationToEuler(
  m: Mat3,
  order: TaitBryanOrder,
  interpretation: EulerInterpretation,
): EulerDecomposition {
  if (interpretation === "intrinsic") {
    const result = decomposeIntrinsic(m, order);
    return {
      first: wrapDegrees(result.first),
      second: result.second,
      third: wrapDegrees(result.third),
      gimbalLock: result.gimbalLock,
    };
  }

  // extrinsic(order, [first,second,third]) === intrinsic(reverse(order), [third,second,first])
  const result = decomposeIntrinsic(m, reverseOrder(order));
  return {
    first: wrapDegrees(result.third),
    second: result.second,
    third: wrapDegrees(result.first),
    gimbalLock: result.gimbalLock,
  };
}

function stagedAngles(angles: EulerAngles, progress: number): EulerAngles {
  const clamped = Math.max(0, Math.min(3, progress));
  const stage = Math.floor(clamped);
  const frac = clamped - stage;
  const scaleFor = (index: number): number => {
    if (index < stage) return 1;
    if (index === stage) return frac;
    return 0;
  };

  return {
    first: angles.first * scaleFor(0),
    second: angles.second * scaleFor(1),
    third: angles.third * scaleFor(2),
  };
}

/**
 * The rotation reached after applying only part of the sequence: `progress`
 * ranges over `[0, 3]`, where `0` is identity, `3` is the full pose from
 * {@link eulerToRotation}, and the fractional part of `progress` scales the
 * angle of the in-progress stage linearly.
 */
export function rotationAfterStages(
  angles: EulerAngles,
  order: TaitBryanOrder,
  interpretation: EulerInterpretation,
  progress: number,
): Mat3 {
  return eulerToRotation(stagedAngles(angles, progress), order, interpretation);
}

/**
 * The unit axis, expressed in the local frame, about which the given stage
 * (1, 2, or 3) actually turns:
 *
 * - intrinsic: the named body axis as it stands after the previous stages,
 *   `R_prev . e_axis`.
 * - extrinsic: the fixed local axis, `e_axis`, unaffected by other stages.
 */
export function stageAxis(
  angles: EulerAngles,
  order: TaitBryanOrder,
  interpretation: EulerInterpretation,
  stageIndex: 1 | 2 | 3,
): Vec3 {
  const axis = ORDER_AXES[order][stageIndex - 1];
  const e = standardBasisVector(axis);

  if (interpretation === "extrinsic") {
    return e;
  }

  const previousStages = rotationAfterStages(angles, order, interpretation, stageIndex - 1);
  return multiplyMat3Vec3(previousStages, e);
}

/**
 * Rodrigues' rotation formula: an active rotation of `deg` degrees about
 * `axis`. `axis` is normalised internally, so any non-zero-length vector
 * gives the same rotation as its unit direction; a zero-length axis throws
 * (via {@link normaliseVec3}).
 */
export function rotationAboutAxis(axis: Vec3, deg: number): Mat3 {
  const [ux, uy, uz] = normaliseVec3(axis);
  const rad = degToRad(deg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;

  return [
    [t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy],
    [t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux],
    [t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c],
  ];
}
