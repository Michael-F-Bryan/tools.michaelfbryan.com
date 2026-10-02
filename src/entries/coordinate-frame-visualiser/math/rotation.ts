import { multiply, transpose } from "./linalg";
import type { Frame, Rotation } from "./types";

/**
 * Composes two frame-labelled rotations: `R[outer] . R[inner]`. The
 * `From` frame of `outer` must match the `To` frame of `inner`, enforced at
 * compile time, so it is not possible to chain frames that do not agree.
 */
export function composeRotations<C extends Frame, B extends Frame, A extends Frame>(
  outer: Rotation<C, B>,
  inner: Rotation<B, A>,
): Rotation<C, A> {
  return { to: outer.to, from: inner.from, m: multiply(outer.m, inner.m) };
}

/**
 * Inverts a frame-labelled rotation. Rotation matrices are orthonormal, so
 * the inverse is simply the transpose.
 */
export function invertRotation<To extends Frame, From extends Frame>(
  rotation: Rotation<To, From>,
): Rotation<From, To> {
  return { to: rotation.from, from: rotation.to, m: transpose(rotation.m) };
}
