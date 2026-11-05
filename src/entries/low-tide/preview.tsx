export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      {/* Terraces from the wreck (top) to the shingle (bottom), as in the game's scene. */}
      <rect width="320" height="45" fill="#5a5d72" opacity=".75" />
      <rect y="45" width="320" height="45" fill="#5f8572" opacity=".8" />
      <rect y="90" width="320" height="45" fill="#8a7657" opacity=".85" />
      <rect y="135" width="320" height="45" fill="#b7a98a" opacity=".9" />
      <g fill="var(--ink)" opacity=".25">
        {Array.from({ length: 22 }, (_, i) => <ellipse key={i} cx={8 + (i % 11) * 30 + (i > 10 ? 15 : 0)} cy={i > 10 ? 168 : 150} rx="4" ry="2.5" />)}
      </g>
      {/* Water back to the reef, with the wreck's ribs standing out of it. */}
      <rect width="320" height="90" fill="#2d6cdf" opacity=".55" />
      <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity=".6">
        <path d="M10 30 Q22 24 34 30 T58 30" />
        <path d="M120 62 Q132 56 144 62 T168 62" />
        <path d="M250 24 Q262 18 274 24 T298 24" />
        <path d="M0 89 Q15 83 30 89 T60 89 T90 89 T120 89 T150 89 T180 89 T210 89 T240 89 T270 89 T300 89 T330 89" />
      </g>
      <g stroke="#2a211b" strokeWidth="3.5" strokeLinecap="round">
        <path d="M212 44 L208 14" />
        <path d="M226 46 L226 8" />
        <path d="M242 44 L248 12" />
      </g>
      {/* Two crew on the mudflat, one with a progress ring. */}
      <g>
        <circle cx="96" cy="112" r="12" fill="var(--paper)" opacity=".6" />
        <circle cx="96" cy="112" r="12" stroke="var(--accent)" strokeWidth="3" strokeDasharray="50 26" transform="rotate(-90 96 112)" />
        <circle cx="96" cy="107" r="3.5" fill="var(--ink)" />
        <rect x="93" y="110" width="6" height="10" rx="1.5" fill="var(--ink)" />
        <circle cx="206" cy="107" r="3.5" fill="var(--ink)" />
        <rect x="203" y="110" width="6" height="10" rx="1.5" fill="var(--ink)" />
      </g>
      {/* The hut and a lit beacon on the shingle. */}
      <path d="M22 174 V158 L36 148 L50 158 V174 Z" fill="#8d6b4a" stroke="#2a211b" strokeWidth="1.5" />
      <path d="M270 176 L272 140 L290 140 L292 176 Z" fill="#b05a3c" stroke="#2a211b" strokeWidth="1.5" />
      <path d="M275 140 L281 128 L287 140 Z" fill="#ffb547" />
      <circle cx="281" cy="136" r="16" fill="#ffb547" opacity=".3" />
    </svg>
  );
}
