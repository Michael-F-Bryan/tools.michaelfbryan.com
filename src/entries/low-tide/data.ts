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
  | "waders"
  | "sled"
  | "fishTrap"
  | "kiln"
  | "net"
  | "raft"
  | "shelter"
  | "winch"
  | "lantern"
  | "bellTower"
  | "beacon";

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
  /** Salvage value at the end of the run, for the first `SALVAGE_CAP` of each. */
  value: number;
  label: string;
}>;

export const RESOURCES: Record<Resource, ResourceInfo> = {
  driftwood: { band: 0, duration: 14_000, yield: 1, food: false, value: 1, label: "Driftwood" },
  stone: { band: 0, duration: 18_000, yield: 1, food: false, value: 1, label: "Stone" },
  clay: { band: 1, duration: 18_000, yield: 1, food: false, value: 1, label: "Clay" },
  reed: { band: 1, duration: 16_000, yield: 1, food: false, value: 1, label: "Reeds" },
  clams: { band: 1, duration: 20_000, yield: 3, food: true, value: 1, label: "Clams" },
  kelp: { band: 2, duration: 20_000, yield: 1, food: false, value: 2, label: "Kelp" },
  fish: { band: 2, duration: 24_000, yield: 4, food: true, value: 3, label: "Fish" },
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

export type Tier = 1 | 2 | 3;

export type Blueprint = Readonly<{
  out: Built;
  tier: Tier;
  /** What it costs. Materials come from the inventory; structures (bell tower, lantern) from `built`. */
  inputs: Readonly<Partial<Record<Item, number>>>;
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
    effect: "Work one band past the waterline, all tide, at 1.5× time.",
    flavour: "Reed wrapped over driftwood soles. The water is no longer the edge.",
  },
  {
    out: "fishTrap",
    tier: 1,
    inputs: { reed: 1, stone: 1 },
    structure: true,
    label: "Fish trap",
    effect: "+2 food at every turn of the tide, forever.",
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
    structure: true,
    label: "Net",
    effect: "Fish jobs bring back 8 instead of 4.",
    flavour: "Rope knotted through a reed frame. The reef will feed everyone.",
  },
  {
    out: "raft",
    tier: 2,
    inputs: { driftwood: 2, rope: 1 },
    structure: true,
    label: "Raft",
    effect: "One more band past the waterline (two with waders, at 2× time).",
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
    effect: "Wreck jobs take 40% less time.",
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
    effect: "Ring it to end the run: 500 points plus 40 for every tide left.",
    flavour: "The lantern goes up the tower. From the sea, this is a harbour now.",
  },
];

export const BUILT_LABELS: Record<Built, string> = {
  ...(Object.fromEntries(BLUEPRINTS.map((blueprint) => [blueprint.out, blueprint.label])) as Record<Built, string>),
  brick: "Brick",
};

/** Score for each structure standing at the end. Building must beat hoarding. */
export const STRUCTURE_VALUE = 50;
/** Only this many of any one item count toward salvage, so spamming the shingle has a ceiling. */
export const SALVAGE_CAP = 6;
export const MATERIAL_VALUE: Record<"rope" | "brick", number> = { rope: 6, brick: 8 };
export const FOOD_VALUE = 2;
export const FOOD_CAP = 10;
export const BEACON_BONUS = 500;
export const TIDE_REMAINING_BONUS = 40;
