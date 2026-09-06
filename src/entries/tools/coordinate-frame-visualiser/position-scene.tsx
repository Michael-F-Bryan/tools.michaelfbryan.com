import { useRef } from "react";

import { cn } from "@/lib/utils";

import { type Geodetic, type LocalConvention, WGS84_A, WGS84_B } from "./math";
import { anchorScenePoint, localTriadTips } from "./position-geometry";
import { type Camera, orbitCamera, project, type ScenePoint } from "./projection";

const SCALE = 150;
const TRIAD_LENGTH = 0.16;
const AXIS_TIP = 1.3;

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
  function handlePointerCancel() {
    dragState.current = null;
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

  const anchorScene = anchorScenePoint(anchor);
  const triadTips = localTriadTips(anchor, convention, TRIAD_LENGTH);
  const anchorNames = convention === "ned" ? (["N", "E", "D"] as const) : (["E", "N", "U"] as const);

  function project2(p: ScenePoint) {
    return project(scaledCamera, p);
  }

  const centre = project2([0, 0, 0]);
  const anchorP = project2(anchorScene);
  // The anchor can be on the far side of the ellipsoid from the current
  // camera (e.g. right after an orbit drag); draw it with the hidden-side
  // treatment rather than claiming a point behind the Earth is visible.
  const anchorHidden = anchorP.depth < 0;

  return (
    <svg
      viewBox="-220 -220 440 440"
      role="img"
      aria-label="The WGS84 ellipsoid with ECEF axes from its centre, the equator, the anchor's meridian, and the anchor's local frame. Drag to orbit the camera."
      className="block w-full touch-pan-y select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
            <text x={tip.x} y={tip.y} dy={-6} className="fill-ink font-mono text-sm max-sm:text-[22px] font-bold">
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={centre.x} cy={centre.y} r={2.5} className="fill-ink" />

      {anchorNames.map((name, index) => {
        const tip = project2(triadTips[index]);
        return (
          <g key={name}>
            <line
              x1={anchorP.x}
              y1={anchorP.y}
              x2={tip.x}
              y2={tip.y}
              className={anchorHidden ? "stroke-rule" : "stroke-accent"}
              strokeWidth={2}
              strokeDasharray={anchorHidden ? "3 3" : undefined}
            />
            <text
              x={tip.x}
              y={tip.y}
              dy={-5}
              className={cn(
                "font-mono text-sm max-sm:text-[22px] font-bold",
                anchorHidden ? "fill-muted" : "fill-accent",
              )}
            >
              {name}
            </text>
          </g>
        );
      })}
      <circle
        cx={anchorP.x}
        cy={anchorP.y}
        r={5}
        className={anchorHidden ? "fill-none stroke-rule" : "fill-accent"}
        strokeWidth={anchorHidden ? 1.5 : undefined}
        strokeDasharray={anchorHidden ? "2 2" : undefined}
      />
      <text
        x={anchorP.x}
        y={anchorP.y}
        dy={18}
        className={cn("font-mono text-sm max-sm:text-[22px] font-bold", anchorHidden ? "fill-muted" : "fill-accent")}
      >
        anchor
      </text>
    </svg>
  );
}
