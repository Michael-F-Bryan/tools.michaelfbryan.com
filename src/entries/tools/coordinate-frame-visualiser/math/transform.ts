import { transpose } from "./linalg";
import type { Frame, Mat4, Rotation, Transform, Vec3, Vec4 } from "./types";

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const row = (r: 0 | 1 | 2 | 3): Vec4 => [
    a[r][0] * b[0][0] + a[r][1] * b[1][0] + a[r][2] * b[2][0] + a[r][3] * b[3][0],
    a[r][0] * b[0][1] + a[r][1] * b[1][1] + a[r][2] * b[2][1] + a[r][3] * b[3][1],
    a[r][0] * b[0][2] + a[r][1] * b[1][2] + a[r][2] * b[2][2] + a[r][3] * b[3][2],
    a[r][0] * b[0][3] + a[r][1] * b[1][3] + a[r][2] * b[2][3] + a[r][3] * b[3][3],
  ];
  return [row(0), row(1), row(2), row(3)];
}

/** Builds `T[to<-from]` from a rotation and a translation to the origin of `From`. */
export function transformFromRotation<To extends Frame, From extends Frame>(
  rotation: Rotation<To, From>,
  translationVec: Vec3,
): Transform<To, From> {
  const [r0, r1, r2] = rotation.m;
  return {
    to: rotation.to,
    from: rotation.from,
    m: [
      [r0[0], r0[1], r0[2], translationVec[0]],
      [r1[0], r1[1], r1[2], translationVec[1]],
      [r2[0], r2[1], r2[2], translationVec[2]],
      [0, 0, 0, 1],
    ],
  };
}

/** Extracts the 3x3 rotation block from a homogeneous transform. */
export function rotationBlock<To extends Frame, From extends Frame>(
  transform: Transform<To, From>,
): Rotation<To, From> {
  const [r0, r1, r2] = transform.m;
  return {
    to: transform.to,
    from: transform.from,
    m: [
      [r0[0], r0[1], r0[2]],
      [r1[0], r1[1], r1[2]],
      [r2[0], r2[1], r2[2]],
    ],
  };
}

/** Extracts the translation column from a homogeneous transform. */
export function translation<To extends Frame, From extends Frame>(
  transform: Transform<To, From>,
): Vec3 {
  return [transform.m[0][3], transform.m[1][3], transform.m[2][3]];
}

/**
 * Composes two frame-labelled transforms: `T[outer] . T[inner]`. The
 * `From` frame of `outer` must match the `To` frame of `inner`, enforced at
 * compile time.
 */
export function composeTransforms<C extends Frame, B extends Frame, A extends Frame>(
  outer: Transform<C, B>,
  inner: Transform<B, A>,
): Transform<C, A> {
  return { to: outer.to, from: inner.from, m: multiplyMat4(outer.m, inner.m) };
}

/** Inverts a homogeneous transform: `R^T` and `-R^T . t`. */
export function invertTransform<To extends Frame, From extends Frame>(
  transform: Transform<To, From>,
): Transform<From, To> {
  const rInv = transpose(rotationBlock(transform).m);
  const t = translation(transform);
  const negRInvT: Vec3 = [
    -(rInv[0][0] * t[0] + rInv[0][1] * t[1] + rInv[0][2] * t[2]),
    -(rInv[1][0] * t[0] + rInv[1][1] * t[1] + rInv[1][2] * t[2]),
    -(rInv[2][0] * t[0] + rInv[2][1] * t[1] + rInv[2][2] * t[2]),
  ];

  return {
    to: transform.from,
    from: transform.to,
    m: [
      [rInv[0][0], rInv[0][1], rInv[0][2], negRInvT[0]],
      [rInv[1][0], rInv[1][1], rInv[1][2], negRInvT[1]],
      [rInv[2][0], rInv[2][1], rInv[2][2], negRInvT[2]],
      [0, 0, 0, 1],
    ],
  };
}

/** Applies a transform to a point (implicit `w = 1`): translation applies. */
export function applyToPoint<To extends Frame, From extends Frame>(
  transform: Transform<To, From>,
  point: Vec3,
): Vec3 {
  const [r0, r1, r2] = transform.m;
  return [
    r0[0] * point[0] + r0[1] * point[1] + r0[2] * point[2] + r0[3],
    r1[0] * point[0] + r1[1] * point[1] + r1[2] * point[2] + r1[3],
    r2[0] * point[0] + r2[1] * point[1] + r2[2] * point[2] + r2[3],
  ];
}

/** Applies a transform to a direction (implicit `w = 0`): translation is ignored. */
export function applyToDirection<To extends Frame, From extends Frame>(
  transform: Transform<To, From>,
  direction: Vec3,
): Vec3 {
  const [r0, r1, r2] = transform.m;
  return [
    r0[0] * direction[0] + r0[1] * direction[1] + r0[2] * direction[2],
    r1[0] * direction[0] + r1[1] * direction[1] + r1[2] * direction[2],
    r2[0] * direction[0] + r2[1] * direction[1] + r2[2] * direction[2],
  ];
}
