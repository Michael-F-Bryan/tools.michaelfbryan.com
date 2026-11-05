/**
 * Tide Pool water model: a deliberately small, honest approximation, not CFD.
 *
 * Model
 * - The organism is one rigid body (centre of mass, heading, velocity, spin) whose
 *   appendages are kinematically driven: the controller prescribes every joint
 *   angle, and the body reacts only through water drag on the segments.
 * - Each segment is sampled at three points. At each point the relative water
 *   velocity is (ambient flow) - (body velocity + spin x r + joint-driven velocity),
 *   where the joint-driven part is a finite difference of last step's pose.
 * - Drag is anisotropic, linear + quadratic: pushing a segment sideways costs about
 *   ten times more than sliding it along its length. Reciprocal strokes cancel at low
 *   speed (linear drag), but the quadratic term makes a fast stroke push harder than
 *   a slow return, and feathering cuts the return-stroke area, so thrust emerges from
 *   skewed or feathered strokes and from travelling body waves. No forward-thrust
 *   parameter exists.
 * - Forces and torques sum about the centre of mass. The update is semi-implicit
 *   (velocity first, then position) with a diagonal drag Jacobian in the denominator
 *   so stiff, fast fins stay stable at the fixed step.
 *
 * Known limits: no added mass, no vorticity or wake interaction between parts, no
 * lift, no hydrodynamic coupling between organisms, and appendage reaction forces
 * exist only through drag. A little linear and angular damping, a speed cap and a
 * spin cap keep evolved bodies from exploiting numerical corners. Walls are soft
 * springs with a hard clamp as a last resort.
 *
 * `organism.velocity` is the centre-of-mass velocity (internal motion cannot move
 * the centre of mass by itself); `organism.position` is the root base (mouth).
 */
import { bodyMass, computePoses, poseBounds, poseCentroid, segmentMass, type Bounds } from "./body";
import { driveJoints } from "./controller";
import type { PartPose, StepOrganism, Vec2 } from "./types";

/** Tunable coefficients, exported so tests and tooling can report them. */
export const PHYSICS = {
  /** Normal-to-segment drag per unit length: force = visc * (linear + quadratic*|u|) * u. */
  normalLinear: 3.2,
  normalQuadratic: 0.5,
  /** Tangential drag is the normal drag divided by this. */
  anisotropy: 10,
  /** Fraction of segment width counted as head-on area when water flows along it. */
  endOnWidth: 0.5,
  /** Background damping (1/s) applied to velocity and spin. */
  linearDamping: 0.2,
  angularDamping: 0.5,
  maxSpeed: 160,
  maxSpin: 8,
  /** Wall spring (1/s^2 per unit penetration), margin from the wall, outward velocity bleed (1/s). */
  wallSpring: 300,
  wallMargin: 6,
  wallBleed: 8,
  trailInterval: 0.1,
  trailLength: 40,
} as const;

const SAMPLE_FRACTIONS = [1 / 6, 1 / 2, 5 / 6] as const;
const SAMPLE_WEIGHT = 1 / SAMPLE_FRACTIONS.length;

// Scratch storage, reused every step. Stepping is synchronous so sharing is safe.
const angles: number[] = [];
const dragScale: number[] = [];
const prevAngles: number[] = [];
const nextPoses: PartPose[] = [];
const comPrev: Vec2 = { x: 0, y: 0 };
const comNext: Vec2 = { x: 0, y: 0 };
const flowPoint: Vec2 = { x: 0, y: 0 };
const bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

function finiteOr(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function shiftPoses(poses: PartPose[], dx: number, dy: number): void {
  for (const p of poses) {
    p.base.x += dx;
    p.base.y += dy;
    p.tip.x += dx;
    p.tip.y += dy;
  }
}

export const stepOrganism: StepOrganism = (organism, water, dt) => {
  const genome = organism.genome;
  const parts = genome.parts;
  const n = parts.length;
  if (n === 0 || !(dt > 0)) return { work: 0 };

  const pos = organism.position;
  pos.x = finiteOr(pos.x, water.width / 2);
  pos.y = finiteOr(pos.y, water.height / 2);
  organism.heading = finiteOr(organism.heading, 0);
  organism.velocity.x = finiteOr(organism.velocity.x, 0);
  organism.velocity.y = finiteOr(organism.velocity.y, 0);
  organism.angularVelocity = finiteOr(organism.angularVelocity, 0);

  // 1. Joint angles for this step.
  driveJoints(organism, dt, angles, dragScale);

  // 2. Last step's poses ("prev"). Rebuild them if they are missing or the body was moved externally.
  const prev = organism.poses;
  if (prev.length !== n) {
    computePoses(genome, pos, organism.heading, angles, prev);
  } else if (
    Math.abs(prev[0].base.x - pos.x) > 1e-6 ||
    Math.abs(prev[0].base.y - pos.y) > 1e-6 ||
    Math.abs(prev[0].heading - organism.heading) > 1e-9
  ) {
    for (let i = 0; i < n; i++) prevAngles[i] = prev[i].jointAngle;
    computePoses(genome, pos, organism.heading, prevAngles, prev);
  }
  poseCentroid(genome, prev, comPrev);

  // 3. New joint angles on the old root: same rigid frame as "prev", so the
  //    difference is purely joint-driven motion. Work is billed from the same delta.
  const next = computePoses(genome, pos, organism.heading, angles, nextPoses);
  poseCentroid(genome, next, comNext);
  let work = 0;
  for (let i = 1; i < n; i++) {
    const part = parts[i];
    work += Math.abs(next[i].jointAngle - prev[i].jointAngle) * Math.max(0, part.length) * Math.max(0, part.width);
  }

  // 4. Drag forces and torques about the centre of mass.
  const visc = Math.max(0.05, finiteOr(water.env.viscosity, 1));
  const mass = Math.max(1e-3, bodyMass(genome));
  const vx = organism.velocity.x;
  const vy = organism.velocity.y;
  const omega = organism.angularVelocity;
  const invDt = 1 / dt;
  const { normalLinear, normalQuadratic, anisotropy, endOnWidth } = PHYSICS;
  let fx = 0;
  let fy = 0;
  let torque = 0;
  let inertia = 0.1 * mass;
  let dragK = 0; // diagonal Jacobian d|F|/d|u|, used to keep the update stable
  let spinK = 0;

  for (let i = 0; i < n; i++) {
    const part = parts[i];
    const a = next[i];
    const b = prev[i];
    const len = Math.max(0, part.length);
    const dx = a.tip.x - a.base.x;
    const dy = a.tip.y - a.base.y;
    const m = segmentMass(part);
    // Segment midpoint relative to the centre of mass, for inertia and the ambient-flow lookup.
    const mrx = (a.base.x + a.tip.x) * 0.5 - comNext.x;
    const mry = (a.base.y + a.tip.y) * 0.5 - comNext.y;
    inertia += m * (len * len / 12 + mrx * mrx + mry * mry);
    if (len < 1e-6) continue;

    const tx = dx / len;
    const ty = dy / len;
    flowPoint.x = comPrev.x + mrx;
    flowPoint.y = comPrev.y + mry;
    const flow = water.flowAt(flowPoint);
    const flowX = finiteOr(flow.x, 0);
    const flowY = finiteOr(flow.y, 0);

    const normalArea = visc * dragScale[i] * len * SAMPLE_WEIGHT;
    const tangentArea = visc * (len / anisotropy + endOnWidth * Math.max(0, part.width)) * SAMPLE_WEIGHT;

    for (const f of SAMPLE_FRACTIONS) {
      const rx = a.base.x + dx * f - comNext.x;
      const ry = a.base.y + dy * f - comNext.y;
      const rbx = b.base.x + (b.tip.x - b.base.x) * f - comPrev.x;
      const rby = b.base.y + (b.tip.y - b.base.y) * f - comPrev.y;
      // Segment velocity: translation + spin x r + joint-driven motion relative to the CoM.
      const sx = vx - omega * ry + (rx - rbx) * invDt;
      const sy = vy + omega * rx + (ry - rby) * invDt;
      const ux = flowX - sx;
      const uy = flowY - sy;
      const un = ux * -ty + uy * tx;
      const ut = ux * tx + uy * ty;
      const kn = normalArea * (normalLinear + normalQuadratic * Math.abs(un));
      const kt = tangentArea * (normalLinear + normalQuadratic * Math.abs(ut));
      const fn = kn * un;
      const ft = kt * ut;
      const gx = -ty * fn + tx * ft;
      const gy = tx * fn + ty * ft;
      fx += gx;
      fy += gy;
      torque += rx * gy - ry * gx;
      const jac = Math.max(
        normalArea * (normalLinear + 2 * normalQuadratic * Math.abs(un)),
        tangentArea * (normalLinear + 2 * normalQuadratic * Math.abs(ut)),
      );
      dragK += jac;
      spinK += jac * (rx * rx + ry * ry);
    }
  }

  // 5. Soft walls from the body's bounding box (shifted to where the body will be).
  poseBounds(next, bounds);
  const offX = comPrev.x - comNext.x;
  const offY = comPrev.y - comNext.y;
  const margin = PHYSICS.wallMargin;
  let ax = 0;
  let ay = 0;
  let bleedX = 0;
  let bleedY = 0;
  const minX = bounds.minX + offX;
  const maxX = bounds.maxX + offX;
  const minY = bounds.minY + offY;
  const maxY = bounds.maxY + offY;
  if (minX < margin) ax += PHYSICS.wallSpring * (margin - minX);
  if (maxX > water.width - margin) ax -= PHYSICS.wallSpring * (maxX - (water.width - margin));
  if (minY < margin) ay += PHYSICS.wallSpring * (margin - minY);
  if (maxY > water.height - margin) ay -= PHYSICS.wallSpring * (maxY - (water.height - margin));
  if (minX < margin && vx < 0) bleedX = PHYSICS.wallBleed;
  if (maxX > water.width - margin && vx > 0) bleedX = PHYSICS.wallBleed;
  if (minY < margin && vy < 0) bleedY = PHYSICS.wallBleed;
  if (maxY > water.height - margin && vy > 0) bleedY = PHYSICS.wallBleed;

  // 6. Semi-implicit integration of CoM velocity and spin.
  const linDen = mass + dt * dragK;
  const spinDen = inertia + dt * spinK;
  let nvx = vx + (dt * fx) / linDen + ax * dt;
  let nvy = vy + (dt * fy) / linDen + ay * dt;
  let nomega = omega + (dt * torque) / spinDen;
  const lin = 1 / (1 + dt * PHYSICS.linearDamping);
  nvx *= lin / (1 + dt * bleedX);
  nvy *= lin / (1 + dt * bleedY);
  nomega /= 1 + dt * PHYSICS.angularDamping;

  if (!Number.isFinite(nvx) || !Number.isFinite(nvy) || !Number.isFinite(nomega)) {
    nvx = 0;
    nvy = 0;
    nomega = 0;
  }
  const speed = Math.hypot(nvx, nvy);
  if (speed > PHYSICS.maxSpeed) {
    const k = PHYSICS.maxSpeed / speed;
    nvx *= k;
    nvy *= k;
  }
  nomega = Math.max(-PHYSICS.maxSpin, Math.min(PHYSICS.maxSpin, nomega));

  // 7. Advance the rigid body and rebuild final poses. The centre of mass moves by its
  //    own velocity only; the root base then sits wherever the new shape puts it.
  const heading = organism.heading + nomega * dt;
  const comX = comPrev.x + nvx * dt;
  const comY = comPrev.y + nvy * dt;
  const poses = organism.poses;
  computePoses(genome, pos, heading, angles, poses);
  poseCentroid(genome, poses, comNext);
  shiftPoses(poses, comX - comNext.x, comY - comNext.y);

  // Hard clamp: if the body still pokes through a wall, slide it back in and kill outward velocity.
  poseBounds(poses, bounds);
  let pushX = 0;
  let pushY = 0;
  if (bounds.minX < 0 && bounds.maxX <= water.width) pushX = -bounds.minX;
  else if (bounds.maxX > water.width && bounds.minX >= 0) pushX = water.width - bounds.maxX;
  if (bounds.minY < 0 && bounds.maxY <= water.height) pushY = -bounds.minY;
  else if (bounds.maxY > water.height && bounds.minY >= 0) pushY = water.height - bounds.maxY;
  if (pushX !== 0) {
    shiftPoses(poses, pushX, 0);
    if (pushX * nvx < 0) nvx = 0;
  }
  if (pushY !== 0) {
    shiftPoses(poses, 0, pushY);
    if (pushY * nvy < 0) nvy = 0;
  }

  pos.x = poses[0].base.x;
  pos.y = poses[0].base.y;
  organism.heading = heading;
  organism.velocity.x = nvx;
  organism.velocity.y = nvy;
  organism.angularVelocity = nomega;

  // 8. Senses (read by the controller next step), age and trail.
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (parts[i].kind !== "sensor") continue;
    const reading = water.scentAt(poses[i].tip);
    organism.senses[s++] = Number.isFinite(reading) ? Math.max(0, Math.min(1, reading)) : 0;
  }
  organism.senses.length = s;

  const before = organism.age;
  organism.age += dt;
  const interval = PHYSICS.trailInterval;
  if (Math.floor(organism.age / interval) > Math.floor(before / interval)) {
    organism.trail.push({ x: pos.x, y: pos.y });
    if (organism.trail.length > PHYSICS.trailLength) organism.trail.shift();
  }

  return { work: Number.isFinite(work) ? work : 0 };
};
