const stars = [[16, 57], [36, 33], [58, 44], [76, 20], [98, 38], [110, 65], [77, 72]];

export default function AfterlightPreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <path d="M16 57L36 33L58 44L76 20L98 38L110 65L77 72L58 44" className="stroke-rule" strokeWidth="1" />
      {stars.map(([x, y]) => <g key={`${x}-${y}`}>
        <circle cx={x} cy={y} r="6" className="fill-accent" opacity="0.1" />
        <circle cx={x} cy={y} r="2" className="fill-accent" />
      </g>)}
      <path d="M76 14v12M70 20h12" className="stroke-accent" />
      <circle cx="25" cy="16" r="1" className="fill-muted" />
      <circle cx="47" cy="76" r="1" className="fill-muted" />
      <circle cx="113" cy="18" r="1" className="fill-muted" />
    </svg>
  );
}
