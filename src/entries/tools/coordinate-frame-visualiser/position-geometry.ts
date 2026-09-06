/**
 * Pure scene-space geometry for the position scene, kept separate from the
 * SVG rendering so the numbers behind the anchor's local triad can be
 * tested without a browser.
 */
import { geodeticToEcef, type Geodetic, type LocalConvention, rotationEcefFromLocal, WGS84_A } from "./math";
import type { ScenePoint } from "./projection";

/** Converts an ECEF point (metres) to scene space, where the WGS84 ellipsoid has radius ~1. */
export function ecefToScene(ecef: { x: number; y: number; z: number }): ScenePoint {
  return [ecef.x / WGS84_A, ecef.y / WGS84_A, ecef.z / WGS84_A];
}

/** The anchor's position on the ellipsoid surface, in scene space. */
export function anchorScenePoint(anchor: Geodetic): ScenePoint {
  return ecefToScene(geodeticToEcef({ ...anchor, heightM: 0 }));
}

/**
 * The scene-space tips of the anchor's local triad: three points, each
 * `length` scene units from the anchor, along the local frame's basis
 * directions (columns of `R[ecef<-local]`, which are already unit vectors —
 * only positions in metres need scaling by `WGS84_A`, directions do not).
 */
export function localTriadTips(anchor: Geodetic, convention: LocalConvention, length: number): readonly ScenePoint[] {
  const anchorScene = anchorScenePoint(anchor);
  const { m } = rotationEcefFromLocal(anchor, convention);
  return [0, 1, 2].map((index): ScenePoint => {
    const direction: ScenePoint = [m[0][index], m[1][index], m[2][index]];
    return [
      anchorScene[0] + direction[0] * length,
      anchorScene[1] + direction[1] * length,
      anchorScene[2] + direction[2] * length,
    ];
  });
}
