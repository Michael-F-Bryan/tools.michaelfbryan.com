export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      {/* Four bands of flat, shore at the bottom, water drawn back to the reef. */}
      <path d="M0 180 V150 C40 146 80 154 120 150 S200 146 240 150 S300 154 320 150 V180 Z" fill="var(--rule-subtle)" />
      <path d="M0 150 C40 146 80 154 120 150 S200 146 240 150 S300 154 320 150 V118 C280 122 240 114 200 118 S120 122 80 118 S20 114 0 118 Z" fill="var(--rule-subtle)" opacity=".55" />
      <path d="M0 118 C20 114 60 122 80 118 S160 114 200 118 S300 122 320 118 V88 C280 92 240 84 200 88 S120 92 80 88 S20 84 0 88 Z" fill="var(--rule-subtle)" opacity=".3" />
      {/* Water over the wreck band, with a wreck rib showing. */}
      <path d="M0 0 H320 V88 C280 92 240 84 200 88 S120 92 80 88 S20 84 0 88 Z" fill="var(--accent)" opacity=".16" />
      <g stroke="var(--accent)" strokeWidth="1.5" opacity=".6">
        <path d="M24 62 Q44 56 64 62" />
        <path d="M150 50 Q170 44 190 50" />
        <path d="M250 70 Q270 64 290 70" />
      </g>
      <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round">
        <path d="M212 86 L208 56" />
        <path d="M222 88 L226 52" />
        <path d="M202 88 L206 74" />
      </g>
      {/* Two crew out on the flat and a half-built tower on the shingle. */}
      <g fill="var(--ink)">
        <circle cx="92" cy="102" r="4" />
        <rect x="89" y="106" width="6" height="12" />
        <circle cx="186" cy="134" r="4" />
        <rect x="183" y="138" width="6" height="12" />
      </g>
      <g stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round">
        <path d="M38 170 V134 H56 V170" />
        <path d="M38 146 H56 M38 158 H56" />
      </g>
      <path d="M41 134 L47 122 L53 134 Z" fill="var(--accent)" />
      <circle cx="47" cy="128" r="12" fill="var(--accent)" opacity=".15" />
      {/* The forecast: next three tides as depth bars. */}
      <g fill="var(--text-secondary)">
        <rect x="248" y="20" width="12" height="18" />
        <rect x="266" y="12" width="12" height="26" />
        <rect x="284" y="26" width="12" height="12" />
      </g>
      <text x="247" y="52" fill="var(--text-secondary)" fontFamily="var(--font-mono, monospace)" fontSize="10" letterSpacing=".1em">TIDES</text>
    </svg>
  );
}
