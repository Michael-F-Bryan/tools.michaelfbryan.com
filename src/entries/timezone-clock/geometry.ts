/**
 * SVG path helpers for the dial, kept separate from `clock-math.ts` because
 * these deal in on-screen coordinates (a centre and pixel radii) rather than
 * time. Angles are clockwise degrees from the top, matching `minuteToAngle`.
 */

export type Point = Readonly<{ x: number; y: number }>;

export function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number): Point {
  const radians = (angleDegrees * Math.PI) / 180;
  return { x: cx + radius * Math.sin(radians), y: cy - radius * Math.cos(radians) };
}

/**
 * An annulus wedge from `startAngle` to `endAngle` (degrees, clockwise,
 * `endAngle` may exceed 360 — only the sweep's magnitude matters). Callers
 * must keep the sweep strictly below 360; use `fullRingPath` for a complete
 * ring, since a 360° arc command is degenerate.
 */
export function wedgePath(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

/** A complete annulus (ring), drawn as two counter-wound circles so the hole renders with `fillRule="evenodd"`. */
export function fullRingPath(cx: number, cy: number, innerRadius: number, outerRadius: number): string {
  const outerRight = polarPoint(cx, cy, outerRadius, 90);
  const outerLeft = polarPoint(cx, cy, outerRadius, 270);
  const innerRight = polarPoint(cx, cy, innerRadius, 90);
  const innerLeft = polarPoint(cx, cy, innerRadius, 270);
  return [
    `M ${outerRight.x} ${outerRight.y}`,
    `A ${outerRadius} ${outerRadius} 0 1 1 ${outerLeft.x} ${outerLeft.y}`,
    `A ${outerRadius} ${outerRadius} 0 1 1 ${outerRight.x} ${outerRight.y}`,
    `M ${innerRight.x} ${innerRight.y}`,
    `A ${innerRadius} ${innerRadius} 0 1 1 ${innerLeft.x} ${innerLeft.y}`,
    `A ${innerRadius} ${innerRadius} 0 1 1 ${innerRight.x} ${innerRight.y}`,
    "Z",
  ].join(" ");
}

/** The clockwise angle (degrees, 0 = top) of a point relative to a centre, or `null` within `deadZoneRadius` of it. */
export function angleFromCenter(cx: number, cy: number, x: number, y: number, deadZoneRadius: number): number | null {
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) < deadZoneRadius) return null;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}
