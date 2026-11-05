import { genomeMass, mutate, randomGenome, sensorCount } from "./genome";
import { stepOrganism } from "./physics";
import { Rng } from "./random";
import { SCENT, ScentField, type ScentFlow } from "./scent";
import {
  DEFAULT_ENVIRONMENT,
  DT,
  MAX_FOOD,
  MAX_POPULATION,
  POOL_HEIGHT,
  POOL_WIDTH,
  SEED_POPULATION,
  type Environment,
  type Food,
  type Genome,
  type LineageSummary,
  type Organism,
  type PartPose,
  type Stats,
  type StepOrganism,
  type Vec2,
  type WorldEvent,
  type WorldLike,
  type FoodPatch,
} from "./types";

/**
 * Every ecology constant lives here. Energy units are arbitrary "joules"; a typical
 * body (mass ≈ 250) has capacity ≈ 50, so a meal is worth about 0.6 of a full stomach.
 *
 * Energy balance at the default environment (temperature 1):
 *   basal drain ≈ basalPerMass · mass          (≈ 0.28 / s for mass 250)
 *   swimming    ≈ workCost · work · 60         (depends on the real physics' work scale)
 *   income      ≈ foodRate · foodEnergy        (≈ 36 / s shared by the whole pool)
 * so a drifter starves ~100 s after birth, and the food supply sustains roughly
 * 40–100 organisms. Retune `foodEnergy` and `workCost` first once the real physics lands.
 */
const CONTACT_CELL = 40;
const contactPts = { ax: 0, ay: 0, bx: 0, by: 0 };

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function closestOnSegments(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2, out: typeof contactPts): void {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y;
  const rx = p1.x - p2.x, ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  out.ax = p1.x + d1x * s; out.ay = p1.y + d1y * s;
  out.bx = p2.x + d2x * t; out.by = p2.y + d2y * t;
}

/** Translate an organism rigidly, keeping its cached poses consistent with its root position. */
function shiftOrganism(o: Organism, dx: number, dy: number): void {
  o.position.x += dx;
  o.position.y += dy;
  for (const p of o.poses) { p.base.x += dx; p.base.y += dy; p.tip.x += dx; p.tip.y += dy; }
}

export const TUNING = {
  // --- Body energetics -----------------------------------------------------
  /** Energy capacity = capacityBase + capacityPerMass · mass. Bigger bodies store more, but sublinearly vs. their upkeep. */
  capacityBase: 30,
  capacityPerMass: 0.08,
  /** Basal energy drain per second per unit mass (× temperature). Raise to make starvation faster. */
  basalPerMass: 0.0008,
  /** Energy per unit of joint work reported by physics (× temperature). Raise to make swimming costlier. */
  workCost: 0.02,
  /** Energy per second each sensor costs (× temperature) plus a share per unit of stalk length, so reach has a price. */
  sensorUpkeep: 0.012,
  sensorUpkeepPerLength: 0.0007,
  /**
   * Crowding: organisms whose mouths are within `crowdRadius` share oxygen and
   * grazing ground, so every neighbour (up to `crowdCap`) adds `crowdCost` of the
   * basal drain. Neighbour counts refresh every `crowdEverySteps` steps.
   */
  crowdRadius: 30,
  crowdCost: 0.04,
  crowdCap: 8,
  crowdEverySteps: 10,
  /** Organism-organism contact: damped spring between root-trunk capsules (stiffness 1/s^2, damping 1/s, share of overlap removed outright). */
  contactStiffness: 400,
  contactDamping: 14,
  contactPush: 0.3,
  /** Seeded organisms start with this fraction of capacity. */
  startEnergy: 0.6,

  // --- Food ----------------------------------------------------------------
  /** Energy in one food particle (±foodJitter). Larger = easier living, bigger population. */
  foodEnergy: 34,
  foodJitter: 0.2,
  /** Particles already floating when a pool is created, so the first minute is not a famine. */
  initialFood: 90,
  /** Uneaten food dissolves after this many seconds, keeping the pool from silting up. */
  foodLifetime: 300,
  /**
   * Share of the nominal food rate that is emitted by patches rather than scattered uniformly.
   * Patch output is absolute in stock (see spawnFood), so total food depends on stock: that is the
   * point. The remaining (1 - patchShare) is scattered regardless and is the famine floor.
   */
  patchShare: 0.85,
  /** Number of drifting rich patches, their radius range, and wander speed (units/s). */
  patchCount: 4,
  patchRadius: [60, 90] as const,
  patchSpeed: 3,
  /** Each meal taken inside a patch removes this much of its stock (0..1); the patch's spawn rate is proportional to its stock. */
  patchGrazePerMeal: 0.04,
  /** Logistic regrowth rate (1/s) of stock: slow, so a grazed-down patch takes minutes to come back. */
  patchRecovery: 0.02,
  /** Stock never falls below this; high enough that logistic regrowth from the floor (~0.0015/s) is meaningful. */
  patchMinStock: 0.08,
  /** Keep patches this far from the walls when seeding. */
  patchMargin: 80,
  /** Distance from the wall that food and spawns keep. */
  margin: 8,

  // --- Reproduction and death ----------------------------------------------
  /** Fraction of the parent's capacity lost to the act of dividing. */
  birthCost: 0.12,
  /** Seconds of life before an organism may divide (prevents instant re-division). */
  matureAge: 20,
  /** Typical lifespan in world seconds, scaled by mass: bigger bodies live a little longer. */
  maxAge: 240,
  maxAgeMassBias: 0.25,
  referenceMass: 250,
  /** Distance a newborn appears from its parent. */
  birthOffset: 14,

  // --- Mouth ---------------------------------------------------------------
  /** Mouth radius = root width / 2 + this. */
  mouthPadding: 4,
  /**
   * Handling time (s): a particle is eaten only after the mouth has stayed within reach of THAT
   * particle for this long (cumulative, reset when contact breaks). 0 = instant ingestion.
   *
   * Why 0.6 (measured, 20 simulated minutes per run, one run per seed; mouthOverCom = mouth
   * path / centre-of-mass path among evolved bodies, ablationLoss = share of meals lost when
   * every sensor weight is zeroed in a head-to-head garden):
   *   seed:          11     23     100    101    102    103
   *   mouthOverCom   1.87   2.50   2.57   2.49   5.28   2.95   at 0
   *                  2.20   1.54   1.70   1.99   2.41   2.93   at 0.6
   *   ablationLoss  -0.41  -0.02  -0.31  +0.28  +0.06  +0.25   at 0
   *                 +0.22  +0.68  -0.20  -0.10  +0.49  +0.40   at 0.6
   * With instant ingestion a mouth swept through food feeds as well as one steered to it, so
   * sensing was worth nothing on average; with a dwell it has to arrive and stay, and sensing
   * starts to pay (mean ablation loss -0.03 -> +0.25, better on 5 of 6 seeds; mouthOverCom
   * mean 2.94 -> 2.13, better on 5 of 6). No run went extinct (end population 65-145).
   * Known cost: on seed 100 the evolved population no longer out-forages the seed genomes
   * head-to-head (gain 0.8). 0.2 and 0.35 were weaker on both counts.
   */
  handlingTime: 0.6,

  // --- Water ---------------------------------------------------------------
  /** Large-scale swirl speed as a fraction of env.currentStrength (zero when strength is 0). */
  swirlFraction: 0.6,
  /** Steps between swirl refreshes (it drifts slowly) and between scent updates. */
  swirlRefreshSteps: 30,
  scentEverySteps: 3,
};

/** Seconds of world time between history samples. */
const HISTORY_INTERVAL = 2;
const HISTORY_CAP = 600;
const EVENT_CAP = 60;
const FOOD_HASH_CELL = 20;
const STEPS_PER_SECOND = Math.round(1 / DT);

/** Energy per second the organism's sensors cost at temperature 1. */
export function sensorUpkeepFor(genome: Genome): number {
  let total = 0;
  for (const p of genome.parts) if (p.kind === "sensor") total += TUNING.sensorUpkeep + TUNING.sensorUpkeepPerLength * p.length;
  return total;
}

export function capacityFor(mass: number): number {
  return TUNING.capacityBase + TUNING.capacityPerMass * mass;
}

type LineageRecord = {
  id: number;
  parentLineage: number;
  count: number;
  born: number;
  exemplar: Genome;
  totalBirths: number;
  totalMeals: number;
};


const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class World implements WorldLike {
  readonly width = POOL_WIDTH;
  readonly height = POOL_HEIGHT;
  readonly organisms: Organism[] = [];
  readonly food: Food[] = [];
  readonly history: Stats[] = [];
  readonly events: WorldEvent[] = [];
  /** Slowly drifting rich areas, exposed so the renderer can hint at them. */
  readonly patches: FoodPatch[] = [];
  env: Environment;
  time = 0;
  stats: Stats;

  private readonly rng: Rng;
  private readonly scent = new ScentField(POOL_WIDTH, POOL_HEIGHT);
  private readonly swirlX: Float32Array;
  private readonly swirlY: Float32Array;
  private readonly patchHeading: number[] = [];
  private readonly lineageRecords = new Map<number, LineageRecord>();
  private readonly pendingBirths: Organism[] = [];
  private readonly crowding = new Map<number, number>();
  private contactHead = new Int32Array(0);
  private contactNext = new Int32Array(0);
  private stepCount = 0;
  private births = 0;
  private deaths = 0;
  private nextOrganismId = 1;
  private nextFoodId = 1;
  private nextLineageId = 1;

  // Spatial hash of food for mouth lookups.
  private readonly hashCols = Math.ceil(POOL_WIDTH / FOOD_HASH_CELL);
  private readonly hashRows = Math.ceil(POOL_HEIGHT / FOOD_HASH_CELL);
  private readonly hashHead: Int32Array;
  private readonly hashNext = new Int32Array(MAX_FOOD);
  private readonly eaten = new Uint8Array(MAX_FOOD);

  // Rolling one-minute window (one bucket per second) for the foraging rate.
  private readonly mealBuckets = new Float64Array(60);
  private readonly popBuckets = new Float64Array(60);

  /**
   * `stepFn` defaults to the real creature engine; tests may inject a stub.
   */
  constructor(
    readonly seed: number,
    env: Partial<Environment> = {},
    private readonly stepFn: StepOrganism = stepOrganism,
  ) {
    this.rng = new Rng(seed);
    this.env = this.sanitize({ ...DEFAULT_ENVIRONMENT, ...env });
    this.hashHead = new Int32Array(this.hashCols * this.hashRows);
    this.swirlX = new Float32Array(this.scent.cols * this.scent.rows);
    this.swirlY = new Float32Array(this.scent.cols * this.scent.rows);
    this.refreshSwirl();
    this.seedPatches();
    for (let i = 0; i < TUNING.initialFood; i++) this.spawnOneFood();
    for (let i = 0; i < SEED_POPULATION; i++) this.seedOrganism();
    this.stats = this.computeStats();
    this.history.push(this.stats);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  capacityFor(mass: number): number {
    return capacityFor(mass);
  }

  setEnvironment(patch: Partial<Environment>): void {
    this.env = this.sanitize({ ...this.env, ...patch });
    this.refreshSwirl();
  }

  dropFood(point: Vec2, count = 6): void {
    for (let i = 0; i < count && this.food.length < MAX_FOOD; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = Math.sqrt(this.rng.float()) * 22;
      this.addFood(point.x + Math.cos(angle) * dist, point.y + Math.sin(angle) * dist);
    }
  }

  scentAt(point: Vec2): number {
    return this.scent.sample(point);
  }

  /** Uniform current plus a gentle, slowly evolving divergence-free swirl. */
  flowAt(point: Vec2): Vec2 {
    const strength = this.env.currentStrength;
    if (strength === 0) return { x: 0, y: 0 };
    const gx = point.x / (this.width / this.scent.cols) - 0.5;
    const gy = point.y / (this.height / this.scent.rows) - 0.5;
    return {
      x: Math.cos(this.env.currentAngle) * strength + this.gridSample(this.swirlX, gx, gy),
      y: Math.sin(this.env.currentAngle) * strength + this.gridSample(this.swirlY, gx, gy),
    };
  }

  getOrganism(id: number): Organism | undefined {
    return this.organisms.find(o => o.id === id);
  }

  /** Nearest organism whose body passes within `radius` of the point. */
  organismAt(point: Vec2, radius: number): Organism | undefined {
    let best: Organism | undefined;
    let bestDist = radius;
    for (const org of this.organisms) {
      const d = this.distanceToBody(org, point);
      if (d <= bestDist) {
        bestDist = d;
        best = org;
      }
    }
    return best;
  }

  lineages(): LineageSummary[] {
    const out: LineageSummary[] = [];
    for (const r of this.lineageRecords.values()) {
      out.push({
        id: r.id,
        parentLineage: r.parentLineage,
        hue: r.exemplar.hue,
        count: r.count,
        born: r.born,
        exemplar: r.exemplar,
        totalBirths: r.totalBirths,
        totalMeals: r.totalMeals,
      });
    }
    return out.sort((a, b) => b.count - a.count || a.id - b.id);
  }

  step(): void {
    this.stepCount++;
    this.time = this.stepCount * DT;
    this.openWindowBucket();
    if (this.stepCount % TUNING.swirlRefreshSteps === 0) this.refreshSwirl();
    this.driftPatches();
    this.spawnFood();
    this.moveFood();
    this.updateScent();
    this.hashFood();

    const list = this.organisms;
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const org = list[read];
      if (this.stepOrganism(org)) list[write++] = org;
    }
    list.length = write;
    this.resolveContacts();
    for (const child of this.pendingBirths) list.push(child);
    this.pendingBirths.length = 0;

    this.removeEaten();
    this.recordWindow();
    this.stats = this.computeStats();
    if (this.stepCount % Math.round(HISTORY_INTERVAL / DT) === 0) this.sampleHistory();
  }

  // -------------------------------------------------------------------------
  // Seeding
  // -------------------------------------------------------------------------

  private sanitize(env: Environment): Environment {
    const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
    return {
      foodRate: clamp(finite(env.foodRate, 1.2), 0, 5),
      currentStrength: clamp(finite(env.currentStrength, 0), 0, 100),
      currentAngle: finite(env.currentAngle, 0),
      temperature: clamp(finite(env.temperature, 1), 0.5, 2),
      viscosity: clamp(finite(env.viscosity, 1), 0.5, 2),
    };
  }

  private seedPatches(): void {
    const [minR, maxR] = TUNING.patchRadius;
    for (let i = 0; i < TUNING.patchCount; i++) {
      this.patches.push({
        position: { x: this.rng.range(TUNING.patchMargin, this.width - TUNING.patchMargin), y: this.rng.range(TUNING.patchMargin, this.height - TUNING.patchMargin) },
        radius: this.rng.range(minR, maxR),
        stock: 1,
        grazed: 0,
      });
      this.patchHeading.push(this.rng.range(0, Math.PI * 2));
    }
  }

  private seedOrganism(): void {
    const genome = randomGenome(this.rng);
    const position = { x: this.rng.range(40, this.width - 40), y: this.rng.range(40, this.height - 40) };
    const lineage = this.newLineage(-1, genome);
    this.lineageRecords.get(lineage)!.count = 1;
    const org = this.makeOrganism(genome, position, this.rng.range(-Math.PI, Math.PI), lineage, -1, 0);
    org.energy = org.capacity * TUNING.startEnergy;
    this.organisms.push(org);
  }

  private makeOrganism(genome: Genome, position: Vec2, heading: number, lineage: number, parentLineage: number, generation: number): Organism {
    const mass = genomeMass(genome);
    const capacity = capacityFor(mass);
    const poses: PartPose[] = genome.parts.map(() => ({
      base: { x: position.x, y: position.y },
      tip: { x: position.x, y: position.y },
      jointAngle: 0,
      heading,
    }));
    return {
      id: this.nextOrganismId++,
      genome,
      lineage,
      parentLineage,
      generation,
      position,
      heading,
      velocity: { x: 0, y: 0 },
      angularVelocity: 0,
      age: 0,
      energy: capacity * 0.5,
      capacity,
      mass,
      senses: new Array<number>(sensorCount(genome)).fill(0),
      poses,
      meals: 0,
      offspring: 0,
      trail: [],
    };
  }

  private newLineage(parentLineage: number, genome: Genome): number {
    const id = this.nextLineageId++;
    this.lineageRecords.set(id, { id, parentLineage, count: 0, born: this.time, exemplar: genome, totalBirths: 0, totalMeals: 0 });
    return id;
  }

  // -------------------------------------------------------------------------
  // Food
  // -------------------------------------------------------------------------

  private addFood(x: number, y: number): void {
    const m = TUNING.margin;
    const jitter = 1 + (this.rng.float() * 2 - 1) * TUNING.foodJitter;
    this.food.push({
      id: this.nextFoodId++,
      position: { x: clamp(x, m, this.width - m), y: clamp(y, m, this.height - m) },
      energy: TUNING.foodEnergy * jitter,
      age: 0,
    });
  }

  /** Integer count with the given expectation (floor plus a Bernoulli on the remainder). */
  private stochasticCount(expected: number): number {
    return Math.floor(expected) + (this.rng.chance(expected % 1) ? 1 : 0);
  }

  /**
   * Food spawning is ABSOLUTE in patch stock. The scattered share arrives uniformly regardless of
   * stock (the famine floor); each patch independently contributes
   * foodRate * patchShare * DT * stock / patchCount, so full patches reproduce the nominal rate
   * while a grazed-down patch really goes quiet and total food falls when every patch is depleted.
   */
  private spawnFood(): void {
    const n = this.patches.length;
    const share = n > 0 ? TUNING.patchShare : 0;
    const scattered = this.stochasticCount(this.env.foodRate * (1 - share) * DT);
    for (let i = 0; i < scattered && this.food.length < MAX_FOOD; i++) {
      this.addFood(this.rng.range(0, this.width), this.rng.range(0, this.height));
    }
    for (const patch of this.patches) {
      const count = this.stochasticCount((this.env.foodRate * share * DT * patch.stock) / n);
      for (let i = 0; i < count && this.food.length < MAX_FOOD; i++) {
        this.addFood(patch.position.x + this.rng.gaussian() * patch.radius * 0.5, patch.position.y + this.rng.gaussian() * patch.radius * 0.5);
      }
    }
  }

  /** One seed particle (initial food only): patch-clustered with the patch share, otherwise scattered. */
  private spawnOneFood(): void {
    if (this.patches.length > 0 && this.rng.chance(TUNING.patchShare)) {
      const patch = this.patches[Math.floor(this.rng.float() * this.patches.length) % this.patches.length];
      this.addFood(patch.position.x + this.rng.gaussian() * patch.radius * 0.5, patch.position.y + this.rng.gaussian() * patch.radius * 0.5);
    } else {
      this.addFood(this.rng.range(0, this.width), this.rng.range(0, this.height));
    }
  }

  private driftPatches(): void {
    this.patches.forEach((patch, i) => {
      // Slow logistic regrowth of the food stock; grazing (see consume) takes it back down.
      patch.stock = Math.min(1, Math.max(TUNING.patchMinStock, patch.stock + TUNING.patchRecovery * patch.stock * (1 - patch.stock) * DT));
      this.patchHeading[i] += this.rng.gaussian() * 0.4 * Math.sqrt(DT);
      const next = {
        x: patch.position.x + Math.cos(this.patchHeading[i]) * TUNING.patchSpeed * DT,
        y: patch.position.y + Math.sin(this.patchHeading[i]) * TUNING.patchSpeed * DT,
      };
      // Turn around at the pool edge so patches stay in view.
      if (next.x < 80 || next.x > this.width - 80) this.patchHeading[i] = Math.PI - this.patchHeading[i];
      if (next.y < 80 || next.y > this.height - 80) this.patchHeading[i] = -this.patchHeading[i];
      patch.position.x = clamp(next.x, 80, this.width - 80);
      patch.position.y = clamp(next.y, 80, this.height - 80);
    });
  }

  /** Advect food with the current, age it, and drop expired particles. */
  private moveFood(): void {
    const moving = this.env.currentStrength > 0;
    const m = TUNING.margin;
    let write = 0;
    for (let read = 0; read < this.food.length; read++) {
      const f = this.food[read];
      f.age += DT;
      if (f.age > TUNING.foodLifetime) continue;
      if (moving) {
        const flow = this.flowAt(f.position);
        f.position.x = clamp(f.position.x + flow.x * DT, m, this.width - m);
        f.position.y = clamp(f.position.y + flow.y * DT, m, this.height - m);
      }
      this.food[write++] = f;
    }
    this.food.length = write;
  }

  private hashFood(): void {
    this.hashHead.fill(-1);
    for (let i = 0; i < this.food.length; i++) {
      const cell = this.hashCell(this.food[i].position.x, this.food[i].position.y);
      this.hashNext[i] = this.hashHead[cell];
      this.hashHead[cell] = i;
    }
  }

  private hashCell(x: number, y: number): number {
    const cx = clamp(Math.floor(x / FOOD_HASH_CELL), 0, this.hashCols - 1);
    const cy = clamp(Math.floor(y / FOOD_HASH_CELL), 0, this.hashRows - 1);
    return cy * this.hashCols + cx;
  }

  private removeEaten(): void {
    let write = 0;
    for (let read = 0; read < this.food.length; read++) {
      if (this.eaten[read]) continue;
      this.food[write++] = this.food[read];
    }
    this.eaten.fill(0, 0, this.food.length);
    this.food.length = write;
  }

  // -------------------------------------------------------------------------
  // Water
  // -------------------------------------------------------------------------

  /** Recompute the swirl grid: stream function ψ = c·sin(kx·x+a)·sin(ky·y+b), u = ∂ψ/∂y, v = -∂ψ/∂x. */
  private refreshSwirl(): void {
    const speed = this.env.currentStrength * TUNING.swirlFraction;
    const { cols, rows } = this.scent;
    if (speed === 0) {
      this.swirlX.fill(0);
      this.swirlY.fill(0);
      return;
    }
    const kx = (Math.PI * 2) / this.width;
    const ky = (Math.PI * 2) / this.height;
    const a = this.time * 0.05;
    const b = this.time * 0.037 + 1.3;
    for (let y = 0; y < rows; y++) {
      const py = ((y + 0.5) * this.height) / rows;
      for (let x = 0; x < cols; x++) {
        const px = ((x + 0.5) * this.width) / cols;
        const i = y * cols + x;
        this.swirlX[i] = speed * Math.sin(kx * px + a) * Math.cos(ky * py + b);
        this.swirlY[i] = -speed * (kx / ky) * Math.cos(kx * px + a) * Math.sin(ky * py + b);
      }
    }
  }

  private gridSample(grid: Float32Array, gxIn: number, gyIn: number): number {
    const { cols, rows } = this.scent;
    const gx = clamp(gxIn, 0, cols - 1);
    const gy = clamp(gyIn, 0, rows - 1);
    const x0 = Math.min(cols - 2, Math.floor(gx));
    const y0 = Math.min(rows - 2, Math.floor(gy));
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * cols + x0;
    const top = grid[i] * (1 - fx) + grid[i + 1] * fx;
    const bottom = grid[i + cols] * (1 - fx) + grid[i + cols + 1] * fx;
    return top * (1 - fy) + bottom * fy;
  }

  private updateScent(): void {
    const amount = TUNING.scentEverySteps * DT;
    for (const f of this.food) this.scent.deposit(f.position.x, f.position.y, SCENT.depositRate * DT);
    if (this.stepCount % TUNING.scentEverySteps !== 0) return;
    const s = this.env.currentStrength;
    const flow: ScentFlow | undefined =
      s > 0
        ? { ux: Math.cos(this.env.currentAngle) * s, uy: Math.sin(this.env.currentAngle) * s, fx: this.swirlX, fy: this.swirlY }
        : undefined;
    this.scent.step(amount, flow);
  }

  // -------------------------------------------------------------------------
  // Organisms
  // -------------------------------------------------------------------------

  /** Advance one organism; returns false if it died. */
  private stepOrganism(org: Organism): boolean {
    const cost = this.stepFn(org, this, DT);
    this.keepInside(org);
    const T = this.env.temperature;
    const work = Number.isFinite(cost.work) ? cost.work : 0;
    const crowd = 1 + TUNING.crowdCost * (this.crowding.get(org.id) ?? 0);
    const drain = (TUNING.basalPerMass * org.mass * crowd + sensorUpkeepFor(org.genome)) * DT + work * TUNING.workCost;
    org.energy -= drain * T;
    this.eat(org);

    if (this.canReproduce(org)) this.reproduce(org);
    const cause = this.deathCause(org);
    if (cause) {
      this.die(org, cause);
      return false;
    }
    return true;
  }

  /** Keep the mouth inside the pool and cancel velocity into the wall. */
  private keepInside(org: Organism): void {
    const m = TUNING.margin;
    const p = org.position;
    if (p.x < m) { p.x = m; org.velocity.x = Math.max(0, org.velocity.x); }
    else if (p.x > this.width - m) { p.x = this.width - m; org.velocity.x = Math.min(0, org.velocity.x); }
    if (p.y < m) { p.y = m; org.velocity.y = Math.max(0, org.velocity.y); }
    else if (p.y > this.height - m) { p.y = this.height - m; org.velocity.y = Math.min(0, org.velocity.y); }
  }

  /**
   * Soft organism-organism contact. Each root trunk is a capsule (base to tip, radius
   * width / 2). Overlapping capsules push apart along the closest-point normal with a damped
   * spring on velocity (mass-weighted, so heavy bodies shove light ones) plus a small direct
   * position correction. The number of real contacts per organism is the crowding count
   * that `stepOrganism` bills through `crowdCost`.
   */
  private resolveContacts(): void {
    const list = this.organisms;
    this.crowding.clear();
    const cell = CONTACT_CELL;
    const cols = Math.ceil(this.width / cell);
    const rows = Math.ceil(this.height / cell);
    const heads = this.contactHead.length >= cols * rows ? this.contactHead : (this.contactHead = new Int32Array(cols * rows));
    heads.fill(-1, 0, cols * rows);
    if (this.contactNext.length < list.length) this.contactNext = new Int32Array(list.length * 2);
    const nextIdx = this.contactNext;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const p = o.poses[0];
      if (!p) continue;
      const cx = clamp(Math.floor((p.base.x + p.tip.x) * 0.5 / cell), 0, cols - 1);
      const cy = clamp(Math.floor((p.base.y + p.tip.y) * 0.5 / cell), 0, rows - 1);
      nextIdx[i] = heads[cy * cols + cx];
      heads[cy * cols + cx] = i;
    }
    const k = TUNING.contactStiffness * DT;
    const damp = TUNING.contactDamping * DT;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const pa = a.poses[0];
      if (!pa) continue;
      const ra = Math.max(0, a.genome.parts[0].width) / 2;
      const acx = clamp(Math.floor((pa.base.x + pa.tip.x) * 0.5 / cell), 0, cols - 1);
      const acy = clamp(Math.floor((pa.base.y + pa.tip.y) * 0.5 / cell), 0, rows - 1);
      for (let y = Math.max(0, acy - 1); y <= Math.min(rows - 1, acy + 1); y++) {
        for (let x = Math.max(0, acx - 1); x <= Math.min(cols - 1, acx + 1); x++) {
          for (let j = heads[y * cols + x]; j >= 0; j = nextIdx[j]) {
            if (j <= i) continue;
            const b = list[j];
            const pb = b.poses[0];
            const rr = ra + Math.max(0, b.genome.parts[0].width) / 2;
            closestOnSegments(pa.base, pa.tip, pb.base, pb.tip, contactPts);
            let nx = contactPts.bx - contactPts.ax;
            let ny = contactPts.by - contactPts.ay;
            const d2 = nx * nx + ny * ny;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2);
            if (d > 1e-6) { nx /= d; ny /= d; } else { const ang = (a.id * 2.399963 + b.id) % (2 * Math.PI); nx = Math.cos(ang); ny = Math.sin(ang); }
            const overlap = rr - d;
            const ma = Math.max(1e-3, a.mass);
            const mb = Math.max(1e-3, b.mass);
            const wa = mb / (ma + mb);
            const wb = ma / (ma + mb);
            // Relative approach speed along the normal (positive = closing).
            const closing = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * ny;
            const impulse = k * overlap + damp * Math.max(0, closing);
            a.velocity.x -= nx * impulse * wa;
            a.velocity.y -= ny * impulse * wa;
            b.velocity.x += nx * impulse * wb;
            b.velocity.y += ny * impulse * wb;
            const push = overlap * TUNING.contactPush;
            shiftOrganism(a, -nx * push * wa, -ny * push * wa);
            shiftOrganism(b, nx * push * wb, ny * push * wb);
            this.crowding.set(a.id, Math.min(TUNING.crowdCap, (this.crowding.get(a.id) ?? 0) + 1));
            this.crowding.set(b.id, Math.min(TUNING.crowdCap, (this.crowding.get(b.id) ?? 0) + 1));
          }
        }
      }
    }
  }

  private eat(org: Organism): void {
    if (org.energy >= org.capacity) {
      this.resetHandling(org);
      return;
    }
    const reach = org.genome.parts[0].width / 2 + TUNING.mouthPadding;
    const r2 = reach * reach;
    const cx = Math.floor(org.position.x / FOOD_HASH_CELL);
    const cy = Math.floor(org.position.y / FOOD_HASH_CELL);
    const handling = TUNING.handlingTime > 0;
    let targetIndex = -1;
    let nearest = -1;
    let nearestD2 = Infinity;
    for (let y = Math.max(0, cy - 1); y <= Math.min(this.hashRows - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(this.hashCols - 1, cx + 1); x++) {
        for (let i = this.hashHead[y * this.hashCols + x]; i >= 0; i = this.hashNext[i]) {
          if (this.eaten[i]) continue;
          const f = this.food[i];
          const dx = f.position.x - org.position.x;
          const dy = f.position.y - org.position.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (handling) {
            if (f.id === org.handlingFood) targetIndex = i;
            if (d2 < nearestD2) {
              nearestD2 = d2;
              nearest = i;
            }
            continue;
          }
          this.consume(org, i);
          if (org.energy >= org.capacity) return;
        }
      }
    }
    if (!handling) return;
    if (targetIndex >= 0) {
      org.handlingElapsed = (org.handlingElapsed ?? 0) + DT;
      org.handlingProgress = Math.min(1, org.handlingElapsed / TUNING.handlingTime);
      if (org.handlingElapsed >= TUNING.handlingTime - 1e-9) {
        this.consume(org, targetIndex);
        this.resetHandling(org);
      }
    } else if (nearest >= 0) {
      // Contact on a new particle (or the old one slipped away): start over.
      org.handlingFood = this.food[nearest].id;
      org.handlingElapsed = 0;
      org.handlingProgress = 0;
    } else {
      this.resetHandling(org);
    }
  }

  private resetHandling(org: Organism): void {
    if (org.handlingFood === undefined && !org.handlingProgress) return;
    org.handlingFood = undefined;
    org.handlingElapsed = 0;
    org.handlingProgress = 0;
  }

  private consume(org: Organism, i: number): void {
    const f = this.food[i];
    this.eaten[i] = 1;
    org.energy = Math.min(org.capacity, org.energy + f.energy);
    org.meals++;
    for (const patch of this.patches) {
      if (Math.hypot(f.position.x - patch.position.x, f.position.y - patch.position.y) <= patch.radius) {
        patch.grazed++;
        patch.stock = Math.max(TUNING.patchMinStock, patch.stock - TUNING.patchGrazePerMeal);
      }
    }
    this.mealBuckets[this.windowBucket()]++;
    const record = this.lineageRecords.get(org.lineage);
    if (record) record.totalMeals++;
  }

  private canReproduce(org: Organism): boolean {
    return (
      org.energy >= org.genome.reproduceAt * org.capacity &&
      org.age >= TUNING.matureAge &&
      this.organisms.length + this.pendingBirths.length < MAX_POPULATION
    );
  }

  private reproduce(parent: Organism): void {
    const { genome, topologyChanged } = mutate(parent.genome, this.rng);
    const lineage = topologyChanged ? this.newLineage(parent.lineage, genome) : parent.lineage;
    const angle = this.rng.range(-Math.PI, Math.PI);
    const reach = TUNING.birthOffset + parent.genome.parts[0].length * 0.5;
    const position = {
      x: clamp(parent.position.x + Math.cos(angle) * reach, TUNING.margin, this.width - TUNING.margin),
      y: clamp(parent.position.y + Math.sin(angle) * reach, TUNING.margin, this.height - TUNING.margin),
    };
    const child = this.makeOrganism(genome, position, this.rng.range(-Math.PI, Math.PI), lineage, topologyChanged ? parent.lineage : parent.parentLineage, parent.generation + 1);

    const pool = parent.energy - TUNING.birthCost * parent.capacity;
    parent.energy = pool / 2;
    child.energy = Math.min(child.capacity, pool / 2);
    parent.offspring++;

    const record = this.lineageRecords.get(lineage);
    if (record) {
      record.count++;
      record.totalBirths++;
      record.exemplar = genome;
    }
    this.births++;
    this.pendingBirths.push(child);
    this.emit({ kind: "birth", time: this.time, organism: child.id, lineage });
    if (topologyChanged) this.emit({ kind: "lineage", time: this.time, organism: child.id, lineage, parentLineage: parent.lineage });
  }

  private deathCause(org: Organism): "starved" | "age" | null {
    if (!(org.energy > 0)) return "starved";
    const bias = 1 + TUNING.maxAgeMassBias * (org.mass / TUNING.referenceMass - 1);
    return org.age > TUNING.maxAge * clamp(bias, 0.75, 1.5) ? "age" : null;
  }

  private die(org: Organism, cause: "starved" | "age"): void {
    this.deaths++;
    this.emit({ kind: "death", time: this.time, organism: org.id, lineage: org.lineage, cause });
    const record = this.lineageRecords.get(org.lineage);
    if (!record) return;
    record.count--;
    // A child born this very step may still carry the lineage; its count was already added.
    if (record.count <= 0) {
      this.lineageRecords.delete(org.lineage);
      this.emit({ kind: "extinct", time: this.time, lineage: org.lineage });
    }
  }

  private emit(event: WorldEvent): void {
    this.events.push(event);
    if (this.events.length > EVENT_CAP) this.events.shift();
  }

  private distanceToBody(org: Organism, point: Vec2): number {
    let best = Math.hypot(point.x - org.position.x, point.y - org.position.y);
    for (const pose of org.poses) {
      best = Math.min(best, distanceToSegment(point, pose.base, pose.tip));
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /** One-second bucket of the rolling window for the current step. */
  private windowBucket(): number {
    return Math.floor((this.stepCount - 1) / STEPS_PER_SECOND) % 60;
  }

  /** Entering a new second: clear the bucket that is about to be reused. */
  private openWindowBucket(): void {
    if ((this.stepCount - 1) % STEPS_PER_SECOND !== 0) return;
    const bucket = this.windowBucket();
    this.mealBuckets[bucket] = 0;
    this.popBuckets[bucket] = 0;
  }

  private recordWindow(): void {
    this.popBuckets[this.windowBucket()] += this.organisms.length * DT;
  }

  private computeStats(): Stats {
    let speed = 0;
    for (const o of this.organisms) speed += Math.hypot(o.velocity.x, o.velocity.y);
    let meals = 0;
    let popSeconds = 0;
    for (let i = 0; i < 60; i++) {
      meals += this.mealBuckets[i];
      popSeconds += this.popBuckets[i];
    }
    const n = this.organisms.length;
    let dominantLineage = -1;
    let dominantCount = 0;
    for (const r of this.lineageRecords.values()) {
      if (r.count > dominantCount || (r.count === dominantCount && r.id < dominantLineage)) {
        dominantCount = r.count;
        dominantLineage = r.id;
      }
    }
    return {
      time: this.time,
      population: n,
      food: this.food.length,
      lineages: this.lineageRecords.size,
      births: this.births,
      deaths: this.deaths,
      meanSpeed: n > 0 ? speed / n : 0,
      foragingRate: popSeconds > 0 ? (meals / popSeconds) * 60 : 0,
      dominantLineage: n > 0 ? dominantLineage : -1,
      dominantShare: n > 0 ? dominantCount / n : 0,
      extinct: n === 0,
    };
  }

  private sampleHistory(): void {
    this.history.push(this.stats);
    if (this.history.length > HISTORY_CAP) this.history.shift();
  }
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
