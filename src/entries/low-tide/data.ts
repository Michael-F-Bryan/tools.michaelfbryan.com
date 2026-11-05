/**
 * Static tables for Low Tide: the four bands of the flat, what each yields,
 * how long it takes, and the blueprints that change the rules. Numbers here
 * are the pacing knobs; `model.ts` is the machinery that reads them.
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

/** Things you make. Structures stand at camp; materials (rope, brick) sit in the inventory. */
export type Built =
  | "rope"
  | "brick"
  | "hull"
  | "sail"
  | "salt"
  | "waders"
  | "sled"
  | "fishTrap"
  | "kiln"
  | "net"
  | "raft"
  | "shelter"
  | "winch"
  | "lantern"
  | "saltworks"
  | "bellTower"
  | "beacon"
  | "boat";

export type Item = Resource | Built;

export const TIDE_MS = 80_000;
/** Game time within a tide at which the outermost exposed band goes under. */
export const TURN_MS = 50_000;
/** How long before the turn the water is visibly creeping over the outermost band. */
export const CREEP_MS = 15_000;
export const TIDES_PER_RUN = 12;
export const MAX_CREW = 4;
export const STARTING_CREW = 2;
export const STARTING_FOOD = 6;
export const FISH_TRAP_FOOD = 2;

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
  label: string;
}>;

export const RESOURCES: Record<Resource, ResourceInfo> = {
  driftwood: { band: 0, duration: 14_000, yield: 1, food: false, label: "Driftwood" },
  stone: { band: 0, duration: 18_000, yield: 1, food: false, label: "Stone" },
  clay: { band: 1, duration: 18_000, yield: 1, food: false, label: "Clay" },
  reed: { band: 1, duration: 16_000, yield: 1, food: false, label: "Reeds" },
  clams: { band: 1, duration: 20_000, yield: 3, food: true, label: "Clams" },
  kelp: { band: 2, duration: 20_000, yield: 1, food: false, label: "Kelp" },
  fish: { band: 2, duration: 24_000, yield: 4, food: true, label: "Fish" },
  pearl: { band: 2, duration: 36_000, yield: 1, food: false, label: "Pearl" },
  brass: { band: 3, duration: 28_000, yield: 1, food: false, label: "Brass" },
  iron: { band: 3, duration: 28_000, yield: 1, food: false, label: "Iron" },
  oil: { band: 3, duration: 30_000, yield: 1, food: false, label: "Oil" },
};

export const RESOURCES_BY_BAND: Record<Band, readonly Resource[]> = {
  0: ["driftwood", "stone"],
  1: ["reed", "clay", "clams"],
  2: ["kelp", "fish", "pearl"],
  3: ["brass", "iron", "oil"],
};

export type Tier = 1 | 2 | 3;

export type Blueprint = Readonly<{
  out: Built;
  tier: Tier;
  /** What it costs. Materials come from the inventory; structures (bell tower, lantern) from `built`. */
  inputs: Readonly<Partial<Record<Item, number>>>;
  /** A structure that must stand (and is not consumed) before this can be built. */
  requires?: Built;
  /** Structures stand at camp and change the rules; materials sit in the inventory. */
  structure: boolean;
  label: string;
  effect: string;
  flavour: string;
}>;

/**
 * Every blueprint is visible from the first tide. A tier unlocks once anything
 * from the tier below has been built, so the first decision is small and the
 * later ones are about which scarce material goes where.
 */
export const BLUEPRINTS: readonly Blueprint[] = [
  {
    out: "waders",
    tier: 1,
    inputs: { reed: 1, driftwood: 1 },
    structure: true,
    label: "Waders",
    effect: "Work one band past the waterline until the tide turns, at 1.5× time.",
    flavour: "Reed wrapped over driftwood soles. The water is no longer the edge.",
  },
  {
    out: "fishTrap",
    tier: 1,
    inputs: { reed: 1, stone: 1 },
    structure: true,
    label: "Fish trap",
    effect: "+2 food at every turn of the tide.",
    flavour: "A reed fence on a stone footing. The tide feeds you now.",
  },
  {
    out: "kiln",
    tier: 1,
    inputs: { clay: 1, stone: 1 },
    structure: true,
    label: "Kiln",
    effect: "At each turn, fires one brick from one clay and one driftwood.",
    flavour: "Stone walls packed with clay. Light it and it hums.",
  },
  {
    out: "sled",
    tier: 1,
    inputs: { driftwood: 2 },
    structure: true,
    label: "Sled",
    effect: "Every job that is not food brings back one more.",
    flavour: "Two planks and a rope of your own hair. It drags.",
  },
  {
    out: "rope",
    tier: 1,
    inputs: { kelp: 1, reed: 1 },
    structure: false,
    label: "Rope",
    effect: "A material. Nets, rafts and winches all start here.",
    flavour: "Kelp twisted round reed holds. Rope.",
  },
  {
    out: "net",
    tier: 2,
    inputs: { rope: 1, reed: 1 },
    requires: "fishTrap",
    structure: true,
    label: "Net",
    effect: "Needs a fish trap. The trap holds 2 more food at every turn: enough for four.",
    flavour: "Rope knotted across the trap mouth. It catches what the reed fence missed.",
  },
  {
    out: "raft",
    tier: 2,
    inputs: { driftwood: 2, rope: 1 },
    structure: true,
    label: "Raft",
    effect: "One more band past the waterline (two with waders, at 2× time), until the tide turns.",
    flavour: "Driftwood lashed with rope. It floats. Just.",
  },
  {
    out: "shelter",
    tier: 2,
    inputs: { reed: 1, clay: 1 },
    structure: true,
    label: "Shelter",
    effect: "One more crew member joins you. Build another for a fourth. They eat too.",
    flavour: "Reed thatch on a clay footing. Someone was waiting for a roof.",
  },
  {
    out: "winch",
    tier: 2,
    inputs: { iron: 1, rope: 1 },
    structure: true,
    label: "Winch",
    effect: "Wreck jobs take half the time.",
    flavour: "An iron drum and a rope. The wreck gives things up faster.",
  },
  {
    out: "lantern",
    tier: 2,
    inputs: { brass: 1, oil: 1 },
    structure: true,
    label: "Lantern",
    effect: "Dark tides no longer slow your crew.",
    flavour: "Brass cupped round a wick of oil. The night tide is yours.",
  },
  {
    out: "hull",
    tier: 2,
    inputs: { driftwood: 3, rope: 1 },
    structure: false,
    label: "Hull",
    effect: "Half of a boat. Add a sail.",
    flavour: "Three planks and a rope, caulked with mud. It holds water out, mostly.",
  },
  {
    out: "sail",
    tier: 2,
    inputs: { reed: 3, rope: 1 },
    structure: false,
    label: "Sail",
    effect: "Half of a boat. Add a hull.",
    flavour: "Reed matting on a rope edge. It catches wind you cannot feel.",
  },
  {
    out: "saltworks",
    tier: 2,
    inputs: { clay: 2, kelp: 2 },
    requires: "kiln",
    structure: true,
    label: "Saltworks",
    effect: "Needs a kiln. One salt at every turn: cargo worth 10.",
    flavour: "Clay pans by the kiln, kelp ash in the brine. White crust by morning.",
  },
  {
    out: "boat",
    tier: 3,
    inputs: { hull: 1, sail: 1 },
    structure: true,
    label: "Boat",
    effect: "At every turn, carries your three most valuable pieces of cargo to market.",
    flavour: "Hull and sail. Now you go to the market instead of waiting for it.",
  },
  {
    out: "bellTower",
    tier: 3,
    inputs: { brick: 2, stone: 1 },
    structure: true,
    label: "Bell tower",
    effect: "Half of a beacon. Add a lantern.",
    flavour: "Brick on stone, higher than the wreck. It wants a light.",
  },
  {
    out: "beacon",
    tier: 3,
    inputs: { bellTower: 1, lantern: 1 },
    structure: true,
    label: "Beacon",
    effect: "At every turn, a ship calls and buys one of every kind of cargo. Its light keeps dark tides from slowing you.",
    flavour: "The lantern goes up the tower. From the sea, this is a harbour now.",
  },
];

export const BUILT_LABELS: Record<Built, string> = {
  ...(Object.fromEntries(BLUEPRINTS.map((blueprint) => [blueprint.out, blueprint.label])) as Record<Built, string>),
  brick: "Brick",
  salt: "Salt",
};

/**
 * What sells at the turn, in tie-break order. Shingle and mudflat goods, rope,
 * brick and kelp are building stock and never sell: every blueprint input is
 * either one of these (protected by the keep-last-one rule) or not cargo at all.
 */
export const CARGO = ["pearl", "brass", "iron", "oil", "salt"] as const satisfies readonly Item[];
export type Cargo = (typeof CARGO)[number];
/** Sale price per piece. The score is the sum of these over the run. */
export const CARGO_VALUE: Record<Cargo, number> = { pearl: 20, brass: 12, iron: 10, oil: 10, salt: 10 };
/** How many pieces the trader takes at each turn (the most valuable first). */
export const TRADER_HOLD = 1;
/** How many more pieces your own boat carries at each turn. */
export const BOAT_HOLD = 3;
/** Wreck jobs take this fraction of their time with a winch. */
export const WINCH_FACTOR = 0.5;
/** Extra food the trap holds at each turn once a net hangs across it. */
export const NET_FOOD = 2;
