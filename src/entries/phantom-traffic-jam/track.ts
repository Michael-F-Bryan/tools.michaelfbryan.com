/**
 * Road geometry, kept apart from the cars' longitudinal state.
 *
 * A track is one or two lanes. A lane is a chain of segments, each a straight
 * or an arc of constant curvature, laid out in screen metres (x right, y
 * down). A car's state on a lane is a single number: metres along it. The
 * model measures gaps along lanes and never by straight-line distance, so two
 * parts of the road that pass close to each other (the B's waist and spine,
 * the ramp beside the ring) are as separate as they are to a driver.
 *
 * Curvature is positive for a clockwise turn on screen. Each arc says whether
 * it is a `corner`: a bend drivers slow for, with the speed they take it at
 * set by the lateral acceleration they accept (see `cornerLimit`). The ring
 * keeps the original idealisation of no cornering at all so its experiments
 * compare with the published ones; the B and the ramp have corners.
 */

export type TrackId = "ring" | "b" | "merge";

export type Pose = Readonly<{ x: number; y: number; heading: number }>;

export type Segment = Readonly<{
  length: number;
  /** 1/radius, signed; 0 for a straight. */
  curvature: number;
  /** Drivers treat this arc as a bend to slow for. */
  corner: boolean;
}>;

export type Lane = Readonly<{
  /** 0 is the main lane (the one the 0 m cut, the posts and the history's first panel belong to). */
  index: number;
  name: string;
  closed: boolean;
  segments: readonly Segment[];
  /** Pose at the start of each segment, plus one past the end. */
  poses: readonly Pose[];
  /** Metres along the lane at the start of each segment, plus the lane length last. */
  starts: readonly number[];
  length: number;
}>;

/**
 * How an open lane joins the main lane: cars reach it from the main lane at
 * `divergeAt` (main-lane metres) and leave it only by merging into the main
 * lane somewhere in the merge zone, which runs beside the main lane. In the
 * zone, ramp metres `s` sit beside main-lane metres `zoneMainStart + (s - zoneStart)`.
 */
export type Junction = Readonly<{
  divergeAt: number;
  zoneStart: number;
  zoneEnd: number;
  zoneMainStart: number;
  zoneMainEnd: number;
  /** Main-lane metres per ramp metre in the zone (the ramp runs on the inside of the bend, so it is shorter). */
  zoneScale: number;
}>;

export type Track = Readonly<{
  id: TrackId;
  label: string;
  lanes: readonly Lane[];
  /** Present when there is a ramp (lane 1). */
  junction?: Junction;
  /** Half the square viewBox in metres, and where to leave room for the legend. */
  halfView: number;
  legend: "centre" | "right";
}>;

/** Drawn lane width, m. The model has no width; it also sets how far the ramp sits beside the ring. */
export const LANE_WIDTH = 3.6;

/** Original ring: 230 m round after Sugiyama et al. (2008). */
export const RING_LENGTH = 230;
export const RING_RADIUS = RING_LENGTH / (2 * Math.PI);

/** The speed a driver takes a bend of curvature `curvature` at, accepting `lateral` m/s² sideways. */
export function cornerLimit(curvature: number, lateral: number): number {
  return Math.sqrt(lateral / Math.abs(curvature));
}

function buildLane(index: number, name: string, closed: boolean, start: Pose, segments: readonly Segment[]): Lane {
  const poses: Pose[] = [start];
  const starts: number[] = [0];
  let pose = start;
  let at = 0;
  for (const segment of segments) {
    pose = advancePose(pose, segment, segment.length);
    at += segment.length;
    poses.push(pose);
    starts.push(at);
  }
  return { index, name, closed, segments, poses, starts, length: at };
}

/** The pose `distance` metres into `segment` from `start`. */
function advancePose(start: Pose, segment: Segment, distance: number): Pose {
  const { x, y, heading } = start;
  if (segment.curvature === 0) {
    return { x: x + distance * Math.cos(heading), y: y + distance * Math.sin(heading), heading };
  }
  const r = 1 / segment.curvature;
  const cx = x - r * Math.sin(heading);
  const cy = y + r * Math.cos(heading);
  const turned = heading + segment.curvature * distance;
  return { x: cx + r * Math.sin(turned), y: cy - r * Math.cos(turned), heading: turned };
}

export function positiveMod(x: number, length: number): number {
  const r = x % length;
  return r < 0 ? r + length : r;
}

/** Index of the segment containing lane metre `s` (wrapped on a closed lane, clamped on an open one). */
export function segmentAt(lane: Lane, s: number): number {
  const at = lane.closed ? positiveMod(s, lane.length) : Math.min(Math.max(0, s), lane.length);
  let k = 0;
  while (k < lane.segments.length - 1 && at >= lane.starts[k + 1]) k += 1;
  return k;
}

/** Where lane metre `s` is on screen, and which way the road points there. */
export function poseAt(lane: Lane, s: number): Pose {
  const at = lane.closed ? positiveMod(s, lane.length) : Math.min(Math.max(0, s), lane.length);
  const k = segmentAt(lane, at);
  return advancePose(lane.poses[k], lane.segments[k], at - lane.starts[k]);
}

/** The pose offset sideways by `offset` metres (positive to the right of travel, towards a clockwise centre). */
export function offsetPose(pose: Pose, offset: number): Pose {
  return { x: pose.x - offset * Math.sin(pose.heading), y: pose.y + offset * Math.cos(pose.heading), heading: pose.heading };
}

export type Corner = Readonly<{ distance: number; length: number; limit: number }>;

/**
 * The corners a driver at lane metre `s` has to think about: the one they are
 * in (distance 0) and every one starting within `horizon` metres ahead, in
 * road order. Follows the lane round if it is closed, and stops at the end of
 * an open one.
 */
export function cornersAhead(lane: Lane, s: number, horizon: number, lateral: number): Corner[] {
  const out: Corner[] = [];
  const at = lane.closed ? positiveMod(s, lane.length) : Math.min(Math.max(0, s), lane.length);
  const count = lane.segments.length;
  const first = segmentAt(lane, at);
  for (let step = 0; step < count; step += 1) {
    const k = (first + step) % count;
    if (!lane.closed && first + step >= count) break;
    const segment = lane.segments[k];
    const startAt = lane.starts[k] + (first + step >= count ? lane.length : 0);
    const distance = Math.max(0, startAt - at);
    if (distance > horizon) break;
    if (segment.corner) {
      const remaining = step === 0 ? lane.starts[k] + segment.length - at : segment.length;
      out.push({ distance, length: remaining, limit: cornerLimit(segment.curvature, lateral) });
    }
  }
  return out;
}

/** Speed limit of the segment at `s`, or Infinity where there is none. */
export function limitAt(lane: Lane, s: number, lateral: number): number {
  const segment = lane.segments[segmentAt(lane, s)];
  return segment.corner ? cornerLimit(segment.curvature, lateral) : Infinity;
}

// --- The tracks -----------------------------------------------------------

const RING_START: Pose = { x: 0, y: -RING_RADIUS, heading: 0 };

function ringLane(): Lane {
  return buildLane(0, "ring", true, RING_START, [{ length: RING_LENGTH, curvature: 1 / RING_RADIUS, corner: false }]);
}

/** The original ring, 0 m at the top, driven clockwise, no cornering (one-dimensional, as published). */
export function ringTrack(): Track {
  return { id: "ring", label: "Ring", lanes: [ringLane()], halfView: 43.5, legend: "centre" };
}

/*
 * The B circuit, driven anticlockwise as written: up the spine, round the top
 * lobe, through the waist, round the bottom lobe and back. Radii in metres:
 * the lobes 20, the spine's corners 8, the waist 5.5. The waist passes 6.5 m
 * from the spine (centreline to centreline), so the two roads nearly touch
 * but are 100-odd metres apart by road.
 */
const B = { lobe: 20, corner: 8, waist: 5.5, shoulder: 9, neck: 5 } as const;

export function bTrack(): Track {
  const { lobe, corner, waist, shoulder, neck } = B;
  const spine = 4 * lobe + 2 * waist - 2 * corner;
  const quarter = (Math.PI / 2) * corner;
  const segments: Segment[] = [
    { length: spine, curvature: 0, corner: false },
    { length: quarter, curvature: 1 / corner, corner: true },
    { length: shoulder, curvature: 0, corner: false },
    { length: Math.PI * lobe, curvature: 1 / lobe, corner: true },
    { length: neck, curvature: 0, corner: false },
    { length: Math.PI * waist, curvature: -1 / waist, corner: true },
    { length: neck, curvature: 0, corner: false },
    { length: Math.PI * lobe, curvature: 1 / lobe, corner: true },
    { length: shoulder, curvature: 0, corner: false },
    { length: quarter, curvature: 1 / corner, corner: true },
  ];
  // Spine bottom; the B is 91 m tall and 37 m wide at the centreline, placed left of centre with the legend to its right.
  const start: Pose = { x: -40, y: (spine + 2 * corner) / 2 - corner, heading: -Math.PI / 2 };
  return { id: "b", label: "B circuit", lanes: [buildLane(0, "circuit", true, start, segments)], halfView: 49, legend: "right" };
}

/*
 * The ring with an inner on-ramp. Ramp users leave the ring at `divergeAt`,
 * cut across the inside on two 25 m bends and a straight, then run beside
 * the ring for `zoneLength` m of ring (the merge zone, where they may move
 * over) before their lane ends. The join is solved so the ramp arrives
 * exactly beside the ring, pointing the same way.
 */
const RAMP = { divergeAt: 45, zoneMainStart: 120, zoneLength: 60, bendRadius: 25 } as const;

export function mergeTrack(): Track {
  const ring = ringLane();
  const { divergeAt, zoneMainStart, zoneLength, bendRadius: r } = RAMP;
  const d = poseAt(ring, divergeAt);
  const beside = offsetPose(poseAt(ring, zoneMainStart), LANE_WIDTH);
  const sweep = (zoneMainStart - divergeAt) / RING_RADIUS;

  // Arc (radius r, angle psi1) + straight + arc (radius r, angle sweep - psi1) must end at `beside`,
  // heading as the ring does there. The first arc's angle is found by bisection on the sideways miss.
  const bend = (angle: number): Segment => ({ length: r * angle, curvature: 1 / r, corner: true });
  const miss = (psi1: number): { residual: number; straight: number } => {
    const afterFirst = advancePose(d, bend(psi1), r * psi1);
    const psi2 = sweep - psi1;
    // Displacement of the second arc, from a pose with heading `afterFirst.heading`.
    const origin: Pose = { x: 0, y: 0, heading: afterFirst.heading };
    const second = advancePose(origin, bend(psi2), r * psi2);
    const gx = beside.x - second.x - afterFirst.x;
    const gy = beside.y - second.y - afterFirst.y;
    const tx = Math.cos(afterFirst.heading);
    const ty = Math.sin(afterFirst.heading);
    return { straight: gx * tx + gy * ty, residual: gx * ty - gy * tx };
  };
  let low = 1e-6;
  let high = sweep - 1e-6;
  let lowMiss = miss(low).residual;
  if (Math.sign(lowMiss) === Math.sign(miss(high).residual)) throw new Error("ramp geometry does not close");
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const m = miss(mid).residual;
    if (Math.sign(m) === Math.sign(lowMiss)) {
      low = mid;
      lowMiss = m;
    } else high = mid;
  }
  const psi1 = (low + high) / 2;
  const { straight } = miss(psi1);
  if (!(straight > 0)) throw new Error("ramp geometry needs a straight of positive length");
  const psi2 = sweep - psi1;
  // Beside the ring on the inside, the zone covers the same angle in fewer metres.
  const zoneScale = RING_RADIUS / (RING_RADIUS - LANE_WIDTH);
  const segments: Segment[] = [
    bend(psi1),
    { length: straight, curvature: 0, corner: false },
    bend(psi2),
    { length: zoneLength / zoneScale, curvature: 1 / (RING_RADIUS - LANE_WIDTH), corner: false },
  ];
  const ramp = buildLane(1, "ramp", false, d, segments);
  const zoneStart = ramp.starts[3];
  return {
    id: "merge",
    label: "Merge",
    lanes: [ring, ramp],
    junction: { divergeAt, zoneStart, zoneEnd: ramp.length, zoneMainStart, zoneMainEnd: zoneMainStart + zoneLength, zoneScale },
    halfView: 43.5,
    legend: "centre",
  };
}

const TRACKS: Record<TrackId, () => Track> = { ring: ringTrack, b: bTrack, merge: mergeTrack };
const cache = new Map<TrackId, Track>();

/** The tracks are fixed, so each is built once. */
export function trackFor(id: TrackId): Track {
  let track = cache.get(id);
  if (!track) {
    track = TRACKS[id]();
    cache.set(id, track);
  }
  return track;
}

export const TRACK_IDS: readonly TrackId[] = ["ring", "b", "merge"];

// --- Drawing helpers --------------------------------------------------------

const f = (value: number) => value.toFixed(3);

/**
 * SVG path of a lane's centreline shifted `offset` metres sideways (kerbs are
 * ±LANE_WIDTH/2). Optionally only the metres from `from` to `to`.
 */
export function lanePath(lane: Lane, offset = 0, from = 0, to = lane.length): string {
  let d = "";
  const begin = offsetPose(poseAt(lane, from), offset);
  d += `M${f(begin.x)} ${f(begin.y)}`;
  for (let k = 0; k < lane.segments.length; k += 1) {
    const segment = lane.segments[k];
    const a = Math.max(from, lane.starts[k]);
    const b = Math.min(to, lane.starts[k] + segment.length);
    if (b <= a) continue;
    const end = offsetPose(advancePose(lane.poses[k], segment, b - lane.starts[k]), offset);
    if (segment.curvature === 0) {
      d += `L${f(end.x)} ${f(end.y)}`;
    } else {
      // A rightward offset moves towards a clockwise centre (smaller radius) and away from an anticlockwise one.
      const radius = Math.abs(1 / segment.curvature) - offset * Math.sign(segment.curvature);
      const angle = Math.abs(segment.curvature) * (b - a);
      const large = angle > Math.PI ? 1 : 0;
      const sweepFlag = segment.curvature > 0 ? 1 : 0;
      if (angle >= 2 * Math.PI - 1e-9) {
        // A full circle needs two arcs.
        const half = offsetPose(advancePose(lane.poses[k], segment, (a + b) / 2 - lane.starts[k]), offset);
        d += `A${f(radius)} ${f(radius)} 0 0 ${sweepFlag} ${f(half.x)} ${f(half.y)}A${f(radius)} ${f(radius)} 0 0 ${sweepFlag} ${f(end.x)} ${f(end.y)}`;
      } else {
        d += `A${f(radius)} ${f(radius)} 0 ${large} ${sweepFlag} ${f(end.x)} ${f(end.y)}`;
      }
    }
  }
  if (lane.closed && from === 0 && to === lane.length) d += "Z";
  return d;
}

/** The corner stretches of a lane as [from, to] metres, for shading. */
export function cornerRanges(lane: Lane): [number, number][] {
  return lane.segments.flatMap((segment, k) => (segment.corner ? [[lane.starts[k], lane.starts[k] + segment.length] as [number, number]] : []));
}
