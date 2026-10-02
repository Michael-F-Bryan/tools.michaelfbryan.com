/**
 * A tiny orthographic camera for the orientation and position scenes.
 *
 * This module knows nothing about NED/ENU/body frames: it takes plain
 * "scene-space" 3-vectors where `z` is up, and a camera described by an
 * azimuth (rotation around the vertical axis) and an elevation (tilt above
 * the horizontal plane). Callers map their own frame's axes onto this
 * scene-space before projecting; the entry's scene components own that
 * mapping.
 */

/** A point (or direction) in scene space: `[x, y, z]` with `z` up. */
export type ScenePoint = readonly [number, number, number];

export type Camera = Readonly<{
  /** Rotation around the vertical (scene `z`) axis, in degrees. */
  azimuthDeg: number;
  /** Tilt above the horizontal plane, in degrees. Clamped away from the poles. */
  elevationDeg: number;
  /** Pixels (or other screen units) per scene unit. */
  scale: number;
}>;

export type Projected = Readonly<{
  x: number;
  y: number;
  /**
   * Distance toward the camera along its view axis. Larger values are
   * closer to the camera. Sort ascending for painter's-algorithm ordering
   * (farthest first, so nearer shapes are drawn on top).
   */
  depth: number;
}>;

/**
 * The largest elevation magnitude the camera will report. Keeping the
 * camera strictly short of +/-90 degrees means the view direction is never
 * exactly parallel to the world-up reference, so the right/up basis below
 * never degenerates - a top-down or bottom-up view is simply this angle,
 * not the unstable exact pole.
 */
export const MAX_ELEVATION_DEG = 89;

/** Clamps an elevation to `[-MAX_ELEVATION_DEG, MAX_ELEVATION_DEG]`. */
export function clampElevation(deg: number): number {
  return Math.max(-MAX_ELEVATION_DEG, Math.min(MAX_ELEVATION_DEG, deg));
}

const WORLD_UP: ScenePoint = [0, 0, 1];

function cross(a: ScenePoint, b: ScenePoint): ScenePoint {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: ScenePoint, b: ScenePoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise(a: ScenePoint): ScenePoint {
  const n = Math.sqrt(dot(a, a));
  return [a[0] / n, a[1] / n, a[2] / n];
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

type CameraBasis = Readonly<{
  /** Unit vector from the scene origin toward the camera. */
  dir: ScenePoint;
  /** The camera's screen-right axis, in scene space. */
  right: ScenePoint;
  /** The camera's screen-up axis, in scene space. */
  up: ScenePoint;
}>;

function cameraBasis(camera: Camera): CameraBasis {
  const az = degToRad(camera.azimuthDeg);
  const el = degToRad(clampElevation(camera.elevationDeg));
  const dir: ScenePoint = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const forward: ScenePoint = [-dir[0], -dir[1], -dir[2]];
  const right = normalise(cross(forward, WORLD_UP));
  const up = cross(right, forward);
  return { dir, right, up };
}

/** Projects a scene-space point through an orthographic camera. */
export function project(camera: Camera, point: ScenePoint): Projected {
  const { dir, right, up } = cameraBasis(camera);
  return {
    x: dot(point, right) * camera.scale,
    y: -dot(point, up) * camera.scale,
    depth: dot(point, dir),
  };
}

export type Ray = Readonly<{
  /** A point on the ray: where the screen point sits on the view plane through the scene origin. */
  origin: ScenePoint;
  /** Unit direction of travel, away from the camera into the scene. */
  direction: ScenePoint;
}>;

/**
 * The inverse of {@link project} for a screen point: the orthographic view
 * ray that projects onto `(x, y)`, for picking scene geometry under the
 * pointer. Screen `y` grows downwards, as in `project`.
 */
export function viewRay(camera: Camera, x: number, y: number): Ray {
  const { dir, right, up } = cameraBasis(camera);
  const sx = x / camera.scale;
  const sy = -y / camera.scale;
  return {
    origin: [right[0] * sx + up[0] * sy, right[1] * sx + up[1] * sy, right[2] * sx + up[2] * sy],
    direction: [-dir[0], -dir[1], -dir[2]],
  };
}

/** Orbits the camera by a pointer-drag delta. Azimuth accumulates freely; elevation is clamped. */
export function orbitCamera(camera: Camera, deltaAzimuthDeg: number, deltaElevationDeg: number): Camera {
  return {
    ...camera,
    azimuthDeg: camera.azimuthDeg + deltaAzimuthDeg,
    elevationDeg: clampElevation(camera.elevationDeg + deltaElevationDeg),
  };
}

/**
 * Sorts items back-to-front by a depth selector, for painter's-algorithm
 * rendering: paint in the returned order so nearer items land on top.
 */
export function sortByDepthAscending<T>(items: readonly T[], depthOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => depthOf(a) - depthOf(b));
}
