import { test, expect } from "@playwright/test";
import { stepOrganism, PHYSICS } from "../src/entries/tide-pool/physics";
import { wave } from "../src/entries/tide-pool/controller";
import { bodyMass } from "../src/entries/tide-pool/body";
import { validateGenome } from "../src/entries/tide-pool/genome";
import { World } from "../src/entries/tide-pool/world";
import {
  DEFAULT_ENVIRONMENT,
  DT,
  type Genome,
  type Organism,
  type PartGene,
  type Vec2,
  type Water,
} from "../src/entries/tide-pool/types";

type Spec = Partial<PartGene> & { kind: PartGene["kind"] };

let nextId = 1;

function part(spec: Spec): PartGene {
  return {
    id: nextId++,
    parent: 0,
    anchor: 0.5,
    side: 0,
    angle: 0,
    length: 10,
    width: 3,
    frequency: 0,
    amplitude: 0,
    phase: 0,
    skew: 0.5,
    feather: 0,
    ampWeights: [],
    freqWeights: [],
    ...spec,
  };
}

function trunk(length = 24, width = 8): PartGene {
  return part({ kind: "trunk", parent: -1, anchor: 0, length, width });
}

/** A fin angled straight out from the trunk (perpendicular), oscillating about that rest angle. */
function fin(side: -1 | 1, spec: Partial<PartGene> = {}): PartGene {
  return part({
    kind: "fin",
    parent: 0,
    anchor: 0.3,
    side,
    angle: Math.PI / 2,
    length: 16,
    width: 3,
    frequency: 2,
    amplitude: 0.7,
    ...spec,
  });
}

function makeOrganism(parts: PartGene[], position: Vec2, heading = 0): Organism {
  const genome: Genome = { parts, hue: 200, reproduceAt: 0.8 };
  const sensors = parts.filter((p) => p.kind === "sensor").length;
  return {
    id: 1,
    genome,
    lineage: 1,
    parentLineage: -1,
    generation: 0,
    position: { ...position },
    heading,
    velocity: { x: 0, y: 0 },
    angularVelocity: 0,
    age: 0,
    energy: 100,
    capacity: 100,
    mass: bodyMass(genome),
    senses: new Array<number>(sensors).fill(0),
    poses: [],
    meals: 0,
    offspring: 0,
    trail: [],
  };
}

function still(scent: (p: Vec2) => number = () => 0, size = 4000): Water {
  return {
    env: { ...DEFAULT_ENVIRONMENT },
    flowAt: () => ({ x: 0, y: 0 }),
    scentAt: scent,
    width: size,
    height: size,
  };
}

function run(o: Organism, water: Water, seconds: number): number {
  let work = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) work += stepOrganism(o, water, DT).work;
  return work;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const START: Vec2 = { x: 2000, y: 2000 };

function twoFin(spec: Partial<PartGene>, left: Partial<PartGene> = {}): Organism {
  return makeOrganism([trunk(), fin(-1, { ...spec, ...left }), fin(1, spec)], START);
}

test("wave is a sine at skew 0.5 and spends a skew fraction of the cycle rising", () => {
  for (const x of [0, 0.7, 2, 4.4, 6]) expect(wave(x, 0.5)).toBeCloseTo(Math.sin(x), 9);
  let rising = 0;
  const samples = 10000;
  let last = wave(0, 0.25);
  for (let i = 1; i <= samples; i++) {
    const w = wave((i / samples) * 2 * Math.PI, 0.25);
    if (w > last) rising++;
    last = w;
  }
  expect(rising / samples).toBeCloseTo(0.25, 1);
});

test("a rigid trunk does not self-propel", () => {
  const o = makeOrganism([trunk()], START);
  run(o, still(), 10);
  expect(Math.hypot(o.velocity.x, o.velocity.y)).toBeLessThan(1e-6);
  expect(distance(o.position, START)).toBeLessThan(1e-6);
});

test("skewed, feathered strokes swim; the symmetric reciprocal stroke barely moves", () => {
  const skewed = twoFin({ skew: 0.25, feather: 0.6 });
  const workSkewed = run(skewed, still(), 10);
  const skewedDistance = distance(skewed.position, START);
  const skewedSpeed = skewedDistance / 10;

  const feathered = twoFin({ feather: 0.7 });
  run(feathered, still(), 10);
  const featheredDistance = distance(feathered.position, START);

  const reciprocal = twoFin({ skew: 0.5, feather: 0 });
  run(reciprocal, still(), 10);
  const reciprocalDistance = distance(reciprocal.position, START);

  console.log(
    `skew+feather: ${skewedDistance.toFixed(1)} units (${skewedSpeed.toFixed(1)} u/s), work ${workSkewed.toFixed(1)}; ` +
      `feather only: ${featheredDistance.toFixed(1)}; reciprocal: ${reciprocalDistance.toFixed(2)}`,
  );
  expect(skewedDistance).toBeGreaterThan(150);
  expect(skewedSpeed).toBeGreaterThan(15);
  expect(skewedSpeed).toBeLessThan(80);
  expect(featheredDistance).toBeGreaterThan(100);
  expect(reciprocalDistance).toBeLessThan(skewedDistance / 8);
});

test("a phase-lagged chain of trunk segments undulates, and the wave direction sets the swimming direction", () => {
  const segments = [trunk(14, 5)];
  for (let i = 1; i <= 3; i++) {
    segments.push(
      part({
        kind: "trunk",
        parent: i - 1,
        anchor: 1,
        side: 0,
        angle: 0,
        length: 14,
        width: 5,
        frequency: 2,
        amplitude: 0.6,
        phase: -i * 1.2,
      }),
    );
  }
  const o = makeOrganism(segments, START);
  run(o, still(), 10);
  const travelled = distance(o.position, START);

  // Reversing the lag sends the wave the other way, which must reverse the swimming direction.
  const reversed = makeOrganism(
    segments.map((p, i) => ({ ...p, phase: i === 0 ? 0 : i * 1.2 })),
    START,
  );
  run(reversed, still(), 10);
  const forward = o.position.x - START.x;
  const backward = reversed.position.x - START.x;
  console.log(`undulation: lag -1.2 moves ${forward.toFixed(1)} along heading, lag +1.2 moves ${backward.toFixed(1)}`);
  expect(travelled).toBeGreaterThan(60);
  expect(forward * backward).toBeLessThan(0);
});

test("asymmetric fin amplitude turns the body", () => {
  const symmetric = twoFin({ skew: 0.25, feather: 0.6 });
  run(symmetric, still(), 6);
  const asymmetric = twoFin({ skew: 0.25, feather: 0.6 }, { amplitude: 0.2 });
  const early = (() => {
    run(asymmetric, still(), 2);
    return Math.abs(asymmetric.heading);
  })();
  run(asymmetric, still(), 4);
  const late = Math.abs(asymmetric.heading);
  console.log(
    `heading change: symmetric ${symmetric.heading.toFixed(3)} rad, asymmetric ${early.toFixed(2)} (2 s) -> ${late.toFixed(2)} (6 s)`,
  );
  expect(late).toBeGreaterThan(early);
  expect(late).toBeGreaterThan(0.5);
  expect(late).toBeGreaterThan(Math.abs(symmetric.heading) * 5);
});

/**
 * HAND-BUILT POSITIVE CONTROL, NOT EVIDENCE OF DISCOVERY. A klino-style body with a single in-domain
 * steering weight (w = 1 on the left fin's rate slot, within the +-2 weight limit) is dropped into a real World
 * whose real ScentField has been built up by food. It shows the sensorimotor loop can carry a gradient signal
 * at all; it says nothing about whether evolution can find such a weight. Normal vs blind vs reversed-sign.
 */
function handBuiltKlino(w: number): Genome {
  const klinoFin = (side: -1 | 1, ampWeights: number[]) =>
    part({
      kind: "fin",
      parent: 0,
      anchor: 0.3,
      side,
      angle: -Math.PI / 2,
      length: 16,
      width: 3,
      frequency: 2,
      amplitude: 0.7,
      skew: 0.25,
      feather: 0.6,
      ampWeights,
      freqWeights: [0, 0, 0],
    });
  const genome: Genome = {
    parts: [
      part({ kind: "trunk", parent: -1, anchor: 0, length: 16, width: 6, frequency: 1, ampWeights: [0, 0, 0], freqWeights: [0, 0, 0] }),
      klinoFin(-1, [0, w, -0.4]),
      klinoFin(1, [0, 0, 0]),
      part({ kind: "sensor", parent: 0, anchor: 0, side: 0, angle: Math.PI, length: 12, width: 1, ampWeights: [0, 0, 0], freqWeights: [0, 0, 0] }),
    ],
    hue: 200,
    reproduceAt: 0.8,
  };
  return genome;
}

/** Seconds spent within 30 units of a food drop, steady scent field from a real World (reference assay hooks). */
function secondsNear(genome: Genome, start: Vec2, heading: number, target: Vec2, blind: boolean): number {
  // eslint-disable-next-line prefer-const -- assigned after the World that captures it exists (contract Appendix A pattern)
  let view!: Water;
  const w = new World(7, { foodRate: 0, currentStrength: 0 }, (o, _water, dt) => stepOrganism(o, view, dt));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = w as any;
  view = {
    get env() { return w.env; },
    flowAt: (p: Vec2) => w.flowAt(p),
    width: 800,
    height: 500,
    scentAt: (p: Vec2) => (blind ? 0 : priv.scent.sample(p)),
  };
  w.organisms.length = 0;
  priv.lineageRecords.clear();
  priv.food.length = 0;
  priv.patches.length = 0;
  priv.scent.data.fill(0);
  priv.canReproduce = () => false;
  w.dropFood(target, 6);
  for (let i = 0; i < 30 * 60; i++) w.step();
  priv.consume = () => {}; // keep the source steady for a clean comparison
  const lineage = priv.newLineage(-1, genome);
  priv.lineageRecords.get(lineage).count = 1;
  const o: Organism = priv.makeOrganism(genome, start, heading, lineage, -1, 0);
  o.energy = 0.5 * o.capacity;
  w.organisms.push(o);
  let near = 0;
  for (let i = 0; i < 30 * 60; i++) {
    w.step();
    if (distance(o.position, target) < 30) near += DT;
  }
  return near;
}

test("hand-built positive control (not evidence of discovery): a left-fin rate weight of 1 steers toward scent; blind and reversed do not", () => {
  const normal = handBuiltKlino(1);
  const reversed = handBuiltKlino(-1);
  expect(validateGenome(normal)).toBeNull();
  expect(validateGenome(reversed)).toBeNull();
  for (const g of [normal, reversed]) for (const p of g.parts) for (const x of [...p.ampWeights, ...p.freqWeights]) expect(Math.abs(x)).toBeLessThanOrEqual(2);
  const target: Vec2 = { x: 400, y: 250 };
  const totals = { normal: 0, blind: 0, reversed: 0 };
  let trials = 0;
  for (let b = 0; b < 4; b++) {
    const bearing = (b * Math.PI) / 2 + 0.3;
    const start = { x: target.x + 60 * Math.cos(bearing), y: target.y + 60 * Math.sin(bearing) };
    for (const heading of [bearing + Math.PI, bearing + Math.PI / 2]) {
      totals.normal += secondsNear(normal, start, heading, target, false);
      totals.blind += secondsNear(normal, start, heading, target, true);
      totals.reversed += secondsNear(reversed, start, heading, target, false);
      trials++;
    }
  }
  expect(trials).toBe(8);
  const mean = { normal: totals.normal / trials, blind: totals.blind / trials, reversed: totals.reversed / trials };
  console.log(`mean seconds within 30 units over 8 starts: normal ${mean.normal.toFixed(2)}, blind ${mean.blind.toFixed(2)}, reversed ${mean.reversed.toFixed(2)}`);
  expect(mean.normal).toBeGreaterThan(mean.blind);
  expect(mean.normal).toBeGreaterThan(mean.reversed);
});

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("a spinning body is slowed by billed rotational drag, not a hidden clamp", () => {
  for (const [length, width] of [[24, 8], [50, 8]] as const) {
    const o = makeOrganism([trunk(length, width), fin(-1, { amplitude: 0 }), fin(1, { amplitude: 0 })], START);
    o.angularVelocity = 6;
    const water = still();
    const work = run(o, water, 2);
    expect(Math.abs(o.angularVelocity), `span ${length}`).toBeLessThan(1);
    expect(work).toBeGreaterThan(0);
    // Far above the safety clamp's reach: a 6 rad/s spin is allowed to start and pays for itself.
    expect(PHYSICS.maxSpin).toBeGreaterThan(6);
  }
});

test("a random body runs 10,000 steps with no NaN and stays inside the pool", () => {
  for (const seed of [1, 2, 3]) {
    const rand = lcg(seed);
    const kinds: PartGene["kind"][] = ["trunk", "fin", "sensor"];
    const parts: PartGene[] = [trunk(10 + rand() * 30, 3 + rand() * 8)];
    const count = 4 + Math.floor(rand() * 6);
    for (let i = 1; i < count; i++) {
      const sensors = parts.filter((p) => p.kind === "sensor").length + 1;
      parts.push(
        part({
          kind: kinds[Math.floor(rand() * 3)],
          parent: Math.floor(rand() * i),
          anchor: rand(),
          side: [-1, 0, 1][Math.floor(rand() * 3)] as -1 | 0 | 1,
          angle: (rand() - 0.5) * 6,
          length: 3 + rand() * 25,
          width: 1 + rand() * 6,
          frequency: rand() * 5,
          amplitude: rand() * 2,
          phase: rand() * 6,
          skew: 0.1 + rand() * 0.8,
          feather: rand() * 0.9,
          // Deliberately the wrong lengths: short, long and containing a non-finite weight.
          ampWeights: Array.from({ length: sensors + Math.floor(rand() * 3) - 1 }, () => (rand() - 0.5) * 20),
          freqWeights: Array.from({ length: Math.floor(rand() * 4) }, () => (rand() - 0.5) * 20),
        }),
      );
    }
    const water: Water = {
      env: { ...DEFAULT_ENVIRONMENT, viscosity: 0.5 + rand() * 1.5 },
      flowAt: (p) => ({ x: 15 * Math.sin(p.y / 90), y: 10 * Math.cos(p.x / 70) }),
      scentAt: (p) => Math.exp(-distance(p, { x: 480, y: 300 }) / 200) * 1.5,
      width: 960,
      height: 600,
    };
    const o = makeOrganism(parts, { x: 100 + rand() * 700, y: 100 + rand() * 400 }, rand() * 6);
    let speedMax = 0;
    let path = 0;
    let lastX = o.position.x;
    let lastY = o.position.y;
    for (let i = 0; i < 10000; i++) {
      const cost = stepOrganism(o, water, DT);
      if (!Number.isFinite(cost.work)) throw new Error(`non-finite work at step ${i}, seed ${seed}`);
      path += Math.hypot(o.position.x - lastX, o.position.y - lastY);
      lastX = o.position.x;
      lastY = o.position.y;
      speedMax = Math.max(speedMax, Math.hypot(o.velocity.x, o.velocity.y));
      if (!Number.isFinite(o.position.x + o.position.y + o.heading + o.velocity.x + o.velocity.y + o.angularVelocity)) {
        throw new Error(`non-finite state at step ${i}, seed ${seed}`);
      }
      for (const pose of o.poses) {
        if (
          !(pose.base.x >= -1e-6 && pose.tip.x <= 960 + 1e-6 && pose.base.y >= -1e-6 && pose.tip.y <= 600 + 1e-6) ||
          !(pose.tip.x >= -1e-6 && pose.base.x <= 960 + 1e-6 && pose.tip.y >= -1e-6 && pose.base.y <= 600 + 1e-6)
        ) {
          throw new Error(`pose left the pool at step ${i}, seed ${seed}`);
        }
      }
    }
    console.log(`random body seed ${seed}: ${parts.length} parts, path ${path.toFixed(0)}, max speed ${speedMax.toFixed(1)}`);
    expect(path).toBeGreaterThan(1);
    expect(speedMax).toBeLessThanOrEqual(PHYSICS.maxSpeed + 1e-6);
    expect(o.trail.length).toBeLessThanOrEqual(PHYSICS.trailLength);
    expect(o.age).toBeCloseTo(10000 * DT, 3);
  }
});

test("150 organisms of 8 parts at 16 substeps per frame fit a frame budget", () => {
  const water = still(() => 0.3, 4000);
  const crowd = Array.from({ length: 150 }, (_, i) => {
    const parts = [trunk(), fin(-1), fin(1), part({ kind: "sensor", anchor: 1, length: 6, width: 1, angle: 0.5 })];
    for (let k = 0; k < 4; k++) {
      parts.push(part({ kind: "trunk", parent: parts.length - 1, anchor: 1, length: 8, width: 3, frequency: 1.5, amplitude: 0.4, phase: k }));
    }
    return makeOrganism(parts, { x: 500 + (i % 15) * 200, y: 500 + Math.floor(i / 15) * 200 });
  });
  const frames = 30;
  const start = performance.now();
  for (let f = 0; f < frames; f++) {
    for (let sub = 0; sub < 16; sub++) for (const o of crowd) stepOrganism(o, water, DT);
  }
  const perFrame = (performance.now() - start) / frames;
  console.log(`150 organisms x 8 parts x 16 substeps: ${perFrame.toFixed(1)} ms per frame`);
  expect(perFrame).toBeLessThan(60);
});

test("wide fins with a symmetric reciprocal stroke still barely move", () => {
  const wide = twoFin({ skew: 0.5, feather: 0, width: 8 });
  run(wide, still(), 10);
  expect(distance(wide.position, START)).toBeLessThan(5);
});
