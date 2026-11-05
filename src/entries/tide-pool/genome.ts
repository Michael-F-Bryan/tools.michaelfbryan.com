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
  addPart: 0.035,
  removePart: 0.03,
  changeKind: 0.02,
  duplicateMirrored: 0.03,
  /** Hue drift in degrees (uniform ±) per ordinary / per topology-changing mutation. */
  hueDrift: 4,
  hueJump: 25,
};

export const MAX_PARTS = 10;
export const MAX_SENSORS = 4;
/** Mass contributed by each sensor on top of the segment area. */
export const SENSOR_MASS = 2;

type Range = { min: number; max: number };
const SIZE: Record<PartKind, { length: Range; width: Range }> = {
  trunk: { length: { min: 4, max: 60 }, width: { min: 2, max: 16 } },
  fin: { length: { min: 4, max: 60 }, width: { min: 2, max: 16 } },
  sensor: { length: { min: 3, max: 8 }, width: { min: 1, max: 2 } },
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
      if (w.length !== sensors + 1) return `weights misaligned at ${i}`;
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

function randomOscillator(rng: Rng) {
  return {
    frequency: rng.range(0.5, 3),
    amplitude: rng.range(0, 1.2),
    phase: rng.range(0, TAU),
    skew: rng.range(0.3, 0.7),
    feather: rng.range(0, 0.6),
  };
}

function randomWeights(rng: Rng, sensors: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < sensors; i++) w.push(rng.gaussian() * 0.3);
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

function newPart(rng: Rng, id: number, kind: PartKind, parent: number, sensors: number): PartGene {
  const size = SIZE[kind];
  const osc = randomOscillator(rng);
  if (kind === "sensor") osc.amplitude = 0;
  const length = kind === "sensor" ? rng.range(3, 8) : kind === "fin" ? rng.range(8, 28) : rng.range(8, 24);
  const width = kind === "sensor" ? rng.range(1, 2) : kind === "fin" ? rng.range(2, 8) : rng.range(3, 9);
  return {
    id,
    kind,
    parent,
    ...randomAttachment(rng, kind),
    length: clamp(length, size.length.min, size.length.max),
    width: clamp(width, size.width.min, size.width.max),
    ...osc,
    ampWeights: zeros(sensors + 1),
    freqWeights: zeros(sensors + 1),
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
    parts.push(newPart(rng, i + 1, kind, parent, 0));
  }
  const genome: Genome = { parts, hue: rng.range(0, 360), reproduceAt: rng.range(0.6, 0.95) };
  for (const p of parts) {
    const moving = p.kind !== "sensor" && p.parent !== -1;
    p.ampWeights = moving ? randomWeights(rng, sensors) : zeros(sensors + 1);
    p.freqWeights = moving ? randomWeights(rng, sensors) : zeros(sensors + 1);
  }
  return genome;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Re-align every part's weight arrays after the sensor set changed. `before` is the
 * sensor id order the arrays were written against. Surviving columns keep their
 * values, new sensors get small random weights, removed sensors lose their column.
 */
function realign(parts: PartGene[], before: readonly number[], rng: Rng): void {
  const after = sensorIds(parts);
  if (after.length === before.length && after.every((id, i) => id === before[i])) return;
  const remap = (old: number[], moving: boolean) => {
    const out = after.map(id => {
      const at = before.indexOf(id);
      if (at >= 0) return old[at] ?? 0;
      return moving ? rng.gaussian() * 0.3 : 0;
    });
    out.push(old[before.length] ?? 0);
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
      case "length": p.length = jitter(p.length, 0.12, rng); break;
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
  g.parts.push(newPart(rng, id, kind, parent, sensorCount(g)));
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
    p.length = rng.range(3, 8);
    p.width = rng.range(1, 2);
  } else {
    if (p.amplitude === 0) p.amplitude = rng.range(0, 0.8);
    p.length = clamp(Math.max(p.length, 8), size.length.min, size.length.max);
    p.width = clamp(Math.max(p.width, 2), size.width.min, size.width.max);
  }
  return true;
}

/** Copy a side-attached part onto the other side of its parent: bilateral symmetry. */
function duplicateMirrored(g: Genome, rng: Rng): boolean {
  if (g.parts.length >= MAX_PARTS) return false;
  const candidates: number[] = [];
  g.parts.forEach((p, i) => {
    if (i > 0 && p.side !== 0 && (p.kind !== "sensor" || sensorCount(g) < MAX_SENSORS)) candidates.push(i);
  });
  if (candidates.length === 0) return false;
  const source = g.parts[rng.pick(candidates)];
  const copy = clonePart(source);
  copy.id = Math.max(...g.parts.map(p => p.id)) + 1;
  copy.side = source.side === 1 ? -1 : 1;
  g.parts.push(copy);
  return true;
}

function structuralOp(g: Genome, rng: Rng): boolean {
  let changed = false;
  if (rng.chance(MUTATION.addPart)) changed = addPart(g, rng) || changed;
  if (rng.chance(MUTATION.removePart)) changed = removeLeaf(g, rng) || changed;
  if (rng.chance(MUTATION.changeKind)) changed = changeKind(g, rng) || changed;
  if (rng.chance(MUTATION.duplicateMirrored)) changed = duplicateMirrored(g, rng) || changed;
  return changed;
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
