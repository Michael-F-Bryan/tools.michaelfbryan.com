import { useState } from "react";

import { cn } from "@/lib/utils";

import { formatFixed, formatSigned, parseUserNumber } from "./format";
import {
  applyToPoint,
  type EulerAngles,
  type LocalConvention,
  invertTransform,
  type Mat3,
  normaliseQuaternion,
  quaternionFromRotation,
  type Quaternion,
  rotationToEuler,
  transformFromRotation,
  transpose,
} from "./math";
import { RotationTable, TransformTable } from "./matrix-table";
import type { PoseState } from "./pose";
import { activeOrigin, activeProbe, activeRotation } from "./pose";
import { useSyncedDraft } from "./use-synced-draft";

type OrientationInspectorProps = Readonly<{
  state: PoseState;
  onConventionChange: (convention: LocalConvention) => void;
  onAngleEdit: (field: keyof EulerAngles, value: number) => void;
  onQuaternionCommit: (q: Quaternion) => void;
  onProbeEdit: (field: 0 | 1 | 2, value: number) => void;
  onOriginEdit: (field: 0 | 1 | 2, value: number) => void;
}>;

const LOCAL_NAMES: Record<LocalConvention, readonly [string, string, string]> = {
  ned: ["N", "E", "D"],
  enu: ["E", "N", "U"],
};

function AngleRow({
  label,
  hint,
  value,
  onCommit,
}: Readonly<{ label: string; hint: string; value: number; onCommit: (value: number) => void }>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toFixed(1));

  function commit() {
    const parsed = parseUserNumber(draft);
    if (parsed === null) {
      resetDraft();
      return;
    }
    onCommit(parsed);
  }

  return (
    <div className="mt-3">
      <span className="text-sm text-secondary">
        {label} <small className="font-mono text-xs text-muted">{hint}</small>
      </span>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-2">
        <input
          type="range"
          min={-180}
          max={180}
          step={0.1}
          value={value}
          aria-label={`${label} slider`}
          onChange={(event) => onCommit(Number(event.target.value))}
          className="w-full accent-accent focus-visible:outline-2 focus-visible:outline-accent"
        />
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          aria-label={`${label} degrees`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          className="w-full border border-rule bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums"
        />
        <span className="font-mono text-xs text-muted">°</span>
      </div>
      <span className="mt-1 block font-mono text-xs text-muted">{((value * Math.PI) / 180).toFixed(4)} rad</span>
    </div>
  );
}

function QuaternionGroup({
  rotation,
  onCommit,
}: Readonly<{ rotation: Mat3; onCommit: (q: Quaternion) => void }>) {
  const [componentOrder, setComponentOrder] = useState<"wxyz" | "xyzw">("wxyz");
  const derived = quaternionFromRotation(rotation);
  const signature = `${derived.w.toFixed(6)},${derived.x.toFixed(6)},${derived.y.toFixed(6)},${derived.z.toFixed(6)}`;

  // Adjusting state when a prop changes: compare against the previous
  // signature during render (not in an effect) and reset the draft then.
  const [previousSignature, setPreviousSignature] = useState(signature);
  const [draft, setDraft] = useState({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
  if (previousSignature !== signature) {
    setPreviousSignature(signature);
    setDraft({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
  }
  const [note, setNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  function setField(field: keyof Quaternion, text: string) {
    const value = Number(text);
    setDraft((prev) => ({ ...prev, [field]: text === "" ? NaN : value }));
  }

  function commit() {
    const result = normaliseQuaternion(draft);
    if (!result.ok) {
      setNote({
        kind: "error",
        text: result.reason === "zero" ? "A zero quaternion has no direction. Kept the last valid pose." : "Enter finite numbers. Kept the last valid pose.",
      });
      setDraft({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
      return;
    }
    onCommit(result.quaternion);
    if (Math.abs(result.originalNorm - 1) > 1e-6) {
      setNote({ kind: "info", text: `Normalised from |q| = ${result.originalNorm.toFixed(4)}` });
    } else {
      setNote(null);
    }
  }

  const order: readonly (keyof Quaternion)[] = componentOrder === "wxyz" ? ["w", "x", "y", "z"] : ["x", "y", "z", "w"];

  return (
    <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Quaternion</span>
        <div className="inline-flex border border-rule" role="group" aria-label="Component order">
          {(["wxyz", "xyzw"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={componentOrder === candidate}
              onClick={() => setComponentOrder(candidate)}
              className={cn(
                "px-2 py-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent",
                componentOrder === candidate ? "bg-accent text-paper" : "text-secondary",
              )}
            >
              {candidate === "wxyz" ? "w x y z" : "x y z w"}
            </button>
          ))}
        </div>
      </div>
      <div
        className="mt-3 flex flex-wrap gap-3"
        onBlur={(event) => {
          // Commit once focus leaves the whole group of four fields, not on
          // every hop between them, so w/x/y/z commit together.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
        }}
      >
        {order.map((field) => (
          <label key={field} className="flex items-center gap-1 font-mono text-xs text-muted">
            {field}
            <input
              type="text"
              inputMode="decimal"
              aria-label={field}
              value={Number.isNaN(draft[field]) ? "" : draft[field]}
              onChange={(event) => setField(field, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
              className="w-20 border border-rule bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums"
            />
          </label>
        ))}
      </div>
      <p className={cn("mt-2 max-w-[38rem] text-sm", note?.kind === "error" ? "text-error" : "text-muted")}>
        {note?.text ??
          "Same rotation as R above. Non-unit input is normalised on commit; a zero or non-finite quaternion is rejected."}
      </p>
    </div>
  );
}

export function OrientationInspector({
  state,
  onConventionChange,
  onAngleEdit,
  onQuaternionCommit,
  onProbeEdit,
  onOriginEdit,
}: OrientationInspectorProps) {
  const [rInverted, setRInverted] = useState(false);
  const [tInverted, setTInverted] = useState(false);

  const rotation = activeRotation(state);
  const origin = activeOrigin(state);
  const probe = activeProbe(state);
  const names = LOCAL_NAMES[state.convention];
  const bodyNames = ["x", "y", "z"] as const;

  const decomposition = rotationToEuler(rotation, state.order, state.interpretation);
  const gimbalLocked = decomposition.gimbalLock || Math.abs(Math.abs(state.angles.second) - 90) < 1e-6;

  const displayed = rInverted ? transpose(rotation) : rotation;
  const rColumnHeaders: readonly [string, string, string] = rInverted ? names : bodyNames;
  const rRowHeaders: readonly [string, string, string] = rInverted ? bodyNames : names;
  const rName = rInverted ? `R[body←${state.convention}]` : `R[${state.convention}←body]`;
  const rTakes = rInverted ? `${state.convention.toUpperCase()} coordinates` : "body coordinates";
  const rGives = rInverted ? "body coordinates" : `${state.convention.toUpperCase()} coordinates`;

  const rRows = displayed.map((row) => row.map((v) => formatSigned(v)) as unknown as readonly [string, string, string]);

  const bodyTransform = transformFromRotation({ to: state.convention, from: "body" as const, m: rotation }, origin);
  const localFromBody = tInverted ? invertTransform(bodyTransform) : bodyTransform;
  const tName = tInverted ? `T[body←${state.convention}]` : `T[${state.convention}←body]`;
  const tTakes = tInverted ? `${state.convention.toUpperCase()} coordinates of a point, with a fourth coordinate of 1` : "body coordinates of a point, with a fourth coordinate of 1";
  const tGives = tInverted ? "body coordinates" : `${state.convention.toUpperCase()} coordinates`;
  const tColumnHeaders: readonly [string, string, string, string] = tInverted
    ? [...names, "origin"]
    : [...bodyNames, "origin"];
  const tRowHeaders: readonly [string, string, string] = tInverted ? bodyNames : names;
  const tRows = localFromBody.m.slice(0, 3).map(
    (row) => row.map((v) => formatSigned(v, 3)) as unknown as readonly [string, string, string, string],
  );

  const probeBody = applyToPoint(invertTransform(bodyTransform), probe);

  return (
    <div className="min-w-0">
      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Frame</span>
          <span className="font-mono text-xs text-muted">shared with the position mode</span>
        </div>
        <div className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-sm text-secondary">Local</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex border border-rule" role="group" aria-label="Local frame convention">
              {(["ned", "enu"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={state.convention === candidate}
                  onClick={() => onConventionChange(candidate)}
                  className={cn(
                    "px-2 py-1 text-xs uppercase focus-visible:outline-2 focus-visible:outline-accent",
                    state.convention === candidate ? "bg-accent text-paper" : "text-secondary",
                  )}
                >
                  {candidate.toUpperCase()}
                </button>
              ))}
            </span>
            <span className="font-mono text-xs text-muted">tangent frame at the anchor</span>
          </span>
          <span className="text-sm text-secondary">Body</span>
          <span className="font-mono text-xs text-muted">x forward · y right · z down · fixed, independent of the local frame</span>
        </div>
        <p className="mt-2 max-w-[38rem] text-sm text-muted">
          Switching NED to ENU relabels the grid and recomputes every number. The block does not move.
        </p>
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Angles</span>
        </div>
        <AngleRow label="first" hint="about first axis" value={state.angles.first} onCommit={(v) => onAngleEdit("first", v)} />
        <AngleRow label="second" hint="about second axis" value={state.angles.second} onCommit={(v) => onAngleEdit("second", v)} />
        <AngleRow label="third" hint="about third axis" value={state.angles.third} onCommit={(v) => onAngleEdit("third", v)} />
        {gimbalLocked ? (
          <p role="status" className="mt-3 max-w-[38rem] text-sm text-secondary">
            Gimbal lock: the second angle is at ±90°, so the first and third angles are no longer separately
            determined — only their sum or difference is observable. Both pins are drawn in the scene because they
            are now collinear.
          </p>
        ) : (
          <p className="mt-3 max-w-[38rem] text-sm text-muted">
            Near a second angle of ±90° the first- and third-stage pins become parallel; this note explains that
            they are no longer separately determined.
          </p>
        )}
      </div>

      <QuaternionGroup rotation={rotation} onCommit={onQuaternionCommit} />

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">R</span>
        <div className="mt-3">
          <RotationTable
            name={rName}
            takes={rTakes}
            gives={rGives}
            columnHeaders={rColumnHeaders}
            rowHeaders={rRowHeaders}
            rows={rRows}
            ariaLabel={`Rotation matrix, currently showing ${rName}`}
            onInvert={() => setRInverted((v) => !v)}
            invertLabel={rInverted ? `Invert → R[${state.convention}←body]` : `Invert → R[body←${state.convention}]`}
            copyText={`${rName}\n${displayed.map((row) => row.map((v) => formatSigned(v)).join("  ")).join("\n")}`}
          />
        </div>
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Probe</span>
          <span className="font-mono text-xs text-muted">one point, two descriptions</span>
        </div>
        <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-y-2">
          <span className="text-sm text-secondary">P in {state.convention.toUpperCase()}</span>
          <span className="flex flex-wrap gap-3">
            {names.map((name, index) => (
              <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                {name}
                <ProbeField value={probe[index]} onCommit={(v) => onProbeEdit(index as 0 | 1 | 2, v)} label={`local ${name}`} />
              </label>
            ))}
            <span className="font-mono text-xs text-muted">m</span>
          </span>
          <span className="text-sm text-secondary">P in body</span>
          <span className="flex flex-wrap gap-3">
            {bodyNames.map((name, index) => (
              <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                {name}
                <input
                  type="text"
                  readOnly
                  aria-label={`body ${name}`}
                  value={formatFixed(probeBody[index], 3)}
                  className="w-20 border border-rule-subtle bg-panel px-2 py-1 text-right font-mono text-sm tabular-nums text-secondary"
                />
              </label>
            ))}
            <span className="font-mono text-xs text-muted">m</span>
          </span>
        </div>
        <p className="mt-3 max-w-[38rem] text-sm text-muted">
          Body coordinates come from R[body←{state.convention}] · P, the inverse of the matrix above. Turn the block
          and the {state.convention.toUpperCase()} triple stays put while the body triple changes.
        </p>
      </div>

      <details className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Pose T</span>
          <span className="text-sm text-muted">4×4 · a separate object that carries R and the body origin</span>
        </summary>
        <div className="mt-3">
          <TransformTable
            name={tName}
            takes={tTakes}
            gives={tGives}
            columnHeaders={tColumnHeaders}
            rowHeaders={tRowHeaders}
            rows={tRows}
            ariaLabel={`Homogeneous transform, currently showing ${tName}`}
            onInvert={() => setTInverted((v) => !v)}
            invertLabel={tInverted ? `Invert → T[${state.convention}←body]` : `Invert → T[body←${state.convention}]`}
            invertNote="rotation transposed, origin becomes −Rᵀ·t"
            copyText={`${tName}\n${localFromBody.m.map((row) => row.map((v) => formatSigned(v, 3)).join("  ")).join("\n")}`}
          />
          {!tInverted ? (
            <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-sm text-secondary">Origin</span>
              <span className="flex flex-wrap gap-3">
                {names.map((name, index) => (
                  <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                    {name}
                    <ProbeField value={origin[index]} onCommit={(v) => onOriginEdit(index as 0 | 1 | 2, v)} label={`origin ${name}`} />
                  </label>
                ))}
                <span className="font-mono text-xs text-muted">m · body origin in {state.convention.toUpperCase()}</span>
              </span>
            </div>
          ) : null}
          <p className="mt-3 max-w-[38rem] text-sm text-muted">R never becomes T; T contains R.</p>
        </div>
      </details>
    </div>
  );
}

function ProbeField({
  value,
  onCommit,
  label,
}: Readonly<{ value: number; onCommit: (value: number) => void; label: string }>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toFixed(2));

  function commit() {
    const parsed = parseUserNumber(draft);
    if (parsed === null) {
      resetDraft();
      return;
    }
    onCommit(parsed);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className="w-20 border border-rule bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums"
    />
  );
}
