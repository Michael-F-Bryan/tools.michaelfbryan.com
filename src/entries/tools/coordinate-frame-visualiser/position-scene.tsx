import { useRef } from "react";

import { geodeticToEcef, type Geodetic, type LocalConvention, rotationEcefFromLocal, WGS84_A, WGS84_B } from "./math";
import { type Camera, orbitCamera, project, type ScenePoint } from "./projection";

const SCALE = 150;
const TRIAD_LENGTH = 0.16;
const AXIS_TIP = 1.3;

function ecefToScene(ecef: { x: number; y: number; z: number }): ScenePoint {
  return [ecef.x / WGS84_A, ecef.y / WGS84_A, ecef.z / WGS84_A];
}

/** Samples a unit circle in a plane and splits it into front/back runs relative to the camera. */
function circleRuns(
  camera: Camera,
  planePoint: (angle: number) => ScenePoint,
  segments = 64,
): { front: readonly ScenePoint[][]; back: readonly ScenePoint[][] } {
  const points = Array.from({ length: segments + 1 }, (_, i) => planePoint((i / segments) * Math.PI * 2));
  const front: ScenePoint[][] = [];
  const back: ScenePoint[][] = [];
  let current: ScenePoint[] = [];
  let currentIsFront = project(camera, points[0]).depth >= 0;

  for (const point of points) {
    const isFront = project(camera, point).depth >= 0;
    if (isFront !== currentIsFront) {
      (currentIsFront ? front : back).push(current);
      current = [];
      currentIsFront = isFront;
    }
    current.push(point);
  }
  (currentIsFront ? front : back).push(current);
  return { front, back };
}

function pointsToPath(camera: Camera, points: readonly ScenePoint[]): string {
  return points.map((p) => project(camera, p)).map((p) => `${p.x},${p.y}`).join(" ");
}

export type PositionSceneProps = Readonly<{
  anchor: Geodetic;
  convention: LocalConvention;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
}>;

export function PositionScene({ anchor, convention, camera, onCameraChange }: PositionSceneProps) {
  const dragState = useRef<{ x: number; y: number } | null>(null);
  const scaledCamera: Camera = { ...camera, scale: SCALE };

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    (event.target as Element).setPointerCapture(event.pointerId);
    dragState.current = { x: event.clientX, y: event.clientY };
  }
  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!dragState.current) return;
    const dx = event.clientX - dragState.current.x;
    const dy = event.clientY - dragState.current.y;
    dragState.current = { x: event.clientX, y: event.clientY };
    onCameraChange(orbitCamera(camera, -dx * 0.4, dy * 0.4));
  }
  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    dragState.current = null;
    (event.target as Element).releasePointerCapture(event.pointerId);
  }

  const b = WGS84_B;
  const earthRadius = SCALE;

  const equator = circleRuns(scaledCamera, (t) => [Math.cos(t), Math.sin(t), 0]);
  const primeMeridian = circleRuns(scaledCamera, (t) => [Math.cos(t), 0, (Math.sin(t) * b) / WGS84_A]);
  const anchorLambda = (anchor.longitudeDeg * Math.PI) / 180;
  const anchorMeridian = circleRuns(scaledCamera, (t) => [
    Math.cos(t) * Math.cos(anchorLambda),
    Math.cos(t) * Math.sin(anchorLambda),
    (Math.sin(t) * b) / WGS84_A,
  ]);

  const ecefAxes: readonly [ScenePoint, string][] = [
    [[1, 0, 0], "X"],
    [[0, 1, 0], "Y"],
    [[0, 0, 1], "Z"],
  ];

  const anchorEcef = geodeticToEcef({ ...anchor, heightM: 0 });
  const anchorScene = ecefToScene(anchorEcef);
  const anchorRotation = rotationEcefFromLocal(anchor, convention);
  const anchorNames = convention === "ned" ? (["N", "E", "D"] as const) : (["E", "N", "U"] as const);

  function project2(p: ScenePoint) {
    return project(scaledCamera, p);
  }

  const centre = project2([0, 0, 0]);
  const anchorP = project2(anchorScene);

  return (
    <svg
      viewBox="-220 -220 440 440"
      role="img"
      aria-label="The WGS84 ellipsoid with ECEF axes from its centre, the equator, the anchor's meridian, and the anchor's local frame. Drag to orbit the camera."
      className="block w-full touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <circle cx={centre.x} cy={centre.y} r={earthRadius} className="fill-surface stroke-ink" strokeWidth={1} />

      {equator.back.map((run, i) => (
        <polyline key={`eq-back-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule-subtle" strokeDasharray="3 4" strokeWidth={1} />
      ))}
      {primeMeridian.back.map((run, i) => (
        <polyline key={`pm-back-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule-subtle" strokeDasharray="3 4" strokeWidth={1} />
      ))}
      {anchorMeridian.back.map((run, i) => (
        <polyline key={`am-back-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule-subtle" strokeDasharray="3 4" strokeWidth={1} />
      ))}

      {equator.front.map((run, i) => (
        <polyline key={`eq-front-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule" strokeWidth={1.25} />
      ))}
      {primeMeridian.front.map((run, i) => (
        <polyline key={`pm-front-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule" strokeWidth={1} />
      ))}
      {anchorMeridian.front.map((run, i) => (
        <polyline key={`am-front-${i}`} points={pointsToPath(scaledCamera, run)} className="fill-none stroke-rule" strokeWidth={1.25} />
      ))}

      {ecefAxes.map(([direction, label]) => {
        const surface = project2(direction);
        const tip = project2([direction[0] * AXIS_TIP, direction[1] * AXIS_TIP, direction[2] * AXIS_TIP]);
        return (
          <g key={label}>
            <line x1={centre.x} y1={centre.y} x2={surface.x} y2={surface.y} className="stroke-ink" strokeWidth={1.25} strokeDasharray="3 3" />
            <line x1={surface.x} y1={surface.y} x2={tip.x} y2={tip.y} className="stroke-ink" strokeWidth={1.25} />
            <text x={tip.x} y={tip.y} dy={-6} className="fill-ink font-mono text-sm font-bold">
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={centre.x} cy={centre.y} r={2.5} className="fill-ink" />

      {anchorNames.map((name, index) => {
        const m = anchorRotation.m;
        const direction: ScenePoint = [m[0][index] / WGS84_A, m[1][index] / WGS84_A, m[2][index] / WGS84_A];
        const tip = project2([
          anchorScene[0] + direction[0] * TRIAD_LENGTH,
          anchorScene[1] + direction[1] * TRIAD_LENGTH,
          anchorScene[2] + direction[2] * TRIAD_LENGTH,
        ]);
        return (
          <g key={name}>
            <line x1={anchorP.x} y1={anchorP.y} x2={tip.x} y2={tip.y} className="stroke-accent" strokeWidth={2} />
            <text x={tip.x} y={tip.y} dy={-5} className="fill-accent font-mono text-sm font-bold">
              {name}
            </text>
          </g>
        );
      })}
      <circle cx={anchorP.x} cy={anchorP.y} r={5} className="fill-accent" />
      <text x={anchorP.x} y={anchorP.y} dy={18} className="fill-accent font-mono text-sm font-bold">
        anchor
      </text>
    </svg>
  );
}
