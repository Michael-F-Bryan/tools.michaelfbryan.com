import { useRef } from "react";

import type { LocalConvention, Mat3, Vec3 } from "./math";
import { multiplyMat3Vec3 } from "./math";
import { type Camera, orbitCamera, project, type ScenePoint, sortByDepthAscending } from "./projection";

const GRID_HALF_EXTENT = 2;
const TRIAD_LENGTH = 1.35;

/** Local-frame metres (in the active convention) to scene space, where `z` is always up. */
function toScene(convention: LocalConvention, v: Vec3): ScenePoint {
  return convention === "ned" ? [v[1], v[0], -v[2]] : [v[0], v[1], v[2]];
}

function projectLocal(camera: Camera, convention: LocalConvention, v: Vec3) {
  return project(camera, toScene(convention, v));
}

type Body = Readonly<{
  nose: Vec3;
  tailTop: Vec3;
  tailLeft: Vec3;
  tailRight: Vec3;
  flankDot: Vec3;
}>;

const BODY: Body = {
  nose: [0.95, 0, 0],
  tailTop: [-0.85, 0, -0.35],
  tailLeft: [-0.85, -0.5, 0.32],
  tailRight: [-0.85, 0.5, 0.32],
  flankDot: [-0.15, 0.56, 0.05],
};

function transformBody(rotation: Mat3, origin: Vec3, body: Body): Body {
  const apply = (v: Vec3): Vec3 => {
    const rotated = multiplyMat3Vec3(rotation, v);
    return [rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]];
  };
  return {
    nose: apply(body.nose),
    tailTop: apply(body.tailTop),
    tailLeft: apply(body.tailLeft),
    tailRight: apply(body.tailRight),
    flankDot: apply(body.flankDot),
  };
}

export type OrientationSceneProps = Readonly<{
  convention: LocalConvention;
  rotation: Mat3;
  origin: Vec3;
  probe: Vec3;
  ghostRotation: Mat3;
  showGhost: boolean;
  pinAxes: readonly Vec3[];
  pinLabel: string;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
}>;

export function OrientationScene({
  convention,
  rotation,
  origin,
  probe,
  ghostRotation,
  showGhost,
  pinAxes,
  pinLabel,
  camera,
  onCameraChange,
}: OrientationSceneProps) {
  const dragState = useRef<{ x: number; y: number } | null>(null);

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

  const body = transformBody(rotation, origin, BODY);
  const ghost = transformBody(ghostRotation, origin, BODY);
  const localNames = convention === "ned" ? (["N", "E", "D"] as const) : (["E", "N", "U"] as const);
  const localAxes: readonly Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  const pr = (v: Vec3) => projectLocal(camera, convention, v);

  type Primitive = { depth: number; node: React.ReactNode };
  const primitives: Primitive[] = [];

  // Ground grid.
  for (let i = -GRID_HALF_EXTENT; i <= GRID_HALF_EXTENT; i++) {
    const a = pr([i, -GRID_HALF_EXTENT, 0]);
    const b = pr([i, GRID_HALF_EXTENT, 0]);
    const c = pr([-GRID_HALF_EXTENT, i, 0]);
    const d = pr([GRID_HALF_EXTENT, i, 0]);
    primitives.push({
      depth: (a.depth + b.depth) / 2,
      node: <line key={`grid-a-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-rule-subtle" strokeWidth={1} />,
    });
    primitives.push({
      depth: (c.depth + d.depth) / 2,
      node: <line key={`grid-b-${i}`} x1={c.x} y1={c.y} x2={d.x} y2={d.y} className="stroke-rule-subtle" strokeWidth={1} />,
    });
  }

  // Pinned axis/axes: long lines through the origin.
  pinAxes.forEach((axis, index) => {
    const scaled: Vec3 = [axis[0] * 6, axis[1] * 6, axis[2] * 6];
    const negated: Vec3 = [-scaled[0], -scaled[1], -scaled[2]];
    const p1 = pr(scaled);
    const p2 = pr(negated);
    primitives.push({
      depth: (p1.depth + p2.depth) / 2 + 0.5,
      node: (
        <line
          key={`pin-${index}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          className="stroke-accent"
          strokeWidth={1.5}
        />
      ),
    });
  });

  // Local frame triad (ink).
  localAxes.forEach((axis, index) => {
    const tip = pr([axis[0] * TRIAD_LENGTH, axis[1] * TRIAD_LENGTH, axis[2] * TRIAD_LENGTH]);
    const start = pr([0, 0, 0]);
    primitives.push({
      depth: tip.depth,
      node: (
        <g key={`local-axis-${index}`}>
          <line x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} className="stroke-ink" strokeWidth={1.5} />
          <text x={tip.x} y={tip.y} className="fill-ink font-mono text-sm font-bold" dy={-4}>
            {localNames[index]}
          </text>
        </g>
      ),
    });
  });

  // Ghost outline (dashed), only stage>0.
  if (showGhost) {
    const g = [ghost.nose, ghost.tailTop, ghost.tailLeft, ghost.tailRight].map((v) => pr(v));
    const depth = g.reduce((sum, p) => sum + p.depth, 0) / g.length;
    primitives.push({
      depth,
      node: (
        <polygon
          key="ghost"
          points={`${g[0].x},${g[0].y} ${g[1].x},${g[1].y} ${g[2].x},${g[2].y} ${g[3].x},${g[3].y}`}
          className="fill-none stroke-rule"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ),
    });
  }

  // Body faces.
  const faces: readonly (readonly [Vec3, Vec3, Vec3, "top" | "side"])[] = [
    [body.nose, body.tailTop, body.tailLeft, "top"],
    [body.nose, body.tailRight, body.tailTop, "top"],
    [body.nose, body.tailRight, body.tailLeft, "side"],
    [body.tailTop, body.tailRight, body.tailLeft, "side"],
  ];
  faces.forEach(([a, b, c, kind], index) => {
    const pa = pr(a);
    const pb = pr(b);
    const pc = pr(c);
    primitives.push({
      depth: (pa.depth + pb.depth + pc.depth) / 3,
      node: (
        <polygon
          key={`face-${index}`}
          points={`${pa.x},${pa.y} ${pb.x},${pb.y} ${pc.x},${pc.y}`}
          className={kind === "top" ? "fill-surface stroke-ink" : "fill-panel stroke-ink"}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ),
    });
  });

  const flank = pr(body.flankDot);
  primitives.push({ depth: flank.depth + 0.01, node: <circle key="flank" cx={flank.x} cy={flank.y} r={3} className="fill-ink" /> });

  // Body frame triad (cobalt), from the body origin.
  const bodyOrigin = pr(origin);
  const bodyLabels = ["x", "y", "z"] as const;
  localAxes.forEach((axis, index) => {
    const rotated = multiplyMat3Vec3(rotation, [axis[0] * TRIAD_LENGTH, axis[1] * TRIAD_LENGTH, axis[2] * TRIAD_LENGTH]);
    const tip = pr([rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]]);
    primitives.push({
      depth: tip.depth + 0.02,
      node: (
        <g key={`body-axis-${index}`}>
          <line x1={bodyOrigin.x} y1={bodyOrigin.y} x2={tip.x} y2={tip.y} className="stroke-accent" strokeWidth={2} />
          <text x={tip.x} y={tip.y} dy={-4} className="fill-accent font-mono text-sm font-bold">
            {bodyLabels[index]}
          </text>
        </g>
      ),
    });
  });

  // Probe: component legs then a solid line from the local origin.
  const probeInLocal: Vec3 = probe;
  const probeScenePoint = pr(probeInLocal);
  const legA = pr([probeInLocal[0], probeInLocal[1], 0]);
  const legOrigin = pr([0, 0, 0]);
  primitives.push({
    depth: (legOrigin.depth + legA.depth) / 2 - 0.05,
    node: <polyline key="probe-legs" points={`${legOrigin.x},${legOrigin.y} ${legA.x},${legA.y} ${probeScenePoint.x},${probeScenePoint.y}`} className="fill-none stroke-rule" strokeWidth={1} strokeDasharray="3 3" />,
  });
  primitives.push({
    depth: probeScenePoint.depth + 0.1,
    node: (
      <g key="probe">
        <line x1={legOrigin.x} y1={legOrigin.y} x2={probeScenePoint.x} y2={probeScenePoint.y} className="stroke-ink" strokeWidth={1} />
        <circle cx={probeScenePoint.x} cy={probeScenePoint.y} r={4} className="fill-ink" />
        <text x={probeScenePoint.x} y={probeScenePoint.y} dy={-6} className="fill-ink font-mono text-sm font-bold">
          P
        </text>
      </g>
    ),
  });

  primitives.push({
    depth: legOrigin.depth - 0.1,
    node: <circle key="origin" cx={legOrigin.x} cy={legOrigin.y} r={2.5} className="fill-ink" />,
  });

  const ordered = sortByDepthAscending(primitives, (p) => p.depth);

  return (
    <svg
      viewBox="-220 -170 440 340"
      role="img"
      aria-label="Orthographic scene: a local tangent frame in ink, a body frame in cobalt, and a probe point. Drag to orbit the camera."
      className="block w-full touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {ordered.map((p) => p.node)}
      {pinAxes.length > 0 ? (
        <text x={-205} y={-150} className="fill-accent font-mono text-xs font-bold">
          {pinLabel}
        </text>
      ) : null}
    </svg>
  );
}
