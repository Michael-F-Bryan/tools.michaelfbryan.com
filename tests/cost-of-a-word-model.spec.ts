import { expect, test } from "@playwright/test";

import { arrival, initialState, planSpell, reduce, type Action, type GameState } from "../src/entries/cost-of-a-word/model";

function play(...actions: Action[]): GameState {
  return actions.reduce(reduce, initialState());
}
const go = (place: Extract<Action, { type: "go" }>["place"]): Action => ({ type: "go", place });
const doing = (id: string): Action => ({ type: "do", id });
const talk = (topic: string): Action => ({ type: "talk", topic });
const cast = (verb: Extract<Action, { type: "cast" }>["verb"], noun: Extract<Action, { type: "cast" }>["noun"], share = false): Action => ({ type: "cast", verb, noun, share });
const rest = (times: number): Action[] => Array.from({ length: times }, () => doing("rest"));

test("waiting with a lit fire gets you seen by the scout and taken at an earlier dawn", () => {
  const objected = play({ type: "wait" });
  expect(objected.minutes).toBe(0);
  expect(objected.log.at(-1)?.speaker).toBe("vael");
  const state = reduce(objected, { type: "wait" });
  expect(state.alerted).toBe(true);
  expect(state.ending).toBe("taken");
  expect(state.minutes).toBe(450);
});

test("words come from exploring the tower and from Vael", () => {
  const state = play(talk("fire"), doing("satchel"), go("door"), doing("lintel"), go("parapet"), doing("ward"), go("cistern"), doing("cistern"), cast("move", "stone"), go("nest"), doing("wing"), talk("mend"));
  expect([...state.words].sort()).toEqual(["flame", "flesh", "hide", "mend", "move", "still", "stone", "water"]);
});

test("the meaning and cost of a spell depend on where it is spoken", () => {
  const known = play(go("door"), doing("lintel"));
  expect(planSpell(known, "move", "stone", false)).toMatchObject({ cost: 40, target: true });
  const parapet = reduce(known, go("parapet"));
  expect(planSpell(parapet, "move", "stone", false)).toMatchObject({ cost: 120, target: true });
  expect(planSpell(parapet, "move", "stone", false).objection).toBeTruthy();
});

test("a spell beyond your strength kills you after Vael objects once", () => {
  const atParapet = play(go("door"), doing("lintel"), go("parapet"));
  const warned = reduce(atParapet, cast("move", "stone"));
  expect(warned.ending).toBeNull();
  expect(warned.energy).toBe(atParapet.energy);
  const dead = reduce(warned, cast("move", "stone"));
  expect(dead.ending).toBe("spent");
  expect(dead.energy).toBe(0);
});

test("healing the wing twice, sharing the cost, lets you fly", () => {
  let state = play(go("cistern"), go("door"), doing("lintel"), go("cistern"), doing("cistern"), cast("move", "stone"), go("nest"), doing("wing"), talk("mend"));
  state = reduce(state, cast("mend", "flesh", true));
  expect(state.wing).toBe(1);
  state = [go("hearth"), ...rest(2), go("nest"), cast("mend", "flesh", true)].reduce(reduce, state);
  expect(state.wing).toBe(2);
  state = reduce(state, doing("fly"));
  expect(state.ending).toBe("flight");
});

test("Vael refuses to give more strength than she has", () => {
  const state = play(go("door"), doing("lintel"), go("parapet"), cast("move", "stone", true), cast("move", "stone", true));
  expect(state.ending).toBeNull();
  expect(state.log.at(-1)?.text).toMatch(/don't have that much/);
});

test("hiding the fire, the doorway and Vael lets them walk past", () => {
  const state = play(
    go("parapet"), doing("ward"), talk("fire"), go("hearth"), cast("hide", "flame"),
    go("door"), doing("lintel"), cast("hide", "stone"),
    go("cistern"), doing("cistern"), cast("move", "stone"), go("hearth"), ...rest(1),
    go("nest"), cast("hide", "flesh"), cast("hide", "flesh"), { type: "wait" },
  );
  expect(state.alerted).toBe(false);
  expect(state.ending).toBe("unseen");
});

test("a decoy sent too early gutters out and gives you away; sent late, they follow it", () => {
  const hidden = play(go("parapet"), doing("ward"), talk("fire"), go("hearth"), cast("hide", "flame"));
  const early = [cast("move", "flame"), cast("move", "flame")].reduce(reduce, hidden);
  expect(early.decoyAt).not.toBeNull();
  const burnt = reduce(early, { type: "wait" });
  expect(burnt.alerted).toBe(true);
  expect(burnt.ending).not.toBe("decoy");

  const late = [...rest(6), cast("move", "flame")].reduce(reduce, hidden);
  expect(arrival(late) - late.decoyAt!).toBeLessThanOrEqual(120);
  expect(reduce(late, { type: "wait" }).ending).toBe("decoy");
});

test("a sealed stair and a dragon who is awake hold the tower", () => {
  const state = play(talk("fire"), cast("move", "flame"), cast("move", "flame"), go("door"), doing("lintel"), cast("move", "stone"), { type: "wait" });
  expect(state.ending).toBe("stand");
});

test("snuffing the soldiers' torches buys time", () => {
  const state = play(talk("fire"), doing("satchel"), go("parapet"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), cast("still", "flame"));
  expect(state.torchesSnuffed).toBe(true);
  expect(arrival(state)).toBe(555);
});
