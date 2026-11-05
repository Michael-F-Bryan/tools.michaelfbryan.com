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

/** Mapping from CSS pixels to the letterboxed world. */
export type Layout = {
  width: number;
  height: number;
  dpr: number;
  scale: number;
  originX: number;
  originY: number;
};

export type UiState = {
  selectedId: number | null;
  hoverId: number | null;
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

export function computeLayout(width: number, height: number, dpr: number): Layout {
  const scale = Math.min(width / POOL_WIDTH, height / POOL_HEIGHT) || 1;
  return {
    width,
    height,
    dpr,
    scale,
    originX: (width - POOL_WIDTH * scale) / 2,
    originY: (height - POOL_HEIGHT * scale) / 2,
  };
}

/** CSS pixel offset within the canvas to world units. */
export function toWorld(layout: Layout, x: number, y: number): Vec2 {
  return { x: (x - layout.originX) / layout.scale, y: (y - layout.originY) / layout.scale };
}

type OrganismColours = { fill: string; outline: string; fin: string; finEdge: string; stalk: string };

const SCENT_COLS = 48;
const SCENT_ROWS = 30;
const SCENT_REFRESH_MS = 180;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Draws a `WorldView`. Holds only scratch caches (scent texture, colour strings);
 * the world itself is never mutated.
 */
export class PoolRenderer {
  palette: Palette = readPalette();
  private colours = new Map<number, OrganismColours>();
  private scentCanvas: HTMLCanvasElement | null = null;
  private scentContext: CanvasRenderingContext2D | null = null;
  private scentImage: ImageData | null = null;
  private scentStamp = -Infinity;
  private water: CanvasGradient | null = null;
  private waterOwner: CanvasRenderingContext2D | null = null;
  private point: Vec2 = { x: 0, y: 0 };

  setPalette(palette: Palette) {
    this.palette = palette;
    this.colours.clear();
    this.water = null;
    this.scentStamp = -Infinity;
  }

  private coloursFor(hue: number): OrganismColours {
    const key = Math.round(hue) % 360;
    let colours = this.colours.get(key);
    if (!colours) {
      const dark = this.palette.dark;
      const lightness = dark ? 62 : 44;
      colours = {
        fill: `hsl(${key},55%,${lightness}%)`,
        outline: `hsl(${key},55%,${dark ? 28 : 24}%)`,
        fin: `hsla(${key},60%,${dark ? 64 : 50}%,0.55)`,
        finEdge: `hsla(${key},55%,${dark ? 78 : 30}%,0.7)`,
        stalk: `hsl(${key},35%,${dark ? 75 : 30}%)`,
      };
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

  draw(ctx: CanvasRenderingContext2D, world: WorldView, layout: Layout, ui: UiState, now: number) {
    const palette = this.palette;
    const { dpr, scale } = layout;

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
    for (let i = 0; i < organisms.length; i++) this.drawTrail(ctx, organisms[i], false);
    let selected: Organism | undefined;
    let hovered: Organism | undefined;
    for (let i = 0; i < organisms.length; i++) {
      const organism = organisms[i];
      if (organism.id === ui.selectedId) selected = organism;
      if (organism.id === ui.hoverId) hovered = organism;
      this.drawOrganism(ctx, organism);
    }
    if (selected) {
      this.drawTrail(ctx, selected, true);
      this.drawRing(ctx, selected, palette.accent, 2.2 / scale, 1);
    }
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
    ctx.fillStyle = this.palette.foodHalo;
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const { x, y } = food[i].position;
      ctx.moveTo(x + 4.6, y);
      ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = this.palette.food;
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const { x, y } = food[i].position;
      ctx.moveTo(x + 2, y);
      ctx.arc(x, y, 2, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private drawTrail(ctx: CanvasRenderingContext2D, organism: Organism, strong: boolean) {
    const trail = organism.trail;
    const count = trail.length;
    if (count < 2) return;
    const colours = this.coloursFor(organism.genome.hue);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (strong) {
      ctx.strokeStyle = colours.fill;
      ctx.lineWidth = 2.2;
      const step = Math.max(1, Math.floor(count / 24));
      for (let i = step; i < count; i += step) {
        ctx.globalAlpha = 0.12 + 0.7 * (i / count);
        ctx.beginPath();
        ctx.moveTo(trail[i - step].x, trail[i - step].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    const mid = count >> 1;
    ctx.strokeStyle = colours.fill;
    ctx.lineWidth = 1.4;
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

  private drawOrganism(ctx: CanvasRenderingContext2D, organism: Organism) {
    const parts = organism.genome.parts;
    const poses = organism.poses;
    if (!poses.length) return;
    const colours = this.coloursFor(organism.genome.hue);
    const fraction = organism.capacity > 0 ? organism.energy / organism.capacity : 1;
    const alpha = Math.max(0.35, Math.min(1, fraction * 1.1));
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Membranes first so trunks and stalks sit on top of them.
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind === "fin" && poses[i]) this.drawFin(ctx, parts[i], poses[i], colours);
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind !== "trunk" || !poses[i]) continue;
      const { base, tip } = poses[i];
      ctx.strokeStyle = colours.outline;
      ctx.lineWidth = parts[i].width + 2;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind !== "trunk" || !poses[i]) continue;
      const { base, tip } = poses[i];
      ctx.strokeStyle = colours.fill;
      ctx.lineWidth = parts[i].width;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }

    let sensorIndex = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind !== "sensor") continue;
      const reading = clamp01(organism.senses[sensorIndex++] ?? 0);
      const pose = poses[i];
      if (!pose) continue;
      ctx.strokeStyle = colours.stalk;
      ctx.lineWidth = Math.max(0.8, Math.min(1.6, parts[i].width));
      ctx.beginPath();
      ctx.moveTo(pose.base.x, pose.base.y);
      ctx.lineTo(pose.tip.x, pose.tip.y);
      ctx.stroke();
      ctx.fillStyle = colours.outline;
      ctx.beginPath();
      ctx.arc(pose.tip.x, pose.tip.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * (0.2 + 0.8 * reading);
      ctx.fillStyle = this.palette.glow;
      ctx.beginPath();
      ctx.arc(pose.tip.x, pose.tip.y, 1.6 + reading * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    const root = poses[0];
    ctx.fillStyle = this.palette.mouth;
    ctx.beginPath();
    ctx.arc(root.base.x, root.base.y, Math.max(1.6, parts[0].width * 0.26), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (organism.age < 1) {
      const t = organism.age;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = colours.fill;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(root.base.x, root.base.y, 8 + t * 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawFin(ctx: CanvasRenderingContext2D, part: PartGene, pose: PartPose, colours: OrganismColours) {
    drawMembrane(ctx, part, pose, colours.fin, colours.finEdge);
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

/** Tapered membrane from a narrow base to a wider, rounded tip. */
function drawMembrane(ctx: CanvasRenderingContext2D, part: PartGene, pose: PartPose, fill: string, edge: string) {
  const { base, tip } = pose;
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  const nx = -dy / length;
  const ny = dx / length;
  const baseHalf = Math.max(0.6, part.width * 0.12);
  const tipHalf = Math.max(1.5, part.width * 0.5);
  ctx.fillStyle = fill;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.8;
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

/**
 * Draws a genome's anatomy at rest, centred in a `size` x `size` CSS-pixel box
 * at the context's current transform. The mouth faces right.
 */
export function drawGenomeGlyph(ctx: CanvasRenderingContext2D, genome: Genome, size: number, palette: Palette = readPalette()) {
  const poses = restPoses(genome, Math.PI);
  if (!poses.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pose of poses) {
    for (const p of [pose.base, pose.tip]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 6;
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = (size - pad * 2) / extent;
  ctx.save();
  ctx.translate(size / 2 - ((minX + maxX) / 2) * scale, size / 2 - ((minY + maxY) / 2) * scale);
  ctx.scale(scale, scale);
  const hue = Math.round(genome.hue) % 360;
  const dark = palette.dark;
  const fill = `hsl(${hue},55%,${dark ? 62 : 44}%)`;
  const outline = `hsl(${hue},55%,${dark ? 28 : 24}%)`;
  const fin = `hsla(${hue},60%,${dark ? 64 : 50}%,0.55)`;
  const finEdge = `hsla(${hue},55%,${dark ? 78 : 30}%,0.7)`;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const parts = genome.parts;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind === "fin") drawMembrane(ctx, parts[i], poses[i], fin, finEdge);
  }
  for (const [colour, extra] of [[outline, 2], [fill, 0]] as const) {
    ctx.strokeStyle = colour;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].kind !== "trunk") continue;
      ctx.lineWidth = parts[i].width + extra;
      ctx.beginPath();
      ctx.moveTo(poses[i].base.x, poses[i].base.y);
      ctx.lineTo(poses[i].tip.x, poses[i].tip.y);
      ctx.stroke();
    }
  }
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind !== "sensor") continue;
    ctx.strokeStyle = dark ? "hsl(0,0%,75%)" : "hsl(0,0%,30%)";
    ctx.lineWidth = Math.max(0.8, Math.min(1.6, parts[i].width));
    ctx.beginPath();
    ctx.moveTo(poses[i].base.x, poses[i].base.y);
    ctx.lineTo(poses[i].tip.x, poses[i].tip.y);
    ctx.stroke();
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(poses[i].tip.x, poses[i].tip.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = palette.mouth;
  ctx.beginPath();
  ctx.arc(poses[0].base.x, poses[0].base.y, Math.max(1.6, parts[0].width * 0.26), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
