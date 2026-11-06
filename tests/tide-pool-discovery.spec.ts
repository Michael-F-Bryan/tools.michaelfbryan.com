import { test, expect } from "@playwright/test";
import { validateGenome } from "../src/entries/tide-pool/genome";
import { SEED_POPULATION, type PartGene } from "../src/entries/tide-pool/types";
import { World } from "../src/entries/tide-pool/world";
import { evolve, founderGenome, hashGenome } from "../src/entries/tide-pool/discovery";

const shape = (p: PartGene) => JSON.stringify({ ...p, ampWeights: undefined, freqWeights: undefined });

test("the founder validates and every sensory weight is exactly zero", () => {
  const g = founderGenome();
  expect(validateGenome(g)).toBeNull();
  const n = g.parts.filter((p) => p.kind === "sensor").length;
  expect(n).toBe(1);
  for (const p of g.parts) {
    for (const w of [p.ampWeights, p.freqWeights]) {
      expect(w).toHaveLength(2 * n + 1);
      for (let i = 0; i < 2 * n; i++) expect(Object.is(w[i], 0)).toBe(true);
    }
  }
  // The only non-zero weight is the (non-sensory) bias, identical on both fins.
  expect(g.parts[1].ampWeights).toEqual(g.parts[2].ampWeights);
  expect(g.parts[1].ampWeights[2]).toBe(-0.4);
  expect(hashGenome(g)).toMatch(/^[0-9a-f]{64}$/);
});

test("evolve is deterministic, controller-only, and every census weight is reachable through the birth log", () => {
  test.setTimeout(180_000);
  const a = evolve(1000, 2, { scentBlind: false });
  const b = evolve(1000, 2, { scentBlind: false });
  expect(a.census.map((c) => c.hash)).toEqual(b.census.map((c) => c.hash));
  expect(a.births.map((x) => x.hash)).toEqual(b.births.map((x) => x.hash));
  expect(a.births.length).toBeGreaterThan(0);
  expect(a.population).toBeGreaterThan(0);

  const founder = founderGenome();
  const founderHash = hashGenome(founder);
  expect(a.founderHash).toBe(founderHash);
  const childHashes = new Set(a.births.map((x) => x.hash));
  for (const c of a.census) {
    expect(c.hash === founderHash || childHashes.has(c.hash)).toBe(true);
    expect(hashGenome(c.genome)).toBe(c.hash);
    expect(validateGenome(c.genome)).toBeNull();
    // Controller-only: nothing but weights may differ from the founder.
    expect(c.genome.parts.map(shape)).toEqual(founder.parts.map(shape));
    expect(c.genome.hue).toBe(founder.hue);
    expect(c.genome.reproduceAt).toBe(founder.reproduceAt);
    for (const p of c.genome.parts) for (const w of [...p.ampWeights, ...p.freqWeights]) expect(Math.abs(w)).toBeLessThanOrEqual(2);
  }
  expect(a.census.some((c) => c.hash !== founderHash)).toBe(true);

  // Birth log is a closed genealogy: each parent is a founder id or an earlier child.
  const known = new Set<number>(Array.from({ length: SEED_POPULATION }, (_, i) => i + 1));
  for (const birth of a.births) {
    expect(known.has(birth.parent)).toBe(true);
    known.add(birth.child);
  }
});

test("the default world still seeds 36 random genomes and is unaffected by the discovery options", () => {
  const w = new World(5);
  expect(w.organisms).toHaveLength(SEED_POPULATION);
  expect(new Set(w.organisms.map((o) => hashGenome(o.genome))).size).toBeGreaterThan(30);
  expect(w.birthLog).toHaveLength(0);
  const same = new World(5, {}, undefined, {});
  expect(same.organisms.map((o) => JSON.stringify([o.genome, o.position, o.heading]))).toEqual(
    w.organisms.map((o) => JSON.stringify([o.genome, o.position, o.heading])),
  );
  for (let i = 0; i < 600; i++) {
    w.step();
    same.step();
  }
  expect(JSON.stringify(same.organisms.map((o) => o.position))).toBe(JSON.stringify(w.organisms.map((o) => o.position)));
});
