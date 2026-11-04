import { expect, test } from "@playwright/test";

import {
  advance,
  availableJobs,
  canCombine,
  dispatch,
  floodTime,
  forecast,
  isDark,
  jobDuration,
  newRun,
  recipeHints,
  tideTable,
  TIDE_MS,
  TIDES_PER_RUN,
  totalFood,
  TURN_MS,
  type Band,
  type Item,
  type Resource,
  type State,
} from "../src/entries/low-tide/model";
import { CODEX_KEY, loadBest, loadCodex, loadRun, recordBest, RUN_KEY, saveCodex, saveRun } from "../src/entries/low-tide/storage";

/** A seeded run whose tide table satisfies `where`, so tests do not depend on luck. */
function runWhere(where: (tides: number[]) => boolean, codex: string[] = []): State {
  for (let seed = 1; seed < 5000; seed++) {
    if (where(tideTable(seed))) return dispatch(newRun(seed, codex), { type: "resume" });
  }
  throw new Error("no seed satisfies the condition");
}

function give(state: State, items: Partial<Record<Item, number>>): State {
  return { ...state, inventory: { ...state.inventory, ...items } };
}

const send = (state: State, crew: number, band: Band, resource: Resource) => dispatch(state, { type: "send", crew, band, resource });
const combine = (state: State, a: Item, b: Item) => dispatch(state, { type: "combine", a, b });
const lastLog = (state: State) => state.log[state.log.length - 1]?.text ?? "";

test("tide tables are seeded, start generously, never strand the crew, and always reach the wreck", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const tides = tideTable(seed);
    expect(tides).toEqual(tideTable(seed));
    expect(tides).toHaveLength(TIDES_PER_RUN);
    expect(tides[0]).toBeGreaterThanOrEqual(2);
    expect(tides[0]).toBeLessThanOrEqual(3);
    for (let i = 1; i < tides.length; i++) expect(tides[i - 1] === 1 && tides[i] === 1).toBe(false);
    expect(tides.filter((depth) => depth === 4).length).toBeGreaterThanOrEqual(2);
    expect(tides.some((depth, i) => depth === 4 && i >= TIDES_PER_RUN / 2 && !isDark(i))).toBe(true);
    for (const depth of tides) expect(depth >= 1 && depth <= 4).toBe(true);
  }
  expect(tideTable(1)).not.toEqual(tideTable(2));
});

test("a new run starts paused with two fed crew, rations, and a three-tide forecast", () => {
  const state = newRun(7);
  expect(state.paused).toBe(true);
  expect(state.crew).toHaveLength(2);
  expect(state.crew.every((member) => member.fed)).toBe(true);
  expect(totalFood(state)).toBe(4);
  expect(forecast(state)).toHaveLength(3);
  expect(forecast(state)[0]).toMatchObject({ tide: 0, current: true, dark: false });
  expect(advance(state, 10_000).time).toBe(0);
  expect(dispatch(dispatch(state, { type: "resume" }), { type: "pause" }).paused).toBe(true);
});

test("the shingle never floods; exposed bands flood from the outside in, the mudflat last", () => {
  const state = runWhere((tides) => tides[0] === 3);
  expect(floodTime(state, 0)).toBeNull();
  expect(floodTime(state, 2)).toBe(TURN_MS);
  expect(floodTime(state, 1)).toBe(TIDE_MS);
  expect(floodTime(state, 3)).toBeUndefined();
  const deep = { ...state, tides: [4, ...state.tides.slice(1)] };
  expect([3, 2, 1].map((band) => floodTime(deep, band as Band))).toEqual([TURN_MS, 65_000, TIDE_MS]);
  const shallow = { ...state, tides: [2, ...state.tides.slice(1)] };
  expect(floodTime(shallow, 1)).toBe(TURN_MS);
  const options = availableJobs(state, 0);
  expect(options.find((option) => option.band === 3)?.blocked).toBe("Under water this tide.");
  expect(options.find((option) => option.band === 2 && option.resource === "kelp")?.feasible).toBe(true);
});

test("a job finishes after its duration, yields, and frees the crew member", () => {
  let state = runWhere((tides) => tides[0] >= 2);
  const duration = jobDuration(state, 0, "driftwood");
  state = send(state, 0, 0, "driftwood");
  expect(state.jobs).toHaveLength(1);
  expect(availableJobs(state, 0).every((option) => option.blocked === "Already working.")).toBe(true);
  state = advance(state, duration - 1);
  expect(state.inventory.driftwood).toBeUndefined();
  state = advance(state, 1);
  expect(state.inventory.driftwood).toBe(1);
  expect(state.jobs).toHaveLength(0);
  expect(lastLog(state)).toContain("Wren brings back 1 driftwood");
});

test("a job that cannot finish before the water arrives is refused, and one caught by the tide is lost", () => {
  let state = runWhere((tides) => tides[0] === 2);
  // With only the mudflat bare it turns at 50 s. Advance until a 20 s clam job cannot finish.
  state = advance(state, TURN_MS - 10_000);
  const option = availableJobs(state, 0).find((candidate) => candidate.resource === "clams")!;
  expect(option.feasible).toBe(false);
  expect(option.blocked).toBe("Would flood first.");
  expect(send(state, 0, 1, "clams").jobs).toHaveLength(0);

  // A job can still be lost if the rules change under it: here the raft band stays safe,
  // so instead check the lose path by forcing a job whose band floods before it finishes.
  let risky = runWhere((tides) => tides[0] === 3);
  risky = send(risky, 0, 2, "pearl");
  risky = { ...risky, jobs: risky.jobs.map((job) => ({ ...job, finishesAt: TURN_MS + 5_000 })) };
  risky = advance(risky, TURN_MS);
  expect(risky.jobs).toHaveLength(0);
  expect(risky.inventory.pearl).toBeUndefined();
  expect(lastLog(risky)).toContain("The water takes the reef");
});

test("advancing across a tide boundary feeds the crew, spoils old food, and moves the forecast", () => {
  let state = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2 && tides[2] >= 2);
  state = advance(state, TIDE_MS);
  expect(state.tide).toBe(1);
  expect(totalFood(state)).toBe(2);
  expect(state.crew.every((member) => member.fed)).toBe(true);
  state = advance(state, TIDE_MS);
  expect(state.tide).toBe(2);
  expect(totalFood(state)).toBe(0);
  state = advance(state, TIDE_MS);
  expect(state.tide).toBe(3);
  expect(state.crew.every((member) => !member.fed)).toBe(true);
  expect(state.log.some((entry) => entry.text.includes("hungry"))).toBe(true);
  // Hungry crew work at half speed rather than sitting out, so a run can always recover.
  expect(jobDuration(state, 0, "driftwood")).toBeGreaterThanOrEqual(2 * 14_000);
  expect(availableJobs(state, 0).some((option) => option.feasible)).toBe(true);
});

test("hungry crew eat the moment food reaches camp, so hunger does not spiral", () => {
  let state = runWhere((tides) => tides[0] >= 3 && tides[1] >= 3);
  state = { ...state, food: [], crew: state.crew.map((member) => ({ ...member, fed: false })) };
  expect(jobDuration(state, 0, "clams")).toBe(40_000);
  state = send(state, 0, 1, "clams");
  state = advance(state, 40_000);
  expect(state.crew[0].fed).toBe(true);
  expect(state.crew[1].fed).toBe(false);
  expect(totalFood(state)).toBe(0);
  expect(lastLog(state)).toContain("Wren eats straight away");
  expect(jobDuration(state, 0, "clams")).toBe(20_000);
});

test("raw food spoils after two tides unless a smokehouse stands", () => {
  let state = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2);
  state = { ...state, food: [{ amount: 10, tide: 0 }] };
  state = advance(state, TIDE_MS); // end of tide 0: eat 2 → 8, lot is fresh
  expect(totalFood(state)).toBe(8);
  state = advance(state, TIDE_MS); // end of tide 1: eat 2 → 6, then the tide-0 lot spoils
  expect(totalFood(state)).toBe(0);
  expect(lastLog(dispatch(state, { type: "pause" })) === lastLog(state)).toBe(true);
  expect(state.log.some((entry) => entry.text.includes("goes off"))).toBe(true);

  let smoked = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2);
  smoked = { ...smoked, food: [{ amount: 10, tide: 0 }], built: ["smokehouse"] };
  smoked = advance(smoked, 2 * TIDE_MS);
  expect(totalFood(smoked)).toBe(6);
});

test("combining discovers recipes, consumes inputs, and failed combinations cost nothing but a line", () => {
  let state = give(runWhere(() => true), { kelp: 1, reed: 2, driftwood: 1, stone: 1 });
  expect(canCombine(state, "kelp", "stone")).toBeNull();
  const before = state.inventory;
  state = combine(state, "kelp", "stone");
  expect(state.inventory).toEqual(before);
  expect(state.codex).toEqual([]);

  expect(canCombine(state, "reed", "kelp")?.out).toBe("rope");
  state = combine(state, "reed", "kelp");
  expect(state.inventory.rope).toBe(1);
  expect(state.inventory.kelp).toBeUndefined();
  expect(state.inventory.reed).toBe(1);
  expect(state.codex).toEqual(["kelp+reed"]);
  expect(lastLog(state)).toContain("Rope discovered");

  state = combine(state, "rope", "driftwood");
  expect(state.built).toContain("net");
  expect(state.inventory.rope).toBeUndefined();
  expect(state.codex).toEqual(["driftwood+rope", "kelp+reed"]);

  // One of each structure is enough; a second net is refused and costs nothing.
  const again = give(state, { rope: 1, driftwood: 1 });
  expect(canCombine(again, "rope", "driftwood")).toBeNull();
  const refused = combine(again, "rope", "driftwood");
  expect(refused.built).toEqual(["net"]);
  expect(refused.inventory.rope).toBe(1);
  expect(lastLog(refused)).toContain("You already have a net");

  // Known recipes carry into the next run; the inventory does not.
  const next = dispatch(state, { type: "newRun", seed: 3 });
  expect(next.codex).toEqual(["driftwood+rope", "kelp+reed"]);
  expect(next.inventory).toEqual({});
  expect(next.built).toEqual([]);
});

test("structures change the rules: net, waders, lantern, raft, shelter, kiln", () => {
  const base = runWhere((tides) => tides[0] === 3 && tides[3] === 3);
  expect(jobDuration(base, 0, "fish")).toBe(24_000);
  expect(jobDuration({ ...base, built: ["waders"] }, 0, "fish")).toBe(16_800);
  expect(jobDuration({ ...base, built: ["waders"] }, 0, "stone")).toBe(18_000);

  let netted: State = { ...base, built: ["net"] };
  netted = send(netted, 0, 2, "fish");
  netted = advance(netted, 24_000);
  expect(totalFood(netted)).toBe(4 + 5);

  const night = advance({ ...base, built: ["smokehouse"], food: [{ amount: 20, tide: 0 }] }, 3 * TIDE_MS);
  expect(night.tide).toBe(3);
  expect(night.crew.every((member) => member.fed)).toBe(true);
  expect(isDark(3)).toBe(true);
  expect(jobDuration(night, 0, "driftwood")).toBe(28_000);
  expect(jobDuration({ ...night, built: ["lantern"] }, 0, "driftwood")).toBe(14_000);

  const rafted = { ...base, built: ["raft" as const] };
  expect(floodTime(base, 3)).toBeUndefined();
  expect(floodTime(rafted, 3)).toBeNull();
  const brass = availableJobs(rafted, 0).find((option) => option.resource === "brass")!;
  expect(brass.feasible).toBe(true);
  expect(brass.duration).toBe(42_000);

  let sheltered = give(base, { reed: 1, stone: 1 });
  sheltered = combine(sheltered, "reed", "stone");
  expect(sheltered.crew).toHaveLength(3);
  expect(sheltered.crew[2].name).toBe("Ada");

  let fired = give(base, { clay: 1, driftwood: 1 });
  expect(canCombine(fired, "clay", "driftwood")).toBeNull();
  fired = combine(fired, "clay", "driftwood");
  expect(lastLog(fired)).toContain("You need a kiln first");
  expect(fired.inventory.clay).toBe(1);
  fired = combine({ ...fired, built: ["kiln"] }, "clay", "driftwood");
  expect(fired.inventory.brick).toBe(1);
});

test("recipe hints point at reachable goals, nearest first, without giving the pair away", () => {
  let state = give(runWhere(() => true), { reed: 1 });
  let hints = recipeHints(state);
  // Brick needs a kiln, so it is not offered yet; everything else is.
  expect(hints.map((hint) => hint.recipe.out)).not.toContain("brick");
  expect(hints).toHaveLength(10);
  expect(hints.slice(0, 3).map((hint) => hint.held)).toEqual(["reed", "reed", "reed"]);
  expect(hints.slice(3).every((hint) => hint.held === null)).toBe(true);

  state = give({ ...state, built: ["kiln"], codex: ["clay+stone"] }, { clay: 1 });
  hints = recipeHints(state);
  expect(hints.map((hint) => hint.recipe.out)).toContain("brick");
  expect(hints.map((hint) => hint.recipe.out)).not.toContain("kiln");
  expect(hints[0].held).toBeTruthy();
});

test("a queued job waits until it can finish before the flood, then starts by itself", () => {
  let state = runWhere((tides) => tides[0] === 2 && tides[1] === 4);
  state = dispatch(state, { type: "queue", crew: 0, band: 3, resource: "brass" });
  expect(state.jobs).toHaveLength(0);
  expect(state.crew[0].queued).toEqual({ band: 3, resource: "brass" });
  state = advance(state, TIDE_MS - 1);
  expect(state.jobs).toHaveLength(0);
  state = advance(state, 1);
  expect(state.tide).toBe(1);
  expect(state.jobs).toHaveLength(1);
  expect(state.jobs[0]).toMatchObject({ band: 3, resource: "brass", crew: 0 });
  expect(state.crew[0].queued).toBeNull();

  // Queue behind a running job: it starts the moment the first one finishes.
  let busy = runWhere((tides) => tides[0] === 3);
  busy = send(busy, 1, 0, "driftwood");
  busy = dispatch(busy, { type: "queue", crew: 1, band: 0, resource: "stone" });
  busy = advance(busy, 14_000);
  expect(busy.inventory.driftwood).toBe(1);
  expect(busy.jobs).toHaveLength(1);
  expect(busy.jobs[0].resource).toBe("stone");
  busy = dispatch(busy, { type: "recall", job: busy.jobs[0].id });
  expect(busy.jobs).toHaveLength(0);
});

test("ringing a finished beacon ends the run early with the bonus; otherwise the twelfth tide ends it", () => {
  let state = runWhere((tides) => tides[0] >= 2);
  expect(dispatch(state, { type: "ring" }).ended).toBeNull();
  state = { ...state, built: ["bellTower", "lantern"] };
  state = combine(state, "bellTower", "lantern");
  expect(state.built).toEqual(["beacon"]);
  state = give(state, { pearl: 1, driftwood: 40 });
  state = dispatch(state, { type: "ring" });
  // Only the first six of any one item count, so forty driftwood are worth six.
  expect(state.ended).toMatchObject({ reason: "beacon", beacon: 500, tidesLeft: 11, tidesLeftBonus: 440, salvage: 66, structures: 50 });
  expect(state.ended?.score).toBe(66 + 50 + 500 + 440);
  expect(advance(state, 10_000)).toBe(state);
  expect(send(state, 0, 0, "driftwood")).toBe(state);

  let full = runWhere(() => true);
  full = { ...full, built: ["smokehouse"], food: [{ amount: 100, tide: 0 }] };
  full = advance(full, TIDES_PER_RUN * TIDE_MS + 5);
  expect(full.ended?.reason).toBe("tides");
  expect(full.time).toBe(TIDES_PER_RUN * TIDE_MS);
  expect(full.ended?.structures).toBe(50);
});

test("advance is stable however finely time is sliced", () => {
  const coarse = (() => {
    let state = runWhere((tides) => tides[0] === 3 && tides[1] >= 2);
    state = send(state, 0, 2, "fish");
    state = send(state, 1, 1, "clams");
    return advance(state, 2 * TIDE_MS + 777);
  })();
  const fine = (() => {
    let state = runWhere((tides) => tides[0] === 3 && tides[1] >= 2);
    state = send(state, 0, 2, "fish");
    state = send(state, 1, 1, "clams");
    for (let t = 0; t < 2 * TIDE_MS + 777; t += 333) state = advance(state, Math.min(333, 2 * TIDE_MS + 777 - t));
    return state;
  })();
  expect(fine.time).toBe(coarse.time);
  expect(fine.inventory).toEqual(coarse.inventory);
  expect(fine.food).toEqual(coarse.food);
  expect(fine.tide).toBe(coarse.tide);
  expect(fine.log.map((entry) => entry.text)).toEqual(coarse.log.map((entry) => entry.text));
});

test("saves round-trip through localStorage, reload resumes paused, and the codex merges across runs", () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } as unknown as Storage;
  (globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage };
  try {
    expect(loadRun()).toBeNull();
    let state = runWhere(() => true);
    state = send(state, 0, 0, "driftwood");
    state = advance(state, 5_000);
    saveRun(state);
    const loaded = loadRun()!;
    expect(loaded.paused).toBe(true);
    expect({ ...loaded, paused: false }).toEqual(state);
    expect(JSON.parse(store.get(RUN_KEY)!)).toBeTruthy();

    saveCodex(["kelp+reed"]);
    saveCodex(["driftwood+rope", "kelp+reed"]);
    expect(loadCodex()).toEqual(["driftwood+rope", "kelp+reed"]);

    expect(loadBest()).toBeNull();
    expect(recordBest({ score: 120, beacon: false, seed: 1 })).toEqual({ score: 120, beacon: false, seed: 1 });
    expect(recordBest({ score: 90, beacon: true, seed: 2 })).toEqual({ score: 120, beacon: false, seed: 1 });
    expect(recordBest({ score: 900, beacon: true, seed: 3 })).toEqual({ score: 900, beacon: true, seed: 3 });
    expect(loadBest()).toEqual({ score: 900, beacon: true, seed: 3 });

    store.set(RUN_KEY, "{not json");
    expect(loadRun()).toBeNull();
    store.set(CODEX_KEY, "[1, \"a+b\"]");
    expect(loadCodex()).toEqual(["a+b"]);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
