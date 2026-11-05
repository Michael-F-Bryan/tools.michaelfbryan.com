"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";

import { describeGenome } from "./genome";
import { PoolRenderer, computeLayout, drawGenomeGlyph, readPalette, toWorld, type Layout, type UiState } from "./renderer";
import { DEFAULT_ENVIRONMENT, DT, POOL_HEIGHT, POOL_WIDTH, type Environment, type Genome, type WorldLike } from "./types";
import { World } from "./world";
import styles from "./pool.module.css";

const SPEEDS = [1, 4, 16] as const;
const MAX_STEPS_PER_FRAME = 16;
const CAPTION_SECONDS = 20;
const PICK_RADIUS = 14;

type Readout = { population: number; lineages: number; food: number; clock: string };
type LineageChip = { id: number; hue: number; count: number };
type Inspected = {
  id: number;
  lineage: number;
  hue: number;
  generation: number;
  description: string;
  genome: Genome;
  energy: number;
  capacity: number;
  age: number;
  meals: number;
  offspring: number;
  cause: "alive" | "starved" | "age" | "unknown";
};

const EMPTY_READOUT: Readout = { population: 0, lineages: 0, food: 0, clock: "00:00" };

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

function swatch(hue: number): string {
  return `hsl(${Math.round(hue)}, 55%, 50%)`;
}

function mostSuccessful(world: WorldLike, lineage?: number) {
  let best;
  for (const organism of world.organisms) {
    if (lineage !== undefined && organism.lineage !== lineage) continue;
    if (!best || organism.meals > best.meals || (organism.meals === best.meals && organism.energy > best.energy)) best = organism;
  }
  return best;
}

function snapshot(world: WorldLike, id: number, previous: Inspected | null): Inspected | null {
  const organism = world.getOrganism(id);
  if (organism) {
    return {
      id,
      lineage: organism.lineage,
      hue: organism.genome.hue,
      generation: organism.generation,
      description: previous?.id === id ? previous.description : describeGenome(organism.genome),
      genome: organism.genome,
      energy: organism.energy,
      capacity: organism.capacity,
      age: organism.age,
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
  return { ...previous, energy: cause === "starved" ? 0 : previous.energy, cause };
}

function drawSparkline(canvas: HTMLCanvasElement, world: WorldLike, accent: string, muted: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const history = world.history;
  ctx.strokeStyle = muted;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (history.length < 2) return;
  let max = 1;
  for (const entry of history) max = Math.max(max, entry.population);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  const last = history.length - 1;
  for (let i = 0; i <= last; i++) {
    const x = (i / last) * (width - 2) + 1;
    const y = height - 2 - (history[i].population / max) * (height - 5);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function Glyph({ genome, themeVersion }: { genome: Genome; themeVersion: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = canvas.clientWidth || 84;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawGenomeGlyph(ctx, genome, size, readPalette());
  }, [genome, themeVersion]);
  return <canvas ref={ref} className={styles.glyph} role="img" aria-label="Anatomy" />;
}

export function TidePool() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const inspectButtonRef = useRef<HTMLButtonElement>(null);
  const worldRef = useRef<WorldLike | null>(null);
  const rendererRef = useRef<PoolRenderer | null>(null);
  const layoutRef = useRef<Layout>(computeLayout(POOL_WIDTH, POOL_HEIGHT, 1));
  const uiRef = useRef<UiState>({ selectedId: null, hoverId: null });
  const envRef = useRef<Environment>({ ...DEFAULT_ENVIRONMENT });
  const speedRef = useRef(1);
  const pausedRef = useRef(false);
  const inspectedRef = useRef<Inspected | null>(null);

  const prefersReducedMotion = useSyncExternalStore(subscribeReducedMotion, () => matchMedia(REDUCED_MOTION).matches, () => false);
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? prefersReducedMotion;
  const [speed, setSpeedState] = useState<number>(1);
  const [envOpen, setEnvOpen] = useState(false);
  const [env, setEnv] = useState<Environment>({ ...DEFAULT_ENVIRONMENT });
  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const [lineages, setLineages] = useState<LineageChip[]>([]);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [showCaption, setShowCaption] = useState(true);
  const [themeVersion, setThemeVersion] = useState(0);
  const idBase = useId();

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const refresh = useCallback((full: boolean) => {
    const world = worldRef.current;
    if (!world) return;
    const next: Readout = {
      population: world.organisms.length,
      lineages: world.stats.lineages,
      food: world.food.length,
      clock: formatClock(world.time),
    };
    setReadout((prev) => (prev.population === next.population && prev.lineages === next.lineages && prev.food === next.food && prev.clock === next.clock ? prev : next));
    setShowCaption(world.time < CAPTION_SECONDS);
    if (uiRef.current.selectedId !== null) {
      const updated = snapshot(world, uiRef.current.selectedId, inspectedRef.current);
      inspectedRef.current = updated;
      setInspected(updated);
    }
    if (full) {
      const chips = world
        .lineages()
        .filter((lineage) => lineage.count > 0)
        .sort((a, b) => b.count - a.count || a.id - b.id)
        .slice(0, 16)
        .map((lineage) => ({ id: lineage.id, hue: lineage.hue, count: lineage.count }));
      setLineages(chips);
    }
    const spark = sparkRef.current;
    if (spark) {
      const tokens = getComputedStyle(document.documentElement);
      drawSparkline(spark, world, tokens.getPropertyValue("--accent").trim() || "#164dcc", tokens.getPropertyValue("--rule").trim() || "#848d98");
    }
  }, []);

  const select = useCallback((id: number | null) => {
    const world = worldRef.current;
    uiRef.current.selectedId = id;
    if (id === null || !world) {
      inspectedRef.current = null;
      setInspected(null);
      return;
    }
    const next = snapshot(world, id, null);
    inspectedRef.current = next;
    setInspected(next);
  }, []);

  const startPool = useCallback(() => {
    worldRef.current = new World(newSeed(), { ...envRef.current });
    uiRef.current.hoverId = null;
    select(null);
    setShowCaption(true);
    refresh(true);
  }, [refresh, select]);

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
      layoutRef.current = computeLayout(width, height, dpr);
    }
    function retheme() {
      renderer.setPalette(readPalette());
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
      renderer.draw(ctx!, world, layoutRef.current, uiRef.current, now);
    }

    resize();
    retheme();
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(surface);
    const themeObserver = new MutationObserver(retheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", retheme);
    let ticks = 0;
    const readouts = window.setInterval(() => refresh(++ticks % 4 === 0), 250);
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

  function onCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    const world = worldRef.current;
    const point = world && worldPoint(event);
    if (!world || !point) return;
    const hit = world.organismAt(point, PICK_RADIUS);
    if (hit) select(hit.id);
    else world.dropFood(point);
    refresh(false);
  }

  function onCanvasMove(event: PointerEvent<HTMLCanvasElement>) {
    const world = worldRef.current;
    if (!world || event.pointerType !== "mouse") return;
    const point = worldPoint(event);
    const hit = point ? world.organismAt(point, PICK_RADIUS) : undefined;
    uiRef.current.hoverId = hit?.id ?? null;
    event.currentTarget.style.cursor = hit ? "pointer" : "";
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
          onPointerMove={onCanvasMove}
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
          {showCaption ? <p className={styles.caption}>Seeded with random bodies. What survives is what breeds.</p> : null}
        </div>
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
                <span className={styles.swatch} style={{ background: swatch(inspected.hue) }} aria-hidden="true" />
                <h2>
                  Organism {inspected.id}
                  <small> · lineage {inspected.lineage}</small>
                </h2>
                <button type="button" className={styles.button} onClick={closeInspector}>
                  Close
                </button>
              </header>
              <div className={styles.inspectorBody}>
                <Glyph genome={inspected.genome} themeVersion={themeVersion} />
                <div>
                  <p className={styles.description}>{inspected.description}</p>
                  {inspected.cause === "alive" ? null : (
                    <p className={styles.died}>{inspected.cause === "age" ? "died (old age)" : inspected.cause === "starved" ? "died (starved)" : "died"}</p>
                  )}
                </div>
              </div>
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
                  <dt>Generation</dt>
                  <dd>{inspected.generation}</dd>
                </div>
                <div>
                  <dt>Energy</dt>
                  <dd>
                    {Math.round(inspected.energy)} / {Math.round(inspected.capacity)}
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
              </dl>
            </section>
          ) : null}
        </div>
      </div>
      {lineages.length ? (
        <div className={styles.lineages} role="group" aria-label="Lineages">
          {lineages.map((lineage) => (
            <button
              key={lineage.id}
              type="button"
              className={styles.chip}
              aria-pressed={selectedLineage === lineage.id}
              aria-label={`Lineage ${lineage.id}, ${lineage.count} alive`}
              onClick={() => selectLineage(lineage.id)}
            >
              <span className={styles.swatch} style={{ background: swatch(lineage.hue) }} aria-hidden="true" />
              {lineage.count}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.bar}>
        <button type="button" className={styles.button} aria-pressed={paused} onClick={() => {
            pausedRef.current = !paused;
            setUserPaused(!paused);
            refresh(false);
          }}>
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
        <button ref={inspectButtonRef} type="button" className={styles.button} onClick={inspectBest}>
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
        <canvas ref={sparkRef} className={styles.spark} role="img" aria-label="Population history" />
      </div>
    </div>
  );
}
