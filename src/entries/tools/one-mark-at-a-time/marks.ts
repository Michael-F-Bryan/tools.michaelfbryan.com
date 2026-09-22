/**
 * The ink: a bicycle in outline, cut into discrete marks.
 *
 * Every mark is one crisp piece of ink — an arc of rim, a frame tube, a pair
 * of spokes — so a mark either is on the paper or is not. Nothing grows,
 * fades in or animates, because the moment a mark lands is the only thing the
 * visitor has to go on.
 *
 * The geometry is computed from one set of measurements rather than traced by
 * hand, so the proportions stay honest. The measurements are a road bicycle
 * scaled by 148 / 340 (wheel radius in drawing units over wheel radius in
 * millimetres): 990 mm wheelbase, 410 mm chainstay, 561 mm top tube, 73.5°
 * seat angle, 73° head angle, 45 mm fork rake, 172 mm cranks.
 */

type Point = Readonly<{ x: number; y: number }>;

/** Relative ink weights, from a spoke to a wheel rim. */
export const STROKE_WIDTHS = {
  hair: 3,
  thin: 4.5,
  line: 6,
  heavy: 8.5,
} as const;

type StrokeWeight = keyof typeof STROKE_WIDTHS;

export type Stroke = Readonly<{
  /** Stable identity, used as the React key and as a test hook. */
  id: string;
  /** Path data in the drawing's own coordinates. */
  d: string;
  weight: StrokeWeight;
}>;

const WHEEL_RADIUS = 148;
const REAR_HUB: Point = { x: 268, y: 402 };
const FRONT_HUB: Point = { x: 699, y: 402 };
const BOTTOM_BRACKET: Point = { x: 443, y: 433 };
const SEAT_CLUSTER: Point = { x: 368, y: 178 };
const HEAD_TOP: Point = { x: 612, y: 185 };
const HEAD_BOTTOM: Point = { x: 632, y: 250 };
const SEATPOST_TOP: Point = { x: 347, y: 108 };
const STEM_END: Point = { x: 644, y: 176 };
const CRANK_END: Point = { x: 486, y: 494 };
const CHAINRING_RADIUS = 44;
const COG_RADIUS = 20;
const HUB_RADIUS = 9;
const SPOKE_INSET = 7;

/** The drawing's coordinate window, framing the bicycle with an even margin. */
export const VIEW_BOX = "80 64 810 526";

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function polar(centre: Point, radius: number, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: centre.x + radius * Math.cos(radians),
    y: centre.y + radius * Math.sin(radians),
  };
}

function line(from: Point, to: Point): string {
  return `M ${round(from.x)} ${round(from.y)} L ${round(to.x)} ${round(to.y)}`;
}

/** An arc swept clockwise on screen from `fromDeg` to `toDeg` (0° is 3 o'clock). */
function arc(centre: Point, radius: number, fromDeg: number, toDeg: number): string {
  const from = polar(centre, radius, fromDeg);
  const to = polar(centre, radius, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${round(from.x)} ${round(from.y)} A ${radius} ${radius} 0 ${large} ${sweep} ${round(to.x)} ${round(to.y)}`;
}

function ring(centre: Point, radius: number): string {
  const left = { x: centre.x - radius, y: centre.y };
  const right = { x: centre.x + radius, y: centre.y };
  return (
    `M ${round(left.x)} ${round(left.y)}` +
    ` A ${radius} ${radius} 0 1 0 ${round(right.x)} ${round(right.y)}` +
    ` A ${radius} ${radius} 0 1 0 ${round(left.x)} ${round(left.y)}`
  );
}

/** A pair of opposed spokes drawn as one diameter through the hub. */
function spokePair(centre: Point, degrees: number): string {
  const radius = WHEEL_RADIUS - SPOKE_INSET;
  return line(polar(centre, radius, degrees), polar(centre, radius, degrees + 180));
}

/**
 * One of the two chain runs: the outer common tangent of the chainring and
 * the rear cog. `side` picks the upper (-1) or lower (+1) run.
 */
function chainRun(side: 1 | -1): string {
  const dx = BOTTOM_BRACKET.x - REAR_HUB.x;
  const dy = BOTTOM_BRACKET.y - REAR_HUB.y;
  const distance = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);
  // Tangency needs the shared unit normal n to satisfy
  // n · (chainring - cog) = r(cog) - r(chainring), hence the leading sign.
  const spread = Math.acos((COG_RADIUS - CHAINRING_RADIUS) / distance);
  const normal = bearing + side * spread;
  const offset: Point = { x: Math.cos(normal), y: Math.sin(normal) };

  return line(
    { x: REAR_HUB.x + COG_RADIUS * offset.x, y: REAR_HUB.y + COG_RADIUS * offset.y },
    {
      x: BOTTOM_BRACKET.x + CHAINRING_RADIUS * offset.x,
      y: BOTTOM_BRACKET.y + CHAINRING_RADIUS * offset.y,
    },
  );
}

const RIM_QUADRANTS = 4;

function rimArcs(centre: Point, phaseDeg: number, prefix: string): Stroke[] {
  const step = 360 / RIM_QUADRANTS;
  return Array.from({ length: RIM_QUADRANTS }, (_unused, index) => ({
    id: `${prefix}-rim-${index + 1}`,
    d: arc(centre, WHEEL_RADIUS, phaseDeg + index * step, phaseDeg + (index + 1) * step),
    weight: "heavy" as const,
  }));
}

const STROKES: readonly Stroke[] = [
  ...rimArcs(REAR_HUB, -112.5, "rear"),
  ...rimArcs(FRONT_HUB, -135, "front"),

  { id: "rear-hub", d: ring(REAR_HUB, HUB_RADIUS), weight: "line" },
  { id: "front-hub", d: ring(FRONT_HUB, HUB_RADIUS), weight: "line" },

  { id: "rear-spoke-1", d: spokePair(REAR_HUB, 18), weight: "hair" },
  { id: "rear-spoke-2", d: spokePair(REAR_HUB, 78), weight: "hair" },
  { id: "rear-spoke-3", d: spokePair(REAR_HUB, 138), weight: "hair" },
  { id: "front-spoke-1", d: spokePair(FRONT_HUB, 36), weight: "hair" },
  { id: "front-spoke-2", d: spokePair(FRONT_HUB, 96), weight: "hair" },
  { id: "front-spoke-3", d: spokePair(FRONT_HUB, 156), weight: "hair" },

  { id: "chain-stay", d: line(REAR_HUB, BOTTOM_BRACKET), weight: "line" },
  { id: "seat-stay", d: line(SEAT_CLUSTER, REAR_HUB), weight: "line" },
  { id: "seat-tube", d: line(BOTTOM_BRACKET, SEAT_CLUSTER), weight: "line" },
  { id: "top-tube", d: line(SEAT_CLUSTER, HEAD_TOP), weight: "line" },
  { id: "down-tube", d: line(BOTTOM_BRACKET, HEAD_BOTTOM), weight: "line" },
  { id: "head-tube", d: line(HEAD_BOTTOM, HEAD_TOP), weight: "line" },

  // The blade hugs the steering axis, then sweeps forward to the axle.
  { id: "fork", d: "M 632 250 Q 652 330 699 402", weight: "line" },

  { id: "seat-post", d: line(SEAT_CLUSTER, SEATPOST_TOP), weight: "line" },
  { id: "stem", d: line(HEAD_TOP, STEM_END), weight: "line" },

  { id: "chainring", d: ring(BOTTOM_BRACKET, CHAINRING_RADIUS), weight: "line" },
  { id: "cog", d: ring(REAR_HUB, COG_RADIUS), weight: "line" },
  { id: "crank", d: line(BOTTOM_BRACKET, CRANK_END), weight: "line" },
  { id: "pedal", d: "M 468 498 L 506 490", weight: "line" },

  { id: "chain-upper", d: chainRun(-1), weight: "thin" },
  { id: "chain-lower", d: chainRun(1), weight: "thin" },

  { id: "saddle", d: "M 296 116 C 302 106 322 102 346 105 C 374 109 398 120 416 132", weight: "line" },
  { id: "handlebar", d: "M 644 176 C 668 170 692 174 698 190 C 703 204 697 216 684 220", weight: "line" },
];

/**
 * The order the marks land in.
 *
 * Three things shape it.
 *
 * The subject has to become legible early, or nobody finishes: the rear rim
 * closes into a circle by the fourth mark, both wheels are there by the
 * eighth, and the frame closes into an unmistakable bicycle by the
 * fourteenth.
 *
 * Every mark has to be worth noticing while it is the timing that is
 * changing, so the faint hairline spokes are spread out rather than clustered,
 * and no two of them fall next to each other after the first six marks.
 *
 * The last three marks — the ones that land with the injected delay gone —
 * are a long fork blade, the saddle and the handlebar. Each is a single
 * decisive piece of ink, and the drawing is visibly unfinished without them.
 *
 * Nothing about the order tracks progress from one side of the drawing to the
 * other: there is no meter to read off it.
 */
const REVEAL_SEQUENCE: readonly string[] = [
  // The rear wheel closes into a circle, then the front one follows.
  "rear-rim-1",
  "rear-rim-2",
  "rear-rim-3",
  "rear-rim-4",
  "front-rim-1",
  "front-rim-2",
  "front-rim-3",
  "front-rim-4",
  // The frame arrives as a frame: five tubes, then the stay that closes it.
  "down-tube",
  "seat-tube",
  "top-tube",
  "head-tube",
  "chain-stay",
  "seat-stay",
  "rear-hub",
  "front-hub",
  // Transmission and fittings, alternating faint and solid.
  "rear-spoke-1",
  "chainring",
  "rear-spoke-2",
  "cog",
  "rear-spoke-3",
  "chain-upper",
  "front-spoke-1",
  "chain-lower",
  "front-spoke-2",
  "seat-post",
  "front-spoke-3",
  "stem",
  "crank",
  "pedal",
  // The three the drawing cannot do without.
  "fork",
  "saddle",
  "handlebar",
];

function ordered(): readonly Stroke[] {
  const byId = new Map(STROKES.map((stroke) => [stroke.id, stroke]));
  const marks = REVEAL_SEQUENCE.map((id) => {
    const stroke = byId.get(id);
    if (!stroke) {
      throw new Error(`Reveal sequence names an unknown stroke: ${id}`);
    }
    return stroke;
  });

  if (marks.length !== STROKES.length) {
    throw new Error(
      `The reveal sequence covers ${marks.length} of ${STROKES.length} strokes`,
    );
  }

  return marks;
}

/** Every mark, in the order it is revealed. */
export const MARKS: readonly Stroke[] = ordered();
