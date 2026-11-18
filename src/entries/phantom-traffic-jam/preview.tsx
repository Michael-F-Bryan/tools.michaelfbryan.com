/** Static catalogue drawing: a ring road whose cars are bunched into a slow, braking knot on one side. */
const CX = 160;
const CY = 90;
const R = 64;

/** Angle (degrees, clockwise from the right) and colour of each car; slow cars are dark, fast ones light. */
const CARS: readonly (readonly [number, string, boolean])[] = [
  [128, "#21918c", false],
  [146, "#2c728e", true],
  [160, "#3b528b", true],
  [172, "#472d7b", true],
  [183, "#440154", true],
  [194, "#440154", true],
  [205, "#472d7b", false],
  [218, "#3b528b", false],
  [236, "#2c728e", false],
  [262, "#28ae80", false],
  [292, "#5ec962", false],
  [324, "#addc30", false],
  [356, "#fde725", false],
  [28, "#fde725", false],
  [60, "#addc30", false],
  [94, "#5ec962", false],
];

export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      <circle cx={CX} cy={CY} r={R} stroke="var(--rule)" strokeWidth="19" opacity=".35" />
      <circle cx={CX} cy={CY} r={R + 10} stroke="var(--rule)" strokeWidth="1.2" />
      <circle cx={CX} cy={CY} r={R - 10} stroke="var(--rule)" strokeWidth="1.2" />
      <path d={`M${CX} ${CY - R - 12} V${CY - R - 20}`} stroke="var(--ink)" strokeWidth="2" />
      {/* The wave through the knot moves backwards, against the traffic. */}
      <g stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120.1 71.4 A44 44 0 0 0 124 115.2" strokeDasharray="2 5" />
        <path d="M123.5 108.3 L124 115.2 L117.7 112.3" />
      </g>
      {CARS.map(([angle, colour, braking]) => {
        const radians = (angle * Math.PI) / 180;
        const x = CX + R * Math.cos(radians);
        const y = CY + R * Math.sin(radians);
        return (
          <g key={angle} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle + 90})`}>
            <rect x="-8" y="-4" width="15" height="8" rx="2.5" fill={colour} stroke="var(--ink)" strokeWidth="1" />
            <rect x="2.5" y="-2.6" width="2.2" height="5.2" rx="0.8" fill="var(--ink)" opacity=".55" />
            <rect x="-8.6" y="-4" width="2" height="2.4" rx="0.6" fill={braking ? "#ff2d1f" : "var(--ink)"} opacity={braking ? 1 : 0.3} />
            <rect x="-8.6" y="1.6" width="2" height="2.4" rx="0.6" fill={braking ? "#ff2d1f" : "var(--ink)"} opacity={braking ? 1 : 0.3} />
          </g>
        );
      })}
    </svg>
  );
}
