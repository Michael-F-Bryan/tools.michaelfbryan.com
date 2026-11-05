/** Static catalogue drawing: three segmented swimmers, each with fins and a sensor stalk, among food. */
function Swimmer({ x, y, rotate, scale = 1, opacity = 1 }: { x: number; y: number; rotate: number; scale?: number; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`} opacity={opacity}>
      <path d="M26 0 L40 -17 L50 -2 Z" fill="var(--accent)" opacity=".28" stroke="var(--accent)" strokeWidth="1" />
      <path d="M26 0 L40 17 L50 2 Z" fill="var(--accent)" opacity=".28" stroke="var(--accent)" strokeWidth="1" />
      <path d="M0 0 H62" stroke="var(--ink)" strokeWidth="13" strokeLinecap="round" opacity=".9" />
      <path d="M0 0 H62" stroke="var(--panel)" strokeWidth="9" strokeLinecap="round" />
      <path d="M0 0 H62" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" opacity=".55" />
      <path d="M62 0 L86 -9" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M62 0 L86 -9" stroke="var(--panel)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M-3 0 L-12 -9" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="86" cy="-9" r="4" fill="var(--accent)" />
      <circle cx="-12" cy="-9" r="3.2" fill="var(--accent)" />
      <circle cx="3" cy="0" r="2.6" fill="var(--ink)" />
    </g>
  );
}

export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      <g stroke="var(--rule-subtle)" strokeWidth="1.5" opacity=".7">
        <circle cx="225" cy="52" r="46" />
        <circle cx="225" cy="52" r="26" />
      </g>
      <g stroke="var(--ink)" strokeWidth="2.5" fill="none" opacity=".32">
        <path d="M30 150 C70 126 96 144 130 118" strokeDasharray="1 7" strokeLinecap="round" />
        <path d="M300 140 C268 156 244 124 214 140" strokeDasharray="1 7" strokeLinecap="round" />
      </g>
      <g fill="var(--accent)">
        <circle cx="210" cy="40" r="3.5" />
        <circle cx="236" cy="61" r="3.5" />
        <circle cx="244" cy="34" r="3.5" />
        <circle cx="218" cy="70" r="3.5" opacity=".6" />
        <circle cx="48" cy="46" r="3.5" opacity=".6" />
        <circle cx="152" cy="168" r="3.5" opacity=".6" />
        <circle cx="288" cy="102" r="3.5" opacity=".6" />
      </g>
      <Swimmer x={66} y={76} rotate={-14} scale={0.95} />
      <Swimmer x={200} y={130} rotate={160} scale={0.62} opacity={0.85} />
      <Swimmer x={242} y={22} rotate={34} scale={0.4} opacity={0.65} />
    </svg>
  );
}
