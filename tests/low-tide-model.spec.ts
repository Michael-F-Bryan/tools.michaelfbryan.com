import { expect, test } from "@playwright/test";

import {
  advance,
  availableJobs,
  BLUEPRINTS,
  buildOptions,
  canBuild,
  dispatch,
  floodTime,
  forecast,
  isDark,
  jobDuration,
  newRun,
  producers,
  reach,
  tideChart,
  tideTable,
  TIDE_MS,
  TIDES_PER_RUN,
  TURN_MS,
  CREEP_MS,
  waterline,
  type Band,
  type Built,
  type Item,
  type Resource,
  type State,
} from "../src/entries/low-tide/model";
import {
  CODEX_KEY,
  hasLegacyRun,
  LEGACY_RUN_KEY,
  loadBest,
  loadCodex,
  loadRun,
  recordBest,
  retireLegacyRun,
  RUN_KEY,
  saveCodex,
  saveRun,
} from "../src/entries/low-tide/storage";

/** A seeded run whose tide chart satisfies `where`, so tests do not depend on luck. */
function runWhere(where: (tides: number[]) => boolean, codex: string[] = []): State {
  for (let seed = 1; seed < 5000; seed++) {
    if (where(tideTable(seed))) return dispatch(newRun(seed, codex), { type: "resume" });
  }
  throw new Error("no seed satisfies the condition");
}

function give(state: State, items: Partial<Record<Item, number>>): State {
  return { ...state, inventory: { ...state.inventory, ...items } };
}

function withBuilt(state: State, built: Built[]): State {
  return { ...state, built, unlocked: 3 };
}

const send = (state: State, crew: number, band: Band, resource: Resource) => dispatch(state, { type: "send", crew, band, resource });
const build = (state: State, out: Built) => dispatch(state, { type: "build", out });
const lastLog = (state: State) => state.log[state.log.length - 1]?.text ?? "";

test("tide charts are seeded, plannable, start generously, never strand the crew, and always reach the wreck in daylight", () => {
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
    // A cycle, not dice: neighbouring tides differ by at most two bands.
    for (let i = 1; i < tides.length; i++) expect(Math.abs(tides[i] - tides[i - 1])).toBeLessThanOrEqual(2);
  }
  expect(tideTable(1)).not.toEqual(tideTable(2));
});

test("a new run starts paused with two fed crew, rations, every blueprint visible, and the whole chart", () => {
  const state = newRun(7);
  expect(state.version).toBe(2);
  expect(state.paused).toBe(true);
  expect(state.crew).toHaveLength(2);
  expect(state.food).toBe(6);
  expect(state.unlocked).toBe(1);
  expect(tideChart(state)).toHaveLength(TIDES_PER_RUN);
  expect(tideChart(state)[0]).toMatchObject({ tide: 0, current: true, past: false });
  expect(forecast(state, 3)).toHaveLength(3);
  expect(buildOptions(state)).toHaveLength(BLUEPRINTS.length);
  expect(buildOptions(state).filter((option) => !option.locked).map((option) => option.blueprint.tier)).toEqual([1, 1, 1, 1, 1]);
  expect(advance(state, 10_000).time).toBe(0);
  expect(newRun(1, [], "hello").notice).toBe("hello");
  expect(dispatch(newRun(1, [], "hello"), { type: "dismissNotice" }).notice).toBeNull();
});

test("the shingle never floods; exposed bands flood from the outside in; the waterline agrees with the flood times", () => {
  const state = runWhere((tides) => tides[0] === 3);
  expect(floodTime(state, 0)).toBeNull();
  expect(floodTime(state, 2)).toBe(TURN_MS);
  expect(floodTime(state, 1)).toBe(TIDE_MS);
  expect(floodTime(state, 3)).toBeUndefined();
  const deep = { ...state, tides: [4, ...state.tides.slice(1)] };
  expect([3, 2, 1].map((band) => floodTime(deep, band as Band))).toEqual([TURN_MS, 65_000, TIDE_MS]);
  const shallow = { ...state, tides: [2, ...state.tides.slice(1)] };
  expect(floodTime(shallow, 1)).toBe(TURN_MS);

  // Band b is dry exactly while waterline > b, at every moment of the tide, for every depth.
  for (const depth of [1, 2, 3, 4]) {
    const run = { ...state, tides: [depth, ...state.tides.slice(1)] };
    expect(waterline(run)).toBe(Math.max(1, depth));
    for (let t = 0; t < TIDE_MS; t += 250) {
      const at = { ...run, time: t };
      const level = waterline(at);
      for (const band of [1, 2, 3] as Band[]) {
        const flood = floodTime(at, band);
        const dry = flood !== undefined && (flood === null || t < flood);
        expect(level > band, `depth ${depth} t ${t} band ${band}`).toBe(dry);
      }
    }
    if (depth >= 2) {
      expect(waterline({ ...run, time: TURN_MS - CREEP_MS })).toBe(depth);
      expect(waterline({ ...run, time: TURN_MS - CREEP_MS / 2 })).toBeCloseTo(depth - 0.5);
      expect(waterline({ ...run, time: TIDE_MS - 1 })).toBeCloseTo(1, 1);
    }
  }
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

test("a job that cannot finish in time is held and starts by itself when the water allows; one caught by the tide is lost", () => {
  let state = runWhere((tides) => tides[0] === 2 && tides[1] >= 2);
  state = advance(state, TURN_MS - 10_000);
  const option = availableJobs(state, 0).find((candidate) => candidate.resource === "clams")!;
  expect(option.feasible).toBe(false);
  expect(option.blocked).toBe("Would flood first.");
  expect(option.waits).toBe(true);
  state = send(state, 0, 1, "clams");
  expect(state.jobs).toHaveLength(0);
  expect(state.crew[0].queued).toEqual({ band: 1, resource: "clams" });
  expect(lastLog(state)).toContain("as soon as the water allows");
  state = advance(state, TIDE_MS - (TURN_MS - 10_000));
  expect(state.tide).toBe(1);
  expect(state.jobs).toHaveLength(1);
  expect(state.jobs[0].resource).toBe("clams");

  // Shingle jobs are safe from the water but still cannot run past the turn of the tide.
  let late = runWhere((tides) => tides[0] >= 2);
  late = advance(late, TIDE_MS - 5_000);
  expect(availableJobs(late, 0).find((candidate) => candidate.resource === "driftwood")?.blocked).toBe("The tide turns first.");

  let risky = runWhere((tides) => tides[0] === 3);
  risky = send(risky, 0, 2, "pearl");
  risky = { ...risky, jobs: risky.jobs.map((job) => ({ ...job, finishesAt: TURN_MS + 5_000 })) };
  risky = advance(risky, TURN_MS);
  expect(risky.jobs).toHaveLength(0);
  expect(risky.inventory.pearl).toBeUndefined();
  expect(lastLog(risky)).toContain("The water takes the reef");
});

test("the turn of the tide: structures produce, then the crew eat, and hunger means half speed until food arrives", () => {
  let state = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2 && tides[2] >= 2 && tides[3] >= 2);
  state = advance(state, TIDE_MS);
  expect(state.tide).toBe(1);
  expect(state.food).toBe(4);
  state = advance(state, 2 * TIDE_MS);
  expect(state.tide).toBe(3);
  expect(state.food).toBe(0);
  expect(state.crew.every((member) => member.fed)).toBe(true);
  state = advance(state, TIDE_MS);
  expect(state.crew.every((member) => !member.fed)).toBe(true);
  expect(state.log.some((entry) => entry.text.includes("hungry"))).toBe(true);
  expect(jobDuration(state, 0, "driftwood")).toBe(2 * 14_000);
  expect(availableJobs(state, 0).some((option) => option.feasible)).toBe(true);

  // A fish trap feeds two mouths by itself; the kiln fires one brick per turn from clay and driftwood.
  let camp = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2);
  camp = give(withBuilt(camp, ["fishTrap", "kiln"]), { clay: 2, driftwood: 1 });
  expect(producers(camp).map((producer) => producer.id)).toEqual(["fishTrap", "kiln"]);
  expect(producers(camp)[1].ready).toBe(true);
  camp = advance(camp, TIDE_MS);
  expect(camp.food).toBe(6 + 2 - 2);
  expect(camp.inventory).toEqual({ clay: 1, brick: 1 });
  expect(producers(camp)[1].ready).toBe(false);
  camp = advance(camp, TIDE_MS);
  expect(camp.inventory).toEqual({ clay: 1, brick: 1 });
  expect(camp.food).toBe(6);
});

test("hungry crew eat the moment food reaches camp, so hunger does not spiral", () => {
  let state = runWhere((tides) => tides[0] >= 3 && tides[1] >= 3);
  state = { ...state, food: 0, crew: state.crew.map((member) => ({ ...member, fed: false })) };
  expect(jobDuration(state, 0, "clams")).toBe(40_000);
  state = send(state, 0, 1, "clams");
  state = advance(state, 40_000);
  expect(state.crew.every((member) => member.fed)).toBe(true);
  expect(state.food).toBe(1);
  expect(lastLog(state)).toContain("Wren and Sol eat straight away");
  expect(jobDuration(state, 0, "clams")).toBe(20_000);
});

test("blueprints are visible with what is missing; building consumes inputs, unlocks the next tier, and stands once", () => {
  let state = runWhere(() => true);
  const waders = canBuild(state, "waders");
  expect(waders).toEqual({ ok: false, missing: ["reed", "driftwood"], why: "Needs reeds, driftwood." });
  expect(canBuild(state, "net").why).toBe("Build something from tier 1 first.");
  expect(canBuild(give(state, { driftwood: 1 }), "sled")).toEqual({ ok: false, missing: ["driftwood"], why: "Needs driftwood." });

  state = give(state, { reed: 2, driftwood: 3, kelp: 1 });
  expect(build(state, "net").built).toEqual([]);
  state = build(state, "waders");
  expect(state.built).toEqual(["waders"]);
  expect(state.inventory).toEqual({ reed: 1, driftwood: 2, kelp: 1 });
  expect(state.unlocked).toBe(2);
  expect(state.codex).toEqual(["waders"]);
  expect(lastLog(state)).toContain("Reed wrapped over driftwood soles");

  // A material does not unlock a tier; a second pair of waders is refused.
  state = build(state, "rope");
  expect(state.inventory.rope).toBe(1);
  expect(canBuild(give(state, { reed: 5, driftwood: 5 }), "waders").why).toBe("Already standing.");
  state = build(state, "raft");
  expect(state.built).toEqual(["waders", "raft"]);
  expect(state.unlocked).toBe(3);
  expect(state.inventory).toEqual({});

  // Known blueprints carry into the next run; the inventory does not.
  const next = dispatch(state, { type: "newRun", seed: 3 });
  expect(next.codex).toEqual(["raft", "rope", "waders"]);
  expect(next.inventory).toEqual({});
  expect(next.built).toEqual([]);
  expect(next.unlocked).toBe(1);
});

test("reach lets the crew work past the waterline all tide, slower, and never floods them", () => {
  const base = runWhere((tides) => tides[0] === 2);
  expect(reach(base)).toBe(0);
  expect(availableJobs(base, 0).find((option) => option.resource === "kelp")?.blocked).toBe("Under water this tide.");

  const waded = withBuilt(base, ["waders"]);
  expect(reach(waded)).toBe(1);
  expect(floodTime(waded, 2)).toBeNull();
  expect(floodTime(waded, 3)).toBeUndefined();
  const kelp = availableJobs(waded, 0).find((option) => option.resource === "kelp")!;
  expect(kelp).toMatchObject({ feasible: true, beyond: 1, duration: 30_000 });

  const rafted = withBuilt(base, ["waders", "raft"]);
  expect(reach(rafted)).toBe(2);
  const brass = availableJobs(rafted, 0).find((option) => option.resource === "brass")!;
  expect(brass).toMatchObject({ feasible: true, beyond: 2, duration: 56_000 });
  let out = send(rafted, 0, 3, "brass");
  expect(lastLog(out)).toContain("on the raft");
  out = advance(out, 56_000);
  expect(out.inventory.brass).toBe(1);

  // Bare ground inside the waterline still floods exactly as before.
  expect(floodTime(rafted, 1)).toBe(TURN_MS);
});

test("structures change the rules: net, sled, winch, lantern, shelter", () => {
  const base = (() => {
    const run = runWhere((tides) => tides[0] === 3 && tides[3] >= 2);
    return { ...run, tides: [4, ...run.tides.slice(1)] };
  })();
  expect(jobDuration(base, 0, "brass")).toBe(28_000);
  expect(jobDuration(withBuilt(base, ["winch"]), 0, "brass")).toBe(16_800);
  expect(jobDuration(withBuilt(base, ["winch"]), 0, "stone")).toBe(18_000);

  let netted = send(withBuilt(base, ["net"]), 0, 2, "fish");
  netted = advance(netted, 24_000);
  expect(netted.food).toBe(6 + 8);

  let sledded = send(withBuilt(base, ["sled"]), 0, 0, "stone");
  sledded = advance(sledded, 18_000);
  expect(sledded.inventory.stone).toBe(2);
  let sledFood = send(withBuilt(base, ["sled"]), 0, 1, "clams");
  sledFood = advance(sledFood, 20_000);
  expect(sledFood.food).toBe(6 + 3);

  const night = advance({ ...withBuilt(base, ["fishTrap"]), food: 20 }, 3 * TIDE_MS);
  expect(night.tide).toBe(3);
  expect(isDark(3)).toBe(true);
  expect(jobDuration(night, 0, "driftwood")).toBe(28_000);
  expect(jobDuration({ ...night, built: ["lantern"] }, 0, "driftwood")).toBe(14_000);

  let sheltered = give({ ...base, unlocked: 2 }, { reed: 1, clay: 1 });
  sheltered = build(sheltered, "shelter");
  expect(sheltered.crew).toHaveLength(3);
  expect(sheltered.crew[2].name).toBe("Ada");
  const full = { ...sheltered, crew: [...sheltered.crew, { id: 3, name: "Finn", fed: true, queued: null }] };
  expect(canBuild(give(full, { reed: 1, clay: 1 }), "shelter").why).toContain("no one else");
});

test("a queued job waits until it can finish, then starts by itself; queue behind a running job", () => {
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
  state = withBuilt(state, ["bellTower", "lantern"]);
  expect(canBuild(state, "beacon").ok).toBe(true);
  state = build(state, "beacon");
  expect(state.built).toEqual(["beacon"]);
  state = give({ ...state, food: 15 }, { pearl: 1, driftwood: 40 });
  state = dispatch(state, { type: "ring" });
  // Only the first six of any one item count, so forty driftwood are worth six; food counts to ten.
  expect(state.ended).toMatchObject({ reason: "beacon", beacon: 500, tidesLeft: 11, tidesLeftBonus: 440, salvage: 66, structures: 50, foodScore: 20 });
  expect(state.ended?.score).toBe(66 + 50 + 20 + 500 + 440);
  expect(advance(state, 10_000)).toBe(state);
  expect(send(state, 0, 0, "driftwood")).toBe(state);

  let full = runWhere(() => true);
  full = { ...withBuilt(full, ["fishTrap"]), food: 100 };
  full = advance(full, TIDES_PER_RUN * TIDE_MS + 5);
  expect(full.ended?.reason).toBe("tides");
  expect(full.time).toBe(TIDES_PER_RUN * TIDE_MS);
  expect(full.ended?.structures).toBe(50);
});

test("three ends: a boat launches with salvage counted double, a saltworks compounds every turn, and builtAt tells the story", () => {
  let state = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2 && tides[2] >= 2);
  expect(dispatch(state, { type: "launch" }).ended).toBeNull();

  // Saltworks needs a kiln standing (not consumed) and then pays out at every turn, uncapped.
  state = give({ ...state, unlocked: 2 }, { clay: 3, kelp: 2, stone: 1, driftwood: 3, rope: 2, reed: 3 });
  expect(canBuild(state, "saltworks").why).toBe("Needs a kiln standing.");
  state = build(state, "kiln");
  expect(state.builtAt).toEqual({ kiln: 0 });
  state = build(state, "saltworks");
  expect(state.built).toEqual(["kiln", "saltworks"]);
  expect(state.inventory.clay).toBeUndefined();
  expect(state.inventory.driftwood).toBe(3);
  state = { ...state, food: 20 };
  state = advance(state, 2 * TIDE_MS);
  expect(state.inventory.salt).toBe(2);
  expect(state.tide).toBe(2);

  // Hull + sail make a boat; launching ends the run with the boat bonus and double salvage.
  state = build(state, "hull");
  state = build(state, "sail");
  expect(state.inventory).toMatchObject({ hull: 1, sail: 1 });
  state = build(state, "boat");
  expect(state.built).toContain("boat");
  expect(state.builtAt.boat).toBe(2);
  const salvageAlone = { ...state, inventory: { salt: 2, pearl: 1 } };
  const ended = dispatch(salvageAlone, { type: "launch" });
  expect(ended.ended).toMatchObject({ reason: "boat", beacon: 300, tidesLeft: 9, tidesLeftBonus: 360, salvage: 2 * (2 * 25 + 60), structures: 150, foodScore: 20 });
  expect(lastLog(ended)).toContain("The sail fills");

  // Salt is never capped; ordinary salvage still is.
  const salty = { ...state, inventory: { salt: 10, driftwood: 10 } };
  expect(dispatch(salty, { type: "launch" }).ended?.salvage).toBe(2 * (250 + 6));
});

test("advance is stable however finely time is sliced", () => {
  const play = (slice: number) => {
    let state = runWhere((tides) => tides[0] === 3 && tides[1] >= 2);
    state = give(withBuilt(state, ["kiln", "fishTrap"]), { clay: 1, driftwood: 1 });
    state = send(state, 0, 2, "fish");
    state = send(state, 1, 1, "clams");
    const total = 2 * TIDE_MS + 777;
    for (let t = 0; t < total; t += slice) state = advance(state, Math.min(slice, total - t));
    return state;
  };
  const coarse = play(2 * TIDE_MS + 777);
  const fine = play(333);
  expect(fine.time).toBe(coarse.time);
  expect(fine.inventory).toEqual(coarse.inventory);
  expect(fine.food).toBe(coarse.food);
  expect(fine.tide).toBe(coarse.tide);
  expect(fine.log.map((entry) => entry.text)).toEqual(coarse.log.map((entry) => entry.text));
});

test("saves round-trip, reload resumes paused, a first-pass save is retired not loaded, and the best run keeps counts", () => {
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

    store.set(LEGACY_RUN_KEY, JSON.stringify({ version: 1, time: 5, tide: 0 }));
    expect(hasLegacyRun()).toBe(true);
    retireLegacyRun();
    expect(hasLegacyRun()).toBe(false);

    saveCodex(["waders"]);
    store.set(CODEX_KEY, JSON.stringify(["kelp+reed", "waders", "net"]));
    expect(loadCodex()).toEqual(["waders", "net"]);

    expect(loadBest()).toBeNull();
    expect(recordBest({ score: 120, beacon: false, seed: 1 })).toEqual({ score: 120, beacon: false, seed: 1, beacons: 0, boats: 0, runs: 1 });
    expect(recordBest({ score: 90, beacon: true, seed: 2 })).toEqual({ score: 120, beacon: false, seed: 1, beacons: 1, boats: 0, runs: 2 });
    expect(recordBest({ score: 900, beacon: false, boat: true, seed: 3 })).toEqual({ score: 900, beacon: false, seed: 3, beacons: 1, boats: 1, runs: 3 });
    expect(loadBest()).toEqual({ score: 900, beacon: false, seed: 3, beacons: 1, boats: 1, runs: 3 });

    store.set(RUN_KEY, "{not json");
    expect(loadRun()).toBeNull();
    store.set(RUN_KEY, JSON.stringify({ version: 1 }));
    expect(loadRun()).toBeNull();
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
