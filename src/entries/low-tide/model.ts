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
  BEACON_BONUS,
  BUILT_LABELS,
  FAILED_COMBINE_LINES,
  MATERIAL_VALUE,
  MAX_CREW,
  RECIPES,
  RESOURCES,
  RESOURCES_BY_BAND,
  SALVAGE_CAP,
  SPOIL_AFTER_TIDES,
  STARTING_CREW,
  STARTING_FOOD,
  STRUCTURE_VALUE,
  TIDE_MS,
  TIDE_REMAINING_BONUS,
  TIDES_PER_RUN,
  TURN_MS,
  type Band,
  type Built,
  type Item,
  type Recipe,
  type Resource,
} from "./data";

export { TIDE_MS, TIDES_PER_RUN, TURN_MS, BANDS, BAND_NAMES, RESOURCES, RESOURCES_BY_BAND, RECIPES, BUILT_LABELS, MAX_CREW };
export type { Band, Built, Item, Resource, Recipe };

export type Job = Readonly<{
  id: number;
  crew: number;
  band: Band;
  resource: Resource;
  /** Absolute game ms. */
  startedAt: number;
  finishesAt: number;
  /** Absolute game ms at which this band goes under, or null if it is safe all tide. */
  floodsAt: number | null;
}>;

export type QueuedJob = Readonly<{ band: Band; resource: Resource }>;

export type Crew = Readonly<{
  id: number;
  name: string;
  /** False after a tide ended with nothing for them to eat; they work at half speed until fed. */
  fed: boolean;
  /** Starts the moment this person is idle and the job can finish before its band floods. */
  queued: QueuedJob | null;
}>;

export type FoodLot = Readonly<{ amount: number; tide: number }>;

export type LogEntry = Readonly<{ time: number; text: string; kind: "info" | "gain" | "loss" | "build" }>;

export type Ending = Readonly<{
  reason: "tides" | "beacon";
  score: number;
  salvage: number;
  structures: number;
  beacon: number;
  tidesLeft: number;
  tidesLeftBonus: number;
  discovered: number;
}>;

export type State = Readonly<{
  version: 1;
  seed: number;
  /** Game ms since the run began. */
  time: number;
  /** 0-based index into `tides`. */
  tide: number;
  /** Low-water depth per tide: how many bands (from shore) are exposed at the start of that tide. */
  tides: readonly number[];
  paused: boolean;
  crew: readonly Crew[];
  jobs: readonly Job[];
  nextJobId: number;
  inventory: Readonly<Partial<Record<Item, number>>>;
  food: readonly FoodLot[];
  built: readonly Built[];
  /** Recipe keys (see `recipeKey`) discovered this run or carried in from earlier runs. */
  codex: readonly string[];
  log: readonly LogEntry[];
  ended: Ending | null;
}>;

export type Action =
  | { type: "send"; crew: number; band: Band; resource: Resource }
  | { type: "queue"; crew: number; band: Band; resource: Resource }
  | { type: "unqueue"; crew: number }
  | { type: "recall"; job: number }
  | { type: "combine"; a: Item; b: Item }
  | { type: "ring" }
  | { type: "pause" }
  | { type: "resume" }
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
 * The tide table for a run. Depth is how many bands are exposed. The first tide
 * is always generous enough to start (2 or 3); depth-1 tides never come in a
 * pair, so the mudflat and its food are reachable at least every other tide;
 * at least two tides reach the wreck, one of them in the second half, so a
 * beacon is always possible once the player knows what it needs.
 */
export function tideTable(seed: number): number[] {
  const next = rng(seed);
  const weights: Record<number, number> = { 1: 0.15, 2: 0.35, 3: 0.32, 4: 0.18 };
  const draw = (): number => {
    const r = next();
    let acc = 0;
    for (const depth of [1, 2, 3, 4]) {
      acc += weights[depth];
      if (r < acc) return depth;
    }
    return 4;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    const tides: number[] = [];
    for (let i = 0; i < TIDES_PER_RUN; i++) {
      let depth = draw();
      if (i === 0) depth = Math.max(2, Math.min(3, depth));
      if (i > 0 && tides[i - 1] === 1 && depth === 1) depth = 2;
      tides.push(depth);
    }
    const wreckTides = tides.map((depth, i) => (depth === 4 ? i : -1)).filter((i) => i >= 0);
    // A dark wreck tide is no use for the lantern, so the late one must be in daylight.
    if (wreckTides.length >= 2 && wreckTides.some((i) => i >= TIDES_PER_RUN / 2 && !isDark(i))) return tides;
  }
  // Statistically unreachable; keep the type honest.
  return Array.from({ length: TIDES_PER_RUN }, (_, i) => (i % 4) + 1);
}

export function newRun(seed: number = Math.floor(Math.random() * 1_000_000), codex: readonly string[] = []): State {
  const crew: Crew[] = Array.from({ length: STARTING_CREW }, (_, i) => ({ id: i, name: CREW_NAMES[i], fed: true, queued: null }));
  const tides = tideTable(seed);
  const state: State = {
    version: 1,
    seed,
    time: 0,
    tide: 0,
    tides,
    paused: true,
    crew,
    jobs: [],
    nextJobId: 1,
    inventory: {},
    food: [{ amount: STARTING_FOOD, tide: 0 }],
    built: [],
    codex: [...new Set(codex)].sort(),
    log: [],
    ended: null,
  };
  return log(state, `Low water. ${describeDepth(tides[0])} ${tideLabel(state, 0)}.`, "info");
}

// ---------------------------------------------------------------------------
// Selectors

export function recipeKey(a: Item, b: Item): string {
  return [a, b].sort().join("+");
}

export function isDark(tide: number): boolean {
  return tide % 4 === 3;
}

export function hasBuilt(state: State, built: Built): boolean {
  return state.built.includes(built);
}

export function depthOf(state: State, tide: number = state.tide): number {
  return state.tides[tide] ?? 0;
}

/** Game ms elapsed in the current tide. */
export function tideElapsed(state: State): number {
  return state.time - state.tide * TIDE_MS;
}

export function tideRemaining(state: State): number {
  return TIDE_MS - tideElapsed(state);
}

export type TideInfo = Readonly<{ tide: number; depth: number; dark: boolean; current: boolean }>;

/** The current tide and the next `n - 1`. */
export function forecast(state: State, n: number = 3): TideInfo[] {
  const out: TideInfo[] = [];
  for (let i = state.tide; i < Math.min(state.tide + n, state.tides.length); i++) {
    out.push({ tide: i, depth: state.tides[i], dark: isDark(i), current: i === state.tide });
  }
  return out;
}

/**
 * Game ms within the current tide at which a band goes under, or null if it
 * stays workable all tide. The outermost exposed band turns at `TURN_MS`; the
 * water then climbs one band at a time, reaching the mudflat (band 1) at the
 * end of the tide, so a weak tide that only bares the mudflat also takes it
 * back early. The shingle never floods. A raft makes the first submerged band
 * workable all tide.
 */
export function floodOffset(depth: number, band: Band, raft: boolean): number | null | "never-exposed" {
  if (band === 0) return null;
  if (band >= depth) return raft && band === depth ? null : "never-exposed";
  const outermost = depth - 1;
  if (band === outermost) return TURN_MS;
  // Bands between the outermost and the mudflat flood at even intervals; the mudflat last.
  const steps = outermost - 1;
  const index = outermost - band;
  return TURN_MS + ((TIDE_MS - TURN_MS) * index) / steps;
}

/** Absolute game ms at which `band` floods this tide, null if safe this tide, or undefined if not workable this tide. */
export function floodTime(state: State, band: Band): number | null | undefined {
  const offset = floodOffset(depthOf(state), band, hasBuilt(state, "raft"));
  if (offset === "never-exposed") return undefined;
  if (offset === null) return null;
  return state.tide * TIDE_MS + offset;
}

export function isExposed(state: State, band: Band): boolean {
  const flood = floodTime(state, band);
  if (flood === undefined) return false;
  return flood === null || state.time < flood;
}

export function isSubmergedButRaftable(state: State, band: Band): boolean {
  return hasBuilt(state, "raft") && band === depthOf(state);
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
  if (hasBuilt(state, "waders") && (info.band === 1 || info.band === 2)) ms *= 0.7;
  if (isDark(state.tide) && !hasBuilt(state, "lantern")) ms *= 2;
  if (isSubmergedButRaftable(state, info.band)) ms *= 1.5;
  const member = crewOf(state, crewId);
  if (member && !member.fed) ms *= 2;
  return Math.round(ms);
}

export function jobYield(state: State, resource: Resource): number {
  let amount = RESOURCES[resource].yield;
  if (resource === "fish" && hasBuilt(state, "net")) amount += 3;
  return amount;
}

export type JobOption = Readonly<{
  band: Band;
  resource: Resource;
  /** Game ms the job would take for this crew member, starting now. */
  duration: number;
  yield: number;
  /** Is the band above water right now (or reachable by raft)? */
  exposed: boolean;
  /** Absolute game ms at which the band floods this tide; null if safe all tide. Undefined if not exposed this tide. */
  floodsAt: number | null | undefined;
  /** Can it start now and finish before the band floods? */
  feasible: boolean;
  /** Why not, in a short phrase the UI can show. Empty when feasible. */
  blocked: string;
}>;

/** Every job a crew member could take right now, with timings, for the UI to render and for `send` to validate. */
export function availableJobs(state: State, crewId: number): JobOption[] {
  const options: JobOption[] = [];
  const idle = isIdle(state, crewId);
  for (const band of BANDS) {
    for (const resource of RESOURCES_BY_BAND[band]) {
      const duration = jobDuration(state, crewId, resource);
      const floodsAt = floodTime(state, band);
      const exposed = isExposed(state, band);
      let blocked = "";
      if (state.ended) blocked = "The run is over.";
      else if (!idle) blocked = "Already working.";
      else if (!exposed && floodsAt === undefined) blocked = "Under water this tide.";
      else if (!exposed) blocked = "Flooded.";
      else if (typeof floodsAt === "number" && state.time + duration > floodsAt) blocked = "Would flood first.";
      else if (state.time + duration > (state.tide + 1) * TIDE_MS) blocked = "The tide turns first.";
      options.push({ band, resource, duration, yield: jobYield(state, resource), exposed, floodsAt, feasible: blocked === "", blocked });
    }
  }
  return options;
}

export function canCombine(state: State, a: Item, b: Item): Recipe | null {
  const key = recipeKey(a, b);
  const recipe = RECIPES.find((candidate) => recipeKey(candidate.inputs[0], candidate.inputs[1]) === key);
  if (!recipe) return null;
  if (recipe.requires && !hasBuilt(state, recipe.requires)) return null;
  if (!hasInputs(state, recipe)) return null;
  if (recipe.out === "shelter" && state.crew.length >= MAX_CREW) return null;
  if (recipe.structure && recipe.out !== "shelter" && hasBuilt(state, recipe.out)) return null;
  return recipe;
}

/** Recipes the player has already discovered (this run or earlier). */
export function knownRecipes(state: State): Recipe[] {
  return RECIPES.filter((recipe) => state.codex.includes(recipeKey(recipe.inputs[0], recipe.inputs[1])));
}

export type RecipeHint = Readonly<{
  recipe: Recipe;
  /** An input the player is holding right now, so the hint can say "something with reeds". Null if they hold neither. */
  held: Item | null;
}>;

/**
 * Undiscovered recipes the player could plausibly go for, nearest first: those
 * with an input already in hand come before the rest, and anything whose
 * prerequisite structure is missing or whose output is already standing is
 * left out. Lets the UI point at a goal without giving away the pair.
 */
export function recipeHints(state: State): RecipeHint[] {
  const hints: RecipeHint[] = [];
  for (const recipe of RECIPES) {
    if (state.codex.includes(recipeKey(recipe.inputs[0], recipe.inputs[1]))) continue;
    if (recipe.requires && !hasBuilt(state, recipe.requires)) continue;
    if (recipe.structure && hasBuilt(state, recipe.out)) continue;
    const held = recipe.inputs.find((input) => hasItem(state, input)) ?? null;
    hints.push({ recipe, held });
  }
  return hints.sort((a, b) => Number(b.held !== null) - Number(a.held !== null));
}

export function totalFood(state: State): number {
  return state.food.reduce((sum, lot) => sum + lot.amount, 0);
}

export function salvageValue(state: State): number {
  let value = 0;
  for (const [item, count] of Object.entries(state.inventory) as [Item, number][]) {
    const counted = Math.min(count, SALVAGE_CAP);
    if (item in RESOURCES) value += RESOURCES[item as Resource].value * counted;
    else if (item in MATERIAL_VALUE) value += MATERIAL_VALUE[item as keyof typeof MATERIAL_VALUE] * counted;
  }
  return value;
}

export function tideLabel(state: State, tide: number = state.tide): string {
  return `Tide ${tide + 1} of ${state.tides.length}${isDark(tide) ? ", dark" : ""}`;
}

export function describeDepth(depth: number): string {
  return ["Nothing but shingle.", "Only the shingle shows.", "The mudflat is bare.", "The reef is out.", "Even the wreck is dry."][depth] ?? "";
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
    s = { ...s, food: addFood(s.food, amount, s.tide) };
  } else {
    s = { ...s, inventory: addItem(s.inventory, job.resource, amount) };
  }
  s = log(s, `${member?.name ?? "Someone"} brings back ${amount} ${info.label.toLowerCase()} from the ${BAND_NAMES[job.band].toLowerCase()}.`, "gain");
  return info.food ? feedHungry(s) : s;
}

/** Anyone who went to sleep hungry eats as soon as food reaches camp, so hunger slows a run without spiralling. */
function feedHungry(s: State): State {
  const hungry = s.crew.filter((member) => !member.fed);
  if (hungry.length === 0 || totalFood(s) === 0) return s;
  const lots = s.food.map((lot) => ({ ...lot })).sort((a, b) => a.tide - b.tide);
  const fedNow: string[] = [];
  const crew = s.crew.map((member) => {
    if (member.fed) return member;
    const lot = lots.find((candidate) => candidate.amount > 0);
    if (!lot) return member;
    lot.amount -= 1;
    fedNow.push(member.name);
    return { ...member, fed: true };
  });
  s = { ...s, crew, food: lots.filter((lot) => lot.amount > 0) };
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
  s = eat(s);
  s = spoil(s);
  const nextTide = s.tide + 1;
  if (nextTide >= s.tides.length) {
    return finish({ ...s, time: s.tides.length * TIDE_MS }, "tides");
  }
  s = { ...s, tide: nextTide, time: nextTide * TIDE_MS };
  return log(s, `The water falls. ${describeDepth(s.tides[nextTide])} ${tideLabel(s)}.`, "info");
}

function eat(s: State): State {
  const lots = s.food.map((lot) => ({ ...lot })).sort((a, b) => a.tide - b.tide);
  const crew = s.crew.map((member) => {
    for (const lot of lots) {
      if (lot.amount > 0) {
        lot.amount -= 1;
        return { ...member, fed: true };
      }
    }
    return { ...member, fed: false };
  });
  const hungry = crew.filter((member) => !member.fed);
  s = { ...s, crew, food: lots.filter((lot) => lot.amount > 0) };
  if (hungry.length > 0) {
    const names = hungry.map((member) => member.name).join(" and ");
    s = log(s, `${names} ${hungry.length > 1 ? "go" : "goes"} to sleep hungry. Half speed until fed.`, "loss");
  }
  return s;
}

function spoil(s: State): State {
  if (hasBuilt(s, "smokehouse")) return s;
  const spoiled = s.food.filter((lot) => s.tide - lot.tide >= SPOIL_AFTER_TIDES - 1);
  if (spoiled.length === 0) return s;
  const amount = spoiled.reduce((sum, lot) => sum + lot.amount, 0);
  s = { ...s, food: s.food.filter((lot) => !spoiled.includes(lot)) };
  return log(s, `${amount} food goes off overnight.`, "loss");
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
  };
  s = { ...s, jobs: [...s.jobs, job], nextJobId: s.nextJobId + 1 };
  return log(s, `${member?.name ?? "Someone"} heads out to the ${BAND_NAMES[option.band].toLowerCase()} for ${RESOURCES[option.resource].label.toLowerCase()}.`, "info");
}

function finish(s: State, reason: Ending["reason"]): State {
  const salvage = salvageValue(s);
  const structures = s.built.length * STRUCTURE_VALUE;
  const beacon = reason === "beacon" ? BEACON_BONUS : 0;
  const tidesLeft = reason === "beacon" ? s.tides.length - 1 - s.tide : 0;
  const tidesLeftBonus = tidesLeft * TIDE_REMAINING_BONUS;
  const ending: Ending = {
    reason,
    salvage,
    structures,
    beacon,
    tidesLeft,
    tidesLeftBonus,
    discovered: s.codex.length,
    score: salvage + structures + beacon + tidesLeftBonus,
  };
  s = { ...s, jobs: [], crew: s.crew.map((member) => ({ ...member, queued: null })), ended: ending };
  return log(s, reason === "beacon" ? "The bell rings out over the water. A ship turns toward the light." : "The last tide comes in. You count what the sea let you keep.", "build");
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
    default:
      break;
  }
  if (state.ended) return state;
  switch (action.type) {
    case "send": {
      if (!crewOf(state, action.crew)) return state;
      const option = availableJobs(state, action.crew).find((candidate) => candidate.band === action.band && candidate.resource === action.resource);
      if (!option) return state;
      if (!option.feasible) return log(state, option.blocked, "info");
      const s = { ...state, crew: state.crew.map((member) => (member.id === action.crew ? { ...member, queued: null } : member)) };
      return beginJob(s, action.crew, option);
    }
    case "queue": {
      if (!crewOf(state, action.crew) || !RESOURCES_BY_BAND[action.band].includes(action.resource)) return state;
      const s: State = {
        ...state,
        crew: state.crew.map((member) => (member.id === action.crew ? { ...member, queued: { band: action.band, resource: action.resource } } : member)),
      };
      return startQueued(s);
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
    case "combine":
      return combine(state, action.a, action.b);
    case "ring":
      if (!hasBuilt(state, "beacon")) return log(state, "There is no beacon to ring.", "info");
      return finish(state, "beacon");
    default:
      return state;
  }
}

function combine(state: State, a: Item, b: Item): State {
  const key = recipeKey(a, b);
  const recipe = RECIPES.find((candidate) => recipeKey(candidate.inputs[0], candidate.inputs[1]) === key);
  if (!hasItem(state, a) || !hasItem(state, b) || (a === b && countOf(state, a) < 2)) {
    return log(state, "You don't have both of those.", "info");
  }
  if (!recipe) {
    const line = FAILED_COMBINE_LINES[hashKey(key) % FAILED_COMBINE_LINES.length];
    return log(state, line, "info");
  }
  if (recipe.requires && !hasBuilt(state, recipe.requires)) {
    return log(state, `You need a ${BUILT_LABELS[recipe.requires].toLowerCase()} first.`, "info");
  }
  if (recipe.out === "shelter" && state.crew.length >= MAX_CREW) {
    return log(state, "There's no one else out here to shelter.", "info");
  }
  if (recipe.structure && recipe.out !== "shelter" && hasBuilt(state, recipe.out)) {
    return log(state, `You already have a ${recipe.label.toLowerCase()}. One is enough.`, "info");
  }
  let s = removeItem(state, a);
  s = removeItem(s, b);
  const discovered = !s.codex.includes(key);
  if (discovered) s = { ...s, codex: [...s.codex, key].sort() };
  if (recipe.structure) {
    s = { ...s, built: [...s.built, recipe.out] };
  } else {
    s = { ...s, inventory: addItem(s.inventory, recipe.out, 1) };
  }
  if (recipe.out === "shelter") {
    const id = s.crew.length;
    s = { ...s, crew: [...s.crew, { id, name: CREW_NAMES[id] ?? `Crew ${id + 1}`, fed: true, queued: null }] };
  }
  return log(s, `${recipe.flavour}${discovered ? ` (${recipe.label} discovered.)` : ""}`, "build");
}

// ---------------------------------------------------------------------------
// Helpers

function hasInputs(state: State, recipe: Recipe): boolean {
  const [a, b] = recipe.inputs;
  if (a === b) return countOf(state, a) >= 2;
  return hasItem(state, a) && hasItem(state, b);
}

function countOf(state: State, item: Item): number {
  return (state.inventory[item] ?? 0) + state.built.filter((built) => built === item).length;
}

function hasItem(state: State, item: Item): boolean {
  return countOf(state, item) > 0;
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

function addFood(food: readonly FoodLot[], amount: number, tide: number): FoodLot[] {
  const existing = food.find((lot) => lot.tide === tide);
  if (existing) return food.map((lot) => (lot === existing ? { ...lot, amount: lot.amount + amount } : lot));
  return [...food, { amount, tide }];
}

function log(state: State, text: string, kind: LogEntry["kind"]): State {
  const entry: LogEntry = { time: state.time, text, kind };
  return { ...state, log: [...state.log, entry].slice(-LOG_LIMIT) };
}

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}
