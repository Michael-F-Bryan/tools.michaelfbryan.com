import { test, expect } from "@playwright/test";
import { describeGenome, genomeMass, mutate, randomGenome, validateGenome } from "../src/entries/tide-pool/genome";
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
  type Organism,
  type StepOrganism,
} from "../src/entries/tide-pool/types";
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
  return { work: 8 };
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
