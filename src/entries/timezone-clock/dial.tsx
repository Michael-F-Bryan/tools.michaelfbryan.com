"use client";

import { useRef } from "react";

import {
  anchorMinuteFor,
  angleToMinute,
  formatClockTime,
  localMinuteFor,
  mergeSpansToArcs,
  minuteToAngle,
  snapMinute,
} from "./clock-math";
import { angleFromCenter, fullRingPath, wedgePath } from "./geometry";
import { MINUTES_PER_DAY, type Person } from "./types";

// SIZE leaves enough margin around CENTER for the outermost elements (the
// hour labels at TICK_INNER_RADIUS+26 and the selection handle's radius) so
// they aren't clipped by the viewBox; the coordinate math itself (radii,
// angles, all relative to CENTER) is unchanged by this margin.
const SIZE = 440;
const CENTER = 220;
const DEAD_ZONE_RADIUS = 6;
const HUB_RADIUS = 34;
const RING_START_RADIUS = 48;
const RING_OUTER_RADIUS = 182;
const RING_GAP = 2;
const HANDLE_RADIUS = 196;
const TICK_INNER_RADIUS = 184;

export type DialProps = Readonly<{
  referenceOffsetMinutes: number;
  selectedMinuteUtc: number;
  people: readonly Person[];
  onSelect: (selectedMinuteUtc: number) => void;
}>;

export function Dial({ referenceOffsetMinutes, selectedMinuteUtc, people, onSelect }: DialProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  function updateFromClientPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    const angle = angleFromCenter(CENTER, CENTER, point.x, point.y, DEAD_ZONE_RADIUS);
    if (angle === null) return;
    const referenceLocalMinute = snapMinute(angleToMinute(angle));
    onSelect(anchorMinuteFor(referenceLocalMinute, referenceOffsetMinutes));
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    updateFromClientPoint(event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!dragging.current) return;
    updateFromClientPoint(event.clientX, event.clientY);
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGCircleElement>) {
    const current = localMinuteFor(selectedMinuteUtc, referenceOffsetMinutes);
    const step = 5;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current - step;
        break;
      case "PageUp":
        next = current + 60;
        break;
      case "PageDown":
        next = current - 60;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = MINUTES_PER_DAY - 5;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelect(anchorMinuteFor(snapMinute(next), referenceOffsetMinutes));
  }

  const referenceLocalMinute = localMinuteFor(selectedMinuteUtc, referenceOffsetMinutes);
  const selectionAngle = minuteToAngle(referenceLocalMinute);
  const selectionRadians = (selectionAngle * Math.PI) / 180;
  const handleX = CENTER + HANDLE_RADIUS * Math.sin(selectionRadians);
  const handleY = CENTER - HANDLE_RADIUS * Math.cos(selectionRadians);

  const bandWidth = people.length > 0 ? (RING_OUTER_RADIUS - RING_START_RADIUS) / people.length : 0;

  return (
    <div className="mx-auto w-full max-w-[26rem]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Availability dial"
        className="w-full touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <g aria-hidden="true">
          <circle cx={CENTER} cy={CENTER} r={RING_OUTER_RADIUS + 1} className="fill-none stroke-rule-subtle" />

          {people.map((person, index) => {
            const innerRadius = RING_START_RADIUS + index * bandWidth + RING_GAP;
            const outerRadius = RING_START_RADIUS + (index + 1) * bandWidth - RING_GAP;
            const shift = referenceOffsetMinutes - person.offsetMinutes;
            const arcs = mergeSpansToArcs(person.spans);

            return (
              <g key={person.id}>
                <path d={fullRingPath(CENTER, CENTER, innerRadius, outerRadius)} className="fill-panel" fillRule="evenodd" />
                {arcs.map((arc, arcIndex) => {
                  const length = arc.endMinute - arc.startMinute;
                  const drawStart = arc.startMinute + shift;
                  const startAngle = minuteToAngle(drawStart);
                  const sweep = (length / MINUTES_PER_DAY) * 360;
                  if (length >= MINUTES_PER_DAY) {
                    return (
                      <path
                        key={arcIndex}
                        d={fullRingPath(CENTER, CENTER, innerRadius, outerRadius)}
                        fill={person.color}
                        fillRule="evenodd"
                      />
                    );
                  }
                  return (
                    <path
                      key={arcIndex}
                      d={wedgePath(CENTER, CENTER, innerRadius, outerRadius, startAngle, startAngle + sweep)}
                      fill={person.color}
                    />
                  );
                })}
              </g>
            );
          })}

          {Array.from({ length: 24 }, (_, hour) => {
            const angle = hour * 15;
            const major = hour % 3 === 0;
            const outer = major ? TICK_INNER_RADIUS + 12 : TICK_INNER_RADIUS + 6;
            const radians = (angle * Math.PI) / 180;
            const x1 = CENTER + TICK_INNER_RADIUS * Math.sin(radians);
            const y1 = CENTER - TICK_INNER_RADIUS * Math.cos(radians);
            const x2 = CENTER + outer * Math.sin(radians);
            const y2 = CENTER - outer * Math.cos(radians);
            const labelRadius = TICK_INNER_RADIUS + 26;
            const lx = CENTER + labelRadius * Math.sin(radians);
            const ly = CENTER - labelRadius * Math.cos(radians);
            return (
              <g key={hour}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={major ? "stroke-ink" : "stroke-muted"} strokeWidth={major ? 2 : 1} />
                {major ? (
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted font-mono text-[11px]">
                    {String(hour).padStart(2, "0")}
                  </text>
                ) : null}
              </g>
            );
          })}

          <circle cx={CENTER} cy={CENTER} r={HUB_RADIUS} className="fill-surface stroke-rule" />
          <text x={CENTER} y={CENTER} textAnchor="middle" dominantBaseline="middle" className="fill-ink font-mono text-sm font-bold">
            {formatClockTime(referenceLocalMinute)}
          </text>

          <line
            x1={CENTER + (HUB_RADIUS + 4) * Math.sin(selectionRadians)}
            y1={CENTER - (HUB_RADIUS + 4) * Math.cos(selectionRadians)}
            x2={handleX}
            y2={handleY}
            className="stroke-accent"
            strokeWidth={2}
          />
        </g>

        <circle
          cx={handleX}
          cy={handleY}
          r={10}
          className="fill-accent stroke-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          strokeWidth={2}
          tabIndex={0}
          role="slider"
          aria-label="Selected time, in the reference zone"
          aria-valuemin={0}
          aria-valuemax={MINUTES_PER_DAY - 1}
          aria-valuenow={referenceLocalMinute}
          aria-valuetext={formatClockTime(referenceLocalMinute)}
          onKeyDown={handleKeyDown}
        />
      </svg>
    </div>
  );
}
