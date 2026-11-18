"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Label } from "@/components/label";

import { Controls } from "./controls";
import { kmh, metres, seconds, signed, toDisplay } from "./format";
import { createHistory, noteChange, noteTap, recordSample, type History } from "./history";
import { createHistoryFeed, HistoryView, Sparkline } from "./history-view";
import { DEFAULT_CONFIG, DRIVER_SLIDERS, VARIATION_SLIDER } from "./parameters";
import { createRingPainter, RingView } from "./ring-view";
import { createSimulation, readCar, setDrivers, stepSimulation, summarise, tapBrake } from "./simulation";
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
];

/** Real seconds a single frame may account for, so a background tab can't spiral into catch-up. */
const MAX_FRAME_SECONDS = 0.1;
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

type Snapshot = Readonly<{ time: number; summary: TrafficSummary; car: CarReadout; status: SimulationStatus }>;

function snapshotOf(sim: Simulation, car: number): Snapshot {
  return { time: sim.time, summary: summarise(sim), car: readCar(sim, car), status: sim.status };
}

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
  const [selected, setSelected] = useState(0);
  const [snapshot, setSnapshot] = useState(() => snapshotOf(sim, 0));
  const svgRef = useRef<SVGSVGElement>(null);
  /** What the playback loop reads each frame without restarting. */
  const playbackRef = useRef({ paused, rate, selected });

  useEffect(() => {
    playbackRef.current = { paused, rate, selected };
  }, [paused, rate, selected]);

  // The fixed-step loop: real time × playback rate is spent in whole `dt` steps,
  // so a run is identical whatever the frame rate or rate. Pausing stops
  // stepping, not drawing.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const painter = createRingPainter(svg, sim, MAX_SPEED);
    let frameId = 0;
    let previous = performance.now();
    let pending = 0;
    let sinceReadout = 0;
    let shownSteps = sim.steps;

    function frame(now: number) {
      frameId = requestAnimationFrame(frame);
      const real = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - previous) / 1000));
      previous = now;
      const playback = playbackRef.current;
      if (!playback.paused && sim.status.kind === "running") {
        pending += real * playback.rate;
        const steps = Math.floor(pending / sim.dt + 1e-9);
        pending -= steps * sim.dt;
        let sampled = false;
        // Record inside the step loop so a fast frame never skips a sample point.
        for (let step = 0; step < steps && sim.status.kind === "running"; step += 1) {
          stepSimulation(sim);
          if (recordSample(history, sim)) sampled = true;
        }
        if (sampled) feed.notify();
      } else {
        pending = 0;
      }
      painter.paint();
      sinceReadout += real;
      if (sim.steps !== shownSteps && (sinceReadout >= READOUT_SECONDS || sim.status.kind !== "running")) {
        sinceReadout = 0;
        shownSteps = sim.steps;
        setSnapshot(snapshotOf(sim, playback.selected));
      }
    }

    painter.paint();
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [sim, history, feed]);

  const restart = useCallback((next: ExperimentConfig, car = 0) => {
    const fresh = startRun(next);
    const keep = car < fresh.sim.carCount ? car : 0;
    setConfig(next);
    setRun(fresh);
    setSelected(keep);
    setSnapshot(snapshotOf(fresh.sim, keep));
  }, []);

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

  function brake() {
    tapBrake(sim, selected);
    noteTap(history, sim, selected);
    feed.notify();
    setSnapshot(snapshotOf(sim, selected));
  }

  const running = snapshot.status.kind === "running";
  const { status } = snapshot;
  const collided = useMemo(() => (status.kind === "collision" ? [status.follower, status.leader] : []), [status]);
  const { summary, car } = snapshot;

  return (
    <div className={styles.experiment}>
      <div className={styles.stage}>
        <div className={styles.ring}>
          <output className={styles.time} data-testid="sim-time" aria-label="Simulated time">
            t = {seconds(snapshot.time)}
          </output>
          <RingView sim={sim} selected={selected} collided={collided} maxSpeed={MAX_SPEED} onSelect={select} svgRef={svgRef} />
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
          </div>
        </div>

        {!running ? (
          <div role="alert" data-testid="status" className={styles.status}>
            <p>{statusMessage(snapshot.status)}</p>
            <p>Reset to run again.</p>
          </div>
        ) : null}

        <div className={styles.transport} role="group" aria-label="Playback">
          <button type="button" className={`${styles.button} ${styles.play}`} onClick={() => setUserPaused(!paused)} disabled={!running}>
            {!running ? "Frozen" : paused ? "Play" : "Pause"}
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
          <button type="button" className={`${styles.button} ${styles.brake}`} onClick={brake} disabled={!running}>
            Tap brakes · car {selected + 1}
          </button>
          <button type="button" className={styles.button} onClick={() => restart(config, selected)}>
            Reset
          </button>
        </div>
        {/* The space-time history: the ring unrolled at the 0 m cut, under the transport. */}
        <HistoryView history={history} feed={feed} selected={selected} maxSpeed={MAX_SPEED} />
      </div>

      <div className={styles.side}>
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
            </dl>
          </section>
          <section aria-labelledby="ptj-car">
            <Label id="ptj-car" tone="muted">Car {car.car + 1}</Label>
            <dl className={styles.facts}>
              <div>
                <dt>Speed</dt>
                <dd>{kmh(car.speed)}</dd>
              </div>
              <div>
                <dt>Gap to car {car.leader + 1}</dt>
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
                <dt>Brake tap</dt>
                <dd data-active={car.tapActive || undefined}>{car.tapActive ? "active" : "off"}</dd>
              </div>
            </dl>
          </section>
        </div>

        <Controls
          config={config}
          onPreset={(next) => restart(next, selected)}
          onRestartWith={(change) => restart({ ...config, ...change }, selected)}
          onDriver={changeDriver}
          onVariation={changeVariation}
        />
      </div>
    </div>
  );
}
