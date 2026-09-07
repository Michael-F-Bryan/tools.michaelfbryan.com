import { useRef } from "react";

import { cn } from "@/lib/utils";

import { type Geodetic, type LocalConvention, WGS84_A, WGS84_B } from "./math";
import { anchorScenePoint, localTriadTips, pickOnEllipsoid, POSITION_SCALE } from "./position-geometry";
import { type Camera, orbitCamera, project, type Projected, type ScenePoint } from "./projection";

const TRIAD_LENGTH = 0.16;
const AXIS_TIP = 1.3;
const SAFE = 205;
const LABEL_CLASS = "font-mono text-sm font-bold max-sm:text-[22px] [paint-order:stroke] stroke-surface [stroke-width:3px]";

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

function clamp(x: number, y: number): readonly [number, number] {
  return [Math.max(-SAFE, Math.min(SAFE, x)), Math.max(-SAFE, Math.min(SAFE, y))];
}

/** Unit screen direction from `from` to `to`, or null when the two nearly coincide (an axis seen end-on). */
function screenDirection(from: Projected, to: Projected): readonly [number, number] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 6) return null;
  return [dx / length, dy / length];
}

function arrowHead(tip: Projected, dir: readonly [number, number], size: number): string {
  const [ux, uy] = dir;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const px = -uy * size * 0.45;
  const py = ux * size * 0.45;
  return `${tip.x},${tip.y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

/** Converts a pointer event to the SVG's viewBox coordinates. */
function svgPoint(svg: SVGSVGElement, event: React.PointerEvent): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

export type PositionSceneProps = Readonly<{
  anchor: Geodetic;
  convention: LocalConvention;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  /** Called continuously while the anchor is dragged across the ellipsoid. */
  onAnchorDrag: (anchor: Geodetic) => void;
}>;

export function PositionScene({ anchor, convention, camera, onCameraChange, onAnchorDrag }: PositionSceneProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "orbit"; x: number; y: number } | { kind: "anchor" } | null>(null);
  const scaledCamera: Camera = { ...camera, scale: POSITION_SCALE };

  function handleOrbitDown(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "orbit", x: event.clientX, y: event.clientY };
  }

  function handleAnchorDown(event: React.PointerEvent<SVGGElement>) {
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    drag.current = { kind: "anchor" };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    if (state.kind === "orbit") {
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      drag.current = { kind: "orbit", x: event.clientX, y: event.clientY };
      onCameraChange(orbitCamera(camera, -dx * 0.4, dy * 0.4));
      return;
    }
    const { x, y } = svgPoint(event.currentTarget, event);
    const picked = pickOnEllipsoid(scaledCamera, x, y);
    // Off the Earth: keep the last position on it rather than guessing.
    if (picked) onAnchorDrag({ ...anchor, ...picked });
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handlePointerCancel() {
    drag.current = null;
  }

  const b = WGS84_B;
  const earthRadius = POSITION_SCALE;

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

  // Triad labels sit just past each arrow tip. An axis seen end-on (its
  // tip projects onto the anchor) is drawn as a small ring and labelled to
  // one side instead of on top of the anchor.
  const triad = triadTips.map((tip3, index) => {
    const tip = project2(tip3);
    const dir = screenDirection(anchorP, tip);
    const towardCamera = tip.depth > anchorP.depth;
    const label = dir ? clamp(tip.x + dir[0] * 11, tip.y + dir[1] * 11) : clamp(anchorP.x + 16, anchorP.y - 14);
    return { name: anchorNames[index], tip, dir, towardCamera, label };
  });

  // The "anchor" label goes on whichever side is emptiest of triad labels.
  const anchorLabelCandidates: readonly (readonly [number, number, "middle" | "start" | "end"])[] = [
    [anchorP.x, anchorP.y + 24, "middle"],
    [anchorP.x, anchorP.y - 20, "middle"],
    [anchorP.x + 20, anchorP.y + 5, "start"],
    [anchorP.x - 20, anchorP.y + 5, "end"],
  ];
  const anchorLabel = anchorLabelCandidates
    .map((candidate) => ({
      candidate,
      clearance: Math.min(
        ...triad.flatMap((axis) => [
          Math.hypot(axis.label[0] - candidate[0], axis.label[1] - candidate[1]),
          Math.hypot(axis.tip.x - candidate[0], axis.tip.y - candidate[1]),
        ]),
      ),
    }))
    .sort((a, c) => c.clearance - a.clearance)[0].candidate;
  const [anchorLabelX, anchorLabelY] = clamp(anchorLabel[0], anchorLabel[1]);

  return (
    <svg
      ref={svgRef}
      viewBox="-220 -220 440 440"
      role="img"
      aria-label="The WGS84 ellipsoid with ECEF axes from its centre, the equator, the anchor's meridian, and the anchor's local frame. Drag the anchor to move it; drag elsewhere to orbit the camera."
      className="block max-h-[44vh] w-full cursor-grab touch-pan-y select-none active:cursor-grabbing lg:max-h-none"
      onPointerDown={handleOrbitDown}
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
        const dir = screenDirection(centre, tip);
        const [lx, ly] = dir ? clamp(tip.x + dir[0] * 11, tip.y + dir[1] * 11) : clamp(tip.x + 12, tip.y - 12);
        return (
          <g key={label}>
            <line x1={centre.x} y1={centre.y} x2={surface.x} y2={surface.y} className="stroke-ink" strokeWidth={1.25} strokeDasharray="3 3" />
            <line x1={surface.x} y1={surface.y} x2={tip.x} y2={tip.y} className="stroke-ink" strokeWidth={1.25} />
            {dir ? <polygon points={arrowHead(tip, dir, 9)} className="fill-surface stroke-ink" strokeWidth={1.25} strokeLinejoin="round" /> : null}
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={cn("fill-ink", LABEL_CLASS)}>
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={centre.x} cy={centre.y} r={2.5} className="fill-ink" />

      {triad.map((axis) => (
        <g key={axis.name} data-triad-axis={axis.name}>
          {axis.dir ? (
            <>
              <line
                x1={anchorP.x}
                y1={anchorP.y}
                x2={axis.tip.x}
                y2={axis.tip.y}
                className={anchorHidden ? "stroke-rule" : "stroke-accent"}
                strokeWidth={2}
                strokeDasharray={anchorHidden ? "3 3" : undefined}
              />
              {!anchorHidden ? <polygon points={arrowHead(axis.tip, axis.dir, 8)} className="fill-accent" /> : null}
            </>
          ) : (
            // Seen end-on: a ring with a dot (toward the viewer) or a cross (away).
            <g className={anchorHidden ? "stroke-rule" : "stroke-accent"} strokeWidth={1.5}>
              <circle cx={anchorP.x} cy={anchorP.y} r={9} className="fill-none" />
              {axis.towardCamera ? (
                <circle cx={anchorP.x} cy={anchorP.y} r={1.5} className={anchorHidden ? "fill-rule" : "fill-accent"} />
              ) : (
                <>
                  <line x1={anchorP.x - 4} y1={anchorP.y - 4} x2={anchorP.x + 4} y2={anchorP.y + 4} />
                  <line x1={anchorP.x - 4} y1={anchorP.y + 4} x2={anchorP.x + 4} y2={anchorP.y - 4} />
                </>
              )}
            </g>
          )}
          <text
            x={axis.label[0]}
            y={axis.label[1]}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn(LABEL_CLASS, anchorHidden ? "fill-muted" : "fill-accent")}
          >
            {axis.name}
          </text>
        </g>
      ))}

      {anchorHidden ? (
        <circle cx={anchorP.x} cy={anchorP.y} r={5} className="fill-none stroke-rule" strokeWidth={1.5} strokeDasharray="2 2" />
      ) : (
        <g data-anchor-handle className="cursor-move" onPointerDown={handleAnchorDown}>
          <circle cx={anchorP.x} cy={anchorP.y} r={18} className="fill-transparent" />
          <circle cx={anchorP.x} cy={anchorP.y} r={12} className="fill-none stroke-accent" strokeWidth={1} strokeDasharray="2 2" />
          <circle cx={anchorP.x} cy={anchorP.y} r={5} className="fill-accent" />
        </g>
      )}
      <text
        x={anchorLabelX}
        y={anchorLabelY}
        textAnchor={anchorLabel[2]}
        dominantBaseline="middle"
        className={cn(LABEL_CLASS, anchorHidden ? "fill-muted" : "fill-accent")}
      >
        anchor
      </text>
      <g aria-hidden="true" className="fill-muted font-mono text-[10px] max-sm:text-sm">
        <text x={208} y={208} textAnchor="end" className="max-sm:hidden">
          ↻ drag the Earth to orbit · drag the anchor to move it
        </text>
        <text x={208} y={208} textAnchor="end" className="sm:hidden">
          ↻ drag Earth to orbit · drag anchor to move
        </text>
      </g>
    </svg>
  );
}
