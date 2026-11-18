import { useId, useState } from "react";

import { Label } from "@/components/label";

import { decimalsOf, formatDisplay, toDisplay } from "./format";
import { CAR_COUNT_SLIDER, DRIVER_SLIDERS, PRESETS, ROAD, SCHEDULED_TAP, VARIATION_SLIDER } from "./parameters";
import styles from "./experiment.module.css";
import type { DriverParamKey, ExperimentConfig, Preset, SliderSpec, StartArrangement } from "./types";

/** At most a short phrase per control; the labels themselves come from the model. */
const DRIVER_HINTS: Record<DriverParamKey, string> = {
  desiredSpeed: "on an empty road",
  timeGap: "how far behind, in seconds",
  reactionDelay: "how old what they act on is",
  maxAcceleration: "hardest they speed up",
  comfortableBraking: "not an emergency limit",
};

const DRIVER_ORDER: readonly DriverParamKey[] = ["desiredSpeed", "timeGap", "reactionDelay", "maxAcceleration", "comfortableBraking"];

const STARTS: readonly { value: StartArrangement; label: string }[] = [
  { value: "even", label: "Even" },
  { value: "jumbled", label: "Slightly jumbled" },
];

function Slider({ spec, value, hint, onChange }: Readonly<{ spec: SliderSpec; value: number; hint?: string; onChange: (si: number) => void }>) {
  const id = useId();
  return (
    <div className={styles.slider}>
      <span className={styles.sliderName}>
        <label htmlFor={id}>{spec.label}</label>
        {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
      </span>
      <output htmlFor={id}>{formatDisplay(spec, value)}</output>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={toDisplay(spec, value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(Number(Number(event.currentTarget.value).toFixed(decimalsOf(spec.step))) / spec.displayPerSI)}
      />
    </div>
  );
}

/** The seed as typed: a half-typed or empty number does not restart anything. */
function SeedField({ seed, onSeed }: Readonly<{ seed: number; onSeed: (seed: number) => void }>) {
  const id = useId();
  const [draft, setDraft] = useState(String(seed));
  const [shown, setShown] = useState(seed);
  if (shown !== seed) {
    setShown(seed);
    setDraft(String(seed));
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldName}>
        Seed <small>restarts</small>
      </label>
      <div className={styles.seed}>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            const next = Number(text);
            if (text !== "" && Number.isSafeInteger(next) && next >= 0 && next !== seed) onSeed(next);
          }}
        />
        <button type="button" className={styles.button} onClick={() => onSeed(Math.floor(Math.random() * 1_000_000))}>
          New seed
        </button>
      </div>
    </div>
  );
}

function density(carCount: number): string {
  const perKm = carCount / (ROAD.length / 1000);
  const gap = ROAD.length / carCount - ROAD.vehicleLength;
  return `${Math.round(perKm)} cars/km · ${gap.toFixed(1)} m gaps`;
}

/** Order-insensitive structural equality for plain configuration objects. */
function sameConfig(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keys = (value: object) => Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((key) => sameConfig((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** The opening tap as a control label: "Car 1 at 5 s". */
const OPENING_TAP_LABEL = `Car ${SCHEDULED_TAP.car + 1} at ${SCHEDULED_TAP.time} s`;

/**
 * One fact per setting, worded for an experiment button. Only settings whose
 * value differs between the experiments are shown, so a reader comparing two
 * buttons sees exactly what differs and can trust that nothing else does.
 */
const FACTS: readonly { differs: (a: ExperimentConfig, b: ExperimentConfig) => boolean; text: (config: ExperimentConfig) => string | null }[] = [
  { differs: (a, b) => a.carCount !== b.carCount, text: (c) => `${c.carCount} cars` },
  ...(["reactionDelay", "timeGap", "desiredSpeed", "maxAcceleration", "comfortableBraking"] as const).map((key) => ({
    differs: (a: ExperimentConfig, b: ExperimentConfig) => a.driver[key] !== b.driver[key],
    text: (c: ExperimentConfig) => `${key === "reactionDelay" ? "delay" : DRIVER_SLIDERS[key].label.toLowerCase()} ${formatDisplay(DRIVER_SLIDERS[key], c.driver[key])}`,
  })),
  // Identical drivers are the unremarkable case: say only when they differ.
  { differs: (a, b) => a.variation !== b.variation, text: (c) => (c.variation > 0 ? `±${formatDisplay(VARIATION_SLIDER, c.variation)}` : null) },
  { differs: (a, b) => a.start !== b.start, text: (c) => (c.start === "even" ? "even start" : "jumbled start") },
  { differs: (a, b) => a.seed !== b.seed, text: (c) => `seed ${c.seed}` },
  { differs: (a, b) => !sameConfig(a.scheduledTap, b.scheduledTap), text: (c) => (c.scheduledTap ? `tap at ${c.scheduledTap.time} s` : "no tap") },
];

/** "delay 0.8 s · ±10% · no tap": generated from the configs, so it cannot drift from them. */
export function presetFacts(preset: Preset, presets: readonly Preset[] = PRESETS): string {
  return FACTS.filter((fact) => presets.some((other) => fact.differs(preset.config, other.config)))
    .map((fact) => fact.text(preset.config))
    .filter((text): text is string => text !== null)
    .join(" · ");
}

type PresetsProps = Readonly<{ config: ExperimentConfig; onPreset: (config: ExperimentConfig) => void }>;

/** The curated experiments: the one-tap main path, so they live with the transport rather than with the detail controls. */
export function Presets({ config, onPreset }: PresetsProps) {
  const id = useId();
  return (
    <section className={styles.experiments} aria-labelledby={id}>
      <Label id={id} tone="muted">Experiments</Label>
      <div className={styles.presets}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`${styles.button} ${styles.preset}`}
            aria-pressed={sameConfig(preset.config, config)}
            onClick={() => onPreset(preset.config)}
          >
            <span className={styles.presetName}>{preset.label}</span>{" "}
            <span className={styles.presetFacts}>{presetFacts(preset)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type ControlsProps = Readonly<{
  config: ExperimentConfig;
  onRestartWith: (change: Partial<ExperimentConfig>) => void;
  onDriver: (key: DriverParamKey, si: number) => void;
  onVariation: (variation: number) => void;
}>;

export function Controls({ config, onRestartWith, onDriver, onVariation }: ControlsProps) {
  const idBase = useId();

  return (
    <div className={styles.controls}>
      <section className={styles.group} aria-labelledby={`${idBase}-road`}>
        <Label id={`${idBase}-road`} tone="muted">Road · restarts the run</Label>
        <Slider spec={CAR_COUNT_SLIDER} value={config.carCount} hint={density(config.carCount)} onChange={(carCount) => onRestartWith({ carCount: Math.round(carCount) })} />
        <div className={styles.field} role="group" aria-labelledby={`${idBase}-start`}>
          <span id={`${idBase}-start`} className={styles.fieldName}>Start</span>
          <div className={styles.segmented}>
            {STARTS.map((start) => (
              <button
                key={start.value}
                type="button"
                className={styles.button}
                aria-pressed={config.start === start.value}
                onClick={() => onRestartWith({ start: start.value })}
              >
                {start.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field} role="group" aria-labelledby={`${idBase}-tap`}>
          <span id={`${idBase}-tap`} className={styles.fieldName}>Opening tap</span>
          <div className={styles.segmented}>
            <button type="button" className={styles.button} aria-pressed={!config.scheduledTap} onClick={() => onRestartWith({ scheduledTap: undefined })}>
              None
            </button>
            <button type="button" className={styles.button} aria-pressed={sameConfig(config.scheduledTap, SCHEDULED_TAP)} onClick={() => onRestartWith({ scheduledTap: SCHEDULED_TAP })}>
              {OPENING_TAP_LABEL}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.group} aria-labelledby={`${idBase}-drivers`}>
        <Label id={`${idBase}-drivers`} tone="muted">Drivers · changes apply live</Label>
        {DRIVER_ORDER.map((key) => (
          <Slider key={key} spec={DRIVER_SLIDERS[key]} value={config.driver[key]} hint={DRIVER_HINTS[key]} onChange={(si) => onDriver(key, si)} />
        ))}
        <Slider spec={VARIATION_SLIDER} value={config.variation} hint="spreads every setting above" onChange={onVariation} />
        <SeedField seed={config.seed} onSeed={(seed) => onRestartWith({ seed })} />
      </section>
    </div>
  );
}
