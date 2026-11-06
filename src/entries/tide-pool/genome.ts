import type { Genome, PartGene, PartKind } from "./types";
import type { Rng } from "./random";

/** Mutation knobs. Probabilities are per call to `mutate` and are independent. */
export const MUTATION = {
  /** Gaussian small tweaks of lengths, widths, angles and oscillators. The common case. */
  perturb: 0.85,
  /** Tweak sensorimotor weights. */
  weights: 0.35,
  /** Move a part along its parent / change side / rest angle (not a topology change). */
  reattach: 0.05,
  /** Structural operators; each one changes topology (new lineage). */
  addPart: 0.05,
  removePart: 0.04,
  changeKind: 0.03,
  /** Copy a side-attached subtree to the other side (bilateral pairs, whole mirrored limbs). */
  duplicateMirrored: 0.07,
  /** Fan out N copies of a side part around one anchor with a travelling phase lag (radial / metachronal). */
  repeatRadial: 0.03,
  /** Hue drift in degrees (uniform ±) per ordinary / per topology-changing mutation. */
  hueDrift: 4,
  hueJump: 25,
};

export const MAX_PARTS = 14;
export const MAX_SENSORS = 4;
/** Mass contributed by each sensor on top of the segment area. body.ts imports this so energy mass == physics mass. */
export const SENSOR_MASS = 2;

type Range = { min: number; max: number };
const SIZE: Record<PartKind, { length: Range; width: Range }> = {
  trunk: { length: { min: 4, max: 60 }, width: { min: 2, max: 16 } },
  fin: { length: { min: 4, max: 60 }, width: { min: 2, max: 16 } },
  // Scent cells are ~10 units wide, so a stalk must be able to reach well past that to sample a different cell.
  sensor: { length: { min: 3, max: 25 }, width: { min: 1, max: 2 } },
};
const WEIGHT_LIMIT = 2;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a: number) => {
  const w = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return w;
};
const wrapPhase = (p: number) => ((p % TAU) + TAU) % TAU;
const wrapHue = (h: number) => ((h % 360) + 360) % 360;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function sensorCount(genome: Genome): number {
  let n = 0;
  for (const p of genome.parts) if (p.kind === "sensor") n++;
  return n;
}

/** Body mass: total trunk/fin area plus a small constant per sensor. */
export function genomeMass(genome: Genome): number {
  let mass = 0;
  for (const p of genome.parts) mass += p.kind === "sensor" ? SENSOR_MASS : p.length * p.width;
  return mass;
}

/** Returns a description of the first problem found, or null if the genome is valid. */
export function validateGenome(genome: Genome): string | null {
  const parts = genome.parts;
  if (parts.length === 0 || parts.length > MAX_PARTS) return "part count out of range";
  if (!Number.isFinite(genome.hue) || genome.hue < 0 || genome.hue >= 360) return "bad hue";
  if (!(genome.reproduceAt >= 0.5 && genome.reproduceAt <= 1)) return "bad reproduceAt";
  if (parts[0].kind !== "trunk" || parts[0].parent !== -1) return "root must be a parentless trunk";
  const sensors = sensorCount(genome);
  if (sensors > MAX_SENSORS) return "too many sensors";
  const ids = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (ids.has(p.id)) return `duplicate id at ${i}`;
    ids.add(p.id);
    if (i > 0) {
      if (!Number.isInteger(p.parent) || p.parent < 0 || p.parent >= i) return `bad parent at ${i}`;
      if (parts[p.parent].kind === "sensor") return `sensor parent at ${i}`;
    }
    if (![-1, 0, 1].includes(p.side)) return `bad side at ${i}`;
    const numbers = [p.anchor, p.angle, p.length, p.width, p.frequency, p.amplitude, p.phase, p.skew, p.feather];
    if (!numbers.every(Number.isFinite)) return `non-finite value at ${i}`;
    if (p.anchor < 0 || p.anchor > 1) return `anchor range at ${i}`;
    if (p.length <= 0 || p.width <= 0) return `size at ${i}`;
    if (p.skew <= 0 || p.skew >= 1 || p.feather < 0 || p.feather >= 1 || p.amplitude < 0) return `oscillator at ${i}`;
    for (const w of [p.ampWeights, p.freqWeights]) {
      if (w.length !== 2 * sensors + 1) return `weights misaligned at ${i}`;
      if (!w.every(Number.isFinite)) return `non-finite weight at ${i}`;
    }
  }
  return null;
}

/** Short readable summary, e.g. "3 segments, 2 fins, 1 sensor · undulating, sensing". */
export function describeGenome(genome: Genome): string {
  const count = (k: PartKind) => genome.parts.filter(p => p.kind === k).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const counts = [
    plural(count("trunk"), "segment", "segments"),
    plural(count("fin"), "fin", "fins"),
    plural(count("sensor"), "sensor", "sensors"),
  ].join(", ");
  const moves = (p: PartGene) => p.amplitude > 0.15;
  const undulates = genome.parts.some((p, i) => i > 0 && p.kind === "trunk" && moves(p) && genome.parts[p.parent].kind === "trunk");
  const paddles = genome.parts.some(p => p.kind === "fin" && moves(p));
  const traits = [undulates ? "undulating" : paddles ? "paddling" : "drifting"];
  if (count("sensor") > 0) traits.push("sensing");
  return `${counts} · ${traits.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

function clonePart(p: PartGene): PartGene {
  return { ...p, ampWeights: p.ampWeights.slice(), freqWeights: p.freqWeights.slice() };
}

function cloneGenome(g: Genome): Genome {
  return { parts: g.parts.map(clonePart), hue: g.hue, reproduceAt: g.reproduceAt };
}

function sensorIds(parts: readonly PartGene[]): number[] {
  return parts.filter(p => p.kind === "sensor").map(p => p.id);
}

function pickKind(rng: Rng): PartKind {
  const r = rng.float();
  return r < 0.35 ? "trunk" : r < 0.8 ? "fin" : "sensor";
}

/** Founders keep the original wild oscillator so the seeded population can still swim (inept but viable-ish). */
function randomOscillator(rng: Rng) {
  return {
    frequency: rng.range(0.5, 3),
    amplitude: rng.range(0, 1.2),
    phase: rng.range(0, TAU),
    skew: rng.range(0.3, 0.7),
    feather: rng.range(0, 0.6),
  };
}

const isMover = (p: PartGene) => p.kind !== "sensor" && p.parent !== -1;

/**
 * Near-neutral, coherent oscillator for a freshly added part: it inherits the rhythm of its
 * parent (or a sibling, or the body's mean) so an addition starts as a small, in-step
 * wobble rather than random thrash, and selection can then tune it. Fins are born with an
 * asymmetric stroke (skew away from 0.5, some feather) because a symmetric unfeathered
 * stroke gives no thrust. Later perturbation mutations remain free to explore.
 */
function coherentOscillator(rng: Rng, kind: PartKind, parent: number, parts: readonly PartGene[]) {
  const par = parts[parent];
  const siblings = parts.filter(p => p.parent === parent && isMover(p));
  const kin = par && isMover(par) ? par : siblings.length > 0 ? rng.pick(siblings) : undefined;
  const movers = parts.filter(isMover);
  const meanFreq = movers.length > 0 ? movers.reduce((a, p) => a + p.frequency, 0) / movers.length : rng.range(0.8, 2);
  const fin = kind === "fin";
  return {
    frequency: clamp((kin ? kin.frequency : meanFreq) * (1 + rng.range(-0.1, 0.1)), 0.3, 4),
    amplitude: kind === "sensor" ? 0 : rng.range(0, 0.3),
    phase: wrapPhase((kin ? kin.phase : 0) + rng.gaussian() * 0.4),
    skew: fin ? (rng.chance(0.5) ? rng.range(0.25, 0.45) : rng.range(0.55, 0.75)) : rng.range(0.4, 0.6),
    feather: fin ? rng.range(0.3, 0.7) : rng.range(0, 0.3),
  };
}

/** Weights over [readings (n), rates (n), bias]: length 2n + 1. */
function randomWeights(rng: Rng, sensors: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < 2 * sensors; i++) w.push(rng.gaussian() * 0.3);
  w.push(rng.gaussian() * 0.1); // bias stays small so bodies keep their rest rhythm
  return w;
}

function randomAttachment(rng: Rng, kind: PartKind): Pick<PartGene, "anchor" | "side" | "angle"> {
  const inline = kind === "trunk" ? 0.25 : 0.1;
  const side: -1 | 0 | 1 = rng.chance(inline) ? 0 : rng.chance(0.5) ? 1 : -1;
  const angle = side === 0 ? rng.range(-0.4, 0.4) : rng.range(0.2, 1.6);
  const anchor = side === 0 ? 1 : kind === "trunk" ? rng.range(0.3, 1) : rng.range(0.1, 1);
  return { anchor, side, angle };
}

function newPart(rng: Rng, id: number, kind: PartKind, parent: number, sensors: number, parts: readonly PartGene[], founder = false): PartGene {
  const size = SIZE[kind];
  const osc = founder ? randomOscillator(rng) : coherentOscillator(rng, kind, parent, parts);
  if (kind === "sensor") osc.amplitude = 0;
  const length = kind === "sensor" ? rng.range(4, 14) : kind === "fin" ? rng.range(8, 28) : rng.range(8, 24);
  const width = kind === "sensor" ? rng.range(1, 2) : kind === "fin" ? rng.range(2, 8) : rng.range(3, 9);
  return {
    id,
    kind,
    parent,
    ...randomAttachment(rng, kind),
    length: clamp(length, size.length.min, size.length.max),
    width: clamp(width, size.width.min, size.width.max),
    ...osc,
    ampWeights: zeros(2 * sensors + 1),
    freqWeights: zeros(2 * sensors + 1),
  };
}

/** Parts that may carry children (sensors are leaves). */
function parentCandidates(parts: readonly PartGene[]): number[] {
  const out: number[] = [];
  parts.forEach((p, i) => {
    if (p.kind !== "sensor") out.push(i);
  });
  return out;
}

/** Seeded "inept but viable-ish" anatomy: a head trunk plus 0-3 random parts. */
export function randomGenome(rng: Rng): Genome {
  const root: PartGene = {
    id: 0,
    kind: "trunk",
    parent: -1,
    anchor: 0,
    side: 0,
    angle: 0,
    length: rng.range(14, 30),
    width: rng.range(5, 10),
    frequency: 1,
    amplitude: 0,
    phase: 0,
    skew: 0.5,
    feather: 0,
    ampWeights: [],
    freqWeights: [],
  };
  const parts: PartGene[] = [root];
  const extra = rng.int(4);
  let sensors = 0;
  for (let i = 0; i < extra; i++) {
    let kind = pickKind(rng);
    if (kind === "sensor" && sensors >= MAX_SENSORS) kind = "fin";
    if (kind === "sensor") sensors++;
    const parent = rng.pick(parentCandidates(parts));
    parts.push(newPart(rng, i + 1, kind, parent, 0, parts, true));
  }
  // ~30% of founders carry a mirrored pair (made by the same subtree operator mutation uses).
  const paired = rng.chance(0.3);
  if (paired && !parts.some((p, i) => i > 0 && p.side !== 0)) {
    let at = parts.findIndex((p, i) => i > 0 && p.kind !== "sensor");
    if (at < 0) {
      parts.push(newPart(rng, parts.length, "fin", 0, 0, parts, true));
      at = parts.length - 1;
    }
    Object.assign(parts[at], { side: rng.chance(0.5) ? 1 : -1, anchor: rng.range(0.3, 0.9), angle: rng.range(0.5, 1.4) });
  }
  const genome: Genome = { parts, hue: rng.range(0, 360), reproduceAt: rng.range(0.6, 0.95) };
  for (const p of parts) {
    const moving = p.kind !== "sensor" && p.parent !== -1;
    p.ampWeights = moving ? randomWeights(rng, sensors) : zeros(2 * sensors + 1);
    p.freqWeights = moving ? randomWeights(rng, sensors) : zeros(2 * sensors + 1);
  }
  if (paired) {
    const before = sensorIds(parts);
    if (duplicateMirrored(genome, rng)) realign(parts, before, rng);
  }
  return genome;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Re-align every part's weight arrays after the sensor set changed. `before` is the
 * sensor id order the arrays were written against. Arrays are laid out as
 * [reading weights (n), rate weights (n), bias]; surviving sensors keep both of their
 * columns, new sensors get small random weights in both, removed sensors lose theirs.
 */
function realign(parts: PartGene[], before: readonly number[], rng: Rng): void {
  const after = sensorIds(parts);
  if (after.length === before.length && after.every((id, i) => id === before[i])) return;
  const remap = (old: number[], moving: boolean) => {
    const out: number[] = [];
    for (const offset of [0, before.length]) {
      for (const id of after) {
        const at = before.indexOf(id);
        out.push(at >= 0 ? (old[offset + at] ?? 0) : moving ? rng.gaussian() * 0.3 : 0);
      }
    }
    out.push(old[2 * before.length] ?? 0);
    return out;
  };
  for (const p of parts) {
    const moving = p.kind !== "sensor" && p.parent !== -1;
    p.ampWeights = remap(p.ampWeights, moving);
    p.freqWeights = remap(p.freqWeights, moving);
  }
}

function jitter(value: number, rel: number, rng: Rng): number {
  return value * (1 + rng.gaussian() * rel);
}

function clampSize(p: PartGene): void {
  const size = SIZE[p.kind];
  p.length = clamp(p.length, size.length.min, size.length.max);
  p.width = clamp(p.width, size.width.min, size.width.max);
}

function perturbPart(p: PartGene, rng: Rng): void {
  const isRoot = p.parent === -1;
  const fields = ["length", "width"];
  if (!isRoot) fields.push("angle", "anchor");
  if (!isRoot && p.kind !== "sensor") fields.push("frequency", "amplitude", "phase", "skew", "feather");
  const count = 1 + rng.int(2);
  for (let i = 0; i < count; i++) {
    switch (rng.pick(fields)) {
      // Sensor stalks change faster so evolution can reach out of a single scent cell.
      case "length": p.length = jitter(p.length, p.kind === "sensor" ? 0.25 : 0.12, rng); break;
      case "width": p.width = jitter(p.width, 0.12, rng); break;
      case "angle": p.angle = wrapAngle(p.angle + rng.gaussian() * 0.2); break;
      case "anchor": p.anchor = clamp(p.anchor + rng.gaussian() * 0.1, 0, 1); break;
      case "frequency": p.frequency = clamp(jitter(p.frequency, 0.15, rng), 0.3, 4); break;
      case "amplitude": p.amplitude = clamp(p.amplitude + rng.gaussian() * 0.15, 0, 1.6); break;
      case "phase": p.phase = wrapPhase(p.phase + rng.gaussian() * 0.6); break;
      case "skew": p.skew = clamp(p.skew + rng.gaussian() * 0.05, 0.2, 0.8); break;
      default: p.feather = clamp(p.feather + rng.gaussian() * 0.08, 0, 0.9);
    }
  }
  clampSize(p);
}

function perturbWeights(g: Genome, rng: Rng): void {
  const movers = g.parts.filter(p => p.kind !== "sensor" && p.parent !== -1);
  if (movers.length === 0) return;
  const p = rng.pick(movers);
  const count = 1 + rng.int(2);
  for (let i = 0; i < count; i++) {
    const array = rng.chance(0.5) ? p.ampWeights : p.freqWeights;
    const at = rng.int(array.length);
    // Occasionally prune a weight to zero so useless wiring can disappear.
    array[at] = rng.chance(0.08) ? 0 : clamp(array[at] + rng.gaussian() * 0.15, -WEIGHT_LIMIT, WEIGHT_LIMIT);
  }
}

function reattach(g: Genome, rng: Rng): void {
  if (g.parts.length < 2) return;
  const p = g.parts[1 + rng.int(g.parts.length - 1)];
  const r = rng.float();
  if (r < 0.4) p.anchor = clamp(p.anchor + rng.gaussian() * 0.25, 0, 1);
  else if (r < 0.7) p.side = rng.pick([-1, 0, 1] as const);
  else p.angle = wrapAngle(p.angle + rng.gaussian() * 0.5);
}

function addPart(g: Genome, rng: Rng): boolean {
  if (g.parts.length >= MAX_PARTS) return false;
  let kind = pickKind(rng);
  if (kind === "sensor" && sensorCount(g) >= MAX_SENSORS) kind = "fin";
  const id = Math.max(...g.parts.map(p => p.id)) + 1;
  const parent = rng.pick(parentCandidates(g.parts));
  g.parts.push(newPart(rng, id, kind, parent, sensorCount(g), g.parts));
  return true;
}

function removeLeaf(g: Genome, rng: Rng): boolean {
  const parents = new Set(g.parts.map(p => p.parent));
  const leaves: number[] = [];
  for (let i = 1; i < g.parts.length; i++) if (!parents.has(i)) leaves.push(i);
  if (leaves.length === 0) return false;
  const gone = rng.pick(leaves);
  g.parts.splice(gone, 1);
  for (const p of g.parts) if (p.parent > gone) p.parent--;
  return true;
}

function changeKind(g: Genome, rng: Rng): boolean {
  if (g.parts.length < 2) return false;
  const index = 1 + rng.int(g.parts.length - 1);
  const p = g.parts[index];
  const hasChildren = g.parts.some(q => q.parent === index);
  const options = (["trunk", "fin", "sensor"] as const).filter(k => {
    if (k === p.kind) return false;
    if (k === "sensor") return !hasChildren && sensorCount(g) < MAX_SENSORS;
    return true;
  });
  if (options.length === 0) return false;
  const kind = rng.pick(options);
  const size = SIZE[kind];
  p.kind = kind;
  if (kind === "sensor") {
    p.amplitude = 0;
    p.length = rng.range(4, 14);
    p.width = rng.range(1, 2);
  } else {
    if (p.amplitude === 0) p.amplitude = rng.range(0, 0.8);
    p.length = clamp(Math.max(p.length, 8), size.length.min, size.length.max);
    p.width = clamp(Math.max(p.width, 2), size.width.min, size.width.max);
  }
  return true;
}

/** Indices of `root` and all its descendants, ascending (parents always precede children). */
function subtreeOf(parts: readonly PartGene[], root: number): number[] {
  const out = [root];
  for (let i = root + 1; i < parts.length; i++) if (out.includes(parts[i].parent)) out.push(i);
  return out;
}

/**
 * Sims-style reflection: copy a side-attached part together with its whole subtree onto the
 * other side of the same parent. Every copied part is mirrored (side flipped; inline parts,
 * which have no side sign, get their angle negated), so the copy is a true reflection.
 * Phases are either equal (synchronous rowing) or all shifted by pi (alternating), 50/50.
 * Respects MAX_PARTS and MAX_SENSORS. Returns false if nothing fitted.
 */
export function duplicateMirrored(g: Genome, rng: Rng): boolean {
  const sensors = sensorCount(g);
  const fits: number[][] = [];
  g.parts.forEach((p, i) => {
    if (i === 0 || p.side === 0) return;
    const sub = subtreeOf(g.parts, i);
    const sensorsIn = sub.filter(k => g.parts[k].kind === "sensor").length;
    if (g.parts.length + sub.length <= MAX_PARTS && sensors + sensorsIn <= MAX_SENSORS) fits.push(sub);
  });
  if (fits.length === 0) return false;
  const sub = rng.pick(fits);
  const shift = rng.chance(0.5) ? 0 : Math.PI;
  const moved = new Map<number, number>();
  let nextId = Math.max(...g.parts.map(p => p.id)) + 1;
  for (const old of sub) {
    const src = g.parts[old];
    const copy = clonePart(src);
    copy.id = nextId++;
    if (old !== sub[0]) copy.parent = moved.get(src.parent) as number;
    if (src.side === 0) copy.angle = wrapAngle(-src.angle);
    else copy.side = src.side === 1 ? -1 : 1;
    copy.phase = wrapPhase(src.phase + shift);
    moved.set(old, g.parts.length);
    g.parts.push(copy);
  }
  return true;
}

/**
 * Radial repeat: a side-attached trunk/fin gains N = 2-4 siblings at the same anchor. The
 * N + 1 members are spread evenly over the available arc on that side (or alternate across
 * both sides, 50/50) and their phases lag by 2 pi / (N + 1), so the ring beats as a travelling
 * (metachronal) wave. Returns false when there is no room or no side part.
 */
export function repeatRadial(g: Genome, rng: Rng): boolean {
  const room = MAX_PARTS - g.parts.length;
  if (room < 2) return false;
  const candidates: number[] = [];
  g.parts.forEach((p, i) => {
    if (i > 0 && p.kind !== "sensor" && p.side !== 0) candidates.push(i);
  });
  if (candidates.length === 0) return false;
  const src = g.parts[rng.pick(candidates)];
  const copies = Math.min(2 + rng.int(3), room);
  const members = copies + 1;
  const both = rng.chance(0.5);
  const slots = both ? Math.ceil(members / 2) : members;
  const side = src.side;
  const phase0 = src.phase;
  let nextId = Math.max(...g.parts.map(p => p.id)) + 1;
  for (let j = 0; j < members; j++) {
    const part = j === 0 ? src : clonePart(src);
    if (j > 0) part.id = nextId++;
    const slot = both ? Math.floor(j / 2) : j;
    part.side = both && j % 2 === 1 ? (side === 1 ? -1 : 1) : side;
    part.angle = 0.25 + (slots > 1 ? slot / (slots - 1) : 0.5) * 1.25;
    part.phase = wrapPhase(phase0 + (TAU * j) / members);
    if (j > 0) g.parts.push(part);
  }
  return true;
}

function structuralOp(g: Genome, rng: Rng): boolean {
  let changed = false;
  if (rng.chance(MUTATION.addPart)) changed = addPart(g, rng) || changed;
  if (rng.chance(MUTATION.removePart)) changed = removeLeaf(g, rng) || changed;
  if (rng.chance(MUTATION.changeKind)) changed = changeKind(g, rng) || changed;
  if (rng.chance(MUTATION.duplicateMirrored)) changed = duplicateMirrored(g, rng) || changed;
  if (rng.chance(MUTATION.repeatRadial)) changed = repeatRadial(g, rng) || changed;
  return changed;
}

/**
 * Discovery-mode mutation: only the sensorimotor weights operator (`perturbWeights`) may fire, with
 * probability `rate` per birth. No body, gait, attachment, topology, hue or reproduction changes.
 */
export function mutateControllerOnly(genome: Genome, rng: Rng, rate: number = MUTATION.weights): Genome {
  const child = cloneGenome(genome);
  if (rng.chance(rate)) perturbWeights(child, rng);
  return validateGenome(child) === null ? child : cloneGenome(genome);
}

/** Copy-on-write mutation: the input genome is never modified. */
export function mutate(genome: Genome, rng: Rng): { genome: Genome; topologyChanged: boolean } {
  const child = cloneGenome(genome);
  const before = sensorIds(child.parts);

  if (rng.chance(MUTATION.perturb)) {
    const touches = 1 + rng.int(3);
    for (let i = 0; i < touches; i++) perturbPart(rng.pick(child.parts), rng);
  }
  if (rng.chance(MUTATION.weights)) perturbWeights(child, rng);
  if (rng.chance(MUTATION.reattach)) reattach(child, rng);
  if (rng.chance(0.15)) child.reproduceAt = clamp(child.reproduceAt + rng.gaussian() * 0.03, 0.55, 0.97);

  const topologyChanged = structuralOp(child, rng);
  realign(child.parts, before, rng);
  const drift = topologyChanged ? MUTATION.hueJump : MUTATION.hueDrift;
  child.hue = wrapHue(child.hue + rng.range(-drift, drift));

  if (validateGenome(child) !== null) return { genome: cloneGenome(genome), topologyChanged: false };
  return { genome: child, topologyChanged };
}
