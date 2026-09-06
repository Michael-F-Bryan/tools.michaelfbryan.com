import { degToRad } from "./linalg";

/** WGS84 semi-major axis, in metres. */
export const WGS84_A = 6378137;

/** WGS84 inverse flattening (dimensionless). */
export const WGS84_INV_F = 298.257223563;

const flattening = 1 / WGS84_INV_F;

/** WGS84 semi-minor axis, in metres, derived from `a` and `f`. */
export const WGS84_B = WGS84_A * (1 - flattening);

/** WGS84 first eccentricity squared, derived from `f`: `e^2 = f(2-f)`. */
export const WGS84_E2 = flattening * (2 - flattening);

export type Geodetic = {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly heightM: number;
};

export type Ecef = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Converts a WGS84 geodetic coordinate to ECEF using the standard
 * closed-form forward formula:
 *
 * ```
 * N = a / sqrt(1 - e^2 sin^2(phi))
 * X = (N + h) cos(phi) cos(lambda)
 * Y = (N + h) cos(phi) sin(lambda)
 * Z = (N (1 - e^2) + h) sin(phi)
 * ```
 *
 * The inverse (ECEF -> geodetic) is intentionally not provided: it requires
 * an iterative or closed-form approximation this tool does not need.
 */
export function geodeticToEcef(geodetic: Geodetic): Ecef {
  const phi = degToRad(geodetic.latitudeDeg);
  const lambda = degToRad(geodetic.longitudeDeg);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const h = geodetic.heightM;

  return {
    x: (n + h) * cosPhi * Math.cos(lambda),
    y: (n + h) * cosPhi * Math.sin(lambda),
    z: (n * (1 - WGS84_E2) + h) * sinPhi,
  };
}
