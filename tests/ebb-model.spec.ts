import { test, expect } from "@playwright/test";
import { Field, MAX_SENTENCES } from "../src/entries/ebb/model";
import { Markov, Vocabulary } from "../src/entries/ebb/markov";
import { SEEDS } from "../src/entries/ebb/seeds";

function field() {
  const value = new Field(SEEDS);
  value.resize({ cols: 90, rows: 24, cellW: 10, cellH: 24, ox: 16, oy: 12, width: 932, height: 600 });
  value.seed();
  return value;
}

test("seeded sentences evolve without invalid positions or unbounded state", () => {
  const value = field();
  expect(value.sentences.length).toBeGreaterThan(0);
  for (let i = 0; i < 6000; i++) { value.tick(.05); value.drainSoundEvents(); }
  const stats = value.stats();
  expect(stats.nan).toBe(0);
  expect(stats.lost).toBeGreaterThan(0);
  expect(stats.sentences).toBeLessThanOrEqual(MAX_SENTENCES);
  expect(stats.ghosts).toBeLessThanOrEqual(500);
});

test("holding stops a sentence decaying; release and stirring resume movement", () => {
  const value = field();
  const sentence = value.sentences[0];
  const original = sentence.glyphs.map(g => g?.ch ?? null);
  value.hold(sentence);
  for (let i = 0; i < 1200; i++) { value.tick(.05); value.drainSoundEvents(); }
  expect(sentence.glyphs.map(g => g?.ch ?? null)).toEqual(original);
  const glyph = sentence.glyphs.find(g => g)!;
  value.stir(glyph.x, glyph.y, 1000, 1000);
  expect(glyph.vx).toBe(0);
  value.release(sentence);
  value.stir(glyph.x, glyph.y, 1000, 1000);
  expect(glyph.vx).not.toBe(0);
});

test("planting normalises, caps input and capacity and keeps vocabularies separate", () => {
  const value = field();
  expect(value.plant("  ", null)).toBeNull();
  expect(value.plant("  A   fresh sentence  ", { col: -100, row: 100 })?.text).toBe("A fresh sentence");
  for (let i = 0; i < 120; i++) value.plant("a".repeat(200), null);
  expect(value.sentences.length).toBe(MAX_SENTENCES);
  expect(value.sentences.at(-1)?.text.length).toBe(140);
  const a = new Vocabulary(SEEDS), b = new Vocabulary(SEEDS);
  a.learn("platypus");
  expect(a.has("Platypus!")).toBe(true);
  expect(b.has("platypus")).toBe(false);
});

test("reduced motion does not stir or translate loose letters", () => {
  const value = field();
  value.reducedMotion = true;
  const glyph = value.sentences[0].glyphs.find(g => g)!;
  value.stir(glyph.x, glyph.y, 1000, 1000);
  expect(glyph.vx).toBe(0);
  for (let i = 0; i < 200; i++) { value.tick(.05); value.drainSoundEvents(); }
  const positions = value.loose.map(g => [g, g.x, g.y] as const);
  value.tick(.05);
  for (const [g, x, y] of positions) { expect(g.x).toBe(x); expect(g.y).toBe(y); }
});

test("Markov recombinations remain bounded sentences with seed fallback", () => {
  const chain = new Markov();
  expect(chain.generate(SEEDS)).toBeTruthy();
  for (const text of SEEDS) chain.feed(text, 2);
  for (let i = 0; i < 300; i++) {
    const result = chain.generate(SEEDS);
    expect(result).toMatch(/[.!?]$/);
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(result).not.toMatch(/[\u0000\u0001]/);
  }
});
