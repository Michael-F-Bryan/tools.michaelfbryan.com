/**
 * Low Tide's engine: a plain-JSON state, `advance(state, ms)` to move game
 * time forward, and `dispatch(state, action)` for everything the player does.
 * Both are pure and return a new state, so the UI can store, replay and
 * persist it freely. Game time only moves when the UI calls `advance`, which
 * is how pause and "nothing happens while away" fall out for free.
 */

import {
  BAND_NAMES,
  BANDS,
  BLUEPRINTS,
  BOAT_HOLD,
  BUILT_LABELS,
  CARGO,
  CARGO_VALUE,
  CREEP_MS,
  FISH_TRAP_FOOD,
  MAX_CREW,
  NET_FOOD,
  RESOURCES,
  RESOURCES_BY_BAND,
  SHIP_EACH,
  STARTING_CREW,
  STARTING_FOOD,
  TIDE_MS,
  TIDES_PER_RUN,
  TRADER_HOLD,
  TURN_MS,
  WINCH_FACTOR,
  type Band,
  type Blueprint,
  type Built,
  type Cargo,
  type Item,
  type Resource,
  type Tier,
} from "./data";

export { TIDE_MS, TIDES_PER_RUN, TURN_MS, CREEP_MS, BANDS, BAND_NAMES, RESOURCES, RESOURCES_BY_BAND, BLUEPRINTS, BUILT_LABELS, MAX_CREW, CARGO, CARGO_VALUE, TRADER_HOLD, BOAT_HOLD, SHIP_EACH, NET_FOOD, FISH_TRAP_FOOD };
export type { Band, Built, Cargo, Item, Resource, Blueprint, Tier };

export type Job = Readonly<{
  id: number;
  crew: number;
  band: Band;
  resource: Resource;
  /** Absolute game ms. */
  startedAt: number;
  finishesAt: number;
  /** Absolute game ms at which this band goes under, or null if it is safe all tide (the shingle only). */
  floodsAt: number | null;
  /** How many bands past the waterline this job is (0 = on exposed ground). */
  beyond: 0 | 1 | 2;
}>;

export type QueuedJob = Readonly<{ band: Band; resource: Resource }>;

export type Crew = Readonly<{
  id: number;
  name: string;
  /** False after a turn with nothing for them to eat; they work at half speed until fed. */
  fed: boolean;
  /** Starts the moment this person is idle and the job can finish in time. */
  queued: QueuedJob | null;
}>;

export type LogEntry = Readonly<{ time: number; text: string; kind: "info" | "gain" | "loss" | "build" }>;

export type Ending = Readonly<{
  /** Every run ends when the twelfth tide turns. */
  reason: "tides";
  /** trader + boat + ship. */
  score: number;
  /** Value sold to the trader over the run. */
  trader: number;
  /** Value carried by your boat over the run. */
  boat: number;
  /** Value bought by ships over the run. */
  ship: number;
  /** Cargo still on the tarp after the last turn, which the sea keeps. */
  leftover: Partial<Record<Cargo, number>>;
}>;

export type State = Readonly<{
  version: 2;
  seed: number;
  /** Game ms since the run began. */
  time: number;
  /** 0-based index into `tides`. */
  tide: number;
  /** The whole run's tide chart: how many bands (from shore) are exposed at the start of each tide. */
  tides: readonly number[];
  paused: boolean;
  crew: readonly Crew[];
  jobs: readonly Job[];
  nextJobId: number;
  inventory: Readonly<Partial<Record<Item, number>>>;
  food: number;
  built: readonly Built[];
  /** Running total of value sold, by buyer. The score is their sum. */
  sales: Readonly<{ trader: number; boat: number; ship: number }>;
  /** Value sold at the end of each finished tide; index = tide. */
  turnSales: readonly number[];
  /** Tide index on which each thing was first built this run, for the chart and the run's story. */
  builtAt: Readonly<Partial<Record<Built, number>>>;
  /** Highest blueprint tier that may be built. */
  unlocked: Tier;
  /** Blueprints built at least once, this run or earlier (persisted; a small record of what you have made). */
  codex: readonly string[];
  log: readonly LogEntry[];
  ended: Ending | null;
  /** One-off message for the UI to show at the start of a run (e.g. an old save could not be carried over). */
  notice: string | null;
}>;

export type Action =
  | { type: "send"; crew: number; band: Band; resource: Resource }
  | { type: "queue"; crew: number; band: Band; resource: Resource }
  | { type: "unqueue"; crew: number }
  | { type: "recall"; job: number }
  | { type: "build"; out: Built }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "dismissNotice" }
  | { type: "newRun"; seed?: number };

const CREW_NAMES = ["Wren", "Sol", "Ada", "Finn"] as const;
const LOG_LIMIT = 40;

// ---------------------------------------------------------------------------
// Seeding

/** mulberry32: small, deterministic, good enough for a tide table. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The tide chart for a run: a spring/neap cycle (period 8 tides) with a seeded
 * phase and one small perturbation, so a run has a shape you can plan around
 * rather than a lottery. Guarantees: the first tide bares at least the mudflat
 * (2 or 3); depth-1 tides never come in a pair; at least two tides reach the
 * wreck, one of them in daylight in the second half, so a beacon is always
 * possible once you know what it needs; and one of the first three tides bares
 * the reef, so pearls and the boat's cargo are never gated to the second half.
 */
export function tideTable(seed: number): number[] {
  // Statistically unreachable; keep the type honest with a plannable fallback.
  return searchTideTable(seed) ?? [2, 3, 4, 4, 3, 2, 1, 2, 3, 4, 3, 2];
}

/** The seeded search behind `tideTable`; null if no attempt met every guarantee (a test counts these). */
export function searchTideTable(seed: number): number[] | null {
  const next = rng(seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const phase = next() * 8;
    const bump = 1 + Math.floor(next() * (TIDES_PER_RUN - 1));
    const direction = next() < 0.5 ? -1 : 1;
    const tides: number[] = [];
    for (let i = 0; i < TIDES_PER_RUN; i++) {
      let depth = Math.round(2.5 + 1.6 * Math.cos((2 * Math.PI * (i + phase)) / 8));
      if (i === bump) depth += direction;
      depth = Math.max(1, Math.min(4, depth));
      if (i === 0) depth = Math.max(2, Math.min(3, depth));
      if (i > 0 && tides[i - 1] === 1 && depth === 1) depth = 2;
      tides.push(depth);
    }
    const wreckTides = tides.map((depth, i) => (depth === 4 ? i : -1)).filter((i) => i >= 0);
    const smooth = tides.every((depth, i) => i === 0 || Math.abs(depth - tides[i - 1]) <= 2);
    const earlyReef = tides.slice(0, 3).some((depth) => depth >= 3);
    if (smooth && earlyReef && wreckTides.length >= 2 && wreckTides.some((i) => i >= TIDES_PER_RUN / 2 && !isDark(i))) return tides;
  }
  return null;
}

export function newRun(seed: number = Math.floor(Math.random() * 1_000_000), codex: readonly string[] = [], notice: string | null = null): State {
  const crew: Crew[] = Array.from({ length: STARTING_CREW }, (_, i) => ({ id: i, name: CREW_NAMES[i], fed: true, queued: null }));
  const tides = tideTable(seed);
  const state: State = {
    version: 2,
    seed,
    time: 0,
    tide: 0,
    tides,
    paused: true,
    crew,
    jobs: [],
    nextJobId: 1,
    inventory: {},
    food: STARTING_FOOD,
    built: [],
    sales: { trader: 0, boat: 0, ship: 0 },
    turnSales: [],
    builtAt: {},
    unlocked: 1,
    codex: [...new Set(codex)].sort(),
    log: [],
    ended: null,
    notice,
  };
  return log(state, `Low water. ${describeDepth(tides[0])} ${tideLabel(state, 0)}.`, "info");
}

// ---------------------------------------------------------------------------
// Selectors

export function isDark(tide: number): boolean {
  return tide % 4 === 3;
}

export function hasBuilt(state: State, built: Built): boolean {
  return state.built.includes(built);
}

export function depthOf(state: State, tide: number = state.tide): number {
  return state.tides[tide] ?? 0;
}

/** How many bands past the waterline the camp can work: waders and a raft each add one. */
export function reach(state: State): 0 | 1 | 2 {
  return ((hasBuilt(state, "waders") ? 1 : 0) + (hasBuilt(state, "raft") ? 1 : 0)) as 0 | 1 | 2;
}

/** Game ms elapsed in the current tide. */
export function tideElapsed(state: State): number {
  return state.time - state.tide * TIDE_MS;
}

export function tideRemaining(state: State): number {
  return TIDE_MS - tideElapsed(state);
}

export type TideInfo = Readonly<{ tide: number; depth: number; dark: boolean; current: boolean; past: boolean }>;

/** The whole chart with the current tide marked; `n` limits it when a strip only has room for a few. */
export function forecast(state: State, n: number = state.tides.length): TideInfo[] {
  const out: TideInfo[] = [];
  for (let i = state.tide; i < Math.min(state.tide + n, state.tides.length); i++) {
    out.push({ tide: i, depth: state.tides[i], dark: isDark(i), current: i === state.tide, past: false });
  }
  return out;
}

export function tideChart(state: State): TideInfo[] {
  return state.tides.map((depth, i) => ({ tide: i, depth, dark: isDark(i), current: i === state.tide, past: i < state.tide }));
}

/**
 * Game ms within the current tide at which a band goes under, or null if it
 * stays workable all tide (only the shingle). The outermost exposed band turns
 * at `TURN_MS`; the water then climbs one band at a time, reaching the mudflat
 * (band 1) at the end of the tide, so a weak tide that only bares the mudflat
 * also takes it back early. Bands past the waterline within the camp's reach
 * are workable until the turn, `TURN_MS`, like the outermost bare band: reach
 * opens a band, but the tide still sets how much time you get in it.
 */
export function floodOffset(depth: number, band: Band, reachBands: number): number | null | "never-exposed" {
  if (band === 0) return null;
  if (band >= depth) return band - depth < reachBands ? TURN_MS : "never-exposed";
  const outermost = depth - 1;
  if (band === outermost) return TURN_MS;
  const steps = outermost - 1;
  const index = outermost - band;
  return TURN_MS + ((TIDE_MS - TURN_MS) * index) / steps;
}

/** Absolute game ms at which `band` floods this tide, null if safe all tide (the shingle), or undefined if not workable this tide. */
export function floodTime(state: State, band: Band): number | null | undefined {
  const offset = floodOffset(depthOf(state), band, reach(state));
  if (offset === "never-exposed") return undefined;
  if (offset === null) return null;
  return state.tide * TIDE_MS + offset;
}

export function isExposed(state: State, band: Band): boolean {
  const flood = floodTime(state, band);
  if (flood === undefined) return false;
  return flood === null || state.time < flood;
}

/** 0 on bare ground; 1 or 2 if the band is under water but within reach (workable until the turn). */
export function beyondWaterline(state: State, band: Band): 0 | 1 | 2 {
  const depth = depthOf(state);
  if (band < depth) return 0;
  return Math.min(2, band - depth + 1) as 1 | 2;
}

/**
 * Where the water's edge is right now, in band units for the scene: a value
 * of 4 means even the wreck is bare, 1 means only the shingle. It holds at the
 * tide's depth, creeps over the outermost band in the `CREEP_MS` before the
 * turn, then falls one band at a time to 1 at the end of the tide. Band `b`
 * is dry exactly while `waterline(state) > b`, matching `floodTime`.
 */
export function waterline(state: State): number {
  const depth = depthOf(state);
  if (depth <= 1) return 1;
  const elapsed = tideElapsed(state);
  if (elapsed <= TURN_MS - CREEP_MS) return depth;
  if (elapsed < TURN_MS) return depth - (elapsed - (TURN_MS - CREEP_MS)) / CREEP_MS;
  const after = (elapsed - TURN_MS) / (TIDE_MS - TURN_MS);
  return Math.max(1, depth - 1 - (depth - 2) * after);
}

export function crewOf(state: State, id: number): Crew | undefined {
  return state.crew.find((member) => member.id === id);
}

export function jobOf(state: State, crewId: number): Job | undefined {
  return state.jobs.find((job) => job.crew === crewId);
}

export function isIdle(state: State, crewId: number): boolean {
  return !state.jobs.some((job) => job.crew === crewId);
}

/** How long `resource` would take for `crew` right now, with every modifier applied. */
export function jobDuration(state: State, crewId: number, resource: Resource): number {
  const info = RESOURCES[resource];
  let ms = info.duration;
  if (hasBuilt(state, "winch") && info.band === 3) ms *= WINCH_FACTOR;
  // The beacon keeps the lantern's light even though building it uses the lantern up.
  if (isDark(state.tide) && !hasBuilt(state, "lantern") && !hasBuilt(state, "beacon")) ms *= 2;
  const beyond = beyondWaterline(state, info.band);
  if (beyond === 1) ms *= 1.5;
  if (beyond === 2) ms *= 2;
  const member = crewOf(state, crewId);
  if (member && !member.fed) ms *= 2;
  return Math.round(ms);
}

export function jobYield(state: State, resource: Resource): number {
  const info = RESOURCES[resource];
  let amount = info.yield;
  if (!info.food && hasBuilt(state, "sled")) amount += 1;
  return amount;
}

export type JobOption = Readonly<{
  band: Band;
  resource: Resource;
  /** Game ms the job would take for this crew member, starting now. */
  duration: number;
  yield: number;
  /** Is the band workable right now (bare, or under water but within reach)? */
  exposed: boolean;
  beyond: 0 | 1 | 2;
  /** Absolute game ms at which the band floods this tide; null if safe all tide. Undefined if not workable this tide. */
  floodsAt: number | null | undefined;
  /** Can it start now and finish before the band floods and before the tide turns? */
  feasible: boolean;
  /** Why not, in a short phrase the UI can show. Empty when feasible. */
  blocked: string;
  /** True when the only problem is timing: the job will start by itself when the water next allows. */
  waits: boolean;
}>;

/** Every job a crew member could take right now, with timings, for the UI to render and for `send` to validate. */
export function availableJobs(state: State, crewId: number): JobOption[] {
  const options: JobOption[] = [];
  const idle = isIdle(state, crewId);
  const tideEnd = (state.tide + 1) * TIDE_MS;
  for (const band of BANDS) {
    for (const resource of RESOURCES_BY_BAND[band]) {
      const duration = jobDuration(state, crewId, resource);
      const floodsAt = floodTime(state, band);
      const exposed = isExposed(state, band);
      let blocked = "";
      let waits = false;
      if (state.ended) blocked = "The run is over.";
      else if (!idle) blocked = "Already working.";
      else if (!exposed && floodsAt === undefined) {
        blocked = "Under water this tide.";
        waits = true;
      } else if (!exposed) {
        blocked = "Flooded.";
        waits = true;
      } else if (typeof floodsAt === "number" && state.time + duration > floodsAt) {
        blocked = "Would flood first.";
        waits = true;
      } else if (state.time + duration > tideEnd) {
        blocked = "The tide turns first.";
        waits = true;
      }
      options.push({
        band,
        resource,
        duration,
        yield: jobYield(state, resource),
        exposed,
        beyond: exposed ? beyondWaterline(state, band) : 0,
        floodsAt,
        feasible: blocked === "",
        blocked,
        waits,
      });
    }
  }
  return options;
}

export type BuildCheck = Readonly<{ ok: boolean; missing: Item[]; why: string }>;

export function blueprintOf(out: Built): Blueprint | undefined {
  return BLUEPRINTS.find((blueprint) => blueprint.out === out);
}

/** Can `out` be built right now? `missing` lists each missing unit (with repeats) for have/need chips. */
export function canBuild(state: State, out: Built): BuildCheck {
  const blueprint = blueprintOf(out);
  if (!blueprint) return { ok: false, missing: [], why: "No such blueprint." };
  const missing: Item[] = [];
  for (const [item, count] of Object.entries(blueprint.inputs) as [Item, number][]) {
    for (let i = countOf(state, item); i < count; i++) missing.push(item);
  }
  let why = "";
  if (state.ended) why = "The run is over.";
  else if (out === "shelter" && state.crew.length >= MAX_CREW) why = "There's no one else out here to shelter.";
  else if (blueprint.structure && out !== "shelter" && (hasBuilt(state, out) || spentInto(state, out))) why = "Already standing.";
  else if (blueprint.tier > state.unlocked) why = `Build something from tier ${blueprint.tier - 1} first.`;
  else if (blueprint.requires && !hasBuilt(state, blueprint.requires)) why = `Needs a ${BUILT_LABELS[blueprint.requires].toLowerCase()} standing.`;
  else if (missing.length > 0) why = `Needs ${describeItems(missing)}.`;
  return { ok: why === "", missing, why };
}

export type BuildOption = Readonly<{ blueprint: Blueprint; ok: boolean; missing: Item[]; why: string; locked: boolean; standing: boolean }>;

/** The whole workbench, in tier order, always visible. */
export function buildOptions(state: State): BuildOption[] {
  return BLUEPRINTS.map((blueprint) => {
    const check = canBuild(state, blueprint.out);
    return {
      blueprint,
      ok: check.ok,
      missing: check.missing,
      why: check.why,
      locked: blueprint.tier > state.unlocked,
      standing: blueprint.out === "shelter" ? state.crew.length >= MAX_CREW : blueprint.structure && (hasBuilt(state, blueprint.out) || spentInto(state, blueprint.out)),
    };
  });
}

export type Producer = Readonly<{ id: "kiln" | "fishTrap"; label: string; ready: boolean; next: string }>;

/** What the standing structures will do at the next turn of the tide, for anticipation. */
export function producers(state: State): Producer[] {
  const out: Producer[] = [];
  if (hasBuilt(state, "fishTrap")) out.push({ id: "fishTrap", label: "Fish trap", ready: true, next: `+${trapFood(state)} food at the turn` });
  if (hasBuilt(state, "kiln")) {
    const ready = countOf(state, "clay") >= 1 && countOf(state, "driftwood") >= 1;
    out.push({ id: "kiln", label: "Kiln", ready, next: ready ? "fires a brick at the turn" : "needs clay and driftwood to fire" });
  }
  return out;
}

/** Food the fish trap holds at each turn: the trap alone, plus the net's share once it hangs across the mouth. */
function trapFood(state: State): number {
  return FISH_TRAP_FOOD + (hasBuilt(state, "net") ? NET_FOOD : 0);
}

/** The score so far: everything sold to the trader, your boat and ships. */
export function score(state: State): number {
  return state.sales.trader + state.sales.boat + state.sales.ship;
}

export type TradePlan = Readonly<{
  ship: Cargo[];
  trader: Cargo[];
  boat: Cargo[];
  value: Readonly<{ ship: number; trader: number; boat: number }>;
  total: number;
  /** Cargo kinds held back this turn for the workbench: you have one, and it is the one kept (empty on the final turn). */
  held: Cargo[];
}>;

/**
 * What would sell at the next turn of the tide, given the tarp as it is now.
 * Pure, and the engine's own `trade` applies exactly this, so a UI preview
 * cannot disagree with the sale. Until the final turn, traders leave your last
 * one of each kind that a blueprint you have not yet finished still needs (a
 * brass waiting for its oil, an iron for the winch); pearls and salt always
 * sell. Order: the
 * ship (if the beacon stands) buys up to `SHIP_EACH` of every kind, then the trader takes
 * the most valuable piece left, then the boat (if it stands) the next
 * `BOAT_HOLD` most valuable.
 */
export function planTrade(state: State): TradePlan {
  const final = state.tide >= state.tides.length - 1;
  const left: Record<Cargo, number> = { pearl: 0, brass: 0, iron: 0, oil: 0, salt: 0 };
  const held: Cargo[] = [];
  for (const kind of CARGO) {
    const have = state.inventory[kind] ?? 0;
    const keep = !final && have > 0 && neededByWorkbench(state, kind) ? 1 : 0;
    left[kind] = have - keep;
    if (keep > 0) held.push(kind);
  }
  const ship: Cargo[] = [];
  if (hasBuilt(state, "beacon")) {
    for (const kind of CARGO) {
      const take = Math.min(left[kind], SHIP_EACH);
      for (let i = 0; i < take; i++) ship.push(kind);
      left[kind] -= take;
    }
  }
  const trader: Cargo[] = [];
  const boat: Cargo[] = [];
  const picks = TRADER_HOLD + (hasBuilt(state, "boat") ? BOAT_HOLD : 0);
  for (let i = 0; i < picks; i++) {
    let best: Cargo | null = null;
    for (const kind of CARGO) {
      if (left[kind] > 0 && (best === null || CARGO_VALUE[kind] > CARGO_VALUE[best])) best = kind;
    }
    if (best === null) break;
    left[best] -= 1;
    (i < TRADER_HOLD ? trader : boat).push(best);
  }
  const worth = (items: readonly Cargo[]) => items.reduce((sum, kind) => sum + CARGO_VALUE[kind], 0);
  const value = { ship: worth(ship), trader: worth(trader), boat: worth(boat) };
  return { ship, trader, boat, value, total: value.ship + value.trader + value.boat, held };
}

/**
 * Whether a blueprint that still has to be built takes this kind as an input.
 * A structure counts as done while it stands, or once it has been spent into
 * one that does (the lantern goes up the beacon); a material is never done.
 */
function neededByWorkbench(state: State, kind: Cargo): boolean {
  return BLUEPRINTS.some((blueprint) => {
    if (!blueprint.inputs[kind]) return false;
    if (!blueprint.structure) return true;
    return !hasBuilt(state, blueprint.out) && !spentInto(state, blueprint.out);
  });
}

/** True once `out` has been used up in a standing structure (the lantern goes up the beacon), so it still counts as done. */
export function spentInto(state: State, out: Built): boolean {
  return BLUEPRINTS.some((other) => other.inputs[out] && hasBuilt(state, other.out));
}

/** "2 pearls and 1 brass": cargo grouped by kind in `CARGO` order, for the log and the preview. */
export function describeCargo(items: readonly Cargo[]): string {
  const parts = CARGO.map((kind) => [kind, items.filter((item) => item === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${itemLabel(kind).toLowerCase()}${kind === "pearl" && count > 1 ? "s" : ""}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

export function tideLabel(state: State, tide: number = state.tide): string {
  return `Tide ${tide + 1} of ${state.tides.length}${isDark(tide) ? ", dark" : ""}`;
}

export function describeDepth(depth: number): string {
  return ["Nothing but shingle.", "Only the shingle shows.", "The mudflat is bare.", "The reef is out.", "Even the wreck is dry."][depth] ?? "";
}

export function itemLabel(item: Item): string {
  return item in RESOURCES ? RESOURCES[item as Resource].label : BUILT_LABELS[item as Built];
}

function describeItems(items: readonly Item[]): string {
  const counts = new Map<Item, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, count]) => `${count > 1 ? `${count} ` : ""}${itemLabel(item).toLowerCase()}`).join(", ");
}

// ---------------------------------------------------------------------------
// Time

export function advance(state: State, ms: number): State {
  if (ms <= 0 || state.paused || state.ended) return state;
  let s = state;
  let remaining = ms;
  while (remaining > 0 && !s.ended) {
    const tideEnd = (s.tide + 1) * TIDE_MS;
    let next = Math.min(tideEnd, s.time + remaining);
    for (const job of s.jobs) {
      next = Math.min(next, job.finishesAt);
      if (job.floodsAt !== null) next = Math.min(next, job.floodsAt);
    }
    remaining -= next - s.time;
    s = { ...s, time: next };
    s = settleJobs(s);
    if (s.time >= tideEnd) s = endTide(s);
    s = startQueued(s);
  }
  return s;
}

function settleJobs(s: State): State {
  // Completions first, then floods, so a job finishing exactly as the water arrives counts.
  for (const job of [...s.jobs].sort((a, b) => a.finishesAt - b.finishesAt)) {
    if (job.finishesAt <= s.time) s = completeJob(s, job);
  }
  for (const job of s.jobs) {
    if (job.floodsAt !== null && job.floodsAt <= s.time) s = loseJob(s, job);
  }
  return s;
}

function completeJob(s: State, job: Job): State {
  const amount = jobYield(s, job.resource);
  const member = crewOf(s, job.crew);
  const info = RESOURCES[job.resource];
  s = { ...s, jobs: s.jobs.filter((other) => other.id !== job.id) };
  if (info.food) {
    s = { ...s, food: s.food + amount };
  } else {
    s = { ...s, inventory: addItem(s.inventory, job.resource, amount) };
  }
  s = log(s, `${member?.name ?? "Someone"} brings back ${amount} ${info.label.toLowerCase()} from the ${BAND_NAMES[job.band].toLowerCase()}.`, "gain");
  return info.food ? feedHungry(s) : s;
}

/** Anyone who went to sleep hungry eats as soon as food reaches camp, so hunger slows a run without spiralling. */
function feedHungry(s: State): State {
  const hungry = s.crew.filter((member) => !member.fed);
  if (hungry.length === 0 || s.food === 0) return s;
  let food = s.food;
  const fedNow: string[] = [];
  const crew = s.crew.map((member) => {
    if (member.fed || food === 0) return member;
    food -= 1;
    fedNow.push(member.name);
    return { ...member, fed: true };
  });
  s = { ...s, crew, food };
  return log(s, `${fedNow.join(" and ")} ${fedNow.length > 1 ? "eat" : "eats"} straight away. Full speed again.`, "gain");
}

function loseJob(s: State, job: Job): State {
  const member = crewOf(s, job.crew);
  s = { ...s, jobs: s.jobs.filter((other) => other.id !== job.id) };
  return log(s, `The water takes the ${BAND_NAMES[job.band].toLowerCase()}. ${member?.name ?? "Someone"} wades back with nothing.`, "loss");
}

function endTide(s: State): State {
  // Everyone still out is wading back empty-handed as the tide turns fully.
  for (const job of s.jobs) s = loseJob(s, job);
  s = produce(s);
  s = eat(s);
  s = trade(s);
  const nextTide = s.tide + 1;
  if (nextTide >= s.tides.length) {
    return finish({ ...s, time: s.tides.length * TIDE_MS });
  }
  s = { ...s, tide: nextTide, time: nextTide * TIDE_MS };
  return log(s, `The water falls. ${describeDepth(s.tides[nextTide])} ${tideLabel(s)}.`, "info");
}

/** Structures that work by themselves at the turn: the fish trap, the kiln and the saltworks. */
function produce(s: State): State {
  if (hasBuilt(s, "fishTrap")) {
    const food = trapFood(s);
    s = log({ ...s, food: s.food + food }, `The fish trap holds ${food} food.`, "gain");
  }
  if (hasBuilt(s, "kiln") && countOf(s, "clay") >= 1 && countOf(s, "driftwood") >= 1) {
    let inventory = addItem(s.inventory, "clay", -1);
    inventory = addItem(inventory, "driftwood", -1);
    inventory = addItem(inventory, "brick", 1);
    s = log({ ...s, inventory }, "The kiln fires a brick overnight.", "gain");
  }
  if (hasBuilt(s, "saltworks")) {
    s = log({ ...s, inventory: addItem(s.inventory, "salt", 1) }, "The saltworks leaves a crust of salt.", "gain");
  }
  return s;
}

/** The sale at the turn: apply `planTrade`, bank the value, and say what went. */
function trade(s: State): State {
  const plan = planTrade(s);
  let inventory = s.inventory;
  for (const kind of [...plan.ship, ...plan.trader, ...plan.boat]) inventory = addItem(inventory, kind, -1);
  const sales = { trader: s.sales.trader + plan.value.trader, boat: s.sales.boat + plan.value.boat, ship: s.sales.ship + plan.value.ship };
  s = { ...s, inventory, sales, turnSales: [...s.turnSales, plan.total] };
  if (plan.total === 0) return log(s, "At the turn: nothing to sell.", "info");
  const parts: string[] = [];
  if (plan.ship.length > 0) parts.push(`the ship buys ${describeCargo(plan.ship)} (${plan.value.ship})`);
  if (plan.trader.length > 0) parts.push(`the trader takes ${describeCargo(plan.trader)} (${plan.value.trader})`);
  if (plan.boat.length > 0) parts.push(`the boat carries ${describeCargo(plan.boat)} (${plan.value.boat})`);
  return log(s, `At the turn: ${parts.join("; ")}.`, "gain");
}

function eat(s: State): State {
  let food = s.food;
  const crew = s.crew.map((member) => {
    if (food > 0) {
      food -= 1;
      return { ...member, fed: true };
    }
    return { ...member, fed: false };
  });
  const hungry = crew.filter((member) => !member.fed);
  s = { ...s, crew, food };
  if (hungry.length > 0) {
    const names = hungry.map((member) => member.name).join(" and ");
    s = log(s, `${names} ${hungry.length > 1 ? "go" : "goes"} to sleep hungry. Half speed until fed.`, "loss");
  }
  return s;
}

function startQueued(s: State): State {
  for (const member of s.crew) {
    if (!member.queued || !isIdle(s, member.id)) continue;
    const option = availableJobs(s, member.id).find((candidate) => candidate.band === member.queued!.band && candidate.resource === member.queued!.resource);
    if (!option?.feasible) continue;
    s = { ...s, crew: s.crew.map((other) => (other.id === member.id ? { ...other, queued: null } : other)) };
    s = beginJob(s, member.id, option);
  }
  return s;
}

function beginJob(s: State, crewId: number, option: JobOption): State {
  const member = crewOf(s, crewId);
  const job: Job = {
    id: s.nextJobId,
    crew: crewId,
    band: option.band,
    resource: option.resource,
    startedAt: s.time,
    finishesAt: s.time + option.duration,
    floodsAt: option.floodsAt ?? null,
    beyond: option.beyond,
  };
  s = { ...s, jobs: [...s.jobs, job], nextJobId: s.nextJobId + 1 };
  const how = option.beyond === 2 ? " on the raft" : option.beyond === 1 ? " in the shallows" : "";
  return log(s, `${member?.name ?? "Someone"} heads out to the ${BAND_NAMES[option.band].toLowerCase()}${how} for ${RESOURCES[option.resource].label.toLowerCase()}.`, "info");
}

function finish(s: State): State {
  const leftover: Partial<Record<Cargo, number>> = {};
  for (const kind of CARGO) if ((s.inventory[kind] ?? 0) > 0) leftover[kind] = s.inventory[kind];
  const ending: Ending = { reason: "tides", score: score(s), trader: s.sales.trader, boat: s.sales.boat, ship: s.sales.ship, leftover };
  s = { ...s, jobs: [], crew: s.crew.map((member) => ({ ...member, queued: null })), ended: ending };
  return log(s, "The last tide comes in. The traders have had their pick; the sea keeps the rest.", "build");
}

// ---------------------------------------------------------------------------
// Actions

export function dispatch(state: State, action: Action): State {
  switch (action.type) {
    case "newRun":
      return newRun(action.seed, state.codex);
    case "pause":
      return state.paused || state.ended ? state : { ...state, paused: true };
    case "resume":
      return !state.paused || state.ended ? state : { ...state, paused: false };
    case "dismissNotice":
      return state.notice === null ? state : { ...state, notice: null };
    default:
      break;
  }
  if (state.ended) return state;
  switch (action.type) {
    case "send": {
      if (!crewOf(state, action.crew)) return state;
      const option = availableJobs(state, action.crew).find((candidate) => candidate.band === action.band && candidate.resource === action.resource);
      if (!option) return state;
      if (option.feasible) {
        const s = { ...state, crew: state.crew.map((member) => (member.id === action.crew ? { ...member, queued: null } : member)) };
        return beginJob(s, action.crew, option);
      }
      // Only timing stands in the way: hold the job and start it the moment the water allows.
      if (option.waits) return dispatch(state, { type: "queue", crew: action.crew, band: action.band, resource: action.resource });
      return log(state, option.blocked, "info");
    }
    case "queue": {
      const member = crewOf(state, action.crew);
      if (!member || !RESOURCES_BY_BAND[action.band].includes(action.resource)) return state;
      let s: State = {
        ...state,
        crew: state.crew.map((other) => (other.id === action.crew ? { ...other, queued: { band: action.band, resource: action.resource } } : other)),
      };
      const started = startQueued(s);
      if (started !== s) return started;
      s = log(s, `${member.name} will go to the ${BAND_NAMES[action.band].toLowerCase()} for ${RESOURCES[action.resource].label.toLowerCase()} as soon as the water allows.`, "info");
      return s;
    }
    case "unqueue":
      return { ...state, crew: state.crew.map((member) => (member.id === action.crew ? { ...member, queued: null } : member)) };
    case "recall": {
      const job = state.jobs.find((candidate) => candidate.id === action.job);
      if (!job) return state;
      const member = crewOf(state, job.crew);
      const s = { ...state, jobs: state.jobs.filter((candidate) => candidate.id !== job.id) };
      return startQueued(log(s, `${member?.name ?? "Someone"} turns back early, empty-handed.`, "info"));
    }
    case "build":
      return build(state, action.out);
    default:
      return state;
  }
}

function build(state: State, out: Built): State {
  const blueprint = blueprintOf(out);
  const check = canBuild(state, out);
  if (!blueprint) return state;
  if (!check.ok) return log(state, check.why, "info");
  let s = state;
  for (const [item, count] of Object.entries(blueprint.inputs) as [Item, number][]) {
    for (let i = 0; i < count; i++) s = removeItem(s, item);
  }
  if (blueprint.structure) {
    s = { ...s, built: [...s.built, out] };
  } else {
    s = { ...s, inventory: addItem(s.inventory, out, 1) };
  }
  if (blueprint.structure && blueprint.tier >= s.unlocked && s.unlocked < 3) {
    s = { ...s, unlocked: Math.min(3, blueprint.tier + 1) as Tier };
  }
  if (!s.codex.includes(out)) s = { ...s, codex: [...s.codex, out].sort() };
  if (s.builtAt[out] === undefined) s = { ...s, builtAt: { ...s.builtAt, [out]: s.tide } };
  if (out === "shelter") {
    const id = s.crew.length;
    s = { ...s, crew: [...s.crew, { id, name: CREW_NAMES[id] ?? `Crew ${id + 1}`, fed: true, queued: null }] };
  }
  s = log(s, `${blueprint.label}: ${blueprint.flavour}`, "build");
  return startQueued(s);
}

// ---------------------------------------------------------------------------
// Helpers

export function countOf(state: State, item: Item): number {
  return (state.inventory[item] ?? 0) + state.built.filter((built) => built === item).length;
}

function removeItem(state: State, item: Item): State {
  if ((state.inventory[item] ?? 0) > 0) {
    return { ...state, inventory: addItem(state.inventory, item, -1) };
  }
  const index = state.built.indexOf(item as Built);
  if (index === -1) return state;
  return { ...state, built: state.built.filter((_, i) => i !== index) };
}

function addItem(inventory: State["inventory"], item: Item, delta: number): State["inventory"] {
  const next = { ...inventory };
  const count = (next[item] ?? 0) + delta;
  if (count <= 0) delete next[item];
  else next[item] = count;
  return next;
}

function log(state: State, text: string, kind: LogEntry["kind"]): State {
  const entry: LogEntry = { time: state.time, text, kind };
  return { ...state, log: [...state.log, entry].slice(-LOG_LIMIT) };
}
