export default function MelbourneMorningPreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <path d="M8 10h112v76H8Z" className="fill-panel" />
      <path d="M31 10v76M74 10v76M8 32h112M8 63h112" className="stroke-surface" strokeWidth="7" />
      <path d="M8 78c25-28 38 13 62-4s29-13 50-7" className="stroke-rule-subtle" strokeWidth="5" />
      <path d="M31 65V32h43" className="stroke-accent" strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="31" cy="65" r="4" className="fill-accent" />
      <path d="M86 26c0 9-12 20-12 20S62 35 62 26a12 12 0 1 1 24 0Z" className="fill-surface stroke-accent" strokeWidth="2" />
      <circle cx="74" cy="26" r="4" className="fill-accent" />
      <circle cx="108" cy="14" r="7" className="fill-accent/20" />
    </svg>
  );
}
