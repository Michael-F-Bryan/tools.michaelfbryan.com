import { POOL_HEIGHT, POOL_WIDTH } from "./types";
import type { Food, Genome, Organism, PartGene, PartPose, Vec2, WorldView } from "./types";

/** Theme colours read once per theme change, never per frame. */
export type Palette = {
  dark: boolean;
  paper: string;
  panel: string;
  ink: string;
  accent: string;
  rule: string;
  waterTop: string;
  waterBottom: string;
  scent: [number, number, number];
  food: string;
  foodHalo: string;
  glow: string;
  mouth: string;
};

/** Mapping from CSS pixels to world units under the current camera. */
export type Layout = {
  width: number;
  height: number;
  dpr: number;
  scale: number;
  originX: number;
  originY: number;
};

/** Camera centre in world units and zoom relative to the base fit. */
export type Camera = { cx: number; cy: number; zoom: number };

type DeathMark = { x: number; y: number; slot: number; shade: number; starved: boolean; start: number };
type LastSeen = { x: number; y: number; slot: number; shade: number; stamp: number };

export type UiState = {
  selectedId: number | null;
  hoverId: number | null;
  /** True while the camera tracks the selected organism (longer trail). */
  following?: boolean;
};

type Patch = { position: Vec2; radius: number; /** Food stock in [0,1]; absent means full. */ stock?: number };

function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(base: [number, number, number], tint: [number, number, number], amount: number): string {
  const channel = (i: number) => Math.round(base[i] + (tint[i] - base[i]) * amount);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

export function readPalette(): Palette {
  const tokens = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  const paper = token("--paper", "#f9fafb");
  const rgb = parseHex(paper) ?? [249, 250, 251];
  const dark = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
  return {
    dark,
    paper,
    panel: token("--panel", dark ? "#282c33" : "#f1f3f6"),
    ink: token("--ink", dark ? "#f0f2f5" : "#17191d"),
    accent: token("--accent", "#164dcc"),
    rule: token("--rule-subtle", dark ? "#3a414b" : "#c7ccd2"),
    waterTop: dark ? mix(rgb, [28, 92, 104], 0.3) : mix(rgb, [150, 205, 214], 0.3),
    waterBottom: dark ? mix(rgb, [20, 70, 92], 0.5) : mix(rgb, [112, 178, 196], 0.38),
    scent: dark ? [120, 230, 150] : [40, 150, 80],
    food: dark ? "#ffd166" : "#d98e04",
    foodHalo: dark ? "rgba(255,209,102,0.22)" : "rgba(217,142,4,0.2)",
    glow: dark ? "#ffe9a0" : "#f2a900",
    mouth: dark ? "#0c1114" : "#10151a",
  };
}

// ---------------------------------------------------------------------------
// Lineage colour: a curated palette of maximally distinct colours, handed out at
// first sight. A lineage keeps its entry for the life of the pool; a newcomer takes
// the entry that no living lineage uses (oldest assignment first). genome.hue only
// shades within a lineage, by a few degrees.
// ---------------------------------------------------------------------------

/** hue, then saturation and lightness for light mode, then for dark mode. */
type Swatch = readonly [hue: number, satLight: number, lightLight: number, satDark: number, lightDark: number];

const LINEAGE_PALETTE: readonly Swatch[] = [
  [356, 72, 46, 78, 62], // red
  [216, 74, 44, 80, 66], // azure
  [30, 92, 44, 92, 58], // orange
  [270, 56, 48, 68, 70], // violet
  [132, 62, 32, 56, 52], // green
  [330, 72, 56, 82, 72], // pink
  [168, 90, 27, 62, 42], // teal
  [50, 94, 38, 96, 56], // gold
  [18, 50, 28, 46, 44], // rust brown
  [84, 74, 34, 66, 56], // lime
  [214, 22, 38, 26, 62], // slate
  [296, 64, 40, 70, 62], // fuchsia
  [40, 12, 42, 10, 62], // stone
  [192, 100, 36, 92, 56], // cyan
];
export const LINEAGE_PALETTE_SIZE = LINEAGE_PALETTE.length;

const colourSlots = new Map<number, number>();
const slotAssigned: number[] = new Array(LINEAGE_PALETTE.length).fill(0);
let assignments = 0;

/** Forget every lineage-to-colour assignment (call when a new pool starts). */
export function resetLineageColours() {
  colourSlots.clear();
  slotAssigned.fill(0);
  assignments = 0;
}

function assignSlot(lineage: number, living?: readonly Organism[]): number {
  const users = new Array<number>(LINEAGE_PALETTE.length).fill(0);
  if (living) {
    const counted = new Set<number>();
    for (let i = 0; i < living.length; i++) {
      const id = living[i].lineage;
      const slot = colourSlots.get(id);
      if (slot !== undefined && !counted.has(id)) {
        counted.add(id);
        users[slot] += 1;
      }
    }
  }
  let best = 0;
  for (let slot = 1; slot < users.length; slot++) {
    if (users[slot] < users[best] || (users[slot] === users[best] && slotAssigned[slot] < slotAssigned[best])) best = slot;
  }
  colourSlots.set(lineage, best);
  slotAssigned[best] = ++assignments;
  return best;
}

/** Palette entry for a lineage, assigning one on first sight. Negative ids (seeded parents) get neutral entry 12. */
export function lineageColourIndex(lineage: number, living?: readonly Organism[]): number {
  if (lineage < 0) return 12;
  return colourSlots.get(lineage) ?? assignSlot(lineage, living);
}

/**
 * Keeps the given lineages (largest first, the ones shown as chips) on pairwise different
 * entries. Only a lineage that collides with a larger one moves, so the leaders keep their colour.
 */
export function separateLineages(ids: readonly number[]) {
  if (ids.length > LINEAGE_PALETTE.length - 1) return;
  const taken = new Set<number>();
  for (const id of ids) {
    const slot = lineageColourIndex(id);
    if (id < 0) continue;
    if (!taken.has(slot)) {
      taken.add(slot);
      continue;
    }
    let best = -1;
    for (let candidate = 0; candidate < LINEAGE_PALETTE.length; candidate++) {
      if (taken.has(candidate) || candidate === 12) continue;
      if (best < 0 || slotAssigned[candidate] < slotAssigned[best]) best = candidate;
    }
    if (best < 0) continue;
    colourSlots.set(id, best);
    slotAssigned[best] = ++assignments;
    taken.add(best);
  }
}

/** Within-lineage shade offset in [-6, 6) degrees from the genome's drifting hue. */
function shadeOffset(genomeHue: number): number {
  return Math.round((((genomeHue % 12) + 12) % 12) - 6);
}

function swatchHsl(slot: number, shade: number, dark: boolean, lightShift = 0, alpha?: number): string {
  const [hue, satLight, lightLight, satDark, lightDark] = LINEAGE_PALETTE[slot];
  const h = (hue + shade + 360) % 360;
  const sat = dark ? satDark : satLight;
  const light = (dark ? lightDark : lightLight) + lightShift;
  return alpha === undefined ? `hsl(${h},${sat}%,${light}%)` : `hsla(${h},${sat}%,${light}%,${alpha})`;
}

/** Swatch colour for a lineage (chips, parent lineage), with no within-lineage shade. */
export function lineageColour(lineage: number, dark: boolean): string {
  return swatchHsl(lineageColourIndex(lineage), 0, dark);
}

/** Body colour for one organism: its lineage colour plus a subtle genome shade. */
export function organismColour(lineage: number, genomeHue: number, dark: boolean): string {
  return swatchHsl(lineageColourIndex(lineage), shadeOffset(genomeHue), dark);
}

type OrganismColours = { fill: string; outline: string; fin: string; finEdge: string; stalk: string; sensor: string };

function makeColours(slot: number, genomeHue: number, dark: boolean): OrganismColours {
  const shade = shadeOffset(genomeHue);
  const [hue, satLight, , satDark] = LINEAGE_PALETTE[slot];
  const h = (hue + shade + 360) % 360;
  const sat = dark ? satDark : satLight;
  return {
    fill: swatchHsl(slot, shade, dark),
    outline: `hsl(${h},${sat}%,${dark ? 22 : 17}%)`,
    fin: swatchHsl(slot, shade, dark, dark ? 4 : 8, 0.66),
    finEdge: `hsla(${h},${sat}%,${dark ? 82 : 24}%,0.85)`,
    stalk: `hsl(${h},${Math.min(sat, 35)}%,${dark ? 80 : 26}%)`,
    // The animal's own hue, lightened: sensors must not read as the warm orange food pellets.
    sensor: `hsl(${h},${Math.min(sat + 12, 92)}%,${dark ? 86 : 74}%)`,
  };
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Scale at zoom 1: whole pool visible (fit) or the canvas filled (cover). */
export function baseScale(width: number, height: number, cover: boolean): number {
  const fit = Math.min(width / POOL_WIDTH, height / POOL_HEIGHT) || 1;
  if (!cover) return fit;
  return Math.max(width / POOL_WIDTH, height / POOL_HEIGHT) || fit;
}

/** Keep the view inside the pool, centring any axis the view is larger than. */
export function clampCamera(camera: Camera, width: number, height: number, cover: boolean): Camera {
  const scale = baseScale(width, height, cover) * camera.zoom;
  const halfW = width / scale / 2;
  const halfH = height / scale / 2;
  camera.cx = halfW >= POOL_WIDTH / 2 ? POOL_WIDTH / 2 : Math.min(POOL_WIDTH - halfW, Math.max(halfW, camera.cx));
  camera.cy = halfH >= POOL_HEIGHT / 2 ? POOL_HEIGHT / 2 : Math.min(POOL_HEIGHT - halfH, Math.max(halfH, camera.cy));
  return camera;
}

const CENTRED: Camera = { cx: POOL_WIDTH / 2, cy: POOL_HEIGHT / 2, zoom: 1 };

/**
 * `free` skips the pool-bounds clamp so a followed subject can sit at the middle of the visible area even
 * beside the pool's edge (the overscan shows the page surface); `insetBottom` is the height of a sheet
 * covering the bottom of the canvas, so that middle is the middle of the uncovered band.
 */
export function computeLayout(width: number, height: number, dpr: number, cover = false, camera: Camera = CENTRED, free = false, insetBottom = 0): Layout {
  const view = free ? camera : clampCamera({ ...camera }, width, height, cover);
  const scale = baseScale(width, height, cover) * view.zoom;
  return {
    width,
    height,
    dpr,
    scale,
    originX: width / 2 - view.cx * scale,
    originY: (height - insetBottom) / 2 - view.cy * scale,
  };
}

/** CSS pixel offset within the canvas to world units. */
export function toWorld(layout: Layout, x: number, y: number): Vec2 {
  return { x: (x - layout.originX) / layout.scale, y: (y - layout.originY) / layout.scale };
}

/** Line-width multiplier that keeps bodies legible when the pool is drawn small. */
function strokeBoost(scale: number): number {
  return Math.min(1.6, Math.max(1, 0.9 / scale));
}

/** Real milliseconds the meal bloom lasts (it is timed by the wall clock, so 4× or 16× do not shorten it). */
const MEAL_FLASH_MS = 1000;
/** The bloom grows to this multiple of the mouth radius, but never less than this many screen pixels across its radius. */
const MEAL_BLOOM_RADII = 2.5;
const MEAL_BLOOM_MIN_PX = 14;

type MealFlash = { organism: Organism; at: number; fx: number; fy: number; hasFood: boolean };

const SCENT_COLS = 48;
const SCENT_ROWS = 30;
const SCENT_REFRESH_MS = 180;
const SELECTED_TRAIL_POINTS = 140;
const FOLLOW_TRAIL_POINTS = 420;
/** Birth and death marks last this many REAL milliseconds, whatever the simulation speed. */
const DEATH_MS = 700;
const BIRTH_MS = 700;
const MAX_DEATH_MARKS = 40;
const TRAIL_STEP = 2.5;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Draws a `WorldView`. Holds only scratch caches (scent texture, colour strings,
 * the selected organism's own longer trail); the world itself is never mutated.
 */
export class PoolRenderer {
  palette: Palette = readPalette();
  private colours = new Map<string, OrganismColours>();
  private scentCanvas: HTMLCanvasElement | null = null;
  private scentContext: CanvasRenderingContext2D | null = null;
  private scentImage: ImageData | null = null;
  private scentStamp = -Infinity;
  private water: CanvasGradient | null = null;
  private waterOwner: CanvasRenderingContext2D | null = null;
  private point: Vec2 = { x: 0, y: 0 };
  private living: readonly Organism[] = [];
  private boost = 1;
  private scale = 1;
  private trailWorld: WorldView | null = null;
  private trailOwner = -1;
  private trail: Vec2[] = [];
  private lastSeen = new Map<number, LastSeen>();
  private deathsHandled = new Set<number>();
  private deaths: DeathMark[] = [];
  private eventWorld: WorldView | null = null;
  private bornAt = new Map<number, number>();
  private following = false;
  private frameNow = 0;
  private frameStamp = 0;
  private foodById = new Map<number, Food>();
  private lastMeals = new Map<number, number>();
  private lastFood = new Map<number, Vec2>();
  private mealFlashes: MealFlash[] = [];
  private foragingWorld: WorldView | null = null;

  setPalette(palette: Palette) {
    this.palette = palette;
    this.colours.clear();
    this.water = null;
    this.scentStamp = -Infinity;
  }

  private coloursFor(organism: Organism): OrganismColours {
    const slot = lineageColourIndex(organism.lineage, this.living);
    const key = `${slot}:${shadeOffset(organism.genome.hue)}`;
    let colours = this.colours.get(key);
    if (!colours) {
      colours = makeColours(slot, organism.genome.hue, this.palette.dark);
      this.colours.set(key, colours);
    }
    return colours;
  }

  private refreshScent(world: WorldView, now: number) {
    if (now - this.scentStamp < SCENT_REFRESH_MS) return;
    this.scentStamp = now;
    if (!this.scentCanvas) {
      this.scentCanvas = document.createElement("canvas");
      this.scentCanvas.width = SCENT_COLS;
      this.scentCanvas.height = SCENT_ROWS;
      this.scentContext = this.scentCanvas.getContext("2d");
      this.scentImage = this.scentContext?.createImageData(SCENT_COLS, SCENT_ROWS) ?? null;
    }
    const image = this.scentImage;
    if (!image || !this.scentContext) return;
    const [r, g, b] = this.palette.scent;
    const alphaScale = this.palette.dark ? 150 : 120;
    const data = image.data;
    const point = this.point;
    for (let row = 0; row < SCENT_ROWS; row++) {
      point.y = ((row + 0.5) / SCENT_ROWS) * world.height;
      for (let col = 0; col < SCENT_COLS; col++) {
        point.x = ((col + 0.5) / SCENT_COLS) * world.width;
        const strength = clamp01(world.scentAt(point));
        const i = (row * SCENT_COLS + col) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = Math.sqrt(strength) * alphaScale;
      }
    }
    this.scentContext.putImageData(image, 0, 0);
  }

  /** Records the selected organism's path so the followed trail outlasts the engine's. */
  private trackSelected(world: WorldView, organism: Organism | undefined, following: boolean) {
    this.following = following;
    if (!organism || !organism.poses.length) {
      this.trailOwner = -1;
      this.trail.length = 0;
      return;
    }
    if (this.trailWorld !== world || this.trailOwner !== organism.id) {
      this.trailWorld = world;
      this.trailOwner = organism.id;
      this.trail.length = 0;
      for (const p of organism.trail) this.trail.push({ x: p.x, y: p.y });
    }
    const here = organism.position;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(here.x - last.x, here.y - last.y) >= TRAIL_STEP) this.trail.push({ x: here.x, y: here.y });
    const cap = following ? FOLLOW_TRAIL_POINTS : SELECTED_TRAIL_POINTS;
    if (this.trail.length > cap) this.trail.splice(0, this.trail.length - cap);
  }

  draw(ctx: CanvasRenderingContext2D, world: WorldView, layout: Layout, ui: UiState, now: number) {
    const palette = this.palette;
    const { dpr, scale } = layout;
    this.boost = strokeBoost(scale);
    this.scale = scale;
    this.frameNow = now;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, layout.width, layout.height);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * layout.originX, dpr * layout.originY);
    if (!this.water || this.waterOwner !== ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, POOL_HEIGHT);
      gradient.addColorStop(0, palette.waterTop);
      gradient.addColorStop(1, palette.waterBottom);
      this.water = gradient;
      this.waterOwner = ctx;
    }
    ctx.fillStyle = this.water;
    ctx.fillRect(0, 0, POOL_WIDTH, POOL_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, POOL_WIDTH, POOL_HEIGHT);
    ctx.clip();

    this.drawScent(ctx, world, now);
    this.drawPatches(ctx, world);
    this.drawFood(ctx, world);

    const organisms = world.organisms;
    this.living = organisms;
    this.noteDeaths(world, organisms, now);
    const selectedId = ui.selectedId;
    for (let i = 0; i < organisms.length; i++) if (organisms[i].id !== selectedId) this.drawTrail(ctx, organisms[i]);
    let selected: Organism | undefined;
    let hovered: Organism | undefined;
    for (let i = 0; i < organisms.length; i++) {
      const organism = organisms[i];
      if (organism.id === selectedId) selected = organism;
      if (organism.id === ui.hoverId) hovered = organism;
    }
    this.trackSelected(world, selected, Boolean(ui.following));
    if (selected) this.drawSelectedTrail(ctx, selected);
    this.drawDeaths(ctx, now);
    for (let i = 0; i < organisms.length; i++) if (organisms[i] !== selected) this.drawOrganism(ctx, organisms[i], 0);
    if (selected) {
      this.drawOrganism(ctx, selected, 1.6);
      this.drawSelection(ctx, selected, scale);
    }
    this.drawForaging(ctx, world, organisms, now);
    if (hovered && hovered !== selected) this.drawRing(ctx, hovered, palette.ink, 1.2 / scale, 0.45);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0, 0, POOL_WIDTH, POOL_HEIGHT);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Eating, as the engine reports it: a thin arc filling around the mouth with `handlingProgress`, a faint
   * link to the handled particle, and a brief flash when `meals` ticks up between frames.
   */
  private drawForaging(ctx: CanvasRenderingContext2D, world: WorldView, organisms: readonly Organism[], now: number) {
    if (this.foragingWorld !== world) {
      this.foragingWorld = world;
      this.lastMeals.clear();
      this.lastFood.clear();
      this.mealFlashes.length = 0;
    }
    const foodById = this.foodById;
    foodById.clear();
    let handling = false;
    for (let i = 0; i < organisms.length; i++) {
      if ((organisms[i].handlingProgress ?? 0) > 0) {
        handling = true;
        break;
      }
    }
    if (handling) for (const f of world.food) foodById.set(f.id, f);

    const boost = this.boost;
    const accent = this.palette.accent;
    ctx.lineCap = "round";
    for (let i = 0; i < organisms.length; i++) {
      const o = organisms[i];
      const previous = this.lastMeals.get(o.id);
      if (previous !== undefined && o.meals > previous && o.poses.length) {
        const food = this.lastFood.get(o.id);
        this.mealFlashes.push({ organism: o, at: now, fx: food?.x ?? 0, fy: food?.y ?? 0, hasFood: Boolean(food) });
      }
      this.lastMeals.set(o.id, o.meals);
      const progress = o.handlingProgress ?? 0;
      if (progress <= 0 || !o.poses.length) continue;
      const mouth = o.poses[0].base;
      const food = o.handlingFood === undefined ? undefined : foodById.get(o.handlingFood);
      if (food) {
        let last = this.lastFood.get(o.id);
        if (!last) this.lastFood.set(o.id, (last = { x: 0, y: 0 }));
        last.x = food.position.x;
        last.y = food.position.y;
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 0.9 * boost;
        ctx.beginPath();
        ctx.moveTo(mouth.x, mouth.y);
        ctx.lineTo(food.position.x, food.position.y);
        ctx.stroke();
      }
      const radius = this.mouthRadius(o) + 3.4 * boost;
      ctx.lineWidth = 1.5 * boost;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(progress));
      ctx.stroke();
    }

    const flashes = this.mealFlashes;
    let kept = 0;
    for (let i = 0; i < flashes.length; i++) {
      const flash = flashes[i];
      const t = (now - flash.at) / MEAL_FLASH_MS;
      if (t >= 1) continue;
      flashes[kept++] = flash;
      const mouth = flash.organism.poses[0]?.base;
      if (!mouth) continue;
      const e = 1 - (1 - t) * (1 - t);
      const mouthR = this.mouthRadius(flash.organism);
      const peak = Math.max(mouthR * MEAL_BLOOM_RADII, MEAL_BLOOM_MIN_PX / this.scale);
      const from = mouthR + 3.4 * boost;
      ctx.strokeStyle = accent;
      // Hold at full strength for the first third, then fade: bloom = meal eaten (the arc means food is held).
      ctx.globalAlpha = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, from + (Math.max(peak, from) - from) * e, 0, Math.PI * 2);
      ctx.stroke();
      if (flash.hasFood) {
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.fillStyle = this.palette.food;
        ctx.beginPath();
        ctx.arc(flash.fx + (mouth.x - flash.fx) * e, flash.fy + (mouth.y - flash.fy) * e, Math.max(0.2, 2.6 * (1 - e)) * boost, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    flashes.length = kept;
    ctx.globalAlpha = 1;

    if (this.lastMeals.size > organisms.length + 64) {
      const alive = new Set<number>();
      for (const o of organisms) alive.add(o.id);
      for (const id of this.lastMeals.keys()) {
        if (!alive.has(id)) {
          this.lastMeals.delete(id);
          this.lastFood.delete(id);
        }
      }
    }
  }

  private mouthRadius(organism: Organism): number {
    return Math.max(1.6, (organism.genome.parts[0]?.width ?? 4) * 0.26) * this.boost;
  }

  private drawScent(ctx: CanvasRenderingContext2D, world: WorldView, now: number) {
    this.refreshScent(world, now);
    if (!this.scentCanvas) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(this.scentCanvas, 0, 0, POOL_WIDTH, POOL_HEIGHT);
  }

  /** A soft meadow disc per patch: warm and bright when full, almost gone when grazed down, with a faint dashed ring left behind. */
  private drawPatches(ctx: CanvasRenderingContext2D, world: WorldView) {
    const patches = (world as { patches?: readonly Patch[] }).patches;
    if (!patches?.length) return;
    const dark = this.palette.dark;
    const rgb = dark ? "175,235,140" : "95,140,40";
    const ring = dark ? "190,255,210" : "20,90,60";
    for (const patch of patches) {
      const stock = Math.min(1, Math.max(0, patch.stock ?? 1));
      const { x, y } = patch.position;
      const peak = (dark ? 0.06 : 0.05) + (dark ? 0.44 : 0.4) * stock * stock;
      const disc = ctx.createRadialGradient(x, y, 0, x, y, patch.radius);
      disc.addColorStop(0, `rgba(${rgb},${peak.toFixed(3)})`);
      disc.addColorStop(0.6, `rgba(${rgb},${(peak * 0.65).toFixed(3)})`);
      disc.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(x, y, patch.radius, 0, Math.PI * 2);
      ctx.fill();
      // Full: a steady ring. Grazed down: only a faint dashed outline marks the empty ground.
      ctx.lineWidth = 1.2;
      ctx.setLineDash(stock > 0.6 ? [] : [3, 7 - 4 * stock]);
      ctx.strokeStyle = `rgba(${ring},${(0.12 + 0.2 * stock).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, patch.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawFood(ctx: CanvasRenderingContext2D, world: WorldView) {
    const food = world.food;
    if (!food.length) return;
    const boost = this.boost;
    const halo = 4.6 * boost;
    const core = 2 * boost;
    ctx.fillStyle = this.palette.foodHalo;
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const { x, y } = food[i].position;
      ctx.moveTo(x + halo, y);
      ctx.arc(x, y, halo, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = this.palette.food;
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const { x, y } = food[i].position;
      ctx.moveTo(x + core, y);
      ctx.arc(x, y, core, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Faint two-tone path behind an ordinary organism. */
  private drawTrail(ctx: CanvasRenderingContext2D, organism: Organism) {
    const trail = organism.trail;
    const count = trail.length;
    if (count < 2) return;
    const colours = this.coloursFor(organism);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const mid = count >> 1;
    ctx.strokeStyle = colours.fill;
    ctx.lineWidth = 1.4 * this.boost;
    ctx.globalAlpha = 0.07;
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i <= mid; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(trail[mid].x, trail[mid].y);
    for (let i = mid + 1; i < count; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Wake for the selected organism: from the renderer's own longer record, tapering to a point at the tail. */
  private drawSelectedTrail(ctx: CanvasRenderingContext2D, organism: Organism) {
    const trail = this.trail;
    const count = trail.length;
    if (count < 2) return;
    ctx.strokeStyle = this.coloursFor(organism).fill;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const follow = this.following;
    const bands = 28;
    const per = Math.max(1, Math.ceil((count - 1) / bands));
    for (let i = 0; i < count - 1; i += per) {
      const end = Math.min(count - 1, i + per);
      const along = end / count;
      ctx.globalAlpha = Math.min(1, (follow ? 0.16 : 0.08) + (follow ? 0.84 : 0.72) * along);
      ctx.lineWidth = (0.6 + (follow ? 3.6 : 2.6) * along) * this.boost;
      ctx.beginPath();
      ctx.moveTo(trail[i].x, trail[i].y);
      for (let j = i + 1; j <= end; j++) ctx.lineTo(trail[j].x, trail[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Remembers where each animal was last drawn, and turns new death events into brief marks. */
  private noteDeaths(world: WorldView, organisms: readonly Organism[], now: number) {
    if (this.eventWorld !== world) {
      this.eventWorld = world;
      this.lastSeen.clear();
      this.deathsHandled.clear();
      this.deaths.length = 0;
      this.bornAt.clear();
    }
    const stamp = ++this.frameStamp;
    for (let i = 0; i < organisms.length; i++) {
      const organism = organisms[i];
      const seen = this.lastSeen.get(organism.id);
      const slot = lineageColourIndex(organism.lineage, organisms);
      if (seen) {
        seen.x = organism.position.x;
        seen.y = organism.position.y;
        seen.slot = slot;
        seen.shade = shadeOffset(organism.genome.hue);
        seen.stamp = stamp;
      } else {
        this.lastSeen.set(organism.id, { x: organism.position.x, y: organism.position.y, slot, shade: shadeOffset(organism.genome.hue), stamp });
      }
    }
    const events = world.events;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.kind !== "death" || this.deathsHandled.has(event.organism)) continue;
      this.deathsHandled.add(event.organism);
      const seen = this.lastSeen.get(event.organism);
      if (!seen || seen.stamp === stamp) continue;
      this.deaths.push({ x: seen.x, y: seen.y, slot: seen.slot, shade: seen.shade, starved: event.cause === "starved", start: now });
      this.lastSeen.delete(event.organism);
    }
    if (this.deaths.length > MAX_DEATH_MARKS) this.deaths.splice(0, this.deaths.length - MAX_DEATH_MARKS);
    if (this.deathsHandled.size > 800) this.deathsHandled.clear();
    if (stamp % 120 === 0) for (const [id, seen] of this.lastSeen) if (seen.stamp < stamp - 120) this.lastSeen.delete(id);
  }

  /** A quiet fading mark where an animal died: hollow when it starved, a soft disc when it simply aged out. */
  private drawDeaths(ctx: CanvasRenderingContext2D, now: number) {
    const marks = this.deaths;
    let keep = 0;
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i];
      const t = (now - mark.start) / DEATH_MS;
      if (t >= 1) continue;
      marks[keep++] = mark;
      if (t < 0) continue;
      const fade = 1 - t;
      const colour = swatchHsl(mark.slot, mark.shade, this.palette.dark);
      ctx.globalAlpha = (mark.starved ? 0.9 : 0.6) * fade;
      if (mark.starved) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.8 * this.boost;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, 6 + t * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, (4 + t * 4) * this.boost, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    marks.length = keep;
    ctx.globalAlpha = 1;
  }

  private drawOrganism(ctx: CanvasRenderingContext2D, organism: Organism, outlineExtra: number) {
    const poses = organism.poses;
    if (!poses.length) return;
    const colours = this.coloursFor(organism);
    const fraction = organism.capacity > 0 ? organism.energy / organism.capacity : 1;
    const alpha = Math.max(0.4, Math.min(1, fraction * 1.1));
    paintBody(ctx, organism.genome.parts, poses, organism.senses, colours, this.palette, this.boost, alpha, outlineExtra);

    // Newborn pulse: timed in real milliseconds from first sight so it reads at any speed.
    let start = this.bornAt.get(organism.id);
    if (start === undefined && organism.age < 1) {
      start = this.frameNow;
      this.bornAt.set(organism.id, start);
      if (this.bornAt.size > 400) for (const [id, at] of this.bornAt) if (this.frameNow - at > BIRTH_MS) this.bornAt.delete(id);
    }
    if (start !== undefined) {
      const t = (this.frameNow - start) / BIRTH_MS;
      if (t >= 0 && t < 1) {
        const root = poses[0];
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = colours.fill;
        ctx.lineWidth = 2.2 * this.boost;
        ctx.beginPath();
        ctx.arc(root.base.x, root.base.y, 8 + t * 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Rotated box hugging one animal's own poses (root heading as the long axis), padded by `pad`. */
  private outline(organism: Organism, pad: number) {
    const poses = organism.poses;
    const heading = poses[0].heading;
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < poses.length; i++) {
      const half = Math.max(1, (organism.genome.parts[i]?.width ?? 1) * 0.5);
      for (const p of [poses[i].base, poses[i].tip]) {
        const u = p.x * ux + p.y * uy;
        const v = -p.x * uy + p.y * ux;
        minU = Math.min(minU, u - half); maxU = Math.max(maxU, u + half);
        minV = Math.min(minV, v - half); maxV = Math.max(maxV, v + half);
      }
    }
    minU -= pad; maxU += pad; minV -= pad; maxV += pad;
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    return { x: cu * ux - cv * uy, y: cu * uy + cv * ux, angle: heading, w: maxU - minU, h: maxV - minV };
  }

  private strokeBox(ctx: CanvasRenderingContext2D, box: { x: number; y: number; angle: number; w: number; h: number }) {
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.rotate(box.angle);
    ctx.beginPath();
    ctx.roundRect(-box.w / 2, -box.h / 2, box.w, box.h, Math.min(box.w, box.h) / 2);
    ctx.restore();
    ctx.stroke();
  }

  /** Tight ring around the selected animal alone, plus a short leader pointing at its mouth. */
  private drawSelection(ctx: CanvasRenderingContext2D, organism: Organism, scale: number) {
    if (!organism.poses.length) return;
    const pad = 4 / scale;
    const box = this.outline(organism, pad);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.palette.accent;
    ctx.lineWidth = 2.4 / scale;
    this.strokeBox(ctx, box);
    const root = organism.poses[0];
    const dx = Math.cos(root.heading);
    const dy = Math.sin(root.heading);
    const mouth = root.base;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.4 / scale;
    ctx.beginPath();
    ctx.moveTo(mouth.x - dx * (pad + 1.5 / scale), mouth.y - dy * (pad + 1.5 / scale));
    ctx.lineTo(mouth.x - dx * (pad + 11 / scale), mouth.y - dy * (pad + 11 / scale));
    ctx.stroke();
  }

  private drawRing(ctx: CanvasRenderingContext2D, organism: Organism, colour: string, lineWidth: number, alpha: number) {
    if (!organism.poses.length) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    this.strokeBox(ctx, this.outline(organism, 4 * lineWidth / 1.2));
    ctx.globalAlpha = 1;
  }
}

/**
 * Paints one body from its part genes and world poses at the current transform:
 * membranes, outlined trunks, sensor stalks that glow with their reading, then
 * the mouth at the root base.
 */
function paintBody(
  ctx: CanvasRenderingContext2D,
  parts: readonly PartGene[],
  poses: readonly PartPose[],
  senses: readonly number[] | undefined,
  colours: OrganismColours,
  palette: Palette,
  boost: number,
  alpha: number,
  outlineExtra = 0,
) {
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Membranes first so trunks and stalks sit on top of them.
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind === "fin" && poses[i]) drawMembrane(ctx, parts[i], poses[i], colours.fin, colours.finEdge, boost);
  }
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? colours.outline : colours.fill;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind !== "trunk" || !poses[i]) continue;
      const { base, tip } = poses[i];
      ctx.lineWidth = parts[i].width * boost + (pass === 0 ? 2 * Math.sqrt(boost) + outlineExtra : 0);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  }

  let sensorIndex = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind !== "sensor") continue;
    const reading = clamp01(senses?.[sensorIndex++] ?? 0);
    const pose = poses[i];
    if (!pose) continue;
    ctx.strokeStyle = colours.stalk;
    ctx.lineWidth = Math.max(0.8, Math.min(1.6, parts[i].width)) * boost;
    ctx.beginPath();
    ctx.moveTo(pose.base.x, pose.base.y);
    ctx.lineTo(pose.tip.x, pose.tip.y);
    ctx.stroke();
    ctx.fillStyle = colours.outline;
    ctx.beginPath();
    ctx.arc(pose.tip.x, pose.tip.y, 2.1 * boost, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha * (0.2 + 0.8 * reading);
    ctx.fillStyle = colours.sensor;
    ctx.beginPath();
    ctx.arc(pose.tip.x, pose.tip.y, (1.6 + reading * 1.8) * boost, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  const root = poses[0];
  ctx.fillStyle = palette.mouth;
  ctx.beginPath();
  ctx.arc(root.base.x, root.base.y, Math.max(1.6, parts[0].width * 0.26) * boost, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Tapered membrane from a narrow base to a wider, rounded tip. */
function drawMembrane(ctx: CanvasRenderingContext2D, part: PartGene, pose: PartPose, fill: string, edge: string, boost: number) {
  const { base, tip } = pose;
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  const nx = -dy / length;
  const ny = dx / length;
  const baseHalf = Math.max(0.6, part.width * 0.12);
  const tipHalf = Math.max(1.5, part.width * 0.5) * Math.sqrt(boost);
  ctx.fillStyle = fill;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.9 * boost;
  ctx.beginPath();
  ctx.moveTo(base.x + nx * baseHalf, base.y + ny * baseHalf);
  ctx.lineTo(tip.x + nx * tipHalf, tip.y + ny * tipHalf);
  ctx.quadraticCurveTo(tip.x + dx * 0.12, tip.y + dy * 0.12, tip.x - nx * tipHalf, tip.y - ny * tipHalf);
  ctx.lineTo(base.x - nx * baseHalf, base.y - ny * baseHalf);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Rest-pose geometry from genes alone, so the inspector needs no engine. */
function restPoses(genome: Genome, heading: number): PartPose[] {
  const poses: PartPose[] = [];
  const parts = genome.parts;
  for (let i = 0; i < parts.length; i++) {
    const gene = parts[i];
    const parent = gene.parent >= 0 ? poses[gene.parent] : undefined;
    let angle: number;
    let base: Vec2;
    if (!parent) {
      angle = heading;
      base = { x: 0, y: 0 };
    } else {
      angle = parent.heading + (gene.side === 0 ? gene.angle : gene.side * gene.angle);
      base = {
        x: parent.base.x + (parent.tip.x - parent.base.x) * gene.anchor,
        y: parent.base.y + (parent.tip.y - parent.base.y) * gene.anchor,
      };
    }
    poses.push({
      base,
      tip: { x: base.x + Math.cos(angle) * gene.length, y: base.y + Math.sin(angle) * gene.length },
      jointAngle: gene.angle,
      heading: angle,
    });
  }
  return poses;
}

type Frame = { cx: number; cy: number; extent: number };
const frames = new WeakMap<Genome, Frame>();

/** Stable framing from the head-right rest pose, so a live glyph never rescales. */
function frameOf(genome: Genome): Frame {
  let frame = frames.get(genome);
  if (frame) return frame;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pose of restPoses(genome, 0)) {
    for (const p of [pose.base, pose.tip]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  // Room for fins and body waves to swing past the rest silhouette.
  let reach = 0;
  for (let i = 1; i < genome.parts.length; i++) reach = Math.max(reach, genome.parts[i].length);
  frame = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, extent: Math.max(maxX - minX, maxY - minY, 1) * 1.1 + reach * 0.7 };
  frames.set(genome, frame);
  return frame;
}

/**
 * Draws a body into a `size` x `size` CSS-pixel box at the context's current
 * transform, in a canonical frame: the root base at the framing origin and the
 * root heading pointing right. With `poses` omitted the genome is drawn at rest;
 * with an organism's live `poses` the fins and body waves animate.
 */
export function drawAnatomy(
  ctx: CanvasRenderingContext2D,
  genome: Genome,
  size: number,
  palette: Palette,
  options: { poses?: readonly PartPose[]; senses?: readonly number[]; lineage?: number } = {},
) {
  const poses = options.poses?.length === genome.parts.length ? options.poses : restPoses(genome, 0);
  if (!poses.length) return;
  const frame = frameOf(genome);
  const scale = (size - 8) / frame.extent;
  const colours = makeColours(options.lineage === undefined ? 0 : lineageColourIndex(options.lineage), genome.hue, palette.dark);
  const root = poses[0];
  ctx.save();
  ctx.translate(size / 2 - frame.cx * scale, size / 2 - frame.cy * scale);
  ctx.scale(scale, scale);
  ctx.rotate(-root.heading);
  ctx.translate(-root.base.x, -root.base.y);
  paintBody(ctx, genome.parts, poses, options.senses, colours, palette, 1, 1);
  ctx.restore();
}
