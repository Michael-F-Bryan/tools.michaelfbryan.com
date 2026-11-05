/**
 * Body kinematics: genome + root pose + joint angles -> world-space segment poses.
 *
 * Conventions (screen space, y down, so a positive angle turns clockwise on screen):
 * - A segment points along (cos h, sin h). Its "right" normal is (-sin h, cos h).
 * - A part attaches to its parent at fraction `anchor` along the parent, offset
 *   sideways by `side * parent.width / 2` (side 0 = inline, no offset).
 * - The part's heading is the parent's heading plus the joint angle, with the sign
 *   mirrored for side = -1 so left and right fins with the same gene are symmetric.
 *
 * Everything here is pure and writes into caller-supplied output objects so the
 * physics loop does not allocate.
 */
import type { Genome, PartGene, PartPose, Vec2 } from "./types";

/** Mass of a sensor stalk/bulb, in the same units as segment area. */
export const SENSOR_MASS = 0.5;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Mass of one part: segment area for trunk/fin, a small constant for sensors. */
export function segmentMass(part: PartGene): number {
  if (part.kind === "sensor") return SENSOR_MASS;
  return Math.max(0, part.length) * Math.max(0, part.width);
}

export function bodyMass(genome: Genome): number {
  let total = 0;
  for (const part of genome.parts) total += segmentMass(part);
  return total;
}

export function makePose(): PartPose {
  return { base: { x: 0, y: 0 }, tip: { x: 0, y: 0 }, jointAngle: 0, heading: 0 };
}

/** Rest joint angles (no oscillation) for drawing static glyphs. */
export function restAngles(genome: Genome, out: number[] = []): number[] {
  out.length = genome.parts.length;
  for (let i = 0; i < out.length; i++) out[i] = i === 0 ? 0 : finite(genome.parts[i].angle, 0);
  return out;
}

const cosScratch: number[] = [];
const sinScratch: number[] = [];

/**
 * Compute every part's pose. `angles[i]` is the full joint angle for part i
 * (rest + oscillation, un-mirrored); `angles[0]` is ignored. `out` is reused and
 * resized, so pass the same array every step.
 */
export function computePoses(
  genome: Genome,
  root: Vec2,
  heading: number,
  angles: ArrayLike<number>,
  out: PartPose[],
): PartPose[] {
  const parts = genome.parts;
  const n = parts.length;
  while (out.length < n) out.push(makePose());
  out.length = n;
  for (let i = 0; i < n; i++) {
    const gene = parts[i];
    const pose = out[i];
    let h: number;
    if (i === 0) {
      pose.base.x = root.x;
      pose.base.y = root.y;
      pose.jointAngle = 0;
      h = heading;
    } else {
      // Invalid parent indices fall back to the root so a bad mutation cannot crash.
      const pi = gene.parent >= 0 && gene.parent < i ? gene.parent : 0;
      const parent = out[pi];
      const parentGene = parts[pi];
      const pc = cosScratch[pi];
      const ps = sinScratch[pi];
      const along = clamp01(finite(gene.anchor, 0)) * Math.max(0, parentGene.length);
      const side = gene.side;
      const across = side * Math.max(0, parentGene.width) * 0.5;
      pose.base.x = parent.base.x + pc * along - ps * across;
      pose.base.y = parent.base.y + ps * along + pc * across;
      const a = finite(angles[i], gene.angle);
      pose.jointAngle = a;
      h = parent.heading + (side < 0 ? -a : a);
    }
    const c = Math.cos(h);
    const s = Math.sin(h);
    cosScratch[i] = c;
    sinScratch[i] = s;
    pose.heading = h;
    const len = Math.max(0, gene.length);
    pose.tip.x = pose.base.x + c * len;
    pose.tip.y = pose.base.y + s * len;
  }
  return out;
}

/** Mass-weighted centroid of segment midpoints. Falls back to the root base for a massless body. */
export function poseCentroid(genome: Genome, poses: readonly PartPose[], out: Vec2): Vec2 {
  const parts = genome.parts;
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const m = segmentMass(parts[i]);
    const p = poses[i];
    sx += m * (p.base.x + p.tip.x) * 0.5;
    sy += m * (p.base.y + p.tip.y) * 0.5;
    total += m;
  }
  if (total > 1e-9) {
    out.x = sx / total;
    out.y = sy / total;
  } else {
    out.x = poses[0].base.x;
    out.y = poses[0].base.y;
  }
  return out;
}

/** Axis-aligned bounds of every base and tip. */
export function poseBounds(poses: readonly PartPose[], out: Bounds): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poses) {
    minX = Math.min(minX, p.base.x, p.tip.x);
    maxX = Math.max(maxX, p.base.x, p.tip.x);
    minY = Math.min(minY, p.base.y, p.tip.y);
    maxY = Math.max(maxY, p.base.y, p.tip.y);
  }
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;
  return out;
}

/** Point at fraction `f` along a pose's segment. */
export function pointAlong(pose: PartPose, f: number, out: Vec2): Vec2 {
  out.x = pose.base.x + (pose.tip.x - pose.base.x) * f;
  out.y = pose.base.y + (pose.tip.y - pose.base.y) * f;
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}
