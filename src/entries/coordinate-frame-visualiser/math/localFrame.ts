import { degToRad } from "./linalg";
import type { Mat3, Rotation, Transform, Vec3 } from "./types";
import { geodeticToEcef, type Geodetic } from "./wgs84";

export type LocalConvention = "enu" | "ned";

function nedBasis(anchor: Geodetic): {
  readonly north: Vec3;
  readonly east: Vec3;
  readonly down: Vec3;
} {
  const phi = degToRad(anchor.latitudeDeg);
  const lambda = degToRad(anchor.longitudeDeg);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);

  return {
    north: [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi],
    east: [-sinLambda, cosLambda, 0],
    down: [-cosPhi * cosLambda, -cosPhi * sinLambda, -sinPhi],
  };
}

/**
 * Fixed swap between the NED and ENU basis vectors of the same tangent
 * plane: `east = east`, `north = north`, `up = -down`, reordered to
 * `(east, north, up)`. It is its own inverse.
 */
export const rotationEnuFromNed: Rotation<"enu", "ned"> = {
  to: "enu",
  from: "ned",
  m: [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
};

/**
 * `R[ecef<-local]`: a rotation whose columns are the local tangent frame's
 * basis vectors expressed in ECEF. Depends only on the anchor's latitude
 * and longitude (not its height).
 */
export function rotationEcefFromLocal<Convention extends LocalConvention>(
  anchor: Geodetic,
  convention: Convention,
): Rotation<"ecef", Convention> {
  const { north, east, down } = nedBasis(anchor);
  const up: Vec3 = [-down[0], -down[1], -down[2]];
  const columns: readonly [Vec3, Vec3, Vec3] =
    convention === "ned" ? [north, east, down] : [east, north, up];

  const m: Mat3 = [
    [columns[0][0], columns[1][0], columns[2][0]],
    [columns[0][1], columns[1][1], columns[2][1]],
    [columns[0][2], columns[1][2], columns[2][2]],
  ];

  return { to: "ecef", from: convention, m };
}

/**
 * `T[ecef<-local]`: the rotation from {@link rotationEcefFromLocal} plus a
 * translation to the anchor's ECEF position.
 */
export function transformEcefFromLocal<Convention extends LocalConvention>(
  anchor: Geodetic,
  convention: Convention,
): Transform<"ecef", Convention> {
  const rotation = rotationEcefFromLocal(anchor, convention);
  const { x, y, z } = geodeticToEcef(anchor);
  const [r0, r1, r2] = rotation.m;

  return {
    to: "ecef",
    from: convention,
    m: [
      [r0[0], r0[1], r0[2], x],
      [r1[0], r1[1], r1[2], y],
      [r2[0], r2[1], r2[2], z],
      [0, 0, 0, 1],
    ],
  };
}
