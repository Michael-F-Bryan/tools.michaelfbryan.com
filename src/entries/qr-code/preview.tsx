const MODULES = [
  [2, 2], [4, 2], [6, 2],
  [2, 4], [4, 4],
  [6, 4], [2, 6],
  [4, 6], [6, 6],
  [8, 2], [8, 4], [8, 6],
  [2, 8], [4, 8], [6, 8], [8, 8],
] as const;

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="22" height="22" className="fill-ink" />
      <rect x="4" y="4" width="14" height="14" className="fill-surface" />
      <rect x="8" y="8" width="6" height="6" className="fill-ink" />
    </g>
  );
}

export default function QrCodePreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <rect x="20" y="4" width="88" height="88" className="fill-surface stroke-rule" />
      <Finder x={26} y={10} />
      <Finder x={80} y={10} />
      <Finder x={26} y={64} />
      {MODULES.map(([col, row]) => (
        <rect
          key={`${col}-${row}`}
          x={60 + col * 4}
          y={16 + row * 4}
          width="4"
          height="4"
          className="fill-accent"
        />
      ))}
    </svg>
  );
}
