import type { Mat3 } from "./types";

/** A scalar-first quaternion, `w + xi + yj + zk`. */
export type Quaternion = {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type QuaternionNormalisationResult =
  | {
      readonly ok: true;
      readonly quaternion: Quaternion;
      readonly originalNorm: number;
    }
  | {
      readonly ok: false;
      readonly reason: "non-finite" | "zero";
    };

/**
 * Extracts the quaternion for a rotation matrix (Shepperd's method), with
 * the sign convention `w >= 0`.
 */
export function quaternionFromRotation(m: Mat3): Quaternion {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let w: number;
  let x: number;
  let y: number;
  let z: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }

  if (w < 0) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }

  return { w, x, y, z };
}

/**
 * Builds the rotation matrix for a quaternion. Uses the norm-aware form of
 * the standard formula, so a non-unit (but non-zero, finite) quaternion
 * still yields a proper rotation matrix without requiring a separate
 * normalisation step.
 *
 * Callers must validate user input with {@link normaliseQuaternion} first: a
 * zero or non-finite quaternion is not a valid rotation and throws here
 * rather than silently returning identity.
 */
export function rotationFromQuaternion(q: Quaternion): Mat3 {
  const { w, x, y, z } = q;
  const normSq = w * w + x * x + y * y + z * z;
  if (!(normSq > 0) || !Number.isFinite(normSq)) {
    throw new Error(
      "Cannot build a rotation from a zero or non-finite quaternion. Validate user input with normaliseQuaternion first.",
    );
  }
  const s = 2 / normSq;

  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    [1 - s * (yy + zz), s * (xy - wz), s * (xz + wy)],
    [s * (xy + wz), 1 - s * (xx + zz), s * (yz - wx)],
    [s * (xz - wy), s * (yz + wx), 1 - s * (xx + yy)],
  ];
}

/**
 * Normalises a quaternion to unit length. Never throws: a zero or
 * non-finite quaternion (which can arise from user input) is reported as a
 * typed rejection instead.
 */
export function normaliseQuaternion(q: Quaternion): QuaternionNormalisationResult {
  const { w, x, y, z } = q;
  if (![w, x, y, z].every(Number.isFinite)) {
    return { ok: false, reason: "non-finite" };
  }

  const originalNorm = Math.sqrt(w * w + x * x + y * y + z * z);
  if (!(originalNorm > 0)) {
    return { ok: false, reason: "zero" };
  }

  return {
    ok: true,
    quaternion: { w: w / originalNorm, x: x / originalNorm, y: y / originalNorm, z: z / originalNorm },
    originalNorm,
  };
}
