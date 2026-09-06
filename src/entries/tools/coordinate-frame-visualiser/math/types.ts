/**
 * Coordinate frames used throughout the coordinate-frame visualiser.
 *
 * - "body": the vehicle/sensor's own axes (fixed forward-right-down).
 * - "ned": a local tangent frame at an anchor (north, east, down).
 * - "enu": a local tangent frame at the same anchor (east, north, up).
 * - "ecef": earth-centred, earth-fixed Cartesian frame.
 */
export type Frame = "body" | "ecef" | "enu" | "ned";

/** A 3-vector, stored as a readonly tuple `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];

/** A 4-vector, stored as a readonly tuple `[x, y, z, w]`. */
export type Vec4 = readonly [number, number, number, number];

/**
 * A 3x3 matrix stored row-major: `m[row]` is a row, so `m[row][col]` is the
 * entry at that row and column. Treat a {@link Vec3} as a column vector when
 * multiplying: `(m * v)[row] = sum_col m[row][col] * v[col]`.
 */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

/** A 4x4 matrix stored row-major, analogous to {@link Mat3}. */
export type Mat4 = readonly [Vec4, Vec4, Vec4, Vec4];

/**
 * A rotation that maps coordinates expressed in the `From` frame to
 * coordinates expressed in the `To` frame: `v_to = m * v_from`.
 *
 * Compact notation used across this module: `R[to<-from]`.
 */
export type Rotation<To extends Frame, From extends Frame> = {
  readonly to: To;
  readonly from: From;
  readonly m: Mat3;
};

/**
 * A homogeneous transform that maps points/directions expressed in the
 * `From` frame to the `To` frame: `p_to = m * p_from` (w=1 for points, w=0
 * for directions).
 *
 * Compact notation used across this module: `T[to<-from]`.
 */
export type Transform<To extends Frame, From extends Frame> = {
  readonly to: To;
  readonly from: From;
  readonly m: Mat4;
};
