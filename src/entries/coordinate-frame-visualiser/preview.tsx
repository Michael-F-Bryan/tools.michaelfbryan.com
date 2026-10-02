export default function CoordinateFramePreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <path d="M10 68 64 38 118 68 64 94Z" className="fill-panel" />
      <path d="m28 58 54 30M46 48l54 30M28 78l54-30M46 88l54-30" className="stroke-rule-subtle" />
      <path d="M64 68V10m0 58 48 20M64 68 16 88" className="stroke-rule" strokeWidth="1.5" />
      <path d="m60 16 4-6 4 6m38 65 6 7-9 1M25 89l-9-1 6-7" className="stroke-rule" strokeWidth="1.5" />
      <path d="m39 58 53-20-16 33-10-15Z" className="fill-surface stroke-accent" strokeWidth="2" strokeLinejoin="round" />
      <path d="m66 56 26-18-16 33Z" className="fill-accent/20" />
      <path d="m66 56-5-15 17 2" className="stroke-accent" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="64" cy="68" r="3" className="fill-accent" />
    </svg>
  );
}
