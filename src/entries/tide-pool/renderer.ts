import { POOL_HEIGHT, POOL_WIDTH } from "./types";
import type { Genome, Organism, PartGene, PartPose, Vec2, WorldView } from "./types";

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

export type UiState = {
  selectedId: number | null;
  hoverId: number | null;
  /** True while the camera tracks the selected organism (longer trail). */
  following?: boolean;
};

type Patch = { position: Vec2; radius: number };

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
// Lineage colour: the hue comes from the lineage id on a golden-angle ladder so
// neighbouring lineages are always well apart; genome.hue only shades within one.
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE = 137.508;
const LIGHTNESS_STEPS = [0, 7, -6];

function lineageHue(lineage: number): number {
  return (((lineage * GOLDEN_ANGLE) % 360) + 360) % 360;
}

/** Within-lineage shade offset in [-8, 8) degrees from the genome's drifting hue. */
function shadeOffset(genomeHue: number): number {
  return Math.round((((genomeHue % 16) + 16) % 16) - 8);
}

function lightnessFor(lineage: number, dark: boolean): number {
  return (dark ? 62 : 44) + LIGHTNESS_STEPS[((lineage % 3) + 3) % 3];
}

/** Swatch colour for a lineage (chips, parent lineage), with no within-lineage shade. */
export function lineageColour(lineage: number, dark: boolean): string {
  return `hsl(${Math.round(lineageHue(lineage))},${dark ? 58 : 64}%,${lightnessFor(lineage, dark)}%)`;
}

/** Body colour for one organism: its lineage hue plus a subtle genome shade. */
export function organismColour(lineage: number, genomeHue: number, dark: boolean): string {
  const hue = (Math.round(lineageHue(lineage)) + shadeOffset(genomeHue) + 360) % 360;
  return `hsl(${hue},${dark ? 58 : 64}%,${lightnessFor(lineage, dark)}%)`;
}

type OrganismColours = { fill: string; outline: string; fin: string; finEdge: string; stalk: string };

function makeColours(lineage: number, genomeHue: number, dark: boolean): OrganismColours {
  const hue = (Math.round(lineageHue(lineage)) + shadeOffset(genomeHue) + 360) % 360;
  const light = lightnessFor(lineage, dark);
  const sat = dark ? 58 : 64;
  return {
    fill: `hsl(${hue},${sat}%,${light}%)`,
    outline: `hsl(${hue},${sat}%,${dark ? 26 : 20}%)`,
    fin: `hsla(${hue},${sat + 4}%,${light + (dark ? 4 : 8)}%,0.66)`,
    finEdge: `hsla(${hue},${sat}%,${dark ? 80 : 26}%,0.85)`,
    stalk: `hsl(${hue},35%,${dark ? 78 : 28}%)`,
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

export function computeLayout(width: number, height: number, dpr: number, cover = false, camera: Camera = CENTRED): Layout {
  const view = clampCamera({ ...camera }, width, height, cover);
  const scale = baseScale(width, height, cover) * view.zoom;
  return {
    width,
    height,
    dpr,
    scale,
    originX: width / 2 - view.cx * scale,
    originY: height / 2 - view.cy * scale,
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

const SCENT_COLS = 48;
const SCENT_ROWS = 30;
const SCENT_REFRESH_MS = 180;
const SELECTED_TRAIL_POINTS = 140;
const FOLLOW_TRAIL_POINTS = 420;
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
  private boost = 1;
  private trailWorld: WorldView | null = null;
  private trailOwner = -1;
  private trail: Vec2[] = [];

  setPalette(palette: Palette) {
    this.palette = palette;
    this.colours.clear();
    this.water = null;
    this.scentStamp = -Infinity;
  }

  private coloursFor(organism: Organism): OrganismColours {
    const key = `${organism.lineage}:${shadeOffset(organism.genome.hue)}`;
    let colours = this.colours.get(key);
    if (!colours) {
      if (this.colours.size > 1500) this.colours.clear();
      colours = makeColours(organism.lineage, organism.genome.hue, this.palette.dark);
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
    for (let i = 0; i < organisms.length; i++) this.drawOrganism(ctx, organisms[i]);
    if (selected) this.drawRing(ctx, selected, palette.accent, 2.4 / scale, 1);
    if (hovered && hovered !== selected) this.drawRing(ctx, hovered, palette.ink, 1.2 / scale, 0.45);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0, 0, POOL_WIDTH, POOL_HEIGHT);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawScent(ctx: CanvasRenderingContext2D, world: WorldView, now: number) {
    this.refreshScent(world, now);
    if (!this.scentCanvas) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(this.scentCanvas, 0, 0, POOL_WIDTH, POOL_HEIGHT);
  }

  private drawPatches(ctx: CanvasRenderingContext2D, world: WorldView) {
    const patches = (world as { patches?: readonly Patch[] }).patches;
    if (!patches?.length) return;
    ctx.strokeStyle = this.palette.dark ? "rgba(190,255,210,0.14)" : "rgba(20,90,60,0.14)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const patch of patches) {
      ctx.moveTo(patch.position.x + patch.radius, patch.position.y);
      ctx.arc(patch.position.x, patch.position.y, patch.radius, 0, Math.PI * 2);
      ctx.moveTo(patch.position.x + patch.radius * 0.55, patch.position.y);
      ctx.arc(patch.position.x, patch.position.y, patch.radius * 0.55, 0, Math.PI * 2);
    }
    ctx.stroke();
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

  /** Fading wake for the selected organism, from the renderer's own longer record. */
  private drawSelectedTrail(ctx: CanvasRenderingContext2D, organism: Organism) {
    const trail = this.trail;
    const count = trail.length;
    if (count < 2) return;
    ctx.strokeStyle = this.coloursFor(organism).fill;
    ctx.lineWidth = 2.4 * this.boost;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const bands = 28;
    const per = Math.max(1, Math.ceil((count - 1) / bands));
    for (let i = 0; i < count - 1; i += per) {
      const end = Math.min(count - 1, i + per);
      ctx.globalAlpha = 0.08 + 0.72 * (end / count);
      ctx.beginPath();
      ctx.moveTo(trail[i].x, trail[i].y);
      for (let j = i + 1; j <= end; j++) ctx.lineTo(trail[j].x, trail[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawOrganism(ctx: CanvasRenderingContext2D, organism: Organism) {
    const poses = organism.poses;
    if (!poses.length) return;
    const colours = this.coloursFor(organism);
    const fraction = organism.capacity > 0 ? organism.energy / organism.capacity : 1;
    const alpha = Math.max(0.4, Math.min(1, fraction * 1.1));
    paintBody(ctx, organism.genome.parts, poses, organism.senses, colours, this.palette, this.boost, alpha);

    if (organism.age < 1) {
      const root = poses[0];
      const t = organism.age;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = colours.fill;
      ctx.lineWidth = 2 * this.boost;
      ctx.beginPath();
      ctx.arc(root.base.x, root.base.y, 8 + t * 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawRing(ctx: CanvasRenderingContext2D, organism: Organism, colour: string, lineWidth: number, alpha: number) {
    const poses = organism.poses;
    if (!poses.length) return;
    const root = poses[0];
    const cx = (root.base.x + root.tip.x) / 2;
    const cy = (root.base.y + root.tip.y) / 2;
    let radius = 0;
    for (let i = 0; i < poses.length; i++) {
      const dx = poses[i].tip.x - cx;
      const dy = poses[i].tip.y - cy;
      radius = Math.max(radius, Math.hypot(dx, dy));
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.stroke();
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
      ctx.lineWidth = parts[i].width * boost + (pass === 0 ? 2 * Math.sqrt(boost) : 0);
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
    ctx.fillStyle = palette.glow;
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
  const colours = makeColours(options.lineage ?? 0, genome.hue, palette.dark);
  const root = poses[0];
  ctx.save();
  ctx.translate(size / 2 - frame.cx * scale, size / 2 - frame.cy * scale);
  ctx.scale(scale, scale);
  ctx.rotate(-root.heading);
  ctx.translate(-root.base.x, -root.base.y);
  paintBody(ctx, genome.parts, poses, options.senses, colours, palette, 1, 1);
  ctx.restore();
}
