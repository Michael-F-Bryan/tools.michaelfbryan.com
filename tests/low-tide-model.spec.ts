import { expect, test } from "@playwright/test";

import {
  advance,
  availableJobs,
  BLUEPRINTS,
  buildOptions,
  canBuild,
  dispatch,
  floodOffset,
  floodTime,
  forecast,
  isDark,
  jobDuration,
  jobYield,
  newRun,
  planTrade,
  producers,
  reach,
  score,
  searchTideTable,
  tideChart,
  tideElapsed,
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
  BEST_KEY,
  CODEX_KEY,
  hasLegacyRun,
  LEGACY_RUN_KEY,
  loadBest,
  loadCodex,
  loadRun,
  recordBest,
  retireLegacyRun,
  RULES_NOTICE,
  RUN_KEY,
  saveCodex,
  saveRun,
  upgradeRun,
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
/** The most recent "At the turn" line, which is not the last once the next tide's line follows it. */
const saleLog = (state: State) => [...state.log].reverse().find((entry) => entry.text.startsWith("At the turn"));
/** A running seed-1 run with `patch` applied; no jobs, so only the turn's own work happens. */
const at = (patch: Partial<State>): State => ({ ...newRun(1), paused: false, food: 100, ...patch });
/** Play to the end of the current tide. */
const turn = (state: State): State => advance(state, TIDE_MS - tideElapsed(state));

test("tide charts are seeded, plannable, start generously, never strand the crew, always reach the wreck in daylight, and bare the reef early", () => {
  let fallbacks = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    if (searchTideTable(seed) === null) fallbacks++;
    const tides = tideTable(seed);
    expect(tides.slice(0, 3).some((depth) => depth >= 3), `seed ${seed}`).toBe(true);
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
  // The fallback chart is a safety net, not something a real seed should lean on.
  expect(fallbacks).toBe(0);
});

test("a new run starts paused with two fed crew, rations, every blueprint visible, and the whole chart", () => {
  const state = newRun(7);
  expect(state.version).toBe(2);
  expect(state.sales).toEqual({ trader: 0, boat: 0, ship: 0 });
  expect(state.turnSales).toEqual([]);
  expect(score(state)).toBe(0);
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

test("reach opens a band past the waterline until the turn, slower, and the tide still sets how much fits", () => {
  // The flood table: reach opens a band but it goes under with the outermost bare band, at the turn.
  expect(floodOffset(2, 2, 1)).toBe(TURN_MS);
  expect(floodOffset(1, 3, 2)).toBe("never-exposed");
  expect(floodOffset(1, 2, 2)).toBe(TURN_MS);
  expect(floodOffset(4, 3, 0)).toBe(TURN_MS);
  expect(floodOffset(4, 1, 2)).toBe(TIDE_MS);
  expect(floodOffset(2, 0, 0)).toBeNull();

  const base = runWhere((tides) => tides[0] === 2);
  expect(reach(base)).toBe(0);
  expect(availableJobs(base, 0).find((option) => option.resource === "kelp")?.blocked).toBe("Under water this tide.");

  const waded = withBuilt(base, ["waders"]);
  expect(reach(waded)).toBe(1);
  expect(floodTime(waded, 2)).toBe(TURN_MS);
  expect(floodTime(waded, 3)).toBeUndefined();
  const kelp = availableJobs(waded, 0).find((option) => option.resource === "kelp")!;
  expect(kelp).toMatchObject({ feasible: true, beyond: 1, duration: 30_000, floodsAt: TURN_MS });

  // Raft and waders at depth 2: the wreck is two bands out at 2x time, and 56 s does not fit before the turn.
  const rafted = withBuilt(base, ["waders", "raft"]);
  expect(reach(rafted)).toBe(2);
  const noWinch = availableJobs(rafted, 0).find((option) => option.resource === "brass")!;
  expect(noWinch).toMatchObject({ feasible: false, blocked: "Would flood first.", beyond: 2, duration: 56_000 });
  // With the winch it takes 28 s and fits.
  const winched = withBuilt(base, ["waders", "raft", "winch"]);
  expect(availableJobs(winched, 0).find((option) => option.resource === "brass")).toMatchObject({ feasible: true, duration: 28_000 });
  let out = send(winched, 0, 3, "brass");
  expect(lastLog(out)).toContain("on the raft");
  out = advance(out, 28_000);
  expect(out.inventory.brass).toBe(1);
  // A reached job carries the turn as its flood time (oil: 30 s base, halved by the winch, doubled on the raft).
  const oil = send(winched, 0, 3, "oil");
  expect(oil.jobs[0]).toMatchObject({ beyond: 2, floodsAt: TURN_MS, finishesAt: 30_000 });
  // Started late, it no longer fits: it waits for the next tide instead.
  const lateOil = availableJobs(advance(winched, 25_000), 0).find((option) => option.resource === "oil")!;
  expect(lateOil).toMatchObject({ feasible: false, blocked: "Would flood first.", waits: true });

  // Bare ground inside the waterline still floods exactly as before.
  expect(floodTime(rafted, 1)).toBe(TURN_MS);
  // Depth 4 bare with the winch: three trips fit before the turn.
  const deep = withBuilt({ ...base, tides: [4, ...base.tides.slice(1)] }, ["winch"]);
  expect(jobDuration(deep, 0, "brass")).toBe(14_000);
});

test("structures change the rules: net, sled, winch, lantern, beacon, shelter", () => {
  const base = (() => {
    const run = runWhere((tides) => tides[0] === 3 && tides[3] >= 2);
    return { ...run, tides: [4, ...run.tides.slice(1)] };
  })();
  expect(jobDuration(base, 0, "brass")).toBe(28_000);
  expect(jobDuration(withBuilt(base, ["winch"]), 0, "brass")).toBe(14_000);
  expect(jobDuration(withBuilt(base, ["winch"]), 0, "stone")).toBe(18_000);

  // The net no longer multiplies fish jobs, and the sled does not touch food.
  expect(jobYield(withBuilt(base, ["net", "sled"]), "fish")).toBe(4);
  let netted = send(withBuilt(base, ["net"]), 0, 2, "fish");
  netted = advance(netted, 24_000);
  expect(netted.food).toBe(6 + 4);

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
  // The beacon keeps the lantern's light even though building it used the lantern up.
  expect(jobDuration({ ...night, built: ["beacon"] }, 0, "driftwood")).toBe(14_000);
  const darkReef = { ...night, tides: night.tides.map((depth, i) => (i === 3 ? 3 : depth)) };
  expect(jobDuration({ ...darkReef, built: [] }, 0, "kelp")).toBe(40_000);
  expect(jobDuration({ ...darkReef, built: ["beacon"] }, 0, "kelp")).toBe(20_000);

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

test("the trader takes the most valuable piece at each turn and never the last one of a kind until the final turn", () => {
  const sold = turn(at({ inventory: { pearl: 2, brass: 3 } }));
  expect(sold.inventory).toEqual({ pearl: 1, brass: 3 });
  expect(sold.sales).toEqual({ trader: 20, boat: 0, ship: 0 });
  expect(sold.turnSales).toEqual([20]);
  expect(score(sold)).toBe(20);
  expect(saleLog(sold)).toMatchObject({ text: "At the turn: the trader takes 1 pearl (20).", kind: "gain" });

  // The last one is kept: a brass waiting for its oil is safe.
  const kept = turn(at({ inventory: { pearl: 1 } }));
  expect(kept.inventory).toEqual({ pearl: 1 });
  expect(score(kept)).toBe(0);
  expect(kept.turnSales).toEqual([0]);
  expect(saleLog(kept)).toMatchObject({ text: "At the turn: nothing to sell.", kind: "info" });

  // Building stock never sells, whatever the amount.
  const stock = turn(at({ inventory: { driftwood: 9, kelp: 9, rope: 4, brick: 4, clay: 3 } }));
  expect(score(stock)).toBe(0);
  expect(stock.inventory).toEqual({ driftwood: 9, kelp: 9, rope: 4, brick: 4, clay: 3 });

  // On the final turn the last one goes too, and nothing is left over.
  const final = turn(at({ tide: 11, time: 11 * TIDE_MS, inventory: { pearl: 1 } }));
  expect(final.ended).toMatchObject({ reason: "tides", score: 20, trader: 20, boat: 0, ship: 0, leftover: {} });
  expect(lastLog(final)).toBe("The last tide comes in. The traders have had their pick; the sea keeps the rest.");
});

test("the ship buys one of every kind once the beacon stands, before the trader chooses", () => {
  const state = at({ built: ["beacon"], inventory: { pearl: 2, brass: 2, iron: 2, oil: 2, salt: 2 } });
  const plan = planTrade(state);
  expect(plan.ship).toEqual(["pearl", "brass", "iron", "oil", "salt"]);
  expect(plan.trader).toEqual([]);
  expect(plan.total).toBe(62);
  const sold = turn(state);
  expect(sold.sales).toEqual({ trader: 0, boat: 0, ship: 62 });
  expect(sold.inventory).toEqual({ pearl: 1, brass: 1, iron: 1, oil: 1, salt: 1 });
  expect(saleLog(sold)?.text).toContain("the ship buys pearl, brass, iron, oil, salt (62)");

  // Surplus goes to the trader after the ship has had its one of each.
  const more = planTrade(at({ built: ["beacon"], inventory: { pearl: 3, brass: 1 } }));
  expect(more.ship).toEqual(["pearl"]);
  expect(more.trader).toEqual(["pearl"]);
  expect(more.held).toEqual(["brass"]);
});

test("the boat carries the next most valuable pieces after the trader, ties by cargo order", () => {
  const sold = turn(at({ built: ["boat"], inventory: { pearl: 5, brass: 2 } }));
  expect(sold.sales).toEqual({ trader: 20, boat: 60, ship: 0 });
  expect(sold.inventory).toEqual({ pearl: 1, brass: 2 });
  expect(saleLog(sold)?.text).toBe("At the turn: the trader takes 1 pearl (20); the boat carries 3 pearls (60).");

  const mixed = planTrade(at({ built: ["boat"], inventory: { pearl: 2, brass: 3, iron: 3, oil: 3 } }));
  expect(mixed.trader).toEqual(["pearl"]);
  expect(mixed.boat).toEqual(["brass", "brass", "iron"]);
  expect(mixed.value).toEqual({ ship: 0, trader: 20, boat: 12 + 12 + 10 });
  expect(planTrade(at({ built: ["boat", "beacon"], inventory: {} }))).toMatchObject({ total: 0, ship: [], trader: [], boat: [] });
});

test("the run always lasts twelve tides: building the beacon or the boat does not end it, and the score is exactly what was sold", () => {
  let state = runWhere((tides) => tides[0] >= 2);
  state = give(withBuilt(state, ["bellTower", "lantern"]), { hull: 1, sail: 1 });
  state = build(state, "beacon");
  state = build(state, "boat");
  expect(state.built).toEqual(["beacon", "boat"]);
  expect(state.ended).toBeNull();

  state = give({ ...state, food: 100 }, { pearl: 9, brass: 6, iron: 4, oil: 4, salt: 3 });
  state = advance(state, 12 * TIDE_MS + 5);
  expect(state.turnSales).toHaveLength(12);
  expect(state.time).toBe(12 * TIDE_MS);
  expect(state.ended?.reason).toBe("tides");
  const { trader, boat, ship } = state.sales;
  expect(state.ended?.score).toBe(trader + boat + ship);
  expect(state.ended?.score).toBe(state.turnSales.reduce((sum, value) => sum + value, 0));
  expect(state.ended).toMatchObject({ trader, boat, ship });
  expect(trader).toBeGreaterThan(0);
  expect(boat).toBeGreaterThan(0);
  expect(ship).toBeGreaterThan(0);
  expect(advance(state, 10_000)).toBe(state);
  expect(send(state, 0, 0, "driftwood")).toBe(state);

  // Building stock left on the tarp scores nothing and is not reported as cargo.
  const none = turn(at({ tide: 11, time: 11 * TIDE_MS, inventory: { driftwood: 3 } }));
  expect(none.ended).toMatchObject({ score: 0, leftover: {} });
});

test("food is a build: the trap holds two, the net two more, and the net needs the trap", () => {
  const trap = turn(at({ built: ["fishTrap"], food: 6 }));
  expect(trap.food).toBe(6 + 2 - 2);
  expect(trap.log.some((entry) => entry.text === "The fish trap holds 2 food.")).toBe(true);
  expect(producers(at({ built: ["fishTrap"] }))[0].next).toBe("+2 food at the turn");

  const netted = turn(at({ built: ["fishTrap", "net"], food: 6 }));
  expect(netted.food).toBe(6 + 4 - 2);
  expect(netted.log.some((entry) => entry.text === "The fish trap holds 4 food.")).toBe(true);
  expect(producers(at({ built: ["fishTrap", "net"] }))[0].next).toBe("+4 food at the turn");

  const open = { ...at({}), unlocked: 2 as const, inventory: { rope: 1, reed: 1 } };
  expect(canBuild(open, "net")).toMatchObject({ ok: false, why: "Needs a fish trap standing." });
  expect(canBuild({ ...open, built: ["fishTrap"] }, "net").ok).toBe(true);
});

test("a saltworks adds a salt at every turn, and the saltworks needs a kiln; builtAt tells the story", () => {
  let state = runWhere((tides) => tides[0] >= 2 && tides[1] >= 2 && tides[2] >= 2);
  state = give({ ...state, unlocked: 2 }, { clay: 3, kelp: 2, stone: 1, driftwood: 3, rope: 2, reed: 3 });
  expect(canBuild(state, "saltworks").why).toBe("Needs a kiln standing.");
  state = build(state, "kiln");
  expect(state.builtAt).toEqual({ kiln: 0 });
  state = build(state, "saltworks");
  expect(state.built).toEqual(["kiln", "saltworks"]);
  expect(state.inventory.clay).toBeUndefined();
  expect(state.inventory.driftwood).toBe(3);
  state = { ...state, food: 20 };
  // Two turns: one salt each. The first is kept, the second lets the trader take one.
  state = advance(state, 2 * TIDE_MS);
  expect(state.tide).toBe(2);
  expect(state.inventory.salt).toBe(1);
  expect(state.sales.trader).toBe(10);
  expect(state.turnSales).toEqual([0, 10]);

  state = build(state, "hull");
  state = build(state, "sail");
  expect(state.inventory).toMatchObject({ hull: 1, sail: 1 });
  state = build(state, "boat");
  expect(state.built).toContain("boat");
  expect(state.builtAt.boat).toBe(2);
  expect(state.ended).toBeNull();
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

    // A run saved before the cargo rules (no ledger) loads, paused, with a zeroed ledger and a notice.
    const oldShape: Record<string, unknown> & { seed: number } = { ...runWhere(() => true) };
    delete oldShape.sales;
    delete oldShape.turnSales;
    store.set(RUN_KEY, JSON.stringify(oldShape));
    const upgraded = loadRun()!;
    expect(upgraded.paused).toBe(true);
    expect(upgraded.sales).toEqual({ trader: 0, boat: 0, ship: 0 });
    expect(upgraded.turnSales).toEqual([]);
    expect(upgraded.notice).toBe(RULES_NOTICE);
    expect(upgraded.seed).toBe(oldShape.seed);

    // A finished old-rules run is retired, not resumed; a finished new-rules run still loads.
    const oldEnding = { reason: "beacon", score: 900, salvage: 1, structures: 1, foodScore: 1, beacon: 500, tidesLeft: 3, tidesLeftBonus: 120, builtCount: 4 };
    store.set(RUN_KEY, JSON.stringify({ ...oldShape, ended: oldEnding }));
    expect(loadRun()).toBeNull();
    expect(upgradeRun({ ...oldShape, ended: oldEnding } as unknown as State)).toBeNull();
    const finished = turn(at({ tide: 11, time: 11 * TIDE_MS, inventory: { pearl: 1 } }));
    saveRun(finished);
    expect(loadRun()?.ended).toEqual(finished.ended);

    // Best scores from the old scale are not read.
    store.clear();
    store.set("low-tide:best:v2", JSON.stringify({ score: 3000, beacon: true, seed: 1 }));
    expect(loadBest()).toBeNull();
    recordBest({ score: 40, beacon: false, seed: 5 });
    expect(JSON.parse(store.get(BEST_KEY)!).score).toBe(40);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
