import { expect, test } from "@playwright/test";

import { arrival, initialState, planSpell, reduce, searchGain, type Action, type GameState } from "../src/entries/cost-of-a-word/model";

function play(...actions: Action[]): GameState {
  return actions.reduce(reduce, initialState());
}
const go = (place: Extract<Action, { type: "go" }>["place"]): Action => ({ type: "go", place });
const doing = (id: string): Action => ({ type: "do", id });
const talk = (topic: string): Action => ({ type: "talk", topic });
const cast = (verb: Extract<Action, { type: "cast" }>["verb"], noun: Extract<Action, { type: "cast" }>["noun"], share = false): Action => ({ type: "cast", verb, noun, share });
const rest = (times: number): Action[] => Array.from({ length: times }, () => doing("rest"));
const wait: Action = { type: "wait" };
const hold = (times: number): Action[] => Array.from({ length: times }, () => doing("hold"));
const roar = doing("roar");

test("waiting with a lit fire gets you seen by the scout; at dawn they come straight up the hill", () => {
  const objected = play(wait);
  expect(objected.minutes).toBe(0);
  expect(objected.log.at(-1)?.speaker).toBe("vael");
  const dawn = reduce(objected, wait);
  expect(dawn.alerted).toBe(true);
  expect(dawn.minutes).toBe(450);
  expect(dawn.ending).toBeNull();
  expect(dawn.dawn).toMatchObject({ found: true, reach: 1, nerve: 70, soldiers: 12 });
  const climbing = reduce(dawn, doing("hold"));
  expect(climbing.dawn?.reach).toBe(2);
  const taken = reduce(climbing, doing("hold"));
  expect(taken.ending).toBe("taken");
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

test("hiding the fire, the doorway and Vael lets them search and walk past", () => {
  const prepared = play(
    go("parapet"), doing("ward"), talk("fire"), go("hearth"), cast("hide", "flame"),
    go("door"), doing("lintel"), cast("hide", "stone"),
    go("cistern"), doing("cistern"), cast("move", "stone"), go("hearth"), ...rest(1),
    go("nest"), cast("hide", "flesh"), cast("hide", "flesh"), wait,
  );
  expect(prepared.alerted).toBe(false);
  expect(prepared.dawn).toMatchObject({ found: false, soldiers: 12, suspicion: 0 });
  expect(searchGain(prepared, 0)).toBe(0);
  const twoTurns = [...hold(2)].reduce(reduce, prepared);
  expect(twoTurns.ending).toBeNull();
  expect(reduce(twoTurns, doing("hold")).ending).toBe("unseen");
  // Spoken words carry in the quiet; a roar gives everything away.
  expect(reduce(prepared, cast("move", "stone")).dawn?.suspicion).toBe(15);
  expect(reduce(prepared, roar).dawn?.found).toBe(true);
});

test("a decoy sent too early gutters out and gives you away; sent late, most of them follow it", () => {
  const hidden = play(go("parapet"), doing("ward"), talk("fire"), go("hearth"), cast("hide", "flame"));
  const early = [cast("move", "flame"), cast("move", "flame")].reduce(reduce, hidden);
  expect(early.decoyAt).not.toBeNull();
  const burnt = reduce(early, wait);
  expect(burnt.alerted).toBe(true);
  expect(burnt.dawn?.found).toBe(true);

  const late = [...rest(6), cast("move", "flame")].reduce(reduce, hidden);
  expect(arrival(late) - late.decoyAt!).toBeLessThanOrEqual(120);
  const dawn = reduce(late, wait);
  expect(dawn.dawn).toMatchObject({ decoyed: true, soldiers: 3, found: false });
  expect(hold(3).reduce(reduce, dawn).ending).toBe("decoy");
});

test("a visible tower is found, and breaking their nerve holds it", () => {
  const dark = play(doing("satchel"), talk("fire"), cast("still", "flame"), go("door"), doing("lintel"), cast("move", "stone"), wait);
  expect(dark.alerted).toBe(false);
  expect(dark.dawn).toMatchObject({ found: false, nerve: 50 });
  const found = hold(2).reduce(reduce, dark);
  expect(found.dawn?.found).toBe(true);
  expect(found.ending).toBeNull();
  const shaken = [roar, roar].reduce(reduce, found);
  expect(shaken.dawn?.nerve).toBe(10);
  expect(shaken.vaelEnergy).toBe(20);
  expect(reduce(shaken, cast("move", "stone")).ending).toBe("stand");
});

test("warned soldiers need more: a sealed stair buys turns, roars wear thin, stone finishes it", () => {
  const sealed = play(go("door"), doing("lintel"), cast("move", "stone"), wait);
  expect(sealed.dawn).toMatchObject({ found: true, reach: 1 });
  const climbing = [roar, roar].reduce(reduce, sealed);
  expect(climbing.dawn).toMatchObject({ nerve: 30, reach: 2, climb: 1 });
  const broke = reduce(climbing, cast("move", "stone"));
  expect(broke.ending).toBe("stand");
  // Without the stone, the rubble only delays them.
  expect([roar, roar, doing("hold")].reduce(reduce, sealed).ending).toBe("taken");
});

test("at dawn the same words mean new, desperate things", () => {
  const atParapet = play(go("door"), doing("lintel"), go("parapet"), wait, wait);
  expect(atParapet.dawn?.found).toBe(true);
  expect(planSpell(atParapet, "move", "stone", false)).toMatchObject({ cost: 60, target: true });
  const nest = play(go("cistern"), go("door"), doing("lintel"), go("cistern"), doing("cistern"), cast("move", "stone"), go("nest"), doing("wing"), talk("mend"), wait, wait);
  expect(planSpell(nest, "mend", "flesh", false)).toMatchObject({ target: false });
  expect(planSpell(nest, "mend", "flesh", false).meaning).toMatch(/No time/);
});

test("holding the lead climber still costs them a turn; ice holds longer than rubble", () => {
  const iced = play(doing("satchel"), go("door"), doing("lintel"), go("cistern"), doing("cistern"), cast("move", "water"), go("door"), wait, wait);
  expect(iced.dawn?.found).toBe(true);
  const atStair = reduce(iced, doing("hold"));
  expect(atStair.dawn?.reach).toBe(2);
  const held = reduce(atStair, cast("still", "flesh"));
  expect(held.dawn).toMatchObject({ reach: 2, climb: 0 });
  const climbing = hold(2).reduce(reduce, held);
  expect(climbing.dawn).toMatchObject({ reach: 2, climb: 2 });
  expect(climbing.ending).toBeNull();
  expect(reduce(climbing, doing("hold")).ending).toBe("taken");
});

test("snuffing the soldiers' torches buys time", () => {
  const state = play(talk("fire"), doing("satchel"), go("parapet"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), doing("road"), cast("still", "flame"));
  expect(state.torchesSnuffed).toBe(true);
  expect(arrival(state)).toBe(555);
});
