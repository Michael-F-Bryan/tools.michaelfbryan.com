/**
 * Static tables for Low Tide: the four bands of the flat, what each yields,
 * how long it takes, and the recipes that change the rules. Numbers here are
 * the pacing knobs; `model.ts` is the machinery that reads them.
 */

export type Band = 0 | 1 | 2 | 3;
export const BANDS: readonly Band[] = [0, 1, 2, 3];

export type Resource =
  | "driftwood"
  | "stone"
  | "clay"
  | "reed"
  | "clams"
  | "kelp"
  | "pearl"
  | "fish"
  | "brass"
  | "iron"
  | "oil";

/** Things you make. Structures stay in `built`; materials go to the inventory. */
export type Built =
  | "rope"
  | "brick"
  | "net"
  | "waders"
  | "kiln"
  | "lantern"
  | "raft"
  | "smokehouse"
  | "shelter"
  | "bellTower"
  | "beacon";

export type Item = Resource | Built;

export const TIDE_MS = 80_000;
/** Game time within a tide at which the outermost exposed band starts to flood. */
export const TURN_MS = 50_000;
export const TIDES_PER_RUN = 12;
export const MAX_CREW = 4;
export const STARTING_CREW = 2;
export const STARTING_FOOD = 4;
/** A raw food lot is edible at the end of the tide it was gathered and the next; then it spoils. */
export const SPOIL_AFTER_TIDES = 2;

export const BAND_NAMES: Record<Band, string> = {
  0: "Shingle",
  1: "Mudflat",
  2: "Reef",
  3: "Wreck",
};

export type ResourceInfo = Readonly<{
  band: Band;
  /** Base job length in game milliseconds, before modifiers. */
  duration: number;
  yield: number;
  food: boolean;
  /** Salvage value at the end of the run. */
  value: number;
  label: string;
}>;

export const RESOURCES: Record<Resource, ResourceInfo> = {
  driftwood: { band: 0, duration: 14_000, yield: 1, food: false, value: 2, label: "Driftwood" },
  stone: { band: 0, duration: 18_000, yield: 1, food: false, value: 2, label: "Stone" },
  clay: { band: 1, duration: 18_000, yield: 1, food: false, value: 3, label: "Clay" },
  reed: { band: 1, duration: 16_000, yield: 1, food: false, value: 3, label: "Reeds" },
  clams: { band: 1, duration: 20_000, yield: 2, food: true, value: 2, label: "Clams" },
  kelp: { band: 2, duration: 20_000, yield: 1, food: false, value: 4, label: "Kelp" },
  fish: { band: 2, duration: 24_000, yield: 2, food: true, value: 3, label: "Fish" },
  pearl: { band: 2, duration: 34_000, yield: 1, food: false, value: 60, label: "Pearl" },
  brass: { band: 3, duration: 28_000, yield: 1, food: false, value: 25, label: "Brass" },
  iron: { band: 3, duration: 28_000, yield: 1, food: false, value: 20, label: "Iron" },
  oil: { band: 3, duration: 32_000, yield: 1, food: false, value: 15, label: "Oil" },
};

export const RESOURCES_BY_BAND: Record<Band, readonly Resource[]> = {
  0: ["driftwood", "stone"],
  1: ["reed", "clay", "clams"],
  2: ["kelp", "fish", "pearl"],
  3: ["brass", "iron", "oil"],
};

export type Recipe = Readonly<{
  out: Built;
  /** Two inputs; order does not matter. Each is taken from the inventory, or from `built` for structures. */
  inputs: readonly [Item, Item];
  /** A structure that must already stand before this recipe works. */
  requires?: Built;
  /** Structures stand at camp and change the rules; materials sit in the inventory. */
  structure: boolean;
  label: string;
  effect: string;
  flavour: string;
}>;

export const RECIPES: readonly Recipe[] = [
  {
    out: "rope",
    inputs: ["kelp", "reed"],
    structure: false,
    label: "Rope",
    effect: "A material. Nets, waders and rafts all start here.",
    flavour: "Kelp twisted round reed holds. Rope.",
  },
  {
    out: "net",
    inputs: ["rope", "driftwood"],
    structure: true,
    label: "Net",
    effect: "Fish jobs at the reef bring back 5 instead of 2.",
    flavour: "Rope knotted across a driftwood frame. The reef will feed everyone now.",
  },
  {
    out: "waders",
    inputs: ["reed", "driftwood"],
    structure: true,
    label: "Waders",
    effect: "Mudflat and reef jobs take 30% less time.",
    flavour: "Reed wrapped over driftwood soles. The mud lets go of your feet.",
  },
  {
    out: "kiln",
    inputs: ["clay", "stone"],
    structure: true,
    label: "Kiln",
    effect: "Lets you fire clay with driftwood into brick.",
    flavour: "Stone walls packed with clay. Light it and it hums.",
  },
  {
    out: "brick",
    inputs: ["clay", "driftwood"],
    requires: "kiln",
    structure: false,
    label: "Brick",
    effect: "A material for the bell tower.",
    flavour: "The kiln roars on driftwood. The clay comes out ringing.",
  },
  {
    out: "lantern",
    inputs: ["brass", "oil"],
    structure: true,
    label: "Lantern",
    effect: "Dark tides no longer slow your crew.",
    flavour: "Brass cupped round a wick of oil. The night tide is yours.",
  },
  {
    out: "raft",
    inputs: ["driftwood", "rope"],
    structure: true,
    label: "Raft",
    effect: "Work the first band under water, all tide long, at 1.5× time.",
    flavour: "Driftwood lashed with rope. It floats. Just.",
  },
  {
    out: "smokehouse",
    inputs: ["iron", "driftwood"],
    structure: true,
    label: "Smokehouse",
    effect: "Food never spoils.",
    flavour: "An iron plate over a slow driftwood fire. Nothing goes off again.",
  },
  {
    out: "shelter",
    inputs: ["reed", "stone"],
    structure: true,
    label: "Shelter",
    effect: "One more crew member joins you (up to 4).",
    flavour: "Reed thatch on a stone footing. Someone was waiting for a roof.",
  },
  {
    out: "bellTower",
    inputs: ["brick", "stone"],
    structure: true,
    label: "Bell tower",
    effect: "Half of a beacon. Add a lantern.",
    flavour: "Brick on stone, higher than the wreck. It wants a light.",
  },
  {
    out: "beacon",
    inputs: ["bellTower", "lantern"],
    structure: true,
    label: "Beacon",
    effect: "Ring it to end the run with a 500-point bonus plus 40 per tide left.",
    flavour: "The lantern goes up the tower. From the sea, this is a harbour now.",
  },
];

export const BUILT_LABELS: Record<Built, string> = Object.fromEntries(
  RECIPES.map((recipe) => [recipe.out, recipe.label]),
) as Record<Built, string>;

/** Score for each structure standing at the end. */
export const STRUCTURE_VALUE = 30;
export const MATERIAL_VALUE: Record<"rope" | "brick", number> = { rope: 6, brick: 8 };
export const BEACON_BONUS = 500;
export const TIDE_REMAINING_BONUS = 40;

export const FAILED_COMBINE_LINES: readonly string[] = [
  "They just sit there, side by side.",
  "You turn them over in your hands. Nothing.",
  "The tide is louder than this idea.",
  "Not that. Not together, anyway.",
  "You put them back down. Try the other thing.",
];
