import { memo, useCallback, useEffect, useId, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { speedColour } from "./speed-scale";
import { LANE_WIDTH, cornerRanges, lanePath, limitAt, offsetPose, poseAt, positiveMod, type Lane, type Pose, type Track } from "./track";
import styles from "./ring-view.module.css";
import type { Simulation } from "./types";

/** Lane width, m. Only the drawing uses it; the model has no width. */
const LANE = LANE_WIDTH;
/** Drawn body width, m (the model only knows length). The tyres stand just proud of it. */
const BODY_WIDTH = 1.84;
/** Verge posts every POST metres, heavier every MAJOR_POST metres (0 m is the cut). */
const POST = 10;
const MAJOR_POST = 50;
/** The scale cue spans the first verge interval past the cut: from POST to 2 × POST metres. */
const SCALE_FROM = POST;
const SCALE_TO = 2 * POST;
/** A car that has just merged slides across from the ramp over this long, s. Drawing only; the model moved it at once. */
export const MERGE_SLIDE_SECONDS = 1;

/** A press on a car still down after this much real time, and not moved further than HOLD_SLOP, holds its brake, ms. */
export const HOLD_THRESHOLD_MS = 200;
/** CSS px a press may wander before the hold engages; beyond it the press is a swipe (the page may scroll). */
export const HOLD_SLOP = 8;

/**
 * The time readout sits over the drawing's top-left corner. On the narrowest
 * phone (drawing ≈ 278 px) with a long time it covers about the first 36% of
 * the width and 10% of the height; the selection tab moves to the other side
 * of the road there so it never paints over it.
 */
function readoutCorner(track: Track): { x: number; y: number } {
  const h = track.halfView;
  return { x: -h + 0.355 * 2 * h, y: -h + 0.1 * 2 * h };
}

const degrees = (radians: number) => ((radians * 180) / Math.PI).toFixed(2);

function mainLane(sim: Simulation): Lane {
  return sim.track.lanes[0];
}

/**
 * Where a car's centre sits (half a vehicle length behind its front bumper)
 * and which way it points. For MERGE_SLIDE_SECONDS after a merge the car is
 * drawn sliding from where it would be on the ramp to where it is in the
 * main lane; the model itself moved it at once.
 */
function carPose(sim: Simulation, car: number): Pose {
  const lane = sim.track.lanes[sim.lane[car]];
  const centre = sim.position[car] - sim.road.vehicleLength / 2;
  const pose = poseAt(lane, centre);
  const { junction } = sim.track;
  const since = sim.time - sim.mergedAt[car];
  if (!junction || sim.lane[car] !== 0 || !(since >= 0 && since < MERGE_SLIDE_SECONDS)) return pose;
  const ramp = sim.track.lanes[1];
  const alongZone = positiveMod(centre - junction.zoneMainStart, lane.length);
  const onRamp = poseAt(ramp, Math.min(junction.zoneStart + alongZone / junction.zoneScale, ramp.length));
  const f = since / MERGE_SLIDE_SECONDS;
  const ease = f * f * (3 - 2 * f);
  return { x: onRamp.x + (pose.x - onRamp.x) * ease, y: onRamp.y + (pose.y - onRamp.y) * ease, heading: pose.heading };
}

function carTransform(sim: Simulation, car: number): string {
  const pose = carPose(sim, car);
  return `translate(${pose.x.toFixed(3)} ${pose.y.toFixed(3)}) rotate(${degrees(pose.heading)})`;
}

/** Window tint that stays visible on both ends of the speed scale. */
function glassFor(sim: Simulation, car: number, maxSpeed: number): string {
  return sim.speed[car] > maxSpeed * 0.55 ? "rgb(18 22 34 / 0.6)" : "rgb(255 255 255 / 0.62)";
}

/** Half-size of the upright number tab beside the selected car, m: wider for two digits. */
function tabHalf(car: number): { w: number; h: number } {
  return { w: car + 1 >= 10 ? 2.05 : 1.5, h: 1.5 };
}

type MarkerLayout = { pointer: string; pointerTransform: string; tabTransform: string; hideCutLabel: boolean; hideScale: boolean };

/** Where the "0 m" label sits: just before the cut, outside the verge. */
function cutLabelPoint(lane: Lane): { x: number; y: number } {
  const pose = offsetPose(poseAt(lane, lane.length - 0.8), -(LANE / 2 + 0.7));
  return { x: pose.x, y: pose.y };
}

/** Where the scale cue's "10 m" sits: outside the verge, midway between the two posts it spans. */
function scaleLabelPoint(lane: Lane): { x: number; y: number } {
  const pose = offsetPose(poseAt(lane, (SCALE_FROM + SCALE_TO) / 2), -(LANE / 2 + 2.7));
  return { x: pose.x, y: pose.y };
}

/**
 * The roadside selection marker: a pointer on the verge aimed at the car's
 * centre and an upright tab with its number, on the outer verge (the ring's
 * outside; for a ramp car, the side away from the ring) except where the
 * time readout covers the corner, where both move to the other side.
 */
function markerLayout(sim: Simulation, car: number): MarkerLayout {
  const pose = carPose(sim, car);
  // Sideways unit vector to the left of travel (the ring's outside), screen coordinates.
  const leftX = Math.sin(pose.heading);
  const leftY = -Math.cos(pose.heading);
  let side = sim.lane[car] === 1 ? -1 : 1;
  const { w, h } = tabHalf(car);
  const place = (distance: number) => ({ x: pose.x + side * distance * leftX, y: pose.y + side * distance * leftY });
  // Distance from the tab's centre to its edge facing the road.
  const support = w * Math.abs(leftX) + h * Math.abs(leftY);
  const edge = LANE / 2;
  let centre = place(edge + 1.05 - 0.1 + support);
  const corner = readoutCorner(sim.track);
  const covers = centre.x - w < corner.x && centre.y - h < corner.y;
  if (covers) {
    side = -side;
    centre = place(edge + 1.05 - 0.1 + support);
  }
  const tip = edge + 0.15;
  const base = edge + 1.05;
  const main = mainLane(sim);
  const cut = cutLabelPoint(main);
  // The label spans about 5.6 m by 3.2 m, anchored at its end; hide it only while the tab actually overlaps that box.
  const hideCutLabel = !covers && centre.x + w > cut.x - 5.6 && centre.x - w < cut.x && centre.y + h > cut.y - 3.2 && centre.y - h < cut.y + 0.5;
  const cue = scaleLabelPoint(main);
  const hideScale = !covers && Math.abs(centre.x - cue.x) < w + 3.4 && Math.abs(centre.y - cue.y) < h + 1.8;
  // The pointer is drawn along +x and rotated to point from the verge to the car.
  const pointerAngle = Math.atan2(side * leftY, side * leftX);
  return {
    pointer: `M${tip.toFixed(2)} 0L${base.toFixed(2)} -0.75L${base.toFixed(2)} 0.75Z`,
    pointerTransform: `translate(${pose.x.toFixed(3)} ${pose.y.toFixed(3)}) rotate(${degrees(pointerAngle)})`,
    tabTransform: `translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`,
    hideCutLabel,
    hideScale,
  };
}

type CarNode = { g: SVGGElement; body: SVGElement; glass: SVGElement; transform: string; fill: string; tint: string; braking: string; held: string; lane: string };

type Attributes = Record<string, string>;

/** Writes an attribute only when it changed since the last write through the same cache. */
function write(node: Element, cache: Attributes, name: string, value: string): void {
  if (cache[name] === value) return;
  cache[name] = value;
  node.setAttribute(name, value);
}

/**
 * Paints the current simulation state straight onto the drawing's SVG nodes,
 * so playback never re-renders React. Build one per simulation, after the
 * drawing for that simulation has rendered. `isHeld(car)` says whether the
 * experimenter's hold on that car is in force right now (`data-held`).
 */
export function createRingPainter(svg: SVGSVGElement, sim: Simulation, maxSpeed: number, isHeld: (car: number) => boolean): { paint(): void } {
  const nodes: CarNode[] = [];
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-car]")) {
    const body = g.querySelector<SVGElement>('[data-part="body"]');
    const glass = g.querySelector<SVGElement>('[data-part="glass"]');
    if (!body || !glass) continue;
    nodes[Number(g.dataset.car)] = { g, body, glass, transform: "", fill: "", tint: "", braking: "", held: "", lane: "" };
  }

  const pointer = svg.querySelector<SVGPathElement>('[data-part="pointer"]');
  const tab = svg.querySelector<SVGGElement>('[data-part="tab"]');
  const cutLabel = svg.querySelector<SVGTextElement>('[data-part="cut-label"]');
  const scale = svg.querySelector<SVGGElement>('[data-part="scale"]');
  const pointerCache: Attributes = {};
  const tabCache: Attributes = {};
  const cutCache: Attributes = {};
  const scaleCache: Attributes = {};

  let selected = -1;
  let selectedTransform = "";

  function findSelected(): number {
    if (selected >= 0 && nodes[selected]?.g.getAttribute("aria-pressed") === "true") return selected;
    for (let car = 0; car < nodes.length; car += 1) {
      if (nodes[car]?.g.getAttribute("aria-pressed") === "true") return car;
    }
    return -1;
  }

  return {
    paint() {
      for (let car = 0; car < sim.carCount; car += 1) {
        const node = nodes[car];
        if (!node) continue;
        const transform = carTransform(sim, car);
        if (transform !== node.transform) node.g.setAttribute("transform", (node.transform = transform));
        const fill = speedColour(sim.speed[car], maxSpeed);
        if (fill !== node.fill) node.body.setAttribute("fill", (node.fill = fill));
        const tint = glassFor(sim, car, maxSpeed);
        if (tint !== node.tint) node.glass.setAttribute("fill", (node.tint = tint));
        const braking = sim.brakeLight[car] ? "true" : "false";
        if (braking !== node.braking) node.g.setAttribute("data-braking", (node.braking = braking));
        const held = isHeld(car) ? "true" : "false";
        if (held !== node.held) node.g.setAttribute("data-held", (node.held = held));
        const lane = String(sim.lane[car]);
        if (lane !== node.lane) node.g.setAttribute("data-lane", (node.lane = lane));
      }

      const car = findSelected();
      if (car !== selected) {
        selected = car;
        selectedTransform = "";
        // React re-rendered the marker for the new car; forget what was written before.
        for (const cache of [pointerCache, tabCache, cutCache, scaleCache]) for (const key of Object.keys(cache)) delete cache[key];
      }
      if (car < 0) return;
      const transform = nodes[car]?.transform ?? "";
      if (transform !== selectedTransform) {
        selectedTransform = transform;
        const layout = markerLayout(sim, car);
        if (pointer) {
          write(pointer, pointerCache, "d", layout.pointer);
          write(pointer, pointerCache, "transform", layout.pointerTransform);
        }
        if (tab) write(tab, tabCache, "transform", layout.tabTransform);
        if (cutLabel) write(cutLabel, cutCache, "opacity", layout.hideCutLabel ? "0" : "1");
        if (scale) write(scale, scaleCache, "opacity", layout.hideScale ? "0" : "1");
      }
    },
  };
}

const f2 = (value: number) => value.toFixed(2);

/** A short line across the road at lane metre `s`, from `from` to `to` metres sideways (positive = right of travel). */
function across(lane: Lane, s: number, from: number, to: number): string {
  const a = offsetPose(poseAt(lane, s), from);
  const b = offsetPose(poseAt(lane, s), to);
  return `M${f2(a.x)} ${f2(a.y)}L${f2(b.x)} ${f2(b.y)}`;
}

/** Verge posts on the outer verge at every POST metres except the cut at 0 m, which has its own tick. */
function vergePosts(lane: Lane): { minor: string; major: string } {
  let minor = "";
  let major = "";
  for (let distance = POST; distance < lane.length - 1e-9; distance += POST) {
    const isMajor = Math.abs(distance % MAJOR_POST) < 1e-9;
    const segment = across(lane, distance, -(LANE / 2 + 0.3), -(LANE / 2 + (isMajor ? 2 : 1.2)));
    if (isMajor) major += segment;
    else minor += segment;
  }
  return { minor, major };
}

/** A travel-direction arrow just inside the main lane, around the 30 m mark. */
function directionArrow(lane: Lane): string {
  const inset = LANE / 2 + 2.2;
  const shaft = lanePath(lane, inset, 26, 36);
  const tip = offsetPose(poseAt(lane, 36), inset);
  const back = poseAt(lane, 34.2);
  const l = offsetPose(back, inset - 0.9);
  const r = offsetPose(back, inset + 0.9);
  return `${shaft}M${f2(l.x)} ${f2(l.y)}L${f2(tip.x)} ${f2(tip.y)}L${f2(r.x)} ${f2(r.y)}`;
}

/**
 * One car seen from above, pointing along +x, centred on the origin: a
 * squarer tail, a rounded slightly narrower nose, windscreen forward of the
 * middle and a smaller rear window, tyres at the axles, pale headlamps and
 * the brake lamps in the rear corners.
 */
function carShapes(length: number) {
  const half = length / 2;
  const w = BODY_WIDTH / 2;
  const f = (value: number) => value.toFixed(2);
  // Sides narrow slightly towards a rounded nose; the tail keeps small, square-ish corners.
  const front = w - 0.06;
  const body = [
    `M${f(-half + 0.3)} ${-w}`,
    `L${f(half - 1.15)} ${-front}`,
    `C${f(half - 0.35)} ${f(-front + 0.02)} ${half} ${f(-front + 0.3)} ${half} ${f(-front + 0.6)}`,
    `L${half} ${f(front - 0.6)}`,
    `C${half} ${f(front - 0.3)} ${f(half - 0.35)} ${f(front - 0.02)} ${f(half - 1.15)} ${front}`,
    `L${f(-half + 0.3)} ${w}`,
    `Q${-half} ${w} ${-half} ${f(w - 0.3)}`,
    `L${-half} ${f(-w + 0.3)}`,
    `Q${-half} ${-w} ${f(-half + 0.3)} ${-w}Z`,
  ].join("");
  // Windscreen (front edge bowed forwards) and a narrower rear window, one path so one tint.
  const screenBack = half - 1.85;
  const screenFront = half - 1.15;
  const rearFront = -half + 0.95;
  const rearBack = -half + 0.5;
  const glass = [
    `M${screenBack.toFixed(2)} -0.66L${screenFront.toFixed(2)} -0.74Q${(screenFront + 0.22).toFixed(2)} 0 ${screenFront.toFixed(2)} 0.74L${screenBack.toFixed(2)} 0.66Z`,
    `M${rearFront.toFixed(2)} -0.6L${rearBack.toFixed(2)} -0.64L${rearBack.toFixed(2)} 0.64L${rearFront.toFixed(2)} 0.6Z`,
  ].join("");
  const axles = [half - 1.15, -half + 1.05];
  return { half, w, body, glass, axles };
}

type RingViewProps = Readonly<{
  sim: Simulation;
  selected: number;
  /** Cars involved in a collision that froze the run, outlined in the error colour. */
  collided: readonly number[];
  maxSpeed: number;
  /** Lateral acceleration the drivers accept, for the bend speed labels (a live setting, so passed in to re-render). */
  cornering: number;
  onSelect: (car: number) => void;
  /** A press on `car` by `pointerId` has become a hold. Returns false if it could not (e.g. the run is frozen). */
  onHoldStart: (car: number, pointerId: number) => boolean;
  /** The hold by `pointerId` is over. Called at most once per successful `onHoldStart`. */
  onHoldEnd: (pointerId: number) => void;
  svgRef: RefObject<SVGSVGElement | null>;
}>;

type Press = { car: number; element: Element; x: number; y: number; timer: number; engaged: boolean };

/**
 * Press and hold on a car. Pressing selects at once; a press that stays down
 * for HOLD_THRESHOLD_MS within HOLD_SLOP becomes a hold. Before that, moving
 * further is a swipe and lets the page scroll. Once held, the pointer is
 * captured and the page neither scrolls nor offers a callout under it; every
 * way a press can end (up, cancel, lost capture, window blur, the tab going
 * hidden, a new simulation, unmounting) ends the hold.
 */
function useCarPress(
  svgRef: RefObject<SVGSVGElement | null>,
  sim: Simulation,
  onSelect: (car: number) => void,
  onHoldStart: RingViewProps["onHoldStart"],
  onHoldEnd: RingViewProps["onHoldEnd"],
) {
  const presses = useRef(new Map<number, Press>());
  const callbacks = useRef({ onHoldStart, onHoldEnd });
  useEffect(() => {
    callbacks.current = { onHoldStart, onHoldEnd };
  }, [onHoldStart, onHoldEnd]);

  const finish = useCallback((pointerId: number) => {
    const press = presses.current.get(pointerId);
    if (!press) return;
    presses.current.delete(pointerId);
    clearTimeout(press.timer);
    if (press.engaged) callbacks.current.onHoldEnd(pointerId);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const finishAll = () => {
      for (const pointerId of [...presses.current.keys()]) finish(pointerId);
    };
    const move = (event: PointerEvent) => {
      const press = presses.current.get(event.pointerId);
      if (press && !press.engaged && Math.hypot(event.clientX - press.x, event.clientY - press.y) > HOLD_SLOP) finish(event.pointerId);
    };
    const end = (event: PointerEvent) => finish(event.pointerId);
    const lost = (event: PointerEvent) => {
      // A touch is implicitly captured by the shape under it; moving that capture to the car is not the end of the press.
      if (presses.current.get(event.pointerId)?.element === event.target) finish(event.pointerId);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") finishAll();
    };
    const touchMove = (event: TouchEvent) => {
      if ([...presses.current.values()].some((press) => press.engaged)) event.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("lostpointercapture", lost);
    window.addEventListener("blur", finishAll);
    document.addEventListener("visibilitychange", hidden);
    svg?.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      finishAll();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", finishAll);
      document.removeEventListener("visibilitychange", hidden);
      svg?.removeEventListener("touchmove", touchMove);
    };
  }, [svgRef, sim, finish]);

  function pointerDown(event: ReactPointerEvent<SVGGElement>, car: number) {
    const { pointerId } = event;
    if (event.button !== 0 || presses.current.has(pointerId)) return;
    onSelect(car);
    const press: Press = { car, element: event.currentTarget, x: event.clientX, y: event.clientY, timer: 0, engaged: false };
    press.timer = window.setTimeout(() => {
      if (presses.current.get(pointerId) !== press) return;
      if (!callbacks.current.onHoldStart(car, pointerId)) {
        presses.current.delete(pointerId);
        return;
      }
      press.engaged = true;
      try {
        press.element.setPointerCapture(pointerId);
      } catch {
        // The pointer is already gone (or synthetic); the window listeners still see it end.
      }
    }, HOLD_THRESHOLD_MS);
    presses.current.set(pointerId, press);
  }

  /** No long-press menu or callout while a car is being pressed. */
  function contextMenu(event: { preventDefault(): void }) {
    if (presses.current.size > 0) event.preventDefault();
  }

  return { pointerDown, contextMenu };
}

function describeTrack(sim: Simulation): string {
  const main = mainLane(sim);
  const cars = `${sim.carCount} cars`;
  switch (sim.track.id) {
    case "b":
      return `B-shaped circuit, ${Math.round(main.length)} m round with five bends, with ${cars} driving up the spine and round the lobes`;
    case "merge":
      return `Ring road, ${Math.round(main.length)} m round, with an inner on-ramp that merges back in, with ${cars} driving clockwise`;
    default:
      return `Ring road, ${Math.round(main.length)} m round, with ${cars} driving clockwise`;
  }
}

/**
 * The track drawn to scale in metres. React renders the structure (and the
 * state at render time, so the server markup is already correct); the
 * playback loop then updates positions, colours and lights in place.
 */
export const RingView = memo(function RingView({ sim, selected, collided, maxSpeed, cornering, onSelect, onHoldStart, onHoldEnd, svgRef }: RingViewProps) {
  const glowId = `ptj-glow-${useId().replace(/[^\w-]/g, "")}`;
  const { track } = sim;
  const main = mainLane(sim);
  const half = track.halfView;
  const posts = vergePosts(main);
  const shapes = carShapes(sim.road.vehicleLength);
  const { half: carHalf, w } = shapes;
  const marker = selected >= 0 && selected < sim.carCount ? markerLayout(sim, selected) : null;
  const tab = tabHalf(selected);
  const press = useCarPress(svgRef, sim, onSelect, onHoldStart, onHoldEnd);
  const cut = cutLabelPoint(main);
  const cue = scaleLabelPoint(main);
  const { junction } = track;
  const ramp = junction ? track.lanes[1] : null;

  // Keep the drawing's labels a steady on-screen size whatever size it is drawn at (see --mpp in the CSS).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) svg.style.setProperty("--mpp", ((half * 2) / width).toFixed(4));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef, half]);

  /** Roving focus: only the selected car is a tab stop; arrows move to the car ahead or behind. */
  function keyDown(event: KeyboardEvent<SVGGElement>, car: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(car);
      return;
    }
    const ahead = event.key === "ArrowRight" || event.key === "ArrowUp";
    const behind = event.key === "ArrowLeft" || event.key === "ArrowDown";
    if (!ahead && !behind) return;
    event.preventDefault();
    const next = ahead ? sim.leader[car] : sim.leader.indexOf(car);
    if (next < 0 || next === car) return;
    onSelect(next);
    event.currentTarget.parentElement?.querySelector<SVGGElement>(`g[data-car="${next}"]`)?.focus();
  }

  return (
    <svg
      ref={svgRef}
      data-testid="ring"
      data-track={track.id}
      className={styles.ringSvg}
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      role="group"
      aria-label={describeTrack(sim)}
      onContextMenu={press.contextMenu}
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" className={styles.glowStop} stopOpacity="0.75" />
          <stop offset="0.5" className={styles.glowStop} stopOpacity="0.4" />
          <stop offset="1" className={styles.glowStop} stopOpacity="0" />
        </radialGradient>
      </defs>
      {track.lanes.map((lane) => (
        <g key={lane.index} data-part="lane" data-lane={lane.index}>
          <path d={lanePath(lane)} className={styles.lane} strokeWidth={LANE} />
          {/* Bends drivers slow for, with the speed they take them at. */}
          {cornerRanges(lane).map(([from, to]) => (
            <path key={from} data-part="corner" d={lanePath(lane, 0, from, to)} className={styles.corner} strokeWidth={LANE} />
          ))}
          <path d={lanePath(lane, -LANE / 2)} className={styles.kerb} />
          <path d={lanePath(lane, LANE / 2)} className={styles.kerb} />
        </g>
      ))}
      {ramp && junction ? (
        <g aria-hidden="true" data-part="junction">
          {/* The merge zone: a broken line between the lanes, and the ramp's end. */}
          <path d={lanePath(ramp, -LANE / 2, junction.zoneStart, junction.zoneEnd)} className={styles.zoneLine} />
          <path d={across(ramp, ramp.length, -LANE / 2, LANE / 2)} className={styles.laneEnd} />
          <path d={lanePath(ramp, 0, ramp.length - 2.5, ramp.length)} className={styles.laneEndFill} strokeWidth={LANE} />
        </g>
      ) : null}
      <g aria-hidden="true" data-part="bend-speeds">
        {track.lanes.flatMap((lane) =>
          cornerRanges(lane).map(([from, to]) => {
            const mid = (from + to) / 2;
            // On the inside of the bend, towards its centre.
            const curvature = lane.segments[lane.starts.indexOf(from)]?.curvature ?? 1;
            const at = offsetPose(poseAt(lane, mid), Math.sign(curvature) * (LANE / 2 + 2.4));
            return (
              <text key={`${lane.index}-${from}`} x={at.x.toFixed(2)} y={at.y.toFixed(2)} textAnchor="middle" dominantBaseline="central" className={styles.bendSpeed}>
                {Math.round(limitAt(lane, mid, cornering) * 3.6)}
              </text>
            );
          }),
        )}
      </g>
      <g aria-hidden="true">
        <path d={posts.minor} className={styles.post} />
        <path d={posts.major} className={styles.postMajor} />
      </g>
      {/* Where the road is cut to be unrolled into a straight line. */}
      <g className={styles.cut} aria-hidden="true">
        <path d={across(main, 0, -LANE / 2, LANE / 2)} className={styles.cutAcross} />
        <path d={across(main, 0, -(LANE / 2 + 0.3), -(LANE / 2 + 2.6))} className={styles.cutTick} />
        <text data-part="cut-label" x={cut.x.toFixed(2)} y={cut.y.toFixed(2)} textAnchor="end" className={styles.cutLabel} opacity={marker?.hideCutLabel ? 0 : 1}>
          0 m
        </text>
      </g>
      {/* Map-style scale: the verge posts are POST metres apart. */}
      <g data-part="scale" className={styles.scale} aria-hidden="true" opacity={marker?.hideScale ? 0 : 1}>
        <path d={`${across(main, SCALE_FROM, -(LANE / 2 + 0.3), -(LANE / 2 + 1.2))}${lanePath(main, -(LANE / 2 + 1.2), SCALE_FROM, SCALE_TO)}${across(main, SCALE_TO, -(LANE / 2 + 1.2), -(LANE / 2 + 0.3))}`} />
        <text x={cue.x.toFixed(2)} y={cue.y.toFixed(2)} textAnchor="middle" dominantBaseline="central">
          {SCALE_TO - SCALE_FROM} m
        </text>
      </g>
      <g className={styles.direction} aria-hidden="true">
        <path d={directionArrow(main)} />
      </g>
      <g>
        {Array.from({ length: sim.carCount }, (_, car) => {
          const isSelected = car === selected;
          return (
            <g
              key={car}
              data-car={car}
              data-lane={sim.lane[car]}
              data-braking={sim.brakeLight[car] ? "true" : "false"}
              className={styles.car}
              transform={carTransform(sim, car)}
              role="button"
              tabIndex={isSelected ? 0 : -1}
              aria-label={`Car ${car + 1}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(car)}
              onPointerDown={(event) => press.pointerDown(event, car)}
              onKeyDown={(event) => keyDown(event, car)}
            >
              {/* Generous across the lane; along it, 30 cars leave only 7.7 m each. */}
              <rect className={styles.hit} x={-carHalf - 1.2} y={-4} width={carHalf * 2 + 2.4} height={8} />
              <ellipse data-part="glow" className={styles.glow} cx={-carHalf - 0.35} cy="0" rx="1.75" ry="1.65" fill={`url(#${glowId})`} />
              <rect className={styles.shadow} x={-carHalf - 0.22} y={-w - 0.26} width={carHalf * 2 + 0.44} height={2 * w + 0.52} rx="0.75" />
              {collided.includes(car) ? (
                <rect className={styles.collided} x={-carHalf - 1.5} y={-w - 1.5} width={carHalf * 2 + 3} height={2 * w + 3} rx="1.7" />
              ) : null}
              <rect className={styles.held} x={-carHalf - 1.15} y={-w - 1.15} width={carHalf * 2 + 2.3} height={2 * w + 2.3} rx="1.5" />
              {isSelected ? <rect className={styles.halo} x={-carHalf - 0.9} y={-w - 0.9} width={carHalf * 2 + 1.8} height={2 * w + 1.8} rx="1.3" /> : null}
              <rect className={styles.focus} x={-carHalf - 1.6} y={-w - 1.6} width={carHalf * 2 + 3.2} height={2 * w + 3.2} rx="1.8" />
              {shapes.axles.flatMap((axle) =>
                [-1, 1].map((side) => (
                  <rect key={`${axle}${side}`} className={styles.tyre} x={axle - 0.36} y={side < 0 ? -w - 0.15 : w - 0.27} width="0.72" height="0.42" rx="0.12" />
                )),
              )}
              <path data-part="body" className={styles.body} d={shapes.body} fill={speedColour(sim.speed[car], maxSpeed)} />
              <path data-part="glass" d={shapes.glass} fill={glassFor(sim, car, maxSpeed)} />
              <ellipse className={styles.headlamp} cx={carHalf - 0.3} cy={-w + 0.47} rx="0.16" ry="0.22" />
              <ellipse className={styles.headlamp} cx={carHalf - 0.3} cy={w - 0.47} rx="0.16" ry="0.22" />
              <rect data-part="lamp" className={styles.lamp} x={-carHalf - 0.06} y={-w + 0.02} width="0.58" height="0.66" rx="0.16" />
              <rect data-part="lamp" className={styles.lamp} x={-carHalf - 0.06} y={w - 0.68} width="0.58" height="0.66" rx="0.16" />
            </g>
          );
        })}
      </g>
      {/* Always mounted (hidden only if nothing is selected) so the painter's node stays the live one. */}
      <g data-testid="selection-marker" className={styles.marker} aria-hidden="true" display={marker ? undefined : "none"}>
        <path data-part="pointer" d={marker?.pointer} transform={marker?.pointerTransform} />
        <g data-part="tab" transform={marker?.tabTransform}>
          <g className={styles.tabFace}>
            <rect x={-tab.w} y={-tab.h} width={tab.w * 2} height={tab.h * 2} rx={tab.h * 0.8} />
            <text textAnchor="middle" dy="0.36em">
              {selected + 1}
            </text>
          </g>
        </g>
      </g>
    </svg>
  );
});
