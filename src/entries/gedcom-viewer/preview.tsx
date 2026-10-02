export default function FamilyTreePreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <path d="M44 20h40M64 20v28M28 52v-4h72v4M28 64v16m72-16v16" className="stroke-rule" strokeWidth="1.5" />
      <rect x="26" y="9" width="26" height="22" rx="3" className="fill-panel stroke-rule" />
      <rect x="76" y="9" width="26" height="22" rx="3" className="fill-panel stroke-rule" />
      <rect x="15" y="46" width="26" height="22" rx="3" className="fill-accent/10 stroke-accent" strokeWidth="1.5" />
      <rect x="87" y="46" width="26" height="22" rx="3" className="fill-surface stroke-rule" />
      <circle cx="28" cy="85" r="7" className="fill-accent/10 stroke-accent" strokeWidth="1.5" />
      <circle cx="100" cy="85" r="7" className="fill-panel stroke-rule" />
      <path d="M34 20h10m38 0h10M23 57h10m62 0h10" className="stroke-muted" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
