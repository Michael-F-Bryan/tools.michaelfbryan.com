/**
 * The night as a pure state machine. Every action costs minutes; every spell
 * costs energy. The scene and the controls only ever read this state.
 */

export type Verb = "move" | "hide" | "mend" | "still";
export type Noun = "stone" | "flame" | "water" | "flesh";
export type WordId = Verb | Noun;
export type PlaceId = "hearth" | "door" | "cistern" | "nest" | "parapet";
export type EndingId = "flight" | "decoy" | "unseen" | "stand" | "taken" | "spent";
export type Speaker = "narrator" | "vael" | "spell";

export const VERBS: readonly Verb[] = ["move", "hide", "mend", "still"];
export const NOUNS: readonly Noun[] = ["stone", "flame", "water", "flesh"];

export const WORDS: Record<WordId, { word: string; gloss: string }> = {
  move: { word: "ithra", gloss: "move" },
  hide: { word: "skaul", gloss: "hide" },
  mend: { word: "orun", gloss: "mend" },
  still: { word: "hesh", gloss: "still" },
  stone: { word: "kor", gloss: "stone" },
  flame: { word: "brae", gloss: "flame" },
  water: { word: "mira", gloss: "water" },
  flesh: { word: "anwe", gloss: "flesh" },
};

export const PLACES: Record<PlaceId, { name: string; travel: number }> = {
  hearth: { name: "The hearth", travel: 10 },
  nest: { name: "Vael's corner", travel: 10 },
  cistern: { name: "The cistern", travel: 10 },
  door: { name: "The doorway", travel: 10 },
  parapet: { name: "The parapet", travel: 15 },
};
export const PLACE_ORDER: readonly PlaceId[] = ["hearth", "nest", "cistern", "door", "parapet"];

/** The night runs from 21:00; minutes are counted from then. */
export const START_CLOCK = 21 * 60;
export const DAWN = 510;
export const TORCHES_SEEN = 90;
export const SCOUT = 270;
const DECOY_LIFE = 120;
const MAX_ENERGY = 100;

export type LogEntry = Readonly<{ id: number; speaker: Speaker; text: string }>;

export type GameState = Readonly<{
  minutes: number;
  place: PlaceId;
  energy: number;
  vaelEnergy: number;
  words: readonly WordId[];
  fire: "lit" | "hidden" | "out" | "gone";
  wing: 0 | 1 | 2;
  stair: "open" | "blocked" | "iced";
  doorHidden: boolean;
  vaelHidden: boolean;
  wallMended: boolean;
  vaelAsleepUntil: number | null;
  lidMoved: boolean;
  waterPure: boolean;
  torchesSnuffed: boolean;
  alerted: boolean;
  decoyAt: number | null;
  decoyBurnt: boolean;
  scoutPassed: boolean;
  torchesSeen: boolean;
  done: readonly string[];
  topics: readonly string[];
  objected: readonly string[];
  log: readonly LogEntry[];
  ending: EndingId | null;
}>;

type Draft = { -readonly [K in keyof GameState]: GameState[K] } & { words: WordId[]; done: string[]; topics: string[]; objected: string[]; log: LogEntry[] };

export function initialState(): GameState {
  return {
    minutes: 0,
    place: "hearth",
    energy: 70,
    vaelEnergy: 50,
    words: ["move"],
    fire: "lit",
    wing: 0,
    stair: "open",
    doorHidden: false,
    vaelHidden: false,
    wallMended: false,
    vaelAsleepUntil: null,
    lidMoved: false,
    waterPure: false,
    torchesSnuffed: false,
    alerted: false,
    decoyAt: null,
    decoyBurnt: false,
    scoutPassed: false,
    torchesSeen: false,
    done: [],
    topics: [],
    objected: [],
    log: [
      { id: 0, speaker: "narrator", text: "The watchtower has no roof over its hall and no door in its doorway. You lit the fire because your hands stopped working. Vael lies curled against the cold wall, one wing folded wrong." },
      { id: 1, speaker: "vael", text: "Imperial soldiers. At dawn, probably. I can smell their horses on the wind, and their bad cooking. You know one word of the old tongue, Rider. Ithra. Move. It is a beginning." },
    ],
    ending: null,
  };
}

export function clock(minutes: number): string {
  const total = (START_CLOCK + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function arrival(state: Pick<GameState, "alerted" | "torchesSnuffed">): number {
  return DAWN - (state.alerted ? 60 : 0) + (state.torchesSnuffed ? 45 : 0);
}

export function vaelAwake(state: GameState): boolean {
  return state.vaelAsleepUntil === null;
}

export function decoyActive(state: GameState): boolean {
  return state.decoyAt !== null && !state.decoyBurnt;
}

// ---------------------------------------------------------------------------
// Spells

export type SpellPlan = Readonly<{
  key: string;
  /** What the words would take hold of here, or why nothing answers. */
  meaning: string;
  cost: number;
  minutes: number;
  target: boolean;
  objection?: string;
}>;

type Spell = {
  meaning: string;
  cost: number;
  minutes: number;
  objection?: string | ((state: GameState) => string | undefined);
  apply: (draft: Draft) => void;
};

function spellFor(state: GameState, verb: Verb, noun: Noun): Spell | { none: string } {
  const at = state.place;
  const fireHere = state.fire === "lit" || state.fire === "hidden";

  if (at === "hearth") {
    if (noun === "flame") {
      if (!fireHere && verb !== "mend") return { none: state.fire === "gone" ? "The fire is out in the valley now, not here." : "There is no flame here to take hold of." };
      if (verb === "still") return {
        meaning: "Lay the fire down until it goes out.", cost: 2, minutes: 5,
        apply: d => { d.fire = "out"; say(d, "spell", "Hesh brae. The flames lie flat as grass in a wind and are gone. The cold arrives at once."); say(d, "vael", "Dark is safer. I hate it."); },
      };
      if (verb === "hide") {
        if (state.fire === "hidden") return { none: "The fire is already hidden." };
        return {
          meaning: "Keep the fire's warmth but fold its light away.", cost: 15, minutes: 10,
          apply: d => { d.fire = "hidden"; say(d, "spell", "Skaul brae. The light folds into the fire like a hand closing. The warmth stays. From outside, the tower is only a darker shape against the dark."); say(d, "vael", "Clever. I can still feel it on my scales. They can't see it from the road."); },
        };
      }
      if (verb === "move") return {
        meaning: "Send the fire out over the valley, to wander where the soldiers will follow it.", cost: 28, minutes: 10,
        objection: s => arrival(s) - s.minutes > DECOY_LIFE ? "Not yet. A fire with nothing to eat will not last until dawn. If it gutters out in the valley they will know a magician sent it." : undefined,
        apply: d => { d.fire = "gone"; d.decoyAt = d.minutes; say(d, "spell", "Ithra brae. The fire lifts out of its ring, a loose bright knot, and drifts through the breach and down toward the valley. It moves like a traveller's lantern."); say(d, "vael", "A lantern walking south. If I were a tired soldier, I would follow it."); },
      };
      if (verb === "mend") {
        if (fireHere) return { none: "The fire is whole already." };
        if (state.fire === "gone") return { none: "The fire is out in the valley now, not here." };
        return {
          meaning: "Coax the dead coals back into flame.", cost: 10, minutes: 5,
          apply: d => { d.fire = "lit"; say(d, "spell", "Orun brae. The coals remember. Flame stands up out of the ash and the light comes back, bright on the walls and out through the breach."); },
        };
      }
    }
    if (noun === "flesh") {
      if (verb === "still") return {
        meaning: "Still your own body into a deep, quick sleep.", cost: 3, minutes: 150,
        apply: d => { d.energy = clamp(d.energy + 45); say(d, "spell", "Hesh anwe. You fall into sleep like a stone into a well."); say(d, "vael", "Two and a half hours. I kept watch. Someone in this tower has to."); },
      };
      if (verb === "mend") return {
        meaning: "Mend your own scrapes and blisters.", cost: 8, minutes: 5,
        apply: d => { say(d, "spell", "Orun anwe. The skin on your palms closes. You are exactly as tired as before, and slightly hungrier."); say(d, "vael", "Congratulations. You spent a meal to fix a scratch."); },
      };
    }
    if (verb === "move" && noun === "stone") return {
      meaning: "Shift the hearthstones into a tidier ring.", cost: 4, minutes: 5,
      apply: d => { say(d, "spell", "Ithra kor. The hearthstones shuffle into a neat ring. The light still climbs the walls."); say(d, "vael", "Lovely. The soldiers will admire the masonry."); },
    };
  }

  if (at === "cistern") {
    if (noun === "stone" && verb === "move") {
      if (state.lidMoved) return { none: "The lid is already off." };
      return {
        meaning: "Slide the heavy lid off the cistern's dry side chamber.", cost: 12, minutes: 10,
        apply: d => { d.lidMoved = true; say(d, "spell", "Ithra kor. The slab grinds aside. Beneath it, in a dry chamber, lies a long-dead Rider, curled small. Words are scratched in the stone beside them, over and over: anwe, anwe. Flesh."); learn(d, "flesh"); say(d, "vael", "Someone sat with them while they died, and wrote the word they needed. I wish they had known it sooner."); },
      };
    }
    if (noun === "water") {
      if (verb === "mend") {
        if (state.waterPure) return { none: "The water is already clean." };
        return {
          meaning: "Draw the rot out of the cistern water.", cost: 4, minutes: 5,
          apply: d => { d.waterPure = true; say(d, "spell", "Orun mira. A grey scum climbs out of the water and lies on the stone. What is left is clear and cold."); },
        };
      }
      if (verb === "still") return {
        meaning: "Still the water into a mirror and look through it at the soldiers.", cost: 12, minutes: 15,
        apply: d => {
          say(d, "spell", "Hesh mira. The water goes flat as glass. In it, far off, a camp: twelve soldiers, a sergeant, no magician. They mean to ride at first light and reach the tower soon after.");
          say(d, "vael", "No magician. Good. They only know what they can see. A light that walks away, a doorway that isn't there. Those would fool them.");
          d.done.push("scried");
        },
      };
      if (verb === "move") {
        if (state.stair !== "open") return { none: "The stair is already sealed." };
        return {
          meaning: "Lift the cistern out and pour it down the outside stair, to freeze by dawn.", cost: 30, minutes: 15,
          apply: d => { d.stair = "iced"; say(d, "spell", "Ithra mira. The water rises out of the cistern in a slow rope and pours itself down the outside stair. The frost takes it within minutes. By dawn the steps are glass."); say(d, "vael", "Nobody climbs that in boots. I wouldn't climb it with claws."); },
        };
      }
    }
  }

  if (at === "nest") {
    if (noun === "flesh") {
      if (verb === "mend") {
        if (state.wing === 2) return { none: "Vael's wing is whole." };
        return {
          meaning: state.wing === 0 ? "Knit the torn wing membrane and the cracked bone beneath it." : "Finish knitting the wing bone.", cost: 45, minutes: 40,
          apply: d => {
            d.wing = (d.wing + 1) as 0 | 1 | 2;
            if (d.wing === 1) { say(d, "spell", "Orun anwe. The membrane draws itself closed, thread by thread. It takes forty minutes and feels like carrying stones up a hill."); say(d, "vael", "It doesn't hurt. Why doesn't it hurt? The bone is still wrong. Once more, when you have the strength."); }
            else { say(d, "spell", "Orun anwe. The bone finds its old line with a sound you feel in your teeth."); say(d, "vael", "Oh. Oh. I can feel the air again. Rider, I can fly."); }
          },
        };
      }
      if (verb === "still") {
        if (!vaelAwake(state)) return { none: "Vael is already asleep." };
        return {
          meaning: "Ease Vael into sleep, so the pain stops and her breathing quiets.", cost: 8, minutes: 5,
          objection: "Don't you dare put me to sleep like a hatchling. I am the only one in this tower who can smell them coming.",
          apply: d => { d.vaelAsleepUntil = d.minutes + 120; say(d, "spell", "Hesh anwe. Vael's eyes close mid-complaint. Her breathing slows. For the first time tonight she is not in pain."); },
        };
      }
      if (verb === "hide") {
        if (state.vaelHidden) return { none: "Vael is already hidden." };
        return {
          meaning: "Lay a glamour over Vael so she looks like fallen rubble.", cost: 30, minutes: 15,
          objection: "Hide me? Like a shameful thing under a blanket? I am a dragon. Say it again if you mean it, and I want it known that I objected.",
          apply: d => { d.vaelHidden = true; say(d, "spell", "Skaul anwe. Where Vael lay there is now a slope of tumbled stone. The stone breathes, slowly, if you watch it."); say(d, "vael", "I feel ridiculous."); },
        };
      }
      if (verb === "move") return {
        meaning: "Lift Vael bodily. She weighs as much as a cart of stone.", cost: 150, minutes: 5,
        objection: "You want to lift me? With your mind? I weigh as much as a cart of stone, Rider. That spell would empty you and keep going.",
        apply: d => { say(d, "spell", "Ithra anwe. Vael lifts a hand's breadth off the floor."); },
      };
    }
    if (noun === "stone" && verb === "mend") {
      if (state.wallMended) return { none: "The wall is already whole." };
      return {
        meaning: "Raise the fallen stones back into the breach, walling Vael in from the road.", cost: 50, minutes: 30,
        apply: d => { d.wallMended = true; say(d, "spell", "Orun kor. The fallen blocks climb back into the breach one by one, each remembering its place. The wind stops."); say(d, "vael", "You walled me in. I'll knock it down again when I need to. It's warmer, I admit."); },
      };
    }
  }

  if (at === "door" && noun === "stone") {
    if (verb === "move") {
      if (state.stair !== "open") return { none: "The stair is already sealed." };
      return {
        meaning: "Pull the loose rubble down across the outside stair.", cost: 40, minutes: 25,
        apply: d => { d.stair = "blocked"; say(d, "spell", "Ithra kor. Rubble slides down the outside stair and wedges itself, block on block, until there is no stair, only a wall of broken stone."); say(d, "vael", "Now no one comes up. Including us, if you were planning to leave on foot."); },
      };
    }
    if (verb === "hide") {
      if (state.doorHidden) return { none: "The doorway is already hidden." };
      return {
        meaning: "Make the doorway look like solid, collapsed wall.", cost: 25, minutes: 15,
        apply: d => { d.doorHidden = true; say(d, "spell", "Skaul kor. The doorway goes blind. From inside you can still see the stars through it, but from below there is only wall."); },
      };
    }
    if (verb === "still") return {
      meaning: "Hold the stone still.", cost: 0, minutes: 5,
      apply: d => { say(d, "spell", "Hesh kor. The stone, which was not moving, continues not to move."); say(d, "vael", "Masterful."); },
    };
  }

  if (at === "parapet") {
    if (verb === "still" && noun === "flame") {
      if (!state.torchesSeen) return { none: "There are no torches yet, only dark." };
      if (state.torchesSnuffed) return { none: "Their torches are already out." };
      return {
        meaning: "Reach out across the valley and snuff the soldiers' torches.", cost: 35, minutes: 10,
        apply: d => { d.torchesSnuffed = true; say(d, "spell", "Hesh brae. It is like pinching out candles at the far end of a long hall. One by one the torches on the road die. The column halts, and does not move again until there is light to see by."); say(d, "vael", "They'll wait for daylight now. You bought us most of an hour."); },
      };
    }
    if (verb === "move" && noun === "stone") return {
      meaning: "Tear a battlement loose and hurl it down onto the road.", cost: 120, minutes: 5,
      objection: "The road is empty, Rider. They are hours away. You would spend your life throwing a wall at nothing.",
      apply: d => { d.alerted = true; say(d, "spell", "Ithra kor. A merlon tears free and falls end over end into the dark. The crash echoes up and down the valley. Everyone for miles now knows where you are."); },
    };
    if (verb === "still" && noun === "flesh") return {
      meaning: "Put the whole column of soldiers to sleep from here.", cost: 200, minutes: 5,
      objection: "Twelve men, a mile away? That is twelve men's worth of sleep and a mile of reaching. It would kill you three times over.",
      apply: () => undefined,
    };
    if (verb === "hide" && noun === "stone") return {
      meaning: "Hide the entire tower.", cost: 140, minutes: 5,
      objection: "The whole tower? Every stone of it? You would be the quietest corpse on the hill.",
      apply: () => undefined,
    };
  }

  return { none: "The words slide off. Nothing here answers to them." };
}

export function planSpell(state: GameState, verb: Verb, noun: Noun, share: boolean): SpellPlan {
  const key = `${state.place}:${verb}:${noun}`;
  const spell = spellFor(state, verb, noun);
  if ("none" in spell) return { key, meaning: spell.none, cost: 1, minutes: 5, target: false };
  const objection = typeof spell.objection === "function" ? spell.objection(state) : spell.objection;
  const { rider } = split(spell.cost, share && vaelAwake(state));
  const lethal = rider >= state.energy;
  return {
    key,
    meaning: spell.meaning,
    cost: spell.cost,
    minutes: spell.minutes,
    target: true,
    objection: objection ?? (lethal ? "Stop. That would take more than you have. A spell doesn't stop when you run out, Rider. It just keeps taking." : undefined),
  };
}

export function split(cost: number, share: boolean): { rider: number; vael: number } {
  return share ? { rider: Math.ceil(cost / 2), vael: Math.floor(cost / 2) } : { rider: cost, vael: 0 };
}

// ---------------------------------------------------------------------------
// Exploration and conversation

export type Choice = Readonly<{ id: string; label: string; minutes: number }>;

export function placeActions(state: GameState): Choice[] {
  const has = (id: string) => state.done.includes(id);
  const out: Choice[] = [];
  switch (state.place) {
    case "hearth":
      if (!has("satchel")) out.push({ id: "satchel", label: "Search your satchel", minutes: 10 });
      if (has("satchel") && !has("bread")) out.push({ id: "bread", label: "Eat the last of the bread", minutes: 10 });
      out.push({ id: "rest", label: "Rest by the fire", minutes: 60 });
      break;
    case "nest":
      if (!has("wing")) out.push({ id: "wing", label: "Look at the wing", minutes: 10 });
      if (state.wing === 2 && vaelAwake(state)) out.push({ id: "fly", label: "Climb on and fly", minutes: 0 });
      break;
    case "cistern":
      if (!has("cistern")) out.push({ id: "cistern", label: "Look into the cistern", minutes: 10 });
      if (state.waterPure && !has("drink")) out.push({ id: "drink", label: "Drink", minutes: 5 });
      if (state.waterPure && !has("water-vael")) out.push({ id: "water-vael", label: "Carry water to Vael", minutes: 10 });
      break;
    case "door":
      if (!has("lintel")) out.push({ id: "lintel", label: "Read the carved lintel", minutes: 10 });
      out.push({ id: "stair", label: "Look down the stair", minutes: 5 });
      break;
    case "parapet":
      out.push({ id: "road", label: "Watch the road", minutes: 10 });
      if (!has("ward")) out.push({ id: "ward", label: "Read the ward-stone", minutes: 10 });
      break;
  }
  return out;
}

export function topics(state: GameState): Choice[] {
  const heard = (id: string) => state.topics.includes(id);
  const out: Choice[] = [];
  if (!heard("fire")) out.push({ id: "fire", label: "Can they see our fire?", minutes: 5 });
  if (!heard("hurt") && !state.done.includes("wing")) out.push({ id: "hurt", label: "How bad is it?", minutes: 5 });
  if (!heard("mend") && state.done.includes("wing")) out.push({ id: "mend", label: "Is there a word for healing?", minutes: 5 });
  if (!heard("afraid") && state.minutes >= 120) out.push({ id: "afraid", label: "Are you afraid?", minutes: 5 });
  if (!heard("chose") && state.minutes >= 180) out.push({ id: "chose", label: "Why did you hatch for me?", minutes: 5 });
  out.push({ id: "plan", label: "What should we do?", minutes: 5 });
  return out;
}

function talk(d: Draft, topic: string) {
  const v = (text: string) => say(d, "vael", text);
  if (!d.topics.includes(topic) && topic !== "plan") d.topics.push(topic);
  switch (topic) {
    case "fire":
      if (d.fire === "lit") v("From the road? Like a lighthouse. My mother's mothers had a word for fire: brae. Say it carefully. Fire listens.");
      else v("Not now. But you should still know its name. Brae. Fire listens to that word.");
      learn(d, "flame");
      return;
    case "hurt":
      v("It's fine. It's a scratch. It's a wing-shaped scratch. Look at it yourself, if you have to fuss.");
      return;
    case "mend":
      v("When I was a day old and fell off a rock, I heard a word in my head. Not yours. Older. Orun. I think it means to make a thing remember its proper shape. Bones are stubborn, Rider. It will cost you.");
      learn(d, "mend");
      return;
    case "afraid":
      v("Dragons are not afraid. I am... alert. Very, very alert. I keep thinking about how small you are and how much of you is soft.");
      return;
    case "chose":
      v("You were the only one in the room who didn't try to pick me up. Also you smelled of apples. I have since learned this was a fluke.");
      return;
    case "plan":
      v(advice(d));
      return;
  }
}

function advice(s: GameState): string {
  const knows = (w: WordId) => s.words.includes(w);
  if (s.fire === "lit" && s.minutes < SCOUT) return knows("flame") ? "The fire first. A light like that brings scouts. Hide it, or put it out." : "That fire is a beacon. Ask me about it.";
  if (!knows("stone")) return "There are words cut into this tower. Builders always wrote on lintels. Go and read the doorway.";
  if (s.wing < 2 && knows("mend") && knows("flesh")) return s.energy >= 50 || vaelAwake(s) ? "You could mend my wing. It will take nearly everything you have, twice. Share it with me if you must. Then we leave by the sky." : "Rest first. You can't heal a wing on an empty stomach.";
  if (s.wing < 2 && !knows("flesh")) return "If you want to mend me, you'll need the word for flesh. The dead often keep words. Look at that cistern.";
  if (s.stair === "open") return "Seal the stair, and they must climb a wall with a dragon at the top of it. Or hide the doorway and me, and they may walk straight past.";
  if (!decoyActive(s) && knows("flame")) return "You could send a light down the valley just before dawn. Not too early. Fire does not last on nothing.";
  return "We wait. I hate waiting. Talk to me, or rest. Dawn will come whether we want it or not.";
}

const WORD_SOURCES: Partial<Record<string, { word: WordId; text: string }>> = {
  satchel: { word: "still", text: "Under the spare socks: a page from your teacher's notebook, the ink run. One word survives, underlined twice. Hesh. Still. \"For when you are panicking,\" he wrote. \"Which will be often.\"" },
  lintel: { word: "stone", text: "The lintel is carved with the tower's founding words. Most are worn smooth. One is cut deep enough to read by feel: kor. Stone. The builders said it to the first block they laid." },
  cistern: { word: "water", text: "The cistern is half full of black, sour water. Around its rim runs a single word, repeated: mira. Water. A slab lid covers a dry side chamber, far too heavy to lift by hand." },
  ward: { word: "hide", text: "An old ward-stone stands by the beacon cradle. Its word still glows faintly under your thumb: skaul. Hide. Watchmen used it to cover their beacons from enemy eyes." },
};

function examine(d: Draft, id: string) {
  const source = WORD_SOURCES[id];
  if (source) {
    d.done.push(id);
    say(d, "narrator", source.text);
    learn(d, source.word);
    if (id === "satchel") say(d, "narrator", "There is also half a loaf of bread, more crust than loaf.");
    return;
  }
  switch (id) {
    case "bread":
      d.done.push(id);
      d.energy = clamp(d.energy + 15);
      say(d, "narrator", "You eat the bread. It tastes like the last two days.");
      say(d, "vael", "You could have offered.");
      return;
    case "rest": {
      const warm = d.fire === "lit" || d.fire === "hidden";
      d.energy = clamp(d.energy + (warm ? 30 : 15));
      d.vaelEnergy = clamp(d.vaelEnergy + 10);
      say(d, "narrator", warm ? "You sleep an hour by the fire, sitting up, your back against Vael's warm side." : "You sleep an hour in the cold. It helps less than it should.");
      return;
    }
    case "wing":
      d.done.push(id);
      say(d, "narrator", "The arrow is out, but the long bone behind the wrist is cracked and the membrane is torn to the edge. She holds the wing very still so you won't see it shake.");
      say(d, "vael", "Stop looking at it like that. It will heal. In a month. We do not have a month.");
      return;
    case "drink":
      d.done.push(id);
      d.energy = clamp(d.energy + 10);
      say(d, "narrator", "The water is so cold it hurts your teeth. You feel more awake for it.");
      return;
    case "water-vael":
      d.done.push(id);
      d.vaelEnergy = clamp(d.vaelEnergy + 20);
      say(d, "narrator", "You carry water to Vael in your cupped helmet, three trips.");
      say(d, "vael", "That was kind. I will pretend I didn't need it.");
      return;
    case "stair":
      say(d, "narrator", d.stair === "blocked" ? "The outside stair is buried under rubble." : d.stair === "iced" ? "The outside stair is a sheet of grey ice." : "The outside stair runs down the tower's flank, crumbling but climbable. A soldier could come up it in a minute.");
      return;
    case "road": {
      if (!d.torchesSeen) say(d, "narrator", "The road is a pale thread in the valley. Nothing moves on it yet.");
      else if (d.torchesSnuffed) say(d, "narrator", "The road is dark. Somewhere down there, twelve men are sitting in the cold, swearing at their torches.");
      else {
        const left = arrival(d) - d.minutes;
        say(d, "narrator", left > 240 ? "Torches, small as sparks, at the far end of the valley. They are camped, not marching." : left > 120 ? "The torches have broken camp. They are moving, slowly, along the river." : "The torches are close enough to count. Twelve. They are at the foot of the hill.");
      }
      return;
    }
    case "fly":
      d.ending = "flight";
      return;
  }
}

// ---------------------------------------------------------------------------
// Time and events

function advance(d: Draft, minutes: number) {
  const target = d.minutes + minutes;
  for (;;) {
    // Dawn is listed first so that it wins ties: a light that would gutter at the moment they arrive is still burning.
    const events: [number, () => void][] = [[arrival(d), () => { d.ending = dawnEnding(d); }]];
    if (!d.torchesSeen) events.push([TORCHES_SEEN, () => {
      d.torchesSeen = true;
      say(d, "vael", "Torches on the north road. Far off, but there. Don't look at them for long. They don't get further away.");
    }]);
    if (!d.scoutPassed) events.push([SCOUT, () => {
      d.scoutPassed = true;
      if (d.fire === "lit") {
        d.alerted = true;
        say(d, "narrator", "A scout on horseback reins in below the hill, looking straight up at your fire. Then he wheels and gallops north.");
        say(d, "vael", "He saw us. They will come sooner now, and they will come ready. I am sorry. I should have made you put it out.");
      } else {
        say(d, "narrator", "A scout rides along the road below. He does not look up at the dark tower.");
        say(d, "vael", "Breathe. He's gone. You can breathe now.");
      }
    }]);
    if (d.vaelAsleepUntil !== null) events.push([d.vaelAsleepUntil, () => {
      d.vaelAsleepUntil = null;
      d.vaelEnergy = clamp(d.vaelEnergy + 25);
      say(d, "vael", "You put me to sleep. I am furious. I also feel much better. Don't do it again.");
    }]);
    if (d.decoyAt !== null && !d.decoyBurnt) events.push([d.decoyAt + DECOY_LIFE, () => {
      d.decoyBurnt = true;
      if (d.minutes < arrival(d)) {
        d.alerted = true;
        say(d, "narrator", "Far down the valley your wandering light shrinks, gutters, and goes out, in the middle of an empty field.");
        say(d, "vael", "They saw it die. Fires don't die in empty fields unless someone sent them. They know a magician is here.");
      }
    }]);
    const [time, fire] = events.sort((a, b) => a[0] - b[0])[0];
    if (time > target) break;
    d.minutes = Math.max(d.minutes, time);
    fire();
    if (d.ending) return;
  }
  d.minutes = target;
}

function dawnEnding(s: GameState): EndingId {
  const awake = vaelAwake(s);
  if (decoyActive(s) && !s.alerted) return "decoy";
  if (!s.alerted && s.fire !== "lit" && s.doorHidden && (s.vaelHidden || s.wallMended)) return "unseen";
  const sealed = s.stair !== "open";
  if (sealed && awake && s.vaelEnergy >= (s.alerted ? 40 : 15)) return "stand";
  return "taken";
}

// ---------------------------------------------------------------------------
// The reducer

export type Action =
  | { type: "go"; place: PlaceId }
  | { type: "do"; id: string }
  | { type: "talk"; topic: string }
  | { type: "cast"; verb: Verb; noun: Noun; share: boolean }
  | { type: "wait" }
  | { type: "restart" };

export function reduce(state: GameState, action: Action): GameState {
  if (action.type === "restart") return initialState();
  if (state.ending) return state;
  const d: Draft = { ...state, words: [...state.words], done: [...state.done], topics: [...state.topics], objected: [...state.objected], log: [...state.log] };

  switch (action.type) {
    case "go": {
      if (action.place === d.place) return state;
      d.place = action.place;
      say(d, "narrator", ARRIVALS[action.place](d));
      advance(d, PLACES[action.place].travel);
      break;
    }
    case "do": {
      const choice = placeActions(state).find(c => c.id === action.id);
      if (!choice) return state;
      examine(d, action.id);
      if (!d.ending) advance(d, choice.minutes);
      break;
    }
    case "talk": {
      const choice = topics(state).find(c => c.id === action.topic);
      if (!choice) return state;
      if (!vaelAwake(state)) {
        say(d, "narrator", "Vael is asleep. Her mind is a warm, wordless hum.");
        return d;
      }
      talk(d, action.topic);
      advance(d, choice.minutes);
      break;
    }
    case "cast": {
      if (!state.words.includes(action.verb) || !state.words.includes(action.noun)) return state;
      const share = action.share && vaelAwake(state);
      const plan = planSpell(state, action.verb, action.noun, share);
      if (plan.objection && !state.objected.includes(plan.key)) {
        d.objected.push(plan.key);
        say(d, "vael", plan.objection);
        return d;
      }
      const spell = spellFor(state, action.verb, action.noun);
      const { rider, vael } = split(plan.cost, share);
      if (vael > 0 && vael > d.vaelEnergy - 5) {
        say(d, "vael", "No. I don't have that much left to give you. Not without dying, and I'd rather not.");
        return d;
      }
      d.vaelEnergy -= vael;
      if (rider >= d.energy) {
        d.energy = 0;
        say(d, "spell", `${WORDS[action.verb].word} ${WORDS[action.noun].word}. The spell takes what you have, and then it takes the rest.`);
        d.ending = "spent";
        return d;
      }
      d.energy -= rider;
      if ("none" in spell) say(d, "spell", `${capital(WORDS[action.verb].word)} ${WORDS[action.noun].word}. ${spell.none}`);
      else spell.apply(d);
      if (!d.ending) advance(d, plan.minutes);
      break;
    }
    case "wait": {
      if (!state.objected.includes("wait") && state.stair === "open" && !decoyActive(state) && !state.doorHidden && state.wing < 2) {
        d.objected.push("wait");
        say(d, "vael", "You want to sit here and wait for them? With the stair open and nothing hidden? I'll fight, Rider, but I'd like a better plan than that.");
        return d;
      }
      say(d, "narrator", "You sit with your back against Vael and watch the sky go grey.");
      advance(d, Math.max(0, arrival(d) - d.minutes));
      break;
    }
  }
  return d;
}

const ARRIVALS: Record<PlaceId, (s: GameState) => string> = {
  hearth: s => s.fire === "lit" ? "You crouch by the fire. Its light reaches up the walls and out through the breach." : s.fire === "hidden" ? "You crouch by the hidden fire. Warmth without light, like a sleeping animal." : "You crouch by the cold hearth.",
  nest: s => !vaelAwake(s) ? "Vael sleeps, breathing slowly." : s.wing === 2 ? "Vael is flexing her healed wing, very pleased with herself." : "Vael lifts her head as you come. Her good wing curls round you without either of you mentioning it.",
  cistern: () => "The cistern sits in the tower's corner, a ring of black stone around black water.",
  door: s => s.doorHidden ? "You stand in the hidden doorway. From here you can still see the hill falling away." : "You stand in the empty doorway. Cold air comes up the stair.",
  parapet: () => "You climb the ladder to the parapet. The whole valley is laid out below you, dark and patient.",
};

function say(d: Draft, speaker: Speaker, text: string) {
  d.log.push({ id: (d.log.at(-1)?.id ?? -1) + 1, speaker, text });
}

function learn(d: Draft, word: WordId) {
  if (d.words.includes(word)) return;
  d.words.push(word);
  say(d, "narrator", `You learned ${WORDS[word].word}: ${WORDS[word].gloss}.`);
}

function clamp(value: number) {
  return Math.max(0, Math.min(MAX_ENERGY, value));
}

function capital(text: string) {
  return text[0].toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Endings

export const ENDINGS: Record<EndingId, { title: string; survived: boolean; text: string }> = {
  flight: { title: "Wings", survived: true, text: "Vael drags herself through the breach and you climb onto her neck. She drops off the edge of the hill like a stone, and then her wings open, both of them, and the stone becomes a bird. Behind you, much later, the soldiers find a warm hearth and a dead Rider's word scratched in the dark." },
  decoy: { title: "The walking light", survived: true, text: "At dawn the soldiers come up the road and see a lantern moving south across the fields. The sergeant curses and sends them after it at a canter. They do not look back at the dark tower. By the time the light goes out, they are three miles away, and so are you." },
  unseen: { title: "Rubble", survived: true, text: "They come at first light and stand at the foot of the hill. A sergeant looks up at a ruin with no doorway and a slope of fallen stone, and decides it is not worth his boots. You listen to them ride away for a long time before either of you breathes." },
  stand: { title: "The stair", survived: true, text: "They reach the stair and find it gone. One of them starts to climb the wall. Then Vael thrusts her head out through the breach and roars, a sound you feel in your spine, and they discover pressing business elsewhere. They will be back with more men. You have a day. A day is a great deal." },
  taken: { title: "Taken at dawn", survived: false, text: "They come up the hill at first light. There is a doorway and an open stair, and a tired Rider and a hurt dragon with nowhere to go. The last thing you hear before the sack goes over your head is Vael, in your mind, refusing to stop talking to you." },
  spent: { title: "The cost of a word", survived: false, text: "The spell did not stop when you ran out. Magic costs what the work would cost, and you did not have it. Vael's voice is in your head, very loud and then very far away. The soldiers find a dragon at dawn, and she does not let them near you." },
};
