import { memo, type KeyboardEvent, type Ref } from "react";

import { speedColour } from "./speed-scale";
import styles from "./experiment.module.css";
import type { Simulation } from "./types";

/** Lane width, m. Only the drawing uses it; the model has one lane and no width. */
const LANE = 3.6;
/** Drawn car width, m (the model only knows length). */
const CAR_WIDTH = 1.9;
/** Half the viewBox, m: room for the ring, its verges and the cut label. */
const HALF_VIEW = 46;

function ringRadius(sim: Simulation): number {
  return sim.road.length / (2 * Math.PI);
}

/** Where a car's centre sits and which way it points. Positions are front bumpers; cars drive clockwise, position 0 at the top. */
function carTransform(sim: Simulation, car: number): string {
  const { length, vehicleLength } = sim.road;
  const radius = ringRadius(sim);
  const theta = ((sim.position[car] - vehicleLength / 2) / length) * 2 * Math.PI - Math.PI / 2;
  const x = radius * Math.cos(theta);
  const y = radius * Math.sin(theta);
  return `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${((theta * 180) / Math.PI + 90).toFixed(2)})`;
}

/** Windscreen tint that stays visible on both ends of the speed scale. */
function glassFor(sim: Simulation, car: number, maxSpeed: number): string {
  return sim.speed[car] > maxSpeed * 0.55 ? "rgb(18 22 34 / 0.6)" : "rgb(255 255 255 / 0.62)";
}

type CarNode = { g: SVGGElement; body: SVGElement; glass: SVGElement; transform: string; fill: string; tint: string; braking: string };

/**
 * Paints the current simulation state straight onto the ring's SVG nodes,
 * so playback never re-renders React. Build one per simulation, after the
 * ring for that simulation has rendered.
 */
export function createRingPainter(svg: SVGSVGElement, sim: Simulation, maxSpeed: number): { paint(): void } {
  const nodes: CarNode[] = [];
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-car]")) {
    const body = g.querySelector<SVGElement>('[data-part="body"]');
    const glass = g.querySelector<SVGElement>('[data-part="glass"]');
    if (!body || !glass) continue;
    nodes[Number(g.dataset.car)] = { g, body, glass, transform: "", fill: "", tint: "", braking: "" };
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
      }
    },
  };
}

function polar(radius: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return `${(radius * Math.cos(radians)).toFixed(3)} ${(radius * Math.sin(radians)).toFixed(3)}`;
}

type RingViewProps = Readonly<{
  sim: Simulation;
  selected: number;
  /** Cars involved in a collision that froze the run, outlined in the error colour. */
  collided: readonly number[];
  maxSpeed: number;
  onSelect: (car: number) => void;
  svgRef: Ref<SVGSVGElement>;
}>;

/**
 * The ring road drawn to scale in metres. React renders the structure (and
 * the state at render time, so the server markup is already correct); the
 * playback loop then updates positions, colours and lights in place.
 */
export const RingView = memo(function RingView({ sim, selected, collided, maxSpeed, onSelect, svgRef }: RingViewProps) {
  const radius = ringRadius(sim);
  const length = sim.road.vehicleLength;
  const outer = radius + LANE / 2;
  const inner = radius - LANE / 2;
  const arrow = inner - 2.2;

  function keyDown(event: KeyboardEvent<SVGGElement>, car: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(car);
    }
  }

  return (
    <svg
      ref={svgRef}
      data-testid="ring"
      className={styles.ringSvg}
      viewBox={`${-HALF_VIEW} ${-HALF_VIEW} ${HALF_VIEW * 2} ${HALF_VIEW * 2}`}
      role="group"
      aria-label={`Ring road, ${Math.round(sim.road.length)} m round, with ${sim.carCount} cars driving clockwise`}
    >
      <circle r={radius} className={styles.lane} strokeWidth={LANE} />
      <circle r={outer} className={styles.kerb} />
      <circle r={inner} className={styles.kerb} />
      {/* Where the road is cut to be unrolled into a straight line. */}
      <g className={styles.cut} aria-hidden="true">
        <line x1="0" x2="0" y1={-inner} y2={-outer} className={styles.cutAcross} />
        <line x1="0" x2="0" y1={-outer - 0.4} y2={-outer - 2.8} className={styles.cutTick} />
        <text x="0" y={-outer - 3.6} textAnchor="middle" className={styles.cutLabel}>
          0 m
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
              tabIndex={0}
              aria-label={`Car ${car + 1}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(car)}
              onKeyDown={(event) => keyDown(event, car)}
            >
              {/* Generous across the lane; along it, 30 cars leave only 7.7 m each. */}
              <rect className={styles.hit} x={-length / 2 - 1.2} y={-4} width={length + 2.4} height={8} />
              <ellipse className={styles.glow} cx={-length / 2} cy="0" rx="1.6" ry="1.9" />
              {collided.includes(car) ? (
                <rect className={styles.collided} x={-length / 2 - 1.5} y={-CAR_WIDTH / 2 - 1.5} width={length + 3} height={CAR_WIDTH + 3} rx="1.7" />
              ) : null}
              {isSelected ? (
                <rect className={styles.halo} x={-length / 2 - 0.85} y={-CAR_WIDTH / 2 - 0.85} width={length + 1.7} height={CAR_WIDTH + 1.7} rx="1.3" />
              ) : null}
              <rect className={styles.focus} x={-length / 2 - 1.6} y={-CAR_WIDTH / 2 - 1.6} width={length + 3.2} height={CAR_WIDTH + 3.2} rx="1.8" />
              <rect
                data-part="body"
                className={styles.body}
                x={-length / 2}
                y={-CAR_WIDTH / 2}
                width={length}
                height={CAR_WIDTH}
                rx="0.75"
                fill={speedColour(sim.speed[car], maxSpeed)}
              />
              <rect
                data-part="glass"
                x={length / 2 - 1.55}
                y={-CAR_WIDTH / 2 + 0.28}
                width="0.72"
                height={CAR_WIDTH - 0.56}
                rx="0.25"
                fill={glassFor(sim, car, maxSpeed)}
              />
              <rect className={styles.lamp} x={-length / 2 + 0.06} y={-CAR_WIDTH / 2 + 0.06} width="0.55" height="0.62" rx="0.18" />
              <rect className={styles.lamp} x={-length / 2 + 0.06} y={CAR_WIDTH / 2 - 0.68} width="0.55" height="0.62" rx="0.18" />
            </g>
          );
        })}
      </g>
    </svg>
  );
});
