/**
 * Shared contract for the Tide Pool simulator.
 *
 * Module ownership (keep these boundaries; import only across them via this file):
 * - `random.ts`, `genome.ts`, `scent.ts`, `world.ts`: ecology (seeding, mutation,
 *   food, scent, metabolism, reproduction, death, lineages, environment knobs).
 * - `body.ts`, `controller.ts`, `physics.ts`: creature engine (kinematics from a
 *   genome plus joint angles, sensorimotor controller, simplified water model).
 * - `renderer.ts`, `tide-pool.tsx`, `pool.module.css`: presentation and controls.
 *
 * World units: 1 unit ≈ 1 mm of pool. The pool is `World.width` × `World.height`.
 * Angles in radians, time in seconds. The simulation steps at a fixed `DT`.
 */

export const DT = 1 / 60;

/** Pool size in world units. The renderer scales to the canvas. */
export const POOL_WIDTH = 960;
export const POOL_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Genome
// ---------------------------------------------------------------------------

export type PartKind = "trunk" | "fin" | "sensor";

/**
 * One connected body component. `parts[0]` is always the root trunk (the head:
 * its base is the mouth). Every other part attaches to an earlier part, so the
 * array is in topological order and the body is a tree.
 */
export type PartGene = {
  /** Stable identity within a lineage so inspectors can follow a part through mutations. */
  id: number;
  kind: PartKind;
  /** Index into `parts` of the parent; `-1` for the root only. */
  parent: number;
  /** Where on the parent this part attaches: 0 = parent's base, 1 = parent's tip. */
  anchor: number;
  /** Which side of the parent it hangs from: -1 left, 0 inline (continues the parent), 1 right. */
  side: -1 | 0 | 1;
  /** Rest angle relative to the parent's direction (radians). Mirrored by `side` in kinematics. */
  angle: number;
  /** Segment length and width in world units. Sensors are small; width is their stalk width. */
  length: number;
  width: number;
  /**
   * Joint oscillator. All non-root parts may oscillate (trunk joints give body
   * waves; fins give strokes). `amplitude` 0 means a rigid joint.
   * joint angle(t) = angle + amplitude · wave(2π·frequency·t + phase), where
   * `skew` in (0,1) shapes `wave` so one half-stroke is faster than the return
   * (0.5 = symmetric sine). The engine may add sensor-driven modulation.
   */
  frequency: number;
  amplitude: number;
  phase: number;
  skew: number;
  /**
   * Passive feathering in [0,1): drag area multiplier is (1 - feather) during the
   * return half-stroke, so evolution can discover power/recovery strokes.
   */
  feather: number;
  /**
   * Sensorimotor weights, aligned with the organism's sensors in `parts` order,
   * plus a trailing bias weight (length = sensorCount + 1). Amplitude multiplier =
   * clamp(1 + Σ w_i · s_i, 0, 2); `freqWeights` likewise scale frequency. Mutation
   * keeps these aligned when sensors are added or removed.
   */
  ampWeights: number[];
  freqWeights: number[];
};

export type Genome = {
  parts: PartGene[];
  /** Lineage colour hue in degrees [0,360). Drifts a little per mutation, more on topology change. */
  hue: number;
  /** Fraction of energy capacity at which the organism divides, in [0.5, 1]. */
  reproduceAt: number;
};

// ---------------------------------------------------------------------------
// Live organism state
// ---------------------------------------------------------------------------

export type Vec2 = { x: number; y: number };

/** Computed world-space pose of one part for this frame. */
export type PartPose = {
  /** Base and tip of the segment in world units. */
  base: Vec2;
  tip: Vec2;
  /** Current joint angle actually applied this frame (rest + oscillation). */
  jointAngle: number;
  /** World-space heading of the segment, radians. */
  heading: number;
};

export type Organism = {
  id: number;
  genome: Genome;
  /** Lineage id. Changes when a mutation alters body topology (part added/removed/kind changed). */
  lineage: number;
  /** Lineage the parent belonged to when this lineage branched. -1 for seeded organisms. */
  parentLineage: number;
  generation: number;
  /** Position of the root base (mouth), heading of the root trunk, velocity, angular velocity. */
  position: Vec2;
  heading: number;
  velocity: Vec2;
  angularVelocity: number;
  /** Internal clock for oscillators, seconds since birth. */
  age: number;
  /** Energy in joules-ish; dies at 0. `capacity` is derived from body mass. */
  energy: number;
  capacity: number;
  /** Total segment area, used as mass. */
  mass: number;
  /** Last frame's sensor readings, one per sensor in `parts` order. */
  senses: number[];
  /** Per-part world poses computed by `stepOrganism`; aligned with `genome.parts`. */
  poses: PartPose[];
  /** Food eaten and children produced so far, for inspection. */
  meals: number;
  offspring: number;
  /** Recent root positions for drawing a trail (renderer reads, engine appends; capped). */
  trail: Vec2[];
};

// ---------------------------------------------------------------------------
// Environment and water
// ---------------------------------------------------------------------------

export type Environment = {
  /** Food particles spawned per second, 0..~3. */
  foodRate: number;
  /** Current strength in units/s and direction in radians. */
  currentStrength: number;
  currentAngle: number;
  /** Metabolic multiplier, 0.5 (cold) .. 2 (warm). */
  temperature: number;
  /** Water thickness multiplier applied to drag, 0.5 .. 2. */
  viscosity: number;
};

export const DEFAULT_ENVIRONMENT: Environment = {
  foodRate: 1.2,
  currentStrength: 0,
  currentAngle: 0,
  temperature: 1,
  viscosity: 1,
};

/** What the creature engine needs from the world each step. */
export type Water = {
  env: Environment;
  /** Ambient water velocity at a point (current field). */
  flowAt(point: Vec2): Vec2;
  /** Scent concentration at a point, roughly [0, 1]. */
  scentAt(point: Vec2): number;
  width: number;
  height: number;
};

/** Energy spent this step, reported by the engine so ecology can bill it. */
export type StepCost = {
  /** Work done by joints (sum |Δangle| · area), before temperature scaling. */
  work: number;
};

/**
 * The creature engine entry point (physics.ts). Advances pose, forces and
 * motion by `dt`, updates `organism.poses`, `senses`, `position`, `heading`,
 * `velocity`, `angularVelocity`, `age`, appends to `trail`, and returns the
 * mechanical cost. It must not touch energy, reproduction, food or lineage.
 */
export type StepOrganism = (organism: Organism, water: Water, dt: number) => StepCost;

// ---------------------------------------------------------------------------
// World (ecology)
// ---------------------------------------------------------------------------

export type Food = {
  id: number;
  position: Vec2;
  /** Energy granted when eaten. */
  energy: number;
  age: number;
};

export type WorldEvent =
  | { kind: "birth"; time: number; organism: number; lineage: number }
  | { kind: "death"; time: number; organism: number; lineage: number; cause: "starved" | "age" }
  | { kind: "lineage"; time: number; organism: number; lineage: number; parentLineage: number }
  | { kind: "extinct"; time: number; lineage: number };

export type LineageSummary = {
  id: number;
  parentLineage: number;
  hue: number;
  count: number;
  /** World time of first appearance. */
  born: number;
  /** A representative genome (most recent member) for drawing a lineage glyph. */
  exemplar: Genome;
  /** Lifetime totals across members. */
  totalBirths: number;
  totalMeals: number;
};

export type Stats = {
  time: number;
  population: number;
  food: number;
  lineages: number;
  births: number;
  deaths: number;
  /** Mean swimming speed (units/s) over living organisms. */
  meanSpeed: number;
  /** Meals per organism-minute over the last minute of world time. */
  foragingRate: number;
};

/** Read-only view the renderer and UI consume each frame. */
export type WorldView = {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly env: Environment;
  readonly organisms: readonly Organism[];
  readonly food: readonly Food[];
  readonly stats: Stats;
  /** Sampled every ~2 s of world time, oldest first, capped (~600 entries). */
  readonly history: readonly Stats[];
  /** Most recent events, oldest first, capped (~60). */
  readonly events: readonly WorldEvent[];
  lineages(): LineageSummary[];
  scentAt(point: Vec2): number;
  flowAt(point: Vec2): Vec2;
  organismAt(point: Vec2, radius: number): Organism | undefined;
  getOrganism(id: number): Organism | undefined;
};

/** Mutable world API used by the controls. */
export type WorldControls = {
  /** Advance by one fixed `DT`. Call it `speed` times per frame. */
  step(): void;
  setEnvironment(patch: Partial<Environment>): void;
  /** Visible intervention: drop a handful of food at a point. */
  dropFood(point: Vec2, count?: number): void;
  readonly seed: number;
};

export type WorldLike = WorldView & WorldControls;

/** Initial population size when seeding a pool. */
export const SEED_POPULATION = 36;
export const MAX_POPULATION = 160;
export const MAX_FOOD = 320;
