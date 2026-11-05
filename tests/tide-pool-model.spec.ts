import { test, expect } from "@playwright/test";
import { describeGenome, genomeMass, mutate, randomGenome, validateGenome, duplicateMirrored, repeatRadial, MAX_PARTS } from "../src/entries/tide-pool/genome";
import { Rng } from "../src/entries/tide-pool/random";
import { ScentField } from "../src/entries/tide-pool/scent";
import {
  DT,
  MAX_FOOD,
  MAX_POPULATION,
  POOL_HEIGHT,
  POOL_WIDTH,
  SEED_POPULATION,
  type Genome,
  type PartGene,
  type Organism,
  type StepOrganism,
} from "../src/entries/tide-pool/types";
import { stepOrganism } from "../src/entries/tide-pool/physics";
import { TUNING, World } from "../src/entries/tide-pool/world";

/**
 * A deterministic stand-in for the creature engine: swims forward, turns up the
 * scent gradient and wobbles. It lets ecology be exercised without the real physics.
 */
const stubForager: StepOrganism = (org, water, dt) => {
  org.age += dt;
  const ahead = (turn: number) => ({
    x: org.position.x + Math.cos(org.heading + turn) * 14,
    y: org.position.y + Math.sin(org.heading + turn) * 14,
  });
  const gradient = water.scentAt(ahead(0.7)) - water.scentAt(ahead(-0.7));
  org.heading += gradient * 12 * dt + Math.sin(org.age * 1.3 + org.id) * 0.9 * dt;
  const flow = water.flowAt(org.position);
  org.velocity.x = Math.cos(org.heading) * 18 + flow.x;
  org.velocity.y = Math.sin(org.heading) * 18 + flow.y;
  org.position.x += org.velocity.x * dt;
  org.position.y += org.velocity.y * dt;
  // Billed like a real swimmer at ~18 u/s: about 1-2x basal drain (~0.4 J/s), i.e. work * workCost * 60.
  // (Real physics reports dissipated drag power, see PHYSICS.workUnit; the old 8 would cost ~10 J/s, 35x basal.)
  return { work: 0.3 };
};

function hasNaN(world: World): boolean {
  return world.organisms.some(
    o => !Number.isFinite(o.position.x) || !Number.isFinite(o.position.y) || !Number.isFinite(o.energy),
  );
}

function run(world: World, seconds: number, every = 60): number[] {
  const curve: number[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps; i++) {
    world.step();
    if (i % Math.round(every / DT) === 0) curve.push(world.organisms.length);
  }
  return curve;
}

function hasBilateralPair(g: Genome): boolean {
  return g.parts.some((a, i) =>
    g.parts.some((b, j) => j > i && a.parent === b.parent && a.kind === b.kind && a.side === -b.side && a.side !== 0 && a.length === b.length),
  );
}

test("random genomes are valid, aligned and described", () => {
  for (let seed = 0; seed < 500; seed++) {
    const genome = randomGenome(new Rng(seed));
    expect(validateGenome(genome), `seed ${seed}`).toBeNull();
    expect(genomeMass(genome)).toBeGreaterThan(0);
    expect(describeGenome(genome)).toMatch(/segment/);
  }
});

test("random genomes are deterministic per seed and varied across seeds", () => {
  expect(randomGenome(new Rng(7))).toEqual(randomGenome(new Rng(7)));
  const sizes = new Set(Array.from({ length: 50 }, (_, s) => randomGenome(new Rng(s)).parts.length));
  expect(sizes.size).toBeGreaterThan(1);
});

test("mutation chains stay valid, never touch the input, and sometimes change topology and add mirrors", () => {
  const rng = new Rng(2024);
  let genome = randomGenome(rng);
  let topology = 0;
  let mirrored = 0;
  for (let i = 0; i < 2000; i++) {
    const before = JSON.stringify(genome);
    const result = mutate(genome, rng);
    expect(JSON.stringify(genome)).toBe(before);
    expect(validateGenome(result.genome), `mutation ${i}`).toBeNull();
    expect(result.genome).not.toBe(genome);
    if (result.topologyChanged) topology++;
    const n = genome.parts.length;
    const last = result.genome.parts[n];
    if (result.genome.parts.length === n + 1 && last && genome.parts.some(p => p.side === -last.side && p.side !== 0 && p.length === last.length && p.parent === last.parent)) mirrored++;
    genome = result.genome;
  }
  expect(topology).toBeGreaterThan(50);
  expect(mirrored).toBeGreaterThan(0);
});

test("mutation produces bilateral pairs from asymmetric bodies", () => {
  const rng = new Rng(99);
  let found = 0;
  for (let i = 0; i < 400; i++) {
    let g = randomGenome(rng);
    for (let k = 0; k < 40 && !hasBilateralPair(g); k++) g = mutate(g, rng).genome;
    if (hasBilateralPair(g)) found++;
  }
  expect(found).toBeGreaterThan(40);
});

test("scent samples stay in range and decay to nothing without food", () => {
  const field = new ScentField(POOL_WIDTH, POOL_HEIGHT);
  for (let i = 0; i < 300; i++) {
    field.deposit(480, 300, 0.8 * DT);
    field.step(DT * 3);
  }
  const peak = field.sample({ x: 480, y: 300 });
  expect(peak).toBeGreaterThan(0.05);
  expect(peak).toBeLessThan(1);
  expect(field.sample({ x: 480, y: 300 })).toBeGreaterThan(field.sample({ x: 560, y: 300 }));
  for (const p of [{ x: -50, y: -50 }, { x: 5000, y: 5000 }, { x: 0, y: 0 }, { x: POOL_WIDTH, y: POOL_HEIGHT }]) {
    const v = field.sample(p);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
  for (let i = 0; i < 2000; i++) field.step(DT * 3);
  expect(field.total()).toBe(0);
  expect(field.sample({ x: 480, y: 300 })).toBe(0);
});

test("a world seeds a viable population and exposes its API", () => {
  const world = new World(5);
  expect(world.organisms).toHaveLength(SEED_POPULATION);
  expect(world.patches.length).toBeGreaterThan(1);
  expect(world.lineages()).toHaveLength(SEED_POPULATION);
  for (const o of world.organisms) {
    expect(validateGenome(o.genome)).toBeNull();
    expect(o.senses).toHaveLength(o.genome.parts.filter(p => p.kind === "sensor").length);
    expect(o.poses).toHaveLength(o.genome.parts.length);
    expect(o.energy).toBeCloseTo(o.capacity * TUNING.startEnergy, 5);
    expect(world.getOrganism(o.id)).toBe(o);
  }
  const first = world.organisms[0];
  expect(world.organismAt(first.position, 4)).toBeDefined();
  expect(world.organismAt({ x: -999, y: -999 }, 4)).toBeUndefined();
});

test("dropFood adds food, setEnvironment changes the environment, current is zero at zero strength", () => {
  const world = new World(11);
  const before = world.food.length;
  world.dropFood({ x: 400, y: 300 });
  expect(world.food.length).toBe(before + 6);
  world.dropFood({ x: 400, y: 300 }, 3);
  expect(world.food.length).toBe(before + 9);
  expect(world.flowAt({ x: 100, y: 100 })).toEqual({ x: 0, y: 0 });
  world.setEnvironment({ foodRate: 0.3, currentStrength: 10, currentAngle: 0, temperature: 9 });
  expect(world.env.foodRate).toBe(0.3);
  expect(world.env.temperature).toBe(2);
  const flow = world.flowAt({ x: 100, y: 100 });
  expect(Number.isFinite(flow.x) && Number.isFinite(flow.y)).toBe(true);
  expect(Math.hypot(flow.x, flow.y)).toBeGreaterThan(1);
  world.setEnvironment({ currentStrength: 0 });
  expect(world.flowAt({ x: 100, y: 100 })).toEqual({ x: 0, y: 0 });
  for (let i = 0; i < 300; i++) world.step();
  expect(world.food.length).toBeGreaterThan(0);
});

test("scent builds up around food and the world is deterministic per seed", () => {
  const a = new World(42, {}, stubForager);
  const b = new World(42, {}, stubForager);
  const c = new World(43, {}, stubForager);
  a.dropFood({ x: 300, y: 300 }, 10);
  b.dropFood({ x: 300, y: 300 }, 10);
  for (let i = 0; i < 3000; i++) {
    a.step();
    b.step();
    c.step();
  }
  expect(a.stats).toEqual(b.stats);
  expect(a.organisms.map(o => [o.id, o.position.x, o.energy])).toEqual(b.organisms.map(o => [o.id, o.position.x, o.energy]));
  expect(a.stats).not.toEqual(c.stats);
  expect(a.scentAt({ x: 300, y: 300 })).toBeGreaterThan(0);
  expect(a.scentAt({ x: 300, y: 300 })).toBeLessThan(1);
});

test("with real physics, 20 minutes stay finite and bounded", () => {
  const world = new World(7);
  const started = Date.now();
  const curve = run(world, 1200);
  console.log(`real physics: 72,000 steps in ${Date.now() - started} ms; population per minute`, curve.join(","));
  expect(hasNaN(world)).toBe(false);
  assertBounded(world);
});

test("two organisms placed on the same spot are pushed apart by contact within a second", () => {
  const world = new World(5, { foodRate: 0 }, stepOrganism);
  world.organisms.length = 2;
  const [a, b] = world.organisms;
  for (const o of [a, b]) {
    o.genome = { ...o.genome, parts: [{ ...o.genome.parts[0], amplitude: 0, frequency: 0 }] };
    o.mass = genomeMass(o.genome);
    o.capacity = world.capacityFor(o.mass);
    o.energy = o.capacity * 0.3;
    o.poses = [];
    o.senses = [];
    o.position = { x: 500, y: 400 };
    o.velocity = { x: 0, y: 0 };
    o.angularVelocity = 0;
    o.heading = 0.3;
  }
  const radii = (a.genome.parts[0].width + b.genome.parts[0].width) / 2;
  for (let i = 0; i < Math.round(1 / DT); i++) world.step();
  expect(world.organisms).toHaveLength(2);
  const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  expect(gap).toBeGreaterThanOrEqual(radii);
  expect(hasNaN(world)).toBe(false);
});

test("stub forager ecology: sustained at default food, collapses when food is scarce", () => {
  const rich = new World(7, {}, stubForager);
  const richCurve = run(rich, 1200);
  console.log("stub default food, population per minute", richCurve.join(","), "lineages", rich.stats.lineages, "births", rich.stats.births, "deaths", rich.stats.deaths);
  expect(hasNaN(rich)).toBe(false);
  assertBounded(rich);
  expect(rich.organisms.length).toBeGreaterThan(0);
  expect(rich.events.length).toBeGreaterThan(0);

  const poor = new World(7, { foodRate: 0.1 }, stubForager);
  const poorCurve = run(poor, 1200);
  console.log("stub foodRate 0.1, population per minute", poorCurve.join(","));
  assertBounded(poor);
  expect(poor.organisms.length).toBeLessThan(Math.max(1, richCurve[richCurve.length - 1] / 3));
});

test("topology-changing births branch the lineage; others inherit it", () => {
  const world = new World(21, {}, stubForager);
  const founders = new Set(world.organisms.map(o => o.lineage));
  run(world, 600, 60);
  const byId = new Map<number, Organism>(world.organisms.map(o => [o.id, o]));
  const branches = world.events.filter(e => e.kind === "lineage");
  const births = world.stats.births;
  expect(births).toBeGreaterThan(20);
  // Every living organism either keeps a founder lineage or a branch that points at an earlier lineage.
  for (const o of byId.values()) {
    if (!founders.has(o.lineage)) expect(o.parentLineage).toBeGreaterThanOrEqual(1);
    expect(o.generation).toBeGreaterThanOrEqual(0);
  }
  const lineageIds = world.lineages().map(l => l.id);
  expect(new Set(lineageIds).size).toBe(lineageIds.length);
  expect(world.lineages().some(l => !founders.has(l.id))).toBe(true);
  for (const e of branches) if (e.kind === "lineage") expect(e.lineage).not.toBe(e.parentLineage);
  expect(world.lineages().reduce((n, l) => n + l.count, 0)).toBe(world.organisms.length);
});

test("handling time: food is eaten only after the mouth stays on that particle long enough", () => {
  const saved = TUNING.handlingTime;
  TUNING.handlingTime = 0.3;
  try {
    let on = true;
    let target: { x: number; y: number } = { x: 0, y: 0 };
    // Holds the mouth on the particle while `on`, otherwise parks it far away.
    const stub: StepOrganism = (org, _water, dt) => {
      org.age += dt;
      org.velocity.x = 0;
      org.velocity.y = 0;
      org.position.x = on ? target.x : 60;
      org.position.y = on ? target.y : 60;
      return { work: 0 };
    };
    const fresh = (): World => {
      const world = new World(3, { foodRate: 0, currentStrength: 0 }, stub);
      world.organisms.splice(1);
      world.organisms[0].energy = world.organisms[0].capacity * 0.4;
      world.food.length = 0;
      world.food.push({ id: 900001, position: { x: 600, y: 400 }, energy: 30, age: 0 });
      target = world.food[0].position;
      return world;
    };
    const timeToMeal = (world: World, maxSeconds: number): number | null => {
      for (let i = 1; i <= Math.round(maxSeconds / DT); i++) {
        world.step();
        if (world.organisms[0].meals > 0) return i * DT;
      }
      return null;
    };

    // Dwelling: eaten no sooner than 0.3 s after first contact, and soon after.
    const world = fresh();
    on = true;
    const t = timeToMeal(world, 2);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(0.3);
    expect(t!).toBeLessThan(0.3 + 4 * DT);

    // Leaving after 0.1 s breaks contact: handling starts over on return.
    const again = fresh();
    on = true;
    for (let i = 0; i < Math.round(0.1 / DT); i++) again.step();
    expect(again.organisms[0].meals).toBe(0);
    expect(again.organisms[0].handlingProgress).toBeGreaterThan(0);
    on = false;
    again.step();
    expect(again.organisms[0].handlingProgress).toBe(0);
    on = true;
    const t2 = timeToMeal(again, 2);
    expect(t2).not.toBeNull();
    expect(t2!).toBeGreaterThanOrEqual(0.3);

    // A brief sweep past food (never 0.3 s of contact) feeds nothing.
    const sweep = fresh();
    for (let i = 0; i < 20; i++) {
      on = true;
      for (let k = 0; k < 10; k++) sweep.step();
      on = false;
      sweep.step();
    }
    expect(sweep.organisms[0].meals).toBe(0);

    // Instant ingestion when disabled.
    TUNING.handlingTime = 0;
    const instant = fresh();
    on = true;
    expect(timeToMeal(instant, 1)).toBeLessThanOrEqual(2 * DT);
  } finally {
    TUNING.handlingTime = saved;
  }
});

function assertBounded(world: World): void {
  expect(world.organisms.length).toBeLessThanOrEqual(MAX_POPULATION);
  expect(world.food.length).toBeLessThanOrEqual(MAX_FOOD);
  expect(world.history.length).toBeLessThanOrEqual(600);
  expect(world.events.length).toBeLessThanOrEqual(60);
  for (const o of world.organisms) {
    expect(o.position.x).toBeGreaterThanOrEqual(0);
    expect(o.position.x).toBeLessThanOrEqual(POOL_WIDTH);
    expect(o.position.y).toBeGreaterThanOrEqual(0);
    expect(o.position.y).toBeLessThanOrEqual(POOL_HEIGHT);
    expect(o.energy).toBeGreaterThan(0);
    expect(o.energy).toBeLessThanOrEqual(o.capacity + 1e-9);
  }
}

/** Reach into the private ecology hooks so stock dynamics can be driven without organisms. */
type PatchHooks = {
  consume(org: Organism, i: number): void;
  driftPatches(): void;
  spawnFood(): void;
};
const hooks = (world: World) => world as unknown as PatchHooks;

/** Take one meal from inside patch 0. */
function graze(world: World) {
  world.food.length = 0;
  world.dropFood({ ...world.patches[0].position }, 1);
  hooks(world).consume(world.organisms[0], 0);
}

/** Spawn for `steps` ticks without drift; count particles inside each patch's radius and in total. */
function spawnCounts(world: World, steps: number) {
  world.food.length = 0;
  for (let i = 0; i < steps; i++) hooks(world).spawnFood();
  const inside = world.patches.map(p => world.food.filter(f => Math.hypot(f.position.x - p.position.x, f.position.y - p.position.y) <= p.radius).length);
  return { inside, total: world.food.length };
}

test("grazing a patch reduces its own spawn output and the total patch output", () => {
  const world = new World(3);
  world.setEnvironment({ foodRate: 5 });
  // 30 s keeps the total under MAX_FOOD so the cap cannot mask the difference.
  const steps = Math.round(30 / DT);
  const before = spawnCounts(world, steps);
  for (let i = 0; i < 20; i++) graze(world);
  expect(world.patches[0].stock).toBeLessThan(0.3);
  expect(world.patches[0].stock).toBeGreaterThanOrEqual(TUNING.patchMinStock);
  const after = spawnCounts(world, steps);
  expect(after.inside[0]).toBeLessThan(before.inside[0] * 0.5);
  expect(after.total).toBeLessThan(before.total);
});

test("a patch at the floor recovers to half stock in bounded time without grazing", () => {
  const world = new World(4);
  const patch = world.patches[0];
  patch.stock = TUNING.patchMinStock;
  let t = 0;
  while (patch.stock < 0.5 && t < 3600) {
    for (let k = 0; k < Math.round(1 / DT); k++) hooks(world).driftPatches();
    t++;
  }
  expect(patch.stock).toBeGreaterThanOrEqual(0.5);
  expect(t).toBeLessThan(1500);
});

test("with every patch at the floor, total food is roughly the scattered share only", () => {
  const world = new World(5);
  world.setEnvironment({ foodRate: 5 });
  for (const p of world.patches) p.stock = TUNING.patchMinStock;
  const seconds = 120;
  const { total } = spawnCounts(world, Math.round(seconds / DT));
  const rate = total / seconds;
  const scattered = 5 * (1 - TUNING.patchShare);
  const floorPatches = 5 * TUNING.patchShare * TUNING.patchMinStock;
  const expected = scattered + floorPatches;
  expect(rate).toBeGreaterThan(expected * 0.7);
  expect(rate).toBeLessThan(expected * 1.3);
  expect(rate).toBeLessThan(5 * 0.5);
});

function pg(id: number, parent: number, over: Partial<PartGene> = {}): PartGene {
  return {
    id,
    kind: "fin",
    parent,
    anchor: 0.5,
    side: 1,
    angle: 0.8,
    length: 12,
    width: 3,
    frequency: 1.5,
    amplitude: 0.5,
    phase: 1,
    skew: 0.3,
    feather: 0.4,
    ampWeights: [0],
    freqWeights: [0],
    ...over,
  };
}

function limbBody(): Genome {
  const root = pg(0, -1, { kind: "trunk", side: 0, angle: 0, anchor: 0, length: 20, width: 6, amplitude: 0 });
  // root -> arm (side +1) -> hand (inline trunk child, side 0, angle 0.3) and a side fin on the arm.
  const arm = pg(1, 0, { kind: "trunk", angle: 0.9 });
  const hand = pg(2, 1, { kind: "fin", side: 0, angle: 0.3, phase: 2 });
  const fin = pg(3, 1, { kind: "fin", side: -1, angle: 0.5, phase: 3 });
  return { parts: [root, arm, hand, fin], hue: 100, reproduceAt: 0.8 };
}

test("duplicateMirrored copies the whole subtree, mirrors it, and keeps the genome valid", () => {
  let sync = 0;
  let alternating = 0;
  for (let seed = 0; seed < 60; seed++) {
    const g = limbBody();
    const rng = new Rng(seed);
    const ok = duplicateMirrored(g, rng);
    expect(ok).toBe(true);
    expect(validateGenome(g), `seed ${seed}`).toBeNull();
    // Either the arm subtree (3 parts), or one of the lone leaves (1 part) was copied.
    const added = g.parts.length - 4;
    expect([1, 3]).toContain(added);
    const src = [1, 2, 3].slice(0, added === 3 ? 3 : 1);
    if (added === 3) {
      const [arm, hand, fin] = g.parts.slice(4);
      expect(arm.parent).toBe(0);
      expect(arm.side).toBe(-1); // arm was +1
      expect(hand.parent).toBe(g.parts.indexOf(arm)); // children follow the copy, not the original
      expect(hand.side).toBe(0);
      expect(hand.angle).toBeCloseTo(-0.3); // inline parts mirror by negating the angle
      expect(fin.parent).toBe(g.parts.indexOf(arm));
      expect(fin.side).toBe(1); // was -1
      const d = ((arm.phase - 1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (Math.abs(d) < 1e-9) sync++;
      else {
        expect(d).toBeCloseTo(Math.PI);
        alternating++;
      }
      // Relative phases inside the copied limb are preserved.
      expect((((hand.phase - arm.phase) - (2 - 1)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(0, 6);
    }
    expect(src.length).toBeGreaterThan(0);
    expect(new Set(g.parts.map(p => p.id)).size).toBe(g.parts.length);
  }
  expect(sync).toBeGreaterThan(3);
  expect(alternating).toBeGreaterThan(3);
});

test("duplicateMirrored refuses when the copy would exceed MAX_PARTS", () => {
  const g = limbBody();
  while (g.parts.length < MAX_PARTS) g.parts.push(pg(g.parts.length + 10, 0, { side: -1 }));
  expect(duplicateMirrored(g, new Rng(1))).toBe(false);
  expect(g.parts.length).toBe(MAX_PARTS);
});

test("repeatRadial adds 2-4 phase-lagged copies at one anchor and stays valid", () => {
  const counts = new Set<number>();
  for (let seed = 0; seed < 60; seed++) {
    const g = limbBody();
    const before = g.parts.length;
    expect(repeatRadial(g, new Rng(seed))).toBe(true);
    expect(validateGenome(g), `seed ${seed}`).toBeNull();
    const n = g.parts.length - before;
    counts.add(n);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    // The ring: the members sharing the source's parent, kind and anchor.
    const copy = g.parts[before];
    const ring = g.parts.filter(p => p.parent === copy.parent && p.anchor === copy.anchor && p.kind === copy.kind && p.length === copy.length && p.side !== 0);
    expect(ring.length).toBe(n + 1);
    const members = n + 1;
    const lags = ring.map(p => p.phase);
    const base = lags[0];
    lags.forEach((ph, j) => {
      const d = (((ph - base - (2 * Math.PI * j) / members) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.min(d, 2 * Math.PI - d)).toBeLessThan(1e-6);
    });
  }
  expect(counts.size).toBe(3);
});

test("random founders include mirrored pairs, and 2,000 chained mutations with the new operators stay valid", () => {
  let paired = 0;
  for (let seed = 0; seed < 300; seed++) {
    const g = randomGenome(new Rng(seed));
    expect(validateGenome(g), `seed ${seed}`).toBeNull();
    if (hasBilateralPair(g)) paired++;
  }
  expect(paired).toBeGreaterThan(300 * 0.15);

  const rng = new Rng(777);
  let genome = randomGenome(rng);
  let biggest = 0;
  for (let i = 0; i < 2000; i++) {
    const r = mutate(genome, rng);
    expect(validateGenome(r.genome), `mutation ${i}`).toBeNull();
    biggest = Math.max(biggest, r.genome.parts.length);
    genome = r.genome;
    if (i % 400 === 399) genome = randomGenome(rng);
  }
  expect(biggest).toBeLessThanOrEqual(MAX_PARTS);
});
