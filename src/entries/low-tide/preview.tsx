export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      {/* Water, drawn back to the reef; the wreck's ribs stand out of it. */}
      <rect width="320" height="180" fill="var(--accent)" opacity=".22" />
      <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" opacity=".7">
        <path d="M18 40 Q34 32 50 40" />
        <path d="M130 28 Q146 20 162 28" />
        <path d="M236 50 Q252 42 268 50" />
        <path d="M70 66 Q86 58 102 66" />
      </g>
      <g stroke="var(--ink)" strokeWidth="4" strokeLinecap="round">
        <path d="M196 72 L190 30" />
        <path d="M212 74 L218 24" />
        <path d="M228 72 L230 44" />
      </g>
      {/* Three bands of exposed flat, shore at the bottom. */}
      <path d="M0 78 C50 70 100 86 160 78 S270 70 320 78 V180 H0 Z" fill="var(--paper)" />
      <path d="M0 78 C50 70 100 86 160 78 S270 70 320 78 V112 C270 104 220 120 160 112 S50 104 0 112 Z" fill="var(--rule-subtle)" opacity=".5" />
      <path d="M0 112 C50 104 100 120 160 112 S270 104 320 112 V146 C270 138 220 154 160 146 S50 138 0 146 Z" fill="var(--rule-subtle)" opacity=".8" />
      <path d="M0 146 C50 138 100 154 160 146 S270 138 320 146 V180 H0 Z" fill="var(--rule)" opacity=".55" />
      {/* Two crew out on the flat. */}
      <g fill="var(--ink)">
        <circle cx="104" cy="92" r="7" />
        <rect x="98" y="99" width="12" height="20" rx="2" />
        <circle cx="212" cy="126" r="7" />
        <rect x="206" y="133" width="12" height="20" rx="2" />
      </g>
      {/* The half-built tower on the shingle, with its lantern. */}
      <g stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round">
        <path d="M34 176 V120 H62 V176" />
        <path d="M34 140 H62 M34 158 H62" />
      </g>
      <path d="M38 120 L48 100 L58 120 Z" fill="var(--accent)" />
      <circle cx="48" cy="110" r="22" fill="var(--accent)" opacity=".25" />
      {/* The forecast: the next three tides as depth bars. */}
      <g fill="var(--ink)">
        <rect x="258" y="100" width="12" height="36" />
        <rect x="276" y="112" width="12" height="24" />
        <rect x="294" y="124" width="12" height="12" />
      </g>
    </svg>
  );
}
