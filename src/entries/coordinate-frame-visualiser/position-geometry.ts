/**
 * Pure scene-space geometry for the position scene, kept separate from the
 * SVG rendering so the numbers behind the anchor's local triad, the anchor
 * picking and the camera framing can be tested without a browser.
 */
import { geodeticToEcef, type Geodetic, type LocalConvention, radToDeg, rotationEcefFromLocal, WGS84_A, WGS84_B, WGS84_E2 } from "./math";
import { type Camera, project, type ScenePoint, viewRay } from "./projection";

/** Screen units per scene unit in the position scene; the ellipsoid's equatorial radius on screen. */
export const POSITION_SCALE = 150;

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

/**
 * The camera that looks straight at the anchor: azimuth along its
 * longitude, elevation at its latitude, so the anchor projects to the
 * centre of the scene with its tangent plane facing the viewer.
 */
export function cameraFacingAnchor(anchor: Geodetic): Camera {
  return { azimuthDeg: anchor.longitudeDeg, elevationDeg: anchor.latitudeDeg, scale: POSITION_SCALE };
}

/**
 * How squarely the camera sees the anchor: 1 when it faces the camera,
 * 0 on the limb, negative on the hidden hemisphere.
 */
export function anchorFacing(camera: Camera, anchor: Geodetic): number {
  return project(camera, anchorScenePoint(anchor)).depth;
}

/**
 * Below this facing value (about 45° off the line of sight) the anchor and
 * its labels start to crowd the limb, so committed coordinates reframe the
 * camera to face the anchor.
 */
export const REFRAME_BELOW_FACING = 0.7;

/**
 * The geodetic latitude and longitude of the ellipsoid surface point under
 * a screen position, or null when the pointer is off the Earth. The ray is
 * intersected with the WGS84 ellipsoid itself (scene units, `z` scaled by
 * `a/b` to make it a unit sphere), and the surface point's geodetic latitude
 * follows from `tan φ = Z / ((1 − e²) · √(X² + Y²))`, exact at height zero.
 */
export function pickOnEllipsoid(camera: Camera, x: number, y: number): { latitudeDeg: number; longitudeDeg: number } | null {
  const { origin, direction } = viewRay(camera, x, y);
  const k = WGS84_A / WGS84_B;
  const o: ScenePoint = [origin[0], origin[1], origin[2] * k];
  const d: ScenePoint = [direction[0], direction[1], direction[2] * k];
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = 2 * (o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  // The smaller root is nearer the camera: the visible side of the Earth.
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  const p: ScenePoint = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
  const rho = Math.hypot(p[0], p[1]);
  return {
    latitudeDeg: radToDeg(Math.atan2(p[2], (1 - WGS84_E2) * rho)),
    longitudeDeg: radToDeg(Math.atan2(p[1], p[0])),
  };
}
