import type { Mat3, Vec3 } from "./types";

/** Converts degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Converts radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Wraps an angle in degrees to the half-open interval `(-180, 180]`.
 *
 * `-180` itself wraps to `+180`; `+180` is left unchanged.
 */
export function wrapDegrees(deg: number): number {
  let wrapped = deg % 360;
  if (wrapped <= -180) wrapped += 360;
  if (wrapped > 180) wrapped -= 360;
  return wrapped;
}

/** Compares two numbers within an absolute tolerance. */
export function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** The 3x3 identity matrix. */
export const identityMat3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Matrix product `a * b` for two 3x3 matrices. */
export function multiply(a: Mat3, b: Mat3): Mat3 {
  const row = (r: 0 | 1 | 2): Vec3 => [
    a[r][0] * b[0][0] + a[r][1] * b[1][0] + a[r][2] * b[2][0],
    a[r][0] * b[0][1] + a[r][1] * b[1][1] + a[r][2] * b[2][1],
    a[r][0] * b[0][2] + a[r][1] * b[1][2] + a[r][2] * b[2][2],
  ];
  return [row(0), row(1), row(2)];
}

/** Matrix-vector product `m * v`, treating `v` as a column vector. */
export function multiplyMat3Vec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** The transpose of a 3x3 matrix. */
export function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

/** The determinant of a 3x3 matrix, via cofactor expansion along row 0. */
export function determinant(m: Mat3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normVec3(a: Vec3): number {
  return Math.sqrt(dotVec3(a, a));
}

/** Normalises a vector to unit length. Throws for a zero-length vector. */
export function normaliseVec3(a: Vec3): Vec3 {
  const n = normVec3(a);
  if (!(n > 0)) {
    throw new Error("Cannot normalise a zero-length vector.");
  }
  return [a[0] / n, a[1] / n, a[2] / n];
}
