export default function Preview() {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true">
      <path d="M0 150 L70 132 L120 140 L200 128 L320 146 V180 H0 Z" fill="var(--rule-subtle)" />
      <g stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round">
        <path d="M118 138 V52 L126 52 V44 L136 44 V52 L148 52 V40 L158 40 V52 L170 52 V46 L180 46 V60 L186 74 V138" />
        <path d="M186 98 L192 104 L188 116 L194 138" />
        <path d="M186 112 L204 120 L214 130 L222 138" />
        <path d="M118 138 H194" />
      </g>
      <rect x="166" y="92" width="10" height="18" fill="var(--ink)" />
      <path d="M126 134 C128 118 144 112 156 120 C150 124 152 130 160 128 C156 136 136 138 126 134 Z" fill="var(--text-secondary)" />
      <path d="M140 118 L132 102 L150 114" stroke="var(--text-secondary)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M168 136 L171 126 L174 131 L176 122 L180 136 Z" fill="var(--accent)" />
      <circle cx="174" cy="128" r="14" fill="var(--accent)" opacity=".15" />
      <g fill="var(--ink)" fontFamily="Georgia, serif" fontStyle="italic" fontSize="15">
        <text x="28" y="62" opacity=".7">ithra</text>
        <text x="232" y="56" opacity=".5">skaul</text>
        <text x="238" y="94" opacity=".35">kor</text>
        <text x="38" y="98" opacity=".4">brae</text>
      </g>
      <g fill="var(--accent)">
        <circle cx="262" cy="150" r="2" />
        <circle cx="272" cy="152" r="2" />
        <circle cx="283" cy="149" r="2" />
      </g>
    </svg>
  );
}
