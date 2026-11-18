/** Seeded PRNG (mulberry32) so a run is reproducible from its seed. */
export type Random = Readonly<{
  /** Uniform float in [0, 1). */
  float: () => number;
  /** Uniform float in [min, max). */
  range: (min: number, max: number) => number;
}>;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { float, range: (min, max) => min + float() * (max - min) };
}
