"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";

import { describeGenome } from "./genome";
import {
  PoolRenderer,
  baseScale,
  clampCamera,
  computeLayout,
  drawAnatomy,
  lineageColour,
  organismColour,
  readPalette,
  toWorld,
  type Camera,
  type Layout,
  type Palette,
  type UiState,
} from "./renderer";
import { DEFAULT_ENVIRONMENT, DT, POOL_HEIGHT, POOL_WIDTH, type Environment, type Genome, type Organism, type Stats, type WorldLike } from "./types";
import { World } from "./world";
import styles from "./pool.module.css";

const SPEEDS = [1, 4, 16] as const;
const MAX_STEPS_PER_FRAME = 16;
const CAPTION_SECONDS = 20;
const PICK_RADIUS = 14;
const TOUCH_PICK_PIXELS = 20;
const DRAG_THRESHOLD = 6;
const FOLLOW_ZOOM = 2;
const CHIP_LIMIT = 12;
const TAKEOVER_SHARE = 0.6;
const DOMINANT_MARK_SHARE = 0.4;
const TICK_MS = 125;
const MIN_INSPECT_AGE = 20;
const EMPTY_AFTER = 10;

/** Engine statistics the UI reads when present; computed here when absent. */
type ExtraStats = { dominantLineage?: number; dominantShare?: number; extinct?: boolean };

type Takeover = { id: number; share: number };
type Readout = { population: number; lineages: number; food: number; clock: string; speed: string; extinct: boolean; takeover: Takeover | null };
type LineageChip = { id: number; count: number };
type Inspected = {
  id: number;
  organism: Organism;
  lineage: number;
  parentLineage: number;
  genomeHue: number;
  generation: number;
  description: string;
  genome: Genome;
  energy: number;
  capacity: number;
  age: number;
  speed: number;
  meals: number;
  offspring: number;
  cause: "alive" | "starved" | "age" | "unknown";
};

const EMPTY_READOUT: Readout = { population: 0, lineages: 0, food: 0, clock: "00:00", speed: "0.0", extinct: false, takeover: null };

const ENVIRONMENT_CONTROLS: readonly {
  key: "foodRate" | "currentStrength" | "temperature" | "viscosity";
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}[] = [
  { key: "foodRate", label: "Food", min: 0, max: 3, step: 0.1, format: (v) => v.toFixed(1) },
  { key: "currentStrength", label: "Current", min: 0, max: 40, step: 1, format: (v) => v.toFixed(0) },
  { key: "temperature", label: "Temperature", min: 0.5, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
  { key: "viscosity", label: "Water thickness", min: 0.5, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
];

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * The best forager among organisms old enough for the rate to mean something
 * (meals per second alive), falling back to the most meals when all are young.
 */
function mostSuccessful(world: WorldLike, lineage?: number): Organism | undefined {
  let veteran: Organism | undefined;
  let veteranRate = -1;
  let fallback: Organism | undefined;
  for (const organism of world.organisms) {
    if (lineage !== undefined && organism.lineage !== lineage) continue;
    if (!fallback || organism.meals > fallback.meals || (organism.meals === fallback.meals && organism.energy > fallback.energy)) fallback = organism;
    if (organism.age <= MIN_INSPECT_AGE) continue;
    const rate = organism.meals / organism.age;
    if (!veteran || rate > veteranRate || (rate === veteranRate && organism.energy > veteran.energy)) {
      veteran = organism;
      veteranRate = rate;
    }
  }
  return veteran ?? fallback;
}

function snapshot(world: WorldLike, id: number, previous: Inspected | null): Inspected | null {
  const organism = world.getOrganism(id);
  if (organism) {
    return {
      id,
      organism,
      lineage: organism.lineage,
      parentLineage: organism.parentLineage,
      genomeHue: organism.genome.hue,
      generation: organism.generation,
      description: previous?.id === id ? previous.description : describeGenome(organism.genome),
      genome: organism.genome,
      energy: organism.energy,
      capacity: organism.capacity,
      age: organism.age,
      speed: Math.hypot(organism.velocity.x, organism.velocity.y),
      meals: organism.meals,
      offspring: organism.offspring,
      cause: "alive",
    };
  }
  if (!previous || previous.id !== id) return null;
  if (previous.cause !== "alive") return previous;
  let cause: Inspected["cause"] = "unknown";
  for (const event of world.events) {
    if (event.kind === "death" && event.organism === id) cause = event.cause;
  }
  return { ...previous, speed: 0, energy: cause === "starved" ? 0 : previous.energy, cause };
}

type ChartColours = { speed: string; lineages: string; population: string; rule: string };

function chartColours(): ChartColours {
  const tokens = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  return {
    speed: token("--accent", "#164dcc"),
    lineages: token("--ink", "#17191d"),
    population: token("--rule", "#848d98"),
    rule: token("--rule-subtle", "#c7ccd2"),
  };
}

/** Population as a faint area, living lineages as a stepped line, mean speed as the accent line; each on its own scale. */
function drawHistory(canvas: HTMLCanvasElement, world: WorldLike, colours: ChartColours) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = colours.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
  const history = world.history;
  if (history.length < 2) return;
  let maxPopulation = 10, maxLineages = 4, maxSpeed = 1;
  for (const entry of history) {
    maxPopulation = Math.max(maxPopulation, entry.population);
    maxLineages = Math.max(maxLineages, entry.lineages);
    maxSpeed = Math.max(maxSpeed, entry.meanSpeed);
  }
  const last = history.length - 1;
  const span = height - 5;
  const px = (i: number) => (i / last) * (width - 2) + 1;
  const py = (value: number, max: number) => height - 2 - (value / max) * span;

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = colours.population;
  ctx.beginPath();
  ctx.moveTo(px(0), height - 1);
  for (let i = 0; i <= last; i++) ctx.lineTo(px(i), py(history[i].population, maxPopulation));
  ctx.lineTo(px(last), height - 1);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = colours.lineages;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (let i = 0; i <= last; i++) {
    const y = py(history[i].lineages, maxLineages);
    if (i === 0) ctx.moveTo(px(0), y);
    else {
      ctx.lineTo(px(i), py(history[i - 1].lineages, maxLineages));
      ctx.lineTo(px(i), y);
    }
  }
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = colours.speed;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= last; i++) {
    const x = px(i), y = py(history[i].meanSpeed, maxSpeed);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** The inspected organism's anatomy, redrawn every frame from its live poses in a head-right frame. */
function Anatomy({ organism, themeVersion }: { organism: Organism; themeVersion: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = canvas.clientWidth || 84;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const palette: Palette = readPalette();
    let frameId = 0;
    const draw = () => {
      frameId = requestAnimationFrame(draw);
      if (document.hidden) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawAnatomy(ctx, organism.genome, size, palette, { poses: organism.poses, senses: organism.senses, lineage: organism.lineage });
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [organism, themeVersion]);
  return <canvas ref={ref} className={styles.glyph} role="img" aria-label="Anatomy" />;
}

export function TidePool() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const inspectButtonRef = useRef<HTMLButtonElement>(null);
  const worldRef = useRef<WorldLike | null>(null);
  const rendererRef = useRef<PoolRenderer | null>(null);
  const layoutRef = useRef<Layout>(computeLayout(POOL_WIDTH, POOL_HEIGHT, 1));
  const sizeRef = useRef({ width: POOL_WIDTH, height: POOL_HEIGHT, dpr: 1, cover: false });
  const cameraRef = useRef<Camera>({ cx: POOL_WIDTH / 2, cy: POOL_HEIGHT / 2, zoom: 1 });
  const panRef = useRef({ cx: POOL_WIDTH / 2, cy: POOL_HEIGHT / 2 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const uiRef = useRef<UiState>({ selectedId: null, hoverId: null, following: false });
  const envRef = useRef<Environment>({ ...DEFAULT_ENVIRONMENT });
  const speedRef = useRef(1);
  const pausedRef = useRef(false);
  const reducedRef = useRef(false);
  const inspectedRef = useRef<Inspected | null>(null);
  const dominantRef = useRef<Takeover | null>(null);
  const chartColoursRef = useRef<ChartColours | null>(null);

  const prefersReducedMotion = useSyncExternalStore(subscribeReducedMotion, () => matchMedia(REDUCED_MOTION).matches, () => false);
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? prefersReducedMotion;
  const [speed, setSpeedState] = useState<number>(1);
  const [envOpen, setEnvOpen] = useState(false);
  const [env, setEnv] = useState<Environment>({ ...DEFAULT_ENVIRONMENT });
  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const [chips, setChips] = useState<{ visible: LineageChip[]; more: number }>({ visible: [], more: 0 });
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [following, setFollowing] = useState(false);
  const [showCaption, setShowCaption] = useState(true);
  const [themeVersion, setThemeVersion] = useState(0);
  const [dark, setDark] = useState(false);
  const idBase = useId();

  useEffect(() => {
    pausedRef.current = paused;
    reducedRef.current = prefersReducedMotion;
  }, [paused, prefersReducedMotion]);

  const refresh = useCallback((level: "inspector" | "readouts" | "chips") => {
    const world = worldRef.current;
    if (!world) return;
    if (uiRef.current.selectedId !== null) {
      const updated = snapshot(world, uiRef.current.selectedId, inspectedRef.current);
      inspectedRef.current = updated;
      setInspected(updated);
      if (updated && updated.cause !== "alive" && uiRef.current.following) {
        panRef.current = { cx: cameraRef.current.cx, cy: cameraRef.current.cy };
        uiRef.current.following = false;
        setFollowing(false);
      }
    }
    if (level === "inspector") return;

    if (level === "chips") {
      const alive = world
        .lineages()
        .filter((lineage) => lineage.count > 0)
        .sort((a, b) => b.count - a.count || a.id - b.id);
      setChips({ visible: alive.slice(0, CHIP_LIMIT).map((lineage) => ({ id: lineage.id, count: lineage.count })), more: Math.max(0, alive.length - CHIP_LIMIT) });
      const population = world.organisms.length;
      dominantRef.current = alive.length && population > 0 ? { id: alive[0].id, share: alive[0].count / population } : null;
    }
    const stats = world.stats as Stats & ExtraStats;
    const population = world.organisms.length;
    const takeover =
      stats.dominantShare !== undefined && stats.dominantLineage !== undefined && stats.dominantShare > 0
        ? { id: stats.dominantLineage, share: stats.dominantShare }
        : dominantRef.current;
    const next: Readout = {
      population,
      lineages: stats.lineages,
      food: world.food.length,
      clock: formatClock(world.time),
      speed: stats.meanSpeed.toFixed(1),
      extinct: stats.extinct ?? (population === 0 && world.time > EMPTY_AFTER),
      takeover: takeover && takeover.share >= DOMINANT_MARK_SHARE ? takeover : null,
    };
    setReadout((prev) =>
      prev.population === next.population &&
      prev.lineages === next.lineages &&
      prev.food === next.food &&
      prev.clock === next.clock &&
      prev.speed === next.speed &&
      prev.extinct === next.extinct &&
      prev.takeover?.id === next.takeover?.id &&
      Math.round((prev.takeover?.share ?? 0) * 100) === Math.round((next.takeover?.share ?? 0) * 100)
        ? prev
        : next,
    );
    setShowCaption(world.time < CAPTION_SECONDS);
    const chart = chartRef.current;
    if (chart) {
      chartColoursRef.current ??= chartColours();
      drawHistory(chart, world, chartColoursRef.current);
    }
  }, []);

  const resetCamera = useCallback(() => {
    cameraRef.current = { cx: POOL_WIDTH / 2, cy: POOL_HEIGHT / 2, zoom: 1 };
    panRef.current = { cx: POOL_WIDTH / 2, cy: POOL_HEIGHT / 2 };
  }, []);

  const setFollow = useCallback((on: boolean) => {
    if (!on) panRef.current = { cx: cameraRef.current.cx, cy: cameraRef.current.cy };
    uiRef.current.following = on;
    setFollowing(on);
  }, []);

  const select = useCallback(
    (id: number | null) => {
      const world = worldRef.current;
      uiRef.current.selectedId = id;
      if (id === null || !world) {
        inspectedRef.current = null;
        setInspected(null);
        setFollow(false);
        return;
      }
      const next = snapshot(world, id, null);
      inspectedRef.current = next;
      setInspected(next);
    },
    [setFollow],
  );

  const startPool = useCallback(() => {
    worldRef.current = new World(newSeed(), { ...envRef.current });
    uiRef.current.hoverId = null;
    dominantRef.current = null;
    resetCamera();
    select(null);
    setShowCaption(true);
    refresh("chips");
  }, [refresh, resetCamera, select]);

  // The simulation loop, drawing and observers. All simulation state lives in refs.
  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!surface || !canvas || !ctx) return;
    const renderer = new PoolRenderer();
    rendererRef.current = renderer;
    startPool();

    let frameId = 0;
    let previous = performance.now();
    let accumulator = 0;
    let disposed = false;

    function resize() {
      if (disposed) return;
      const bounds = surface!.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      // Narrow or portrait canvases fill the view and crop the pool's sides; wide ones show it whole.
      const cover = width <= 720 || height > width;
      sizeRef.current = { width, height, dpr, cover };
      surface!.style.setProperty("--surface-height", `${height}px`);
      // Overlays hug the pool's own corners when it is letterboxed.
      const fit = baseScale(width, height, false);
      surface!.style.setProperty("--pool-x", cover ? "0px" : `${Math.max(0, (width - POOL_WIDTH * fit) / 2)}px`);
      surface!.style.setProperty("--pool-y", cover ? "0px" : `${Math.max(0, (height - POOL_HEIGHT * fit) / 2)}px`);
      layoutRef.current = computeLayout(width, height, dpr, cover, cameraRef.current);
    }
    function retheme() {
      const palette = readPalette();
      renderer.setPalette(palette);
      chartColoursRef.current = chartColours();
      setDark(palette.dark);
      setThemeVersion((version) => version + 1);
    }
    function frame(now: number) {
      frameId = requestAnimationFrame(frame);
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (document.hidden) return;
      const world = worldRef.current;
      if (!world) return;
      if (pausedRef.current) {
        accumulator = 0;
      } else {
        accumulator += elapsed * speedRef.current;
        const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(accumulator / DT + 1e-6));
        accumulator = Math.min(accumulator - steps * DT, DT);
        const started = performance.now();
        for (let i = 0; i < steps; i++) {
          world.step();
          if (performance.now() - started > 28) break;
        }
      }

      // Camera: glide towards the followed organism, or back to the user's pan at whole-pool zoom.
      const ui = uiRef.current;
      const target = ui.following && ui.selectedId !== null ? world.getOrganism(ui.selectedId) : undefined;
      const camera = cameraRef.current;
      const goalX = target ? target.position.x : panRef.current.cx;
      const goalY = target ? target.position.y : panRef.current.cy;
      const goalZoom = target ? FOLLOW_ZOOM : 1;
      const k = reducedRef.current ? 1 : 1 - Math.exp(-elapsed * 5);
      camera.cx += (goalX - camera.cx) * k;
      camera.cy += (goalY - camera.cy) * k;
      camera.zoom += (goalZoom - camera.zoom) * k;
      const size = sizeRef.current;
      clampCamera(camera, size.width, size.height, size.cover);
      layoutRef.current = computeLayout(size.width, size.height, size.dpr, size.cover, camera);
      renderer.draw(ctx!, world, layoutRef.current, ui, now);
    }

    resize();
    retheme();
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(surface);
    const themeObserver = new MutationObserver(retheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", retheme);
    // Inspector values at ~8 Hz, HUD and chart at ~4 Hz, lineage chips at ~1 Hz.
    let ticks = 0;
    const readouts = window.setInterval(() => {
      ticks += 1;
      refresh(ticks % 8 === 0 ? "chips" : ticks % 2 === 0 ? "readouts" : "inspector");
    }, TICK_MS);
    frameId = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearInterval(readouts);
      sizeObserver.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener("change", retheme);
      worldRef.current = null;
      rendererRef.current = null;
    };
  }, [refresh, startPool]);

  function worldPoint(event: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const point = toWorld(layoutRef.current, event.clientX - rect.left, event.clientY - rect.top);
    return point.x >= 0 && point.y >= 0 && point.x <= POOL_WIDTH && point.y <= POOL_HEIGHT ? point : null;
  }

  function pickRadius() {
    return Math.max(PICK_RADIUS, (sizeRef.current.cover ? TOUCH_PICK_PIXELS : 0) / layoutRef.current.scale);
  }

  function onCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const world = worldRef.current;
    const point = world && worldPoint(event);
    if (!world || !point) return;
    const hit = world.organismAt(point, pickRadius());
    if (hit) select(hit.id);
    else world.dropFood(point);
    refresh("readouts");
  }

  function onCanvasDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    suppressClickRef.current = false;
    const camera = cameraRef.current;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy, moved: false };
  }

  function onCanvasMove(event: PointerEvent<HTMLCanvasElement>) {
    const world = worldRef.current;
    if (!world) return;
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        drag.moved = true;
        suppressClickRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (drag.moved && !uiRef.current.following) {
        const camera = cameraRef.current;
        const size = sizeRef.current;
        const scale = layoutRef.current.scale;
        const view = clampCamera({ cx: drag.cx - dx / scale, cy: drag.cy - dy / scale, zoom: camera.zoom }, size.width, size.height, size.cover);
        panRef.current = { cx: view.cx, cy: view.cy };
        camera.cx = view.cx;
        camera.cy = view.cy;
      }
      return;
    }
    if (event.pointerType !== "mouse") return;
    const point = worldPoint(event);
    const hit = point ? world.organismAt(point, pickRadius()) : undefined;
    uiRef.current.hoverId = hit?.id ?? null;
    event.currentTarget.style.cursor = hit ? "pointer" : "";
  }

  function onCanvasUp(event: PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function onCanvasLeave(event: PointerEvent<HTMLCanvasElement>) {
    uiRef.current.hoverId = null;
    event.currentTarget.style.cursor = "";
  }

  function chooseSpeed(value: number) {
    speedRef.current = value;
    setSpeedState(value);
  }

  function inspectBest() {
    const world = worldRef.current;
    const best = world && mostSuccessful(world);
    if (best) select(best.id);
  }

  function selectLineage(id: number) {
    const world = worldRef.current;
    const member = world && mostSuccessful(world, id);
    if (member) select(member.id);
  }

  function changeEnvironment(key: (typeof ENVIRONMENT_CONTROLS)[number]["key"], value: number) {
    const patch = { [key]: value } as Partial<Environment>;
    envRef.current = { ...envRef.current, ...patch };
    worldRef.current?.setEnvironment(patch);
    setEnv(envRef.current);
  }

  function closeInspector() {
    select(null);
    inspectButtonRef.current?.focus();
  }

  const selectedLineage = inspected?.lineage;
  const energyShare = inspected && inspected.capacity > 0 ? Math.max(0, Math.min(1, inspected.energy / inspected.capacity)) : 0;
  const mealsPerMinute = inspected && inspected.age >= 1 ? ((inspected.meals / inspected.age) * 60).toFixed(1) : "–";
  const takeover = readout.takeover && readout.takeover.share >= TAKEOVER_SHARE ? readout.takeover : null;

  return (
    <div className={styles.pool}>
      <div ref={surfaceRef} className={styles.surface}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="Tide pool simulation"
          data-pool-canvas=""
          onClick={onCanvasClick}
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerCancel={onCanvasUp}
          onPointerLeave={onCanvasLeave}
        />
        <div className={styles.hud}>
          <dl className={styles.stats}>
            <div>
              <dt>Population</dt>
              <dd data-stat="population">{readout.population}</dd>
            </div>
            <div>
              <dt>Lineages</dt>
              <dd data-stat="lineages">{readout.lineages}</dd>
            </div>
            <div>
              <dt>Food</dt>
              <dd data-stat="food">{readout.food}</dd>
            </div>
            <div>
              <dt>Clock</dt>
              <dd data-stat="clock">{readout.clock}</dd>
            </div>
          </dl>
          {takeover ? (
            <p className={styles.takeover} data-takeover="">
              <span className={styles.swatch} style={{ background: lineageColour(takeover.id, dark) }} aria-hidden="true" />
              Lineage {takeover.id} · {Math.round(takeover.share * 100)}% of the pool
            </p>
          ) : null}
          {showCaption ? <p className={styles.caption}>Seeded with random bodies. What survives is what breeds.</p> : null}
        </div>
        {readout.extinct ? (
          <div className={styles.notice} role="status">
            <p>The pool is empty.</p>
            <button type="button" className={styles.button} onClick={startPool}>
              New pool
            </button>
          </div>
        ) : null}
        <div className={styles.dock}>
          {envOpen ? (
            <div id={`${idBase}-environment`} className={styles.environment} role="group" aria-label="Environment">
              {ENVIRONMENT_CONTROLS.map((control) => {
                const id = `${idBase}-${control.key}`;
                return (
                  <div key={control.key} className={styles.slider}>
                    <label htmlFor={id}>{control.label}</label>
                    <input
                      id={id}
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={env[control.key]}
                      onChange={(event) => changeEnvironment(control.key, Number(event.currentTarget.value))}
                    />
                    <output htmlFor={id}>{control.format(env[control.key])}</output>
                  </div>
                );
              })}
            </div>
          ) : null}
          {inspected ? (
            <section className={styles.inspector} role="region" aria-label="Inspector" onKeyDown={(event) => event.key === "Escape" && closeInspector()}>
              <header>
                <span className={styles.swatch} style={{ background: organismColour(inspected.lineage, inspected.genomeHue, dark) }} aria-hidden="true" />
                <h2>
                  Organism {inspected.id}
                  <small> · lineage {inspected.lineage}</small>
                </h2>
                <button type="button" className={styles.button} aria-pressed={following} disabled={inspected.cause !== "alive"} onClick={() => setFollow(!following)}>
                  Follow
                </button>
                <button type="button" className={styles.button} onClick={closeInspector}>
                  Close
                </button>
              </header>
              <div className={styles.inspectorBody}>
                <Anatomy organism={inspected.organism} themeVersion={themeVersion} />
                <div className={styles.details}>
                  <p className={styles.description}>
                    {inspected.description}
                    {inspected.cause === "alive" ? null : (
                      <strong className={styles.died}> · {inspected.cause === "age" ? "died (old age)" : inspected.cause === "starved" ? "died (starved)" : "died"}</strong>
                    )}
                  </p>
                  <div
                    className={styles.energy}
                    role="meter"
                    aria-label="Energy"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(inspected.capacity)}
                    aria-valuenow={Math.round(inspected.energy)}
                  >
                    <span style={{ width: `${energyShare * 100}%` }} />
                  </div>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Speed</dt>
                      <dd>{inspected.speed.toFixed(1)} u/s</dd>
                    </div>
                    <div>
                      <dt>Meals/min</dt>
                      <dd>{mealsPerMinute}</dd>
                    </div>
                    <div>
                      <dt>Energy</dt>
                      <dd>
                        {Math.round(inspected.energy)}/{Math.round(inspected.capacity)}
                      </dd>
                    </div>
                    <div>
                      <dt>Age</dt>
                      <dd>{inspected.age.toFixed(0)} s</dd>
                    </div>
                    <div>
                      <dt>Meals</dt>
                      <dd>{inspected.meals}</dd>
                    </div>
                    <div>
                      <dt>Offspring</dt>
                      <dd>{inspected.offspring}</dd>
                    </div>
                    <div>
                      <dt>Generation</dt>
                      <dd>{inspected.generation}</dd>
                    </div>
                    <div>
                      <dt>Parent lineage</dt>
                      <dd>
                        {inspected.parentLineage >= 0 ? (
                          <>
                            <span className={styles.swatch} style={{ background: lineageColour(inspected.parentLineage, dark) }} aria-hidden="true" /> {inspected.parentLineage}
                          </>
                        ) : (
                          "seed"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {chips.visible.length ? (
        <div className={styles.lineages} role="group" aria-label="Lineages">
          {chips.visible.map((lineage, index) => {
            const dominant = index === 0 && readout.takeover?.id === lineage.id;
            return (
              <button
                key={lineage.id}
                type="button"
                className={styles.chip}
                data-dominant={dominant ? "" : undefined}
                aria-pressed={selectedLineage === lineage.id}
                aria-label={`Lineage ${lineage.id}, ${lineage.count} alive${dominant ? ", dominant" : ""}`}
                onClick={() => selectLineage(lineage.id)}
              >
                <span className={styles.swatch} style={{ background: lineageColour(lineage.id, dark) }} aria-hidden="true" />
                <span className={styles.chipId}>{lineage.id}</span>
                <span className={styles.chipCount}>×{lineage.count}</span>
              </button>
            );
          })}
          {chips.more > 0 ? (
            <span className={styles.more} aria-label={`${chips.more} more lineages`}>
              +{chips.more}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.button}
          aria-pressed={paused}
          onClick={() => {
            pausedRef.current = !paused;
            setUserPaused(!paused);
            refresh("readouts");
          }}
        >
          {paused ? "Play" : "Pause"}
        </button>
        <div className={styles.segmented} role="group" aria-label="Speed">
          {SPEEDS.map((value) => (
            <button key={value} type="button" className={styles.button} aria-pressed={speed === value} onClick={() => chooseSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
        <button type="button" className={styles.button} onClick={startPool}>
          New pool
        </button>
        <button ref={inspectButtonRef} type="button" className={styles.button} disabled={readout.extinct} onClick={inspectBest}>
          Inspect
        </button>
        <button
          type="button"
          className={styles.button}
          aria-expanded={envOpen}
          aria-controls={envOpen ? `${idBase}-environment` : undefined}
          onClick={() => setEnvOpen(!envOpen)}
        >
          Environment
        </button>
        <div className={styles.chart}>
          <canvas ref={chartRef} className={styles.chartCanvas} role="img" aria-label="History of mean speed, living lineages and population" />
          <div className={styles.legend} aria-hidden="true">
            <span data-series="speed">speed {readout.speed}</span>
            <span data-series="lineages">lineages {readout.lineages}</span>
            <span data-series="population">pop {readout.population}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
