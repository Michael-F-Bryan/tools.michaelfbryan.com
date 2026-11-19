"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { Label } from "@/components/label";

import { Controls, corneringOf, mergingOf, Presets, trackOf } from "./controls";
import { kmh, metres, seconds, signed, toDisplay } from "./format";
import { createHistory, noteChange, recordSample, syncInterventions, type History } from "./history";
import { createHistoryFeed, HistoryView, Sparkline } from "./history-view";
import { ACCEPTABLE_BRAKING_SLIDER, COOPERATION_SLIDER, CORNERING_SLIDER, DEFAULT_CONFIG, DRIVER_SLIDERS, VARIATION_SLIDER } from "./parameters";
import { createRingPainter, RingView } from "./ring-view";
import { createSimulation, holdBrake, readCar, releaseBrake, setCornering, setDrivers, setMerging, stepSimulation, summarise, tapBrake } from "./simulation";
import { MAX_SPEED, SPEED_TICKS_KMH, speedFraction, speedGradient } from "./speed-scale";
import styles from "./experiment.module.css";
import type { CarReadout, DriverParamKey, ExperimentConfig, Simulation, SimulationStatus, SliderSpec, TrafficSummary } from "./types";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const PLAYBACK_RATES: readonly { rate: number; label: string; name: string }[] = [
  { rate: 0.25, label: "¼×", name: "Quarter speed" },
  { rate: 1, label: "1×", name: "Real time" },
  { rate: 4, label: "4×", name: "Four times speed" },
  { rate: 16, label: "16×", name: "Sixteen times speed" },
];

/** Real seconds a single frame may account for, so a background tab can't spiral into catch-up. */
const MAX_FRAME_SECONDS = 0.1;
/**
 * Real milliseconds of stepping one frame may spend. Past it the frame paints
 * and any backlog is dropped: a device that can't keep up runs the model
 * slower than asked, never with skipped or longer steps.
 */
const STEP_BUDGET_MS = 7;
/** Simulated seconds "Run ahead" adds, in whole steps. */
const RUN_AHEAD_SECONDS = 60;
/** Simulated seconds per real second while running ahead: 60 s reads as a one-second fast-forward, not a jump cut. */
const RUN_AHEAD_RATE = 60;
/** How often the numeric readouts refresh, s of real time. */
const READOUT_SECONDS = 0.125;

/** Fixed top of the speed-spread sparkline, m/s (40 km/h): a jam spreads speeds by roughly half of this. */
const MAX_SPREAD = MAX_SPEED / 2;

/** Short names for change markers on the history. */
const CHANGE_NAMES: Record<DriverParamKey, string> = {
  desiredSpeed: "desired speed",
  timeGap: "time gap",
  reactionDelay: "delay",
  maxAcceleration: "accel.",
  comfortableBraking: "braking",
};

function describeChange(name: string, spec: SliderSpec) {
  const unit = spec.unit === "%" ? "%" : ` ${spec.unit}`;
  return (from: number, to: number) => `${name} ${toDisplay(spec, from)} → ${toDisplay(spec, to)}${unit}`;
}

type Run = Readonly<{ sim: Simulation; history: History }>;

function startRun(config: ExperimentConfig): Run {
  const sim = createSimulation(config);
  return { sim, history: createHistory(sim) };
}

/** A run-ahead in progress: the run it belongs to and the step count it stops at. */
type Ahead = Readonly<{ sim: Simulation; target: number }>;

type Snapshot = Readonly<{ time: number; summary: TrafficSummary; car: CarReadout; status: SimulationStatus }>;

function snapshotOf(sim: Simulation, car: number): Snapshot {
  return { time: sim.time, summary: summarise(sim), car: readCar(sim, car), status: sim.status };
}

/** "22 km/h · gap 11.8 m": left-aligned with tabular digits, so only the tail moves as the numbers change. */
function carLine(car: CarReadout): string {
  return `${Math.round(car.speed * 3.6)} km/h · gap ${metres(car.gap)}`;
}

/** The experimenter's override on one car, as one value. A frozen run has nothing acting on it. */
function brakeState(car: CarReadout, running: boolean): "off" | "tap" | "held" {
  if (!running) return "off";
  if (car.brakeHeld) return "held";
  return car.tapActive ? "tap" : "off";
}

/** The car followed when the page opens: the one the default experiment taps, so the tap happens where the reader is looking. */
const FIRST_CAR = DEFAULT_CONFIG.scheduledTap?.car ?? 0;

/** A hold in force, by whoever holds it: a pointer on a car (`p<pointerId>`) or the brake button (`button`). */
type Hold = Readonly<{ sim: Simulation; car: number }>;

const isActivationKey = (key: string) => key === " " || key === "Enter";

function statusMessage(status: SimulationStatus): string {
  if (status.kind === "collision") {
    return `Car ${status.follower + 1} ran into car ${status.leader + 1} at t = ${seconds(status.time)}. The run is frozen at that moment.`;
  }
  if (status.kind === "invalid") {
    return `The simulation stopped at t = ${seconds(status.time)}: ${status.reason}. The run is frozen at that moment.`;
  }
  return "";
}

export function Experiment() {
  const prefersReducedMotion = useSyncExternalStore(subscribeReducedMotion, () => matchMedia(REDUCED_MOTION).matches, () => false);
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? prefersReducedMotion;
  const [rate, setRate] = useState(1);
  const [config, setConfig] = useState<ExperimentConfig>(DEFAULT_CONFIG);
  const [{ sim, history }, setRun] = useState(() => startRun(DEFAULT_CONFIG));
  const [feed] = useState(createHistoryFeed);
  const [selected, setSelected] = useState(FIRST_CAR);
  const [snapshot, setSnapshot] = useState(() => snapshotOf(sim, FIRST_CAR));
  const [ahead, setAhead] = useState(false);
  const [watch, setWatch] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const watchRef = useRef<HTMLButtonElement>(null);
  /** What the playback loop reads each frame without restarting. */
  const playbackRef = useRef({ paused, rate, selected });
  /** Set by "Run ahead", cleared by the loop when it is done and by anything that cancels it. */
  const aheadRef = useRef<Ahead | null>(null);
  /** Every hold the reader has in force, and the cars they hold on the current run (what the painter marks as held). */
  const holdsRef = useRef(new Map<string, Hold>());
  const pressedRef = useRef<ReadonlySet<number>>(new Set());
  /** The brake button is being pressed (pointer or key); its own click is then not a separate tap. */
  const buttonDownRef = useRef(false);
  const swallowClickRef = useRef(false);

  useEffect(() => {
    playbackRef.current = { paused, rate, selected };
  }, [paused, rate, selected]);

  // The fixed-step loop: real time × playback rate is spent in whole `dt` steps,
  // so a run is identical whatever the frame rate or rate. Pausing stops
  // stepping, not drawing. Running ahead is the same loop at a high rate up to
  // a fixed step count, so it is exactly the run ordinary play would give.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const painter = createRingPainter(svg, sim, MAX_SPEED, (car) => pressedRef.current.has(car) && sim.status.kind === "running" && readCar(sim, car).brakeHeld);
    let frameId = 0;
    let previous = performance.now();
    let pending = 0;
    let sinceReadout = 0;
    let shownSteps = sim.steps;

    /** Up to `steps` model steps within the frame's budget; false if the budget ran out first. */
    function advance(steps: number, started: number): boolean {
      let sampled = false;
      let marked = false;
      let within = true;
      // Record inside the step loop so a fast frame never skips a sample point.
      for (let step = 0; step < steps && sim.status.kind === "running"; step += 1) {
        if (performance.now() - started > STEP_BUDGET_MS) {
          within = false;
          break;
        }
        stepSimulation(sim);
        // Every step, so a scheduled tap is marked where it happened (to within one step).
        if (syncInterventions(history, sim)) marked = true;
        if (recordSample(history, sim)) sampled = true;
      }
      if (sampled || marked) feed.notify();
      return within;
    }

    function frame(now: number) {
      frameId = requestAnimationFrame(frame);
      const real = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - previous) / 1000));
      previous = now;
      const playback = playbackRef.current;
      const fastForward = aheadRef.current?.sim === sim ? aheadRef.current : null;
      let flush = false;
      if (fastForward && sim.status.kind === "running") {
        pending += real * RUN_AHEAD_RATE;
        const steps = Math.min(fastForward.target - sim.steps, Math.max(1, Math.floor(pending / sim.dt + 1e-9)));
        pending = Math.max(0, pending - steps * sim.dt);
        if (!advance(steps, performance.now())) pending = 0;
      } else if (!playback.paused && sim.status.kind === "running") {
        pending += real * playback.rate;
        const steps = Math.floor(pending / sim.dt + 1e-9);
        pending -= steps * sim.dt;
        if (!advance(steps, performance.now())) pending = 0;
      } else {
        pending = 0;
      }
      if (fastForward && (sim.steps >= fastForward.target || sim.status.kind !== "running")) {
        // Done (or frozen): hand back to whatever playback the reader had chosen.
        aheadRef.current = null;
        pending = 0;
        flush = true;
        setAhead(false);
      }
      painter.paint();
      sinceReadout += real;
      if (sim.steps !== shownSteps && (sinceReadout >= READOUT_SECONDS || flush || sim.status.kind !== "running")) {
        sinceReadout = 0;
        shownSteps = sim.steps;
        setSnapshot(snapshotOf(sim, playback.selected));
      }
    }

    painter.paint();
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      if (aheadRef.current?.sim === sim) aheadRef.current = null;
    };
  }, [sim, history, feed]);

  // Entering the watch view, bring the (now larger) ring and its transport into view together.
  useEffect(() => {
    const ring = ringRef.current;
    const transport = transportRef.current;
    if (!watch || !ring || !transport) return;
    const top = ring.getBoundingClientRect().top;
    const bottom = transport.getBoundingClientRect().bottom;
    if (top < 0 || bottom > innerHeight) window.scrollBy({ top: top - 8, behavior: "instant" });
  }, [watch]);

  /** After an explicit action: mark it on the history and refresh the readouts now, even while paused. */
  const afterAction = useCallback(() => {
    syncInterventions(history, sim);
    feed.notify();
    setSnapshot(snapshotOf(sim, playbackRef.current.selected));
  }, [sim, history, feed]);

  const startHold = useCallback(
    (key: string, car: number): boolean => {
      if (sim.status.kind !== "running") return false;
      holdsRef.current.set(key, { sim, car });
      pressedRef.current = new Set([...holdsRef.current.values()].filter((hold) => hold.sim === sim).map((hold) => hold.car));
      holdBrake(sim, car);
      afterAction();
      return true;
    },
    [sim, afterAction],
  );

  const endHold = useCallback(
    (key: string) => {
      const hold = holdsRef.current.get(key);
      if (!hold) return;
      holdsRef.current.delete(key);
      const others = [...holdsRef.current.values()];
      // Two presses on one car: the brake stays held until the last lets go.
      if (!others.some((other) => other.sim === hold.sim && other.car === hold.car)) releaseBrake(hold.sim, hold.car);
      pressedRef.current = new Set(others.filter((other) => other.sim === sim).map((other) => other.car));
      afterAction();
    },
    [sim, afterAction],
  );

  /** Let go of everything: the window lost focus, the tab was hidden, the run froze or is being replaced. */
  const endAll = useCallback(() => {
    buttonDownRef.current = false;
    for (const key of [...holdsRef.current.keys()]) endHold(key);
  }, [endHold]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") endAll();
    };
    window.addEventListener("blur", endAll);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", endAll);
      document.removeEventListener("visibilitychange", hidden);
      endAll();
    };
  }, [endAll]);

  const onHoldStart = useCallback((car: number, pointerId: number) => startHold(`p${pointerId}`, car), [startHold]);
  const onHoldEnd = useCallback((pointerId: number) => endHold(`p${pointerId}`), [endHold]);

  const restart = useCallback((next: ExperimentConfig, car = 0) => {
    endAll();
    aheadRef.current = null;
    setAhead(false);
    const fresh = startRun(next);
    const keep = car < fresh.sim.carCount ? car : 0;
    setConfig(next);
    setRun(fresh);
    setSelected(keep);
    setSnapshot(snapshotOf(fresh.sim, keep));
  }, [endAll]);

  const select = useCallback(
    (car: number) => {
      setSelected(car);
      setSnapshot(snapshotOf(sim, car));
    },
    [sim],
  );

  function changeDriver(key: DriverParamKey, si: number) {
    const next = { ...config, driver: { ...config.driver, [key]: si } };
    setConfig(next);
    setDrivers(sim, next.driver, next.variation);
    noteChange(history, { time: sim.time, key, from: config.driver[key], to: si, describe: describeChange(CHANGE_NAMES[key], DRIVER_SLIDERS[key]) }, performance.now());
    feed.notify();
    setSnapshot(snapshotOf(sim, selected));
  }

  function changeVariation(variation: number) {
    setConfig({ ...config, variation });
    setDrivers(sim, config.driver, variation);
    noteChange(history, { time: sim.time, key: "variation", from: config.variation, to: variation, describe: describeChange("variation", VARIATION_SLIDER) }, performance.now());
    feed.notify();
    setSnapshot(snapshotOf(sim, selected));
  }

  function changeCornering(lateral: number) {
    const from = corneringOf(config);
    setConfig({ ...config, cornering: lateral });
    setCornering(sim, lateral);
    noteChange(history, { time: sim.time, key: "cornering", from, to: lateral, describe: describeChange("cornering", CORNERING_SLIDER) }, performance.now());
    feed.notify();
    setSnapshot(snapshotOf(sim, selected));
  }

  function changeMerging(key: "cooperation" | "acceptableBraking", value: number) {
    const current = mergingOf(config);
    const next = { ...current, [key]: value };
    setConfig({ ...config, merging: next });
    setMerging(sim, next);
    const spec = key === "cooperation" ? COOPERATION_SLIDER : ACCEPTABLE_BRAKING_SLIDER;
    noteChange(history, { time: sim.time, key, from: current[key], to: value, describe: describeChange(key === "cooperation" ? "cooperation" : "merge braking", spec) }, performance.now());
    feed.notify();
    setSnapshot(snapshotOf(sim, selected));
  }

  /*
   * The brake button is press-and-hold too: pointer or Space/Enter down holds
   * the selected car's brake, up lets go (a quick press is one tap's worth).
   * A click with no press before it (assistive tech, element.click()) is one tap.
   */
  function brakeDown() {
    if (buttonDownRef.current) return;
    buttonDownRef.current = true;
    swallowClickRef.current = true;
    startHold("button", selected);
  }

  function brakeUp() {
    if (!buttonDownRef.current) return;
    buttonDownRef.current = false;
    endHold("button");
    // The click that follows this release (same task) belongs to the press.
    setTimeout(() => {
      swallowClickRef.current = false;
    }, 0);
  }

  function brakePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not an active pointer; pointerup on the button still ends it.
    }
    brakeDown();
  }

  function brakeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    if (!event.repeat) brakeDown();
  }

  function brakeKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    brakeUp();
  }

  function brakeClick() {
    if (swallowClickRef.current) return;
    tapBrake(sim, selected);
    afterAction();
  }

  function runAhead() {
    if (aheadRef.current) {
      // Stop where it is; playback carries on as it was before.
      aheadRef.current = null;
      setAhead(false);
      return;
    }
    if (sim.status.kind !== "running") return;
    aheadRef.current = { sim, target: sim.steps + Math.round(RUN_AHEAD_SECONDS / sim.dt) };
    setAhead(true);
  }

  function playPause() {
    if (aheadRef.current) {
      // Pause during a run-ahead stops it there and pauses.
      aheadRef.current = null;
      setAhead(false);
      setUserPaused(true);
      return;
    }
    setUserPaused(!paused);
  }

  function toggleWatch() {
    if (!watch && sideRef.current?.contains(document.activeElement)) watchRef.current?.focus();
    setWatch(!watch);
  }

  const running = snapshot.status.kind === "running";
  // A frozen run takes no more input: nothing stays held on it.
  useEffect(() => {
    if (!running) endAll();
  }, [running, endAll]);
  const moving = ahead || !paused;
  const { status } = snapshot;
  const collided = useMemo(() => (status.kind === "collision" ? [status.follower, status.leader] : []), [status]);
  const { summary, car } = snapshot;
  const brakeShown = brakeState(car, running);
  const track = trackOf(config);
  const laneName = sim.track.lanes[car.lane]?.name ?? "road";

  return (
    <div className={styles.experiment} data-watch={watch || undefined}>
      <div className={styles.stage}>
        <div className={styles.ring} ref={ringRef} data-legend={sim.track.legend}>
          <output className={styles.time} data-testid="sim-time" aria-label="Simulated time">
            t = {seconds(snapshot.time)}
          </output>
          <RingView sim={sim} selected={selected} collided={collided} maxSpeed={MAX_SPEED} cornering={corneringOf(config)} onSelect={select} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} svgRef={svgRef} />
          <div className={styles.legend}>
            <span className={styles.legendTitle}>Speed · km/h</span>
            <span className={styles.legendBar} style={{ background: speedGradient() }} />
            <span className={styles.legendScale}>
              {SPEED_TICKS_KMH.filter((tick) => tick <= MAX_SPEED * 3.6 + 1e-9).map((tick) => (
                <span key={tick} style={{ left: `${(speedFraction(tick / 3.6, MAX_SPEED) * 100).toFixed(1)}%` }}>
                  {tick}
                </span>
              ))}
            </span>
            {/* The selected car in one glance, so the watch view needs no details panel. */}
            <span className={styles.carLine} data-testid="car-line">
              <span className={styles.carName}>Car {car.car + 1}</span>
              {" "}
              <span>{carLine(car)}</span>
            </span>
          </div>
        </div>

        {!running ? (
          <div role="alert" data-testid="status" className={styles.status}>
            <p>{statusMessage(snapshot.status)}</p>
            <p>Reset to run again.</p>
          </div>
        ) : null}

        <div className={styles.transport} role="group" aria-label="Playback" ref={transportRef}>
          <button type="button" className={`${styles.button} ${styles.play}`} onClick={playPause} disabled={!running}>
            {!running ? "Frozen" : moving ? "Pause" : "Play"}
          </button>
          <div className={styles.segmented} role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map((option) => (
              <button
                key={option.rate}
                type="button"
                className={styles.button}
                aria-label={option.name}
                aria-pressed={rate === option.rate}
                onClick={() => setRate(option.rate)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.button} ${styles.brake}`}
            disabled={!running}
            aria-pressed={brakeShown === "held" && car.car === selected}
            onPointerDown={brakePointerDown}
            onPointerUp={brakeUp}
            onPointerCancel={brakeUp}
            onLostPointerCapture={brakeUp}
            onKeyDown={brakeKeyDown}
            onKeyUp={brakeKeyUp}
            onBlur={brakeUp}
            onContextMenu={(event) => {
              if (buttonDownRef.current) event.preventDefault();
            }}
            onClick={brakeClick}
          >
            Hold to brake · car {selected + 1}
          </button>
          <button type="button" className={styles.button} onClick={() => restart(config, selected)}>
            Reset
          </button>
          {/* Both labels share one cell so the button keeps its width when it toggles; only the shown one is its name. */}
          <button type="button" className={`${styles.button} ${styles.ahead}`} onClick={runAhead} disabled={!running} data-active={ahead || undefined}>
            <span hidden={ahead}>Run ahead {RUN_AHEAD_SECONDS} s</span>
            <span hidden={!ahead}>Stop run-ahead</span>
          </button>
          <button type="button" ref={watchRef} className={`${styles.button} ${styles.watch}`} aria-pressed={watch} onClick={toggleWatch}>
            Watch view
          </button>
        </div>

        <Presets config={config} onPreset={(next) => restart(next, selected)} />
      </div>

      {/* The space-time history: the road unrolled at the 0 m cut, one panel per lane. */}
      <HistoryView history={history} feed={feed} selected={selected} maxSpeed={MAX_SPEED} track={track} />

      <div className={styles.side} ref={sideRef} hidden={watch}>
        <div className={styles.readouts}>
          <section aria-labelledby="ptj-traffic">
            <Label id="ptj-traffic" tone="muted">Traffic</Label>
            <dl className={styles.facts}>
              <div className={styles.sparkRow}>
                <dt>Average speed</dt>
                <dd>{kmh(summary.meanSpeed)}</dd>
                <dd>
                  <Sparkline history={history} feed={feed} values="meanSpeed" max={MAX_SPEED} label={`Average speed over the last ${history.windowSeconds / 60} minutes, on a fixed 0 to ${Math.round(MAX_SPEED * 3.6)} km/h scale`} />
                </dd>
              </div>
              <div className={styles.sparkRow}>
                <dt>Speed spread <small>(std. dev. across cars)</small></dt>
                <dd>{kmh(summary.speedSpread)}</dd>
                <dd>
                  <Sparkline history={history} feed={feed} values="speedSpread" max={MAX_SPREAD} label={`Speed spread over the last ${history.windowSeconds / 60} minutes, on a fixed 0 to ${Math.round(MAX_SPREAD * 3.6)} km/h scale`} />
                </dd>
              </div>
              {track === "merge" ? (
                <>
                  <div>
                    <dt>Flow past the merge <small>(last minute)</small></dt>
                    <dd data-testid="flow">{summary.flow.toFixed(0)} cars/min</dd>
                  </div>
                  <div>
                    <dt>Merges</dt>
                    <dd data-testid="merges">{summary.merges}</dd>
                  </div>
                  <div>
                    <dt>Waiting on the ramp</dt>
                    <dd data-testid="waiting">{summary.waiting}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </section>
          <section aria-labelledby="ptj-car">
            <Label id="ptj-car" tone="muted">Car {car.car + 1}</Label>
            <dl className={styles.facts}>
              {track !== "ring" ? (
                <div>
                  <dt>Road</dt>
                  <dd data-testid="car-road">{car.inZone ? `${laneName} · merge zone` : laneName}</dd>
                </div>
              ) : null}
              <div>
                <dt>Speed</dt>
                <dd>{kmh(car.speed)}</dd>
              </div>
              {Number.isFinite(car.limit) ? (
                <div>
                  <dt>Bend speed here</dt>
                  <dd data-testid="bend-speed">{kmh(car.limit)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{car.leader < 0 ? "Gap to the lane end" : `Gap to car ${car.leader + 1}`}</dt>
                <dd>{metres(car.gap)}</dd>
              </div>
              <div>
                <dt>Desired gap</dt>
                <dd>{metres(car.desiredGap)}</dd>
              </div>
              <div>
                <dt>Acceleration</dt>
                <dd>{signed(car.acceleration, 2)} m/s²</dd>
              </div>
              <div>
                <dt>Brake</dt>
                <dd data-testid="brake-state" data-active={brakeShown !== "off" || undefined}>
                  {brakeShown}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <Controls
          config={config}
          onRestartWith={(change) => restart({ ...config, ...change }, selected)}
          onDriver={changeDriver}
          onVariation={changeVariation}
          onCornering={changeCornering}
          onMerging={changeMerging}
        />
      </div>
    </div>
  );
}
