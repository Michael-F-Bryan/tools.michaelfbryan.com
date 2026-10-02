import { useRef } from "react";

import { cn } from "@/lib/utils";

import type { LocalConvention, Mat3, Vec3 } from "./math";
import { multiplyMat3Vec3 } from "./math";
import { type Camera, orbitCamera, project, type Projected, type ScenePoint, sortByDepthAscending } from "./projection";

const GRID_HALF_EXTENT = 2;
const TRIAD_LENGTH = 1.35;
const PIN_HALF_LENGTH = 1.75;
/** Labels sit this many viewBox units beyond an arrow tip, along the arrow. */
const LABEL_OFFSET = 12;
const SAFE_X = 205;
const SAFE_Y = 155;

/** Local-frame metres (in the active convention) to scene space, where `z` is always up. */
function toScene(convention: LocalConvention, v: Vec3): ScenePoint {
  return convention === "ned" ? [v[1], v[0], -v[2]] : [v[0], v[1], v[2]];
}

/**
 * The body glyph, in body coordinates (x forward, y right, z down): a
 * delta-winged dart with a fin. The nose is the only sharp point, the fin
 * stands up (−z), and the right wing is tinted so left and right can be told
 * apart from any angle.
 */
const NOSE: Vec3 = [1, 0, 0];
const SPINE_REAR: Vec3 = [-0.55, 0, 0];
const WING_LEFT: Vec3 = [-0.8, -0.85, 0];
const WING_RIGHT: Vec3 = [-0.8, 0.85, 0];
const FIN_FRONT: Vec3 = [-0.25, 0, 0];
const FIN_REAR: Vec3 = [-0.8, 0, 0];
const FIN_TIP: Vec3 = [-0.9, 0, -0.5];

type Face = Readonly<{ points: readonly Vec3[]; className: string }>;

const BODY_FACES: readonly Face[] = [
  { points: [NOSE, WING_LEFT, SPINE_REAR], className: "fill-surface stroke-accent" },
  { points: [NOSE, SPINE_REAR, WING_RIGHT], className: "fill-accent/25 stroke-accent" },
  { points: [FIN_FRONT, FIN_REAR, FIN_TIP], className: "fill-accent/10 stroke-accent" },
];

const GHOST_OUTLINES: readonly (readonly Vec3[])[] = [
  [NOSE, WING_RIGHT, SPINE_REAR, WING_LEFT],
  [FIN_FRONT, FIN_REAR, FIN_TIP],
];

function placeInLocal(rotation: Mat3, origin: Vec3, v: Vec3): Vec3 {
  const rotated = multiplyMat3Vec3(rotation, v);
  return [rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]];
}

function polygonPoints(points: readonly Projected[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function meanDepth(points: readonly Projected[]): number {
  return points.reduce((sum, p) => sum + p.depth, 0) / points.length;
}

/** Unit screen direction from `from` to `to`, or null when they coincide on screen. */
function screenDirection(from: Projected, to: Projected): readonly [number, number] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return null;
  return [dx / length, dy / length];
}

/** An arrowhead polygon whose point is at `tip`, pointing along `dir`. */
function arrowHead(tip: Projected, dir: readonly [number, number], size: number): string {
  const [ux, uy] = dir;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  const px = -uy * size * 0.45;
  const py = ux * size * 0.45;
  return `${tip.x},${tip.y} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`;
}

function clampToSafeArea(x: number, y: number): readonly [number, number] {
  return [Math.max(-SAFE_X, Math.min(SAFE_X, x)), Math.max(-SAFE_Y, Math.min(SAFE_Y, y))];
}

/** A label position just past an arrow tip; falls back to below-right when the arrow is end-on. */
function labelBeyond(tip: Projected, dir: readonly [number, number] | null, offset = LABEL_OFFSET): readonly [number, number] {
  if (!dir) return clampToSafeArea(tip.x + offset * 0.7, tip.y + offset);
  return clampToSafeArea(tip.x + dir[0] * offset, tip.y + dir[1] * offset);
}

export type ScenePin = Readonly<{
  /** Unit axis in the active local frame. */
  axis: Vec3;
  /** Which stage turns about it. */
  stage: 1 | 2 | 3;
}>;

export type OrientationSceneProps = Readonly<{
  convention: LocalConvention;
  /** The pose the solid body is drawn in: the scrubbed pose. */
  rotation: Mat3;
  /** The pose the sequence ends in, drawn as a dashed target when it differs from `rotation`. */
  finalRotation: Mat3;
  showFinalGhost: boolean;
  origin: Vec3;
  probe: Vec3;
  showProbe: boolean;
  pins: readonly ScenePin[];
  /** Two pins on the same line (gimbal lock): draw them so both can be seen. */
  pinsCollinear: boolean;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
}>;

export function OrientationScene({
  convention,
  rotation,
  finalRotation,
  showFinalGhost,
  origin,
  probe,
  showProbe,
  pins,
  pinsCollinear,
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

  function handlePointerCancel() {
    dragState.current = null;
  }

  const pr = (v: Vec3) => project(camera, toScene(convention, v));
  const localNames = convention === "ned" ? (["N", "E", "D"] as const) : (["E", "N", "U"] as const);
  const basis: readonly Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const localOrigin = pr([0, 0, 0]);
  const bodyOrigin = pr(origin);
  // Labels get a paper-coloured halo (stroke painted under the fill) so two
  // that land near each other, or over a line, stay legible.
  const labelClass = "font-mono text-sm font-bold max-sm:text-[22px] [paint-order:stroke] stroke-surface [stroke-width:3px]";

  type Primitive = { depth: number; node: React.ReactNode };
  const primitives: Primitive[] = [];

  // Ground grid: the tangent plane at the anchor.
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

  // Local frame triad: thin ink arrows with open heads.
  basis.forEach((axis, index) => {
    const tip = pr([axis[0] * TRIAD_LENGTH, axis[1] * TRIAD_LENGTH, axis[2] * TRIAD_LENGTH]);
    const dir = screenDirection(localOrigin, tip);
    const [lx, ly] = labelBeyond(tip, dir);
    primitives.push({
      depth: tip.depth,
      node: (
        <g key={`local-axis-${index}`} data-local-axis={localNames[index]}>
          <line x1={localOrigin.x} y1={localOrigin.y} x2={tip.x} y2={tip.y} className="stroke-ink" strokeWidth={1.25} />
          {dir ? <polygon points={arrowHead(tip, dir, 9)} className="fill-surface stroke-ink" strokeWidth={1.25} strokeLinejoin="round" /> : null}
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={cn("fill-ink", labelClass)}>
            {localNames[index]}
          </text>
        </g>
      ),
    });
  });

  // Rotation-axis pins: bounded dash-dot lines with a ring and a stage label at one end.
  let previousPinLabelEnd: Projected | null = null;
  pins.forEach((pin, index) => {
    const positive: Vec3 = [pin.axis[0] * PIN_HALF_LENGTH, pin.axis[1] * PIN_HALF_LENGTH, pin.axis[2] * PIN_HALF_LENGTH];
    const negative: Vec3 = [-positive[0], -positive[1], -positive[2]];
    const p1 = pr([positive[0] + origin[0], positive[1] + origin[1], positive[2] + origin[2]]);
    const p2 = pr([negative[0] + origin[0], negative[1] + origin[1], negative[2] + origin[2]]);
    // With two collinear pins, label the second at whichever end is farther
    // from the first label so both stay readable.
    const labelEnd =
      previousPinLabelEnd === null
        ? p1
        : Math.hypot(p1.x - previousPinLabelEnd.x, p1.y - previousPinLabelEnd.y) >=
            Math.hypot(p2.x - previousPinLabelEnd.x, p2.y - previousPinLabelEnd.y)
          ? p1
          : p2;
    previousPinLabelEnd = labelEnd;
    const dir = screenDirection(bodyOrigin, labelEnd);
    const [lx, ly] = labelBeyond(labelEnd, dir, 16);
    primitives.push({
      depth: Math.max(p1.depth, p2.depth) + 0.5,
      node: (
        <g key={`pin-${pin.stage}`} data-pin-stage={pin.stage}>
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            className="stroke-accent"
            strokeWidth={1.25}
            strokeDasharray={pinsCollinear && index === 1 ? "2 4" : "7 3 1 3"}
          />
          <circle
            cx={labelEnd.x}
            cy={labelEnd.y}
            r={pinsCollinear && index === 1 ? 7 : 4.5}
            className="fill-surface stroke-accent"
            strokeWidth={1.25}
          />
          <text
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-accent font-mono text-xs max-sm:text-lg [paint-order:stroke] stroke-surface [stroke-width:3px]"
          >
            axis {pin.stage}
          </text>
        </g>
      ),
    });
  });

  // The final pose as a quiet dashed target, when the body is not there yet.
  if (showFinalGhost) {
    GHOST_OUTLINES.forEach((outline, index) => {
      const projected = outline.map((v) => pr(placeInLocal(finalRotation, origin, v)));
      primitives.push({
        depth: meanDepth(projected),
        node: (
          <polygon
            key={`ghost-${index}`}
            data-final-ghost
            points={polygonPoints(projected)}
            className="fill-none stroke-rule"
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        ),
      });
    });
  }

  // The body, in the displayed pose.
  BODY_FACES.forEach((face, index) => {
    const projected = face.points.map((v) => pr(placeInLocal(rotation, origin, v)));
    primitives.push({
      depth: meanDepth(projected),
      node: (
        <polygon
          key={`face-${index}`}
          points={polygonPoints(projected)}
          className={face.className}
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
      ),
    });
  });

  // Body frame triad: thick cobalt arrows with filled heads.
  const bodyLabels = ["x", "y", "z"] as const;
  basis.forEach((axis, index) => {
    const tip = pr(placeInLocal(rotation, origin, [axis[0] * TRIAD_LENGTH, axis[1] * TRIAD_LENGTH, axis[2] * TRIAD_LENGTH]));
    const dir = screenDirection(bodyOrigin, tip);
    const [lx, ly] = labelBeyond(tip, dir);
    primitives.push({
      depth: tip.depth + 0.02,
      node: (
        <g key={`body-axis-${index}`} data-body-axis={bodyLabels[index]}>
          <line x1={bodyOrigin.x} y1={bodyOrigin.y} x2={tip.x} y2={tip.y} className="stroke-accent" strokeWidth={2.25} />
          {dir ? <polygon points={arrowHead(tip, dir, 10)} className="fill-accent" /> : null}
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={cn("fill-accent", labelClass)}>
            {bodyLabels[index]}
          </text>
        </g>
      ),
    });
  });

  // Optional probe point: component legs then a solid line from the local origin.
  if (showProbe) {
    const probePoint = pr(probe);
    const footPoint = pr([probe[0], probe[1], 0]);
    primitives.push({
      depth: (localOrigin.depth + footPoint.depth) / 2 - 0.05,
      node: (
        <polyline
          key="probe-legs"
          points={`${localOrigin.x},${localOrigin.y} ${footPoint.x},${footPoint.y} ${probePoint.x},${probePoint.y}`}
          className="fill-none stroke-rule"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ),
    });
    const dir = screenDirection(localOrigin, probePoint);
    const [lx, ly] = labelBeyond(probePoint, dir, 14);
    primitives.push({
      depth: probePoint.depth + 0.1,
      node: (
        <g key="probe" data-probe>
          <line x1={localOrigin.x} y1={localOrigin.y} x2={probePoint.x} y2={probePoint.y} className="stroke-ink" strokeWidth={1} />
          <circle cx={probePoint.x} cy={probePoint.y} r={4} className="fill-ink" />
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={cn("fill-ink", labelClass)}>
            P
          </text>
        </g>
      ),
    });
  }

  primitives.push({
    depth: localOrigin.depth - 0.1,
    node: <circle key="origin" cx={localOrigin.x} cy={localOrigin.y} r={2.5} className="fill-ink" />,
  });

  const ordered = sortByDepthAscending(primitives, (p) => p.depth);

  return (
    <svg
      viewBox="-220 -170 440 340"
      role="img"
      aria-label="Orthographic scene: a local tangent frame drawn in ink, a dart-shaped body with its frame drawn in cobalt, and the axis the current rotation stage turns about. Drag to orbit the camera."
      className="block max-h-[44vh] w-full cursor-grab touch-pan-y select-none active:cursor-grabbing lg:max-h-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {ordered.map((p) => p.node)}
      {pinsCollinear ? (
        <text x={-208} y={-150} className="fill-accent font-mono text-xs font-bold max-sm:text-base">
          axis 1 = axis 3 · gimbal lock
        </text>
      ) : null}
      <g aria-hidden="true" className="fill-muted font-mono text-[10px] max-sm:text-sm">
        <text x={208} y={158} textAnchor="end">
          ↻ drag to orbit
        </text>
      </g>
    </svg>
  );
}
