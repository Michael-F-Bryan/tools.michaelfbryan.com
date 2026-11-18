import { memo, useCallback, useEffect, useId, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { speedColour } from "./speed-scale";
import styles from "./ring-view.module.css";
import type { Simulation } from "./types";

/** Lane width, m. Only the drawing uses it; the model has one lane and no width. */
const LANE = 3.6;
/** Drawn body width, m (the model only knows length). The tyres stand just proud of it. */
const BODY_WIDTH = 1.84;
/**
 * Half the viewBox, m. The outermost things are the selection tab on the outer
 * verge (≤ 43.2 m from the centre at 3 and 9 o'clock) and the verge posts; the
 * cars themselves are drawn at true scale.
 */
const HALF_VIEW = 43.5;
/** Verge posts every POST metres, heavier every MAJOR_POST metres (0 m is the cut). */
const POST = 10;
const MAJOR_POST = 50;
/** The scale cue spans the first verge interval clockwise of the cut: from POST to 2 × POST metres. */
const SCALE_FROM = POST;
const SCALE_TO = 2 * POST;

/** A press on a car still down after this much real time, and not moved further than HOLD_SLOP, holds its brake, ms. */
export const HOLD_THRESHOLD_MS = 200;
/** CSS px a press may wander before the hold engages; beyond it the press is a swipe (the page may scroll). */
export const HOLD_SLOP = 8;

/**
 * The time readout sits over the ring's top-left corner. On the narrowest
 * phone (ring ≈ 278 px) with a long time it covers x < -13 m, y < -34.8 m of
 * this drawing; the selection tab moves inside the road there so it never
 * paints over it.
 */
const READOUT_CORNER = { x: -13, y: -34.8 } as const;

function ringRadius(sim: Simulation): number {
  return sim.road.length / (2 * Math.PI);
}

/** Angle (radians, from +x, clockwise on screen) of a point `distance` metres clockwise from the top of the ring. */
function angleAt(sim: Simulation, distance: number): number {
  return (distance / sim.road.length) * 2 * Math.PI - Math.PI / 2;
}

/** Where a car's centre sits: half a vehicle length behind its front bumper. */
function carAngle(sim: Simulation, car: number): number {
  return angleAt(sim, sim.position[car] - sim.road.vehicleLength / 2);
}

/** Where a car's centre sits and which way it points. Positions are front bumpers; cars drive clockwise, position 0 at the top. */
function carTransform(sim: Simulation, car: number): string {
  const radius = ringRadius(sim);
  const theta = carAngle(sim, car);
  const x = radius * Math.cos(theta);
  const y = radius * Math.sin(theta);
  return `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${((theta * 180) / Math.PI + 90).toFixed(2)})`;
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

/** Where the scale cue's "10 m" sits: outside the verge, midway between the two posts it spans. */
function scaleLabelPoint(sim: Simulation): { x: number; y: number } {
  const theta = angleAt(sim, (SCALE_FROM + SCALE_TO) / 2);
  const r = ringRadius(sim) + LANE / 2 + 2.7;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/**
 * The roadside selection marker: a pointer on the verge aimed at the car's
 * centre and an upright tab with its number, outside the kerb except where
 * the time readout covers the corner, where both sit just inside the road.
 */
function markerLayout(sim: Simulation, car: number): MarkerLayout {
  const radius = ringRadius(sim);
  const outer = radius + LANE / 2;
  const inner = radius - LANE / 2;
  const theta = carAngle(sim, car);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const { w, h } = tabHalf(car);
  // Distance from the tab's centre to its edge facing the ring.
  const support = w * Math.abs(cos) + h * Math.abs(sin);
  const place = (r: number) => ({ x: r * cos, y: r * sin });
  let tip = outer + 0.15;
  let base = outer + 1.05;
  let centre = place(base - 0.1 + support);
  const covers = centre.x - w < READOUT_CORNER.x && centre.y - h < READOUT_CORNER.y;
  if (covers) {
    tip = inner - 0.15;
    base = inner - 1.05;
    centre = place(base + 0.1 - support);
  }
  // The "0 m" label sits just left of the cut tick, above the outer kerb.
  // The label spans about x -5.6..0, y -42..-38.8; hide it only while the tab actually overlaps that box.
  const hideCutLabel = !covers && centre.x + w > -5.6 && centre.x - w < 0 && centre.y + h > -42 && centre.y - h < -38.8;
  const cue = scaleLabelPoint(sim);
  const hideScale = !covers && Math.abs(centre.x - cue.x) < w + 3.4 && Math.abs(centre.y - cue.y) < h + 1.8;
  return {
    pointer: `M${tip.toFixed(2)} 0L${base.toFixed(2)} -0.75L${base.toFixed(2)} 0.75Z`,
    pointerTransform: `rotate(${((theta * 180) / Math.PI).toFixed(2)})`,
    tabTransform: `translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`,
    hideCutLabel,
    hideScale,
  };
}

type CarNode = { g: SVGGElement; body: SVGElement; glass: SVGElement; transform: string; fill: string; tint: string; braking: string; held: string };

type Attributes = Record<string, string>;

/** Writes an attribute only when it changed since the last write through the same cache. */
function write(node: Element, cache: Attributes, name: string, value: string): void {
  if (cache[name] === value) return;
  cache[name] = value;
  node.setAttribute(name, value);
}

/**
 * Paints the current simulation state straight onto the ring's SVG nodes,
 * so playback never re-renders React. Build one per simulation, after the
 * ring for that simulation has rendered. `isHeld(car)` says whether the
 * experimenter's hold on that car is in force right now (`data-held`).
 */
export function createRingPainter(svg: SVGSVGElement, sim: Simulation, maxSpeed: number, isHeld: (car: number) => boolean): { paint(): void } {
  const nodes: CarNode[] = [];
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-car]")) {
    const body = g.querySelector<SVGElement>('[data-part="body"]');
    const glass = g.querySelector<SVGElement>('[data-part="glass"]');
    if (!body || !glass) continue;
    nodes[Number(g.dataset.car)] = { g, body, glass, transform: "", fill: "", tint: "", braking: "", held: "" };
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
  let selectedTheta = Number.NaN;

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
      }

      const car = findSelected();
      if (car !== selected) {
        selected = car;
        selectedTheta = Number.NaN;
        // React re-rendered the marker for the new car; forget what was written before.
        for (const cache of [pointerCache, tabCache, cutCache, scaleCache]) for (const key of Object.keys(cache)) delete cache[key];
      }
      if (car < 0) return;
      const theta = carAngle(sim, car);
      if (theta !== selectedTheta) {
        selectedTheta = theta;
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

function polar(radius: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return `${(radius * Math.cos(radians)).toFixed(3)} ${(radius * Math.sin(radians)).toFixed(3)}`;
}

function arcPoint(radius: number, theta: number): string {
  return `${(radius * Math.cos(theta)).toFixed(2)} ${(radius * Math.sin(theta)).toFixed(2)}`;
}

/** Radial verge posts at every POST metres except the cut at 0 m, which has its own tick. */
function vergePosts(sim: Simulation, outer: number): { minor: string; major: string } {
  let minor = "";
  let major = "";
  for (let distance = POST; distance < sim.road.length - 1e-9; distance += POST) {
    const theta = angleAt(sim, distance);
    const isMajor = Math.abs(distance % MAJOR_POST) < 1e-9;
    const segment = `M${arcPoint(outer + 0.3, theta)}L${arcPoint(outer + (isMajor ? 2 : 1.2), theta)}`;
    if (isMajor) major += segment;
    else minor += segment;
  }
  return { minor, major };
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

/**
 * The ring road drawn to scale in metres. React renders the structure (and
 * the state at render time, so the server markup is already correct); the
 * playback loop then updates positions, colours and lights in place.
 */
export const RingView = memo(function RingView({ sim, selected, collided, maxSpeed, onSelect, onHoldStart, onHoldEnd, svgRef }: RingViewProps) {
  const glowId = `ptj-glow-${useId().replace(/[^\w-]/g, "")}`;
  const radius = ringRadius(sim);
  const outer = radius + LANE / 2;
  const inner = radius - LANE / 2;
  const arrow = inner - 2.2;
  const posts = vergePosts(sim, outer);
  const shapes = carShapes(sim.road.vehicleLength);
  const { half, w } = shapes;
  const marker = selected >= 0 && selected < sim.carCount ? markerLayout(sim, selected) : null;
  const tab = tabHalf(selected);
  const press = useCarPress(svgRef, sim, onSelect, onHoldStart, onHoldEnd);
  const scaleArc = outer + 1.2;
  const scaleFrom = angleAt(sim, SCALE_FROM);
  const scaleTo = angleAt(sim, SCALE_TO);
  const cue = scaleLabelPoint(sim);

  // Keep the ring's labels a steady on-screen size whatever size the ring is drawn at (see --mpp in the CSS).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) svg.style.setProperty("--mpp", ((HALF_VIEW * 2) / width).toFixed(4));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef]);

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
    if (next < 0) return;
    onSelect(next);
    event.currentTarget.parentElement?.querySelector<SVGGElement>(`g[data-car="${next}"]`)?.focus();
  }

  return (
    <svg
      ref={svgRef}
      data-testid="ring"
      className={styles.ringSvg}
      viewBox={`${-HALF_VIEW} ${-HALF_VIEW} ${HALF_VIEW * 2} ${HALF_VIEW * 2}`}
      role="group"
      aria-label={`Ring road, ${Math.round(sim.road.length)} m round, with ${sim.carCount} cars driving clockwise`}
      onContextMenu={press.contextMenu}
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" className={styles.glowStop} stopOpacity="0.75" />
          <stop offset="0.5" className={styles.glowStop} stopOpacity="0.4" />
          <stop offset="1" className={styles.glowStop} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r={radius} className={styles.lane} strokeWidth={LANE} />
      <circle r={outer} className={styles.kerb} />
      <circle r={inner} className={styles.kerb} />
      <g aria-hidden="true">
        <path d={posts.minor} className={styles.post} />
        <path d={posts.major} className={styles.postMajor} />
      </g>
      {/* Where the road is cut to be unrolled into a straight line. */}
      <g className={styles.cut} aria-hidden="true">
        <line x1="0" x2="0" y1={-inner} y2={-outer} className={styles.cutAcross} />
        <line x1="0" x2="0" y1={-outer - 0.3} y2={-outer - 2.6} className={styles.cutTick} />
        <text data-part="cut-label" x="-0.8" y={-outer - 0.7} textAnchor="end" className={styles.cutLabel} opacity={marker?.hideCutLabel ? 0 : 1}>
          0 m
        </text>
      </g>
      {/* Map-style scale: the verge posts are POST metres apart. */}
      <g data-part="scale" className={styles.scale} aria-hidden="true" opacity={marker?.hideScale ? 0 : 1}>
        <path d={`M${arcPoint(outer + 0.3, scaleFrom)}L${arcPoint(scaleArc, scaleFrom)}A${scaleArc} ${scaleArc} 0 0 1 ${arcPoint(scaleArc, scaleTo)}L${arcPoint(outer + 0.3, scaleTo)}`} />
        <text x={cue.x.toFixed(2)} y={cue.y.toFixed(2)} textAnchor="middle" dominantBaseline="central">
          {SCALE_TO - SCALE_FROM} m
        </text>
      </g>
      <g className={styles.direction} aria-hidden="true">
        <path d={`M${polar(arrow, -84)} A${arrow} ${arrow} 0 0 1 ${polar(arrow, -66)}`} />
        <path d={`M${polar(arrow - 0.9, -68.5)} L${polar(arrow, -66)} L${polar(arrow + 0.9, -68.5)}`} />
      </g>
      <g>
        {Array.from({ length: sim.carCount }, (_, car) => {
          const isSelected = car === selected;
          return (
            <g
              key={car}
              data-car={car}
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
              <rect className={styles.hit} x={-half - 1.2} y={-4} width={half * 2 + 2.4} height={8} />
              <ellipse data-part="glow" className={styles.glow} cx={-half - 0.35} cy="0" rx="1.75" ry="1.65" fill={`url(#${glowId})`} />
              <rect className={styles.shadow} x={-half - 0.22} y={-w - 0.26} width={half * 2 + 0.44} height={2 * w + 0.52} rx="0.75" />
              {collided.includes(car) ? (
                <rect className={styles.collided} x={-half - 1.5} y={-w - 1.5} width={half * 2 + 3} height={2 * w + 3} rx="1.7" />
              ) : null}
              <rect className={styles.held} x={-half - 1.15} y={-w - 1.15} width={half * 2 + 2.3} height={2 * w + 2.3} rx="1.5" />
              {isSelected ? <rect className={styles.halo} x={-half - 0.9} y={-w - 0.9} width={half * 2 + 1.8} height={2 * w + 1.8} rx="1.3" /> : null}
              <rect className={styles.focus} x={-half - 1.6} y={-w - 1.6} width={half * 2 + 3.2} height={2 * w + 3.2} rx="1.8" />
              {shapes.axles.flatMap((axle) =>
                [-1, 1].map((side) => (
                  <rect key={`${axle}${side}`} className={styles.tyre} x={axle - 0.36} y={side < 0 ? -w - 0.15 : w - 0.27} width="0.72" height="0.42" rx="0.12" />
                )),
              )}
              <path data-part="body" className={styles.body} d={shapes.body} fill={speedColour(sim.speed[car], maxSpeed)} />
              <path data-part="glass" d={shapes.glass} fill={glassFor(sim, car, maxSpeed)} />
              <ellipse className={styles.headlamp} cx={half - 0.3} cy={-w + 0.47} rx="0.16" ry="0.22" />
              <ellipse className={styles.headlamp} cx={half - 0.3} cy={w - 0.47} rx="0.16" ry="0.22" />
              <rect data-part="lamp" className={styles.lamp} x={-half - 0.06} y={-w + 0.02} width="0.58" height="0.66" rx="0.16" />
              <rect data-part="lamp" className={styles.lamp} x={-half - 0.06} y={w - 0.68} width="0.58" height="0.66" rx="0.16" />
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
