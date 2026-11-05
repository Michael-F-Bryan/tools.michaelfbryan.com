"use client";

import { beyondWaterline, depthOf, floodOffset, floodTime, hasBuilt, isDark, reach, tideElapsed, waterline, BANDS, BAND_NAMES, CREEP_MS, TURN_MS, type Band, type State } from "./model";
import styles from "./scene.module.css";

/** The flat seen from the shore: the wreck at the top (sea), the shingle at the bottom. */
export const SCENE_W = 360;
export const SCENE_H = 240;
const BAND_H = SCENE_H / 4;
/** The sky occupies the top of the picture; the open sea beyond the wreck runs to the horizon line below it. */
const SKY_H = 12;
const HORIZON_H = 22;
const MOON_X = 190;
/** Terraces from the sea to the shore, with their dry textures. */
const TERRACES: readonly { band: Band; bed: string; pattern: string; patternOpacity: number }[] = [
  { band: 3, bed: styles.wreckBed, pattern: "lt-mud", patternOpacity: 0.5 },
  { band: 2, bed: styles.reefBed, pattern: "lt-reef", patternOpacity: 1 },
  { band: 1, bed: styles.mudBed, pattern: "lt-mud", patternOpacity: 1 },
  { band: 0, bed: styles.shingleBed, pattern: "lt-pebbles", patternOpacity: 1 },
];
const STARS: readonly (readonly [number, number])[] = [[18, 4], [52, 7], [96, 3], [140, 8], [188, 4], [236, 7], [270, 3], [352, 9]];
/** Glint rows under the moon: y and width, widening toward the viewer. */
const GLINT: readonly (readonly [number, number])[] = [[13, 6], [18, 8], [25, 10], [34, 13], [46, 16], [60, 20], [78, 24], [100, 28], [126, 32], [156, 36]];
const WAVE = "M0 0 C 10 -4 20 4 30 0 S 50 -4 60 0 S 80 4 90 0 S 110 -4 120 0";
/** A wave line the full width of the scene at a given y. */
function waveAt(y: number) {
  let d = `M0 ${y}`;
  for (let x = 0; x < SCENE_W; x += 30) d += ` C ${x + 10} ${y - 3} ${x + 20} ${y + 3} ${x + 30} ${y}`;
  return d;
}

/** Top edge (y) of a band in scene space. Band 3 (wreck) is at the top. */
export function bandTop(band: Band) {
  return (3 - band) * BAND_H;
}

/** Where the water's edge sits right now, in scene y: the engine's continuous waterline (bands exposed, 1..4) mapped onto the terraces. */
export function waterEdge(state: State): number {
  return (4 - waterline(state)) * BAND_H;
}

export type Figure = {
  id: number;
  name: string;
  band: Band;
  /** 0..1 of the current job, or null when idle. */
  progress: number | null;
  queued: boolean;
  hungry: boolean;
};

export function Scene({ state, figures, selected, onSelect }: {
  state: State;
  figures: readonly Figure[];
  selected: Band | null;
  onSelect: (band: Band) => void;
}) {
  const depth = depthOf(state);
  const dark = isDark(state.tide);
  const edge = waterEdge(state);
  const rising = depth > 1 && tideElapsed(state) > TURN_MS - CREEP_MS;
  const elapsed = tideElapsed(state);

  return (
    <div className={styles.scene} data-dark={dark || undefined} data-rising={rising || undefined} data-waterline={waterline(state).toFixed(2)}>
      <svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" className={styles.svg}>
        <defs>
          <pattern id="lt-pebbles" width="14" height="10" patternUnits="userSpaceOnUse">
            <ellipse cx="4" cy="3" rx="3" ry="2" className={styles.pebble} />
            <ellipse cx="11" cy="8" rx="2.5" ry="1.6" className={styles.pebble} />
          </pattern>
          <pattern id="lt-mud" width="18" height="8" patternUnits="userSpaceOnUse">
            <path d="M1 4 H7 M11 2 H16" className={styles.mudMark} />
          </pattern>
          <pattern id="lt-reef" width="16" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 10 L4 4 L8 10 L12 4 L16 10" className={styles.reefMark} />
          </pattern>
          <pattern id="lt-waves" width="120" height="24" patternUnits="userSpaceOnUse">
            <path d={WAVE} transform="translate(0 12)" className={styles.wave} />
          </pattern>
          {/* Each terrace is darker toward the sea; the lip shadow is a short, stronger version of the same fade. */}
          <linearGradient id="lt-bed-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.shadeStop} stopOpacity=".34" />
            <stop offset="1" className={styles.shadeStop} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lt-lip-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.shadeStop} stopOpacity=".5" />
            <stop offset="1" className={styles.shadeStop} stopOpacity="0" />
          </linearGradient>
          {/* Water: pale and thin at the edge, deeper and darker further out, so the terraces beneath show through where it is shallow. */}
          <linearGradient id="lt-depth" gradientUnits="userSpaceOnUse" x1="0" y1={SCENE_H} x2="0" y2={SCENE_H - 110}>
            <stop offset="0" className={styles.depthShallow} stopOpacity=".4" />
            <stop offset=".28" className={styles.depthMid} stopOpacity=".7" />
            <stop offset="1" className={styles.depthDeep} stopOpacity=".9" />
          </linearGradient>
          <linearGradient id="lt-wet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.wetStop} stopOpacity=".42" />
            <stop offset="1" className={styles.wetStop} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lt-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.skyTop} />
            <stop offset="1" className={styles.skyBottom} />
          </linearGradient>
          <radialGradient id="lt-moon-halo">
            <stop offset="0" stopColor="#f4ecd2" stopOpacity=".5" />
            <stop offset="1" stopColor="#f4ecd2" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lt-lantern" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffd98a" stopOpacity=".9" />
            <stop offset=".4" stopColor="#ffb547" stopOpacity=".42" />
            <stop offset="1" stopColor="#ffb547" stopOpacity="0" />
          </radialGradient>
          <clipPath id="lt-sea-clip">
            <rect x="0" y={SKY_H} width={SCENE_W} height={SCENE_H - SKY_H} />
          </clipPath>
        </defs>

        {/* Ground: four terraces, each a little darker than the one nearer shore. */}
        {TERRACES.map(({ band, bed, pattern, patternOpacity }) => (
          <g key={band}>
            <rect x="0" y={bandTop(band)} width={SCENE_W} height={BAND_H} className={bed} />
            <rect x="0" y={bandTop(band)} width={SCENE_W} height={BAND_H} fill={`url(#${pattern})`} opacity={patternOpacity} />
            {band > 0 ? <rect x="0" y={bandTop(band)} width={SCENE_W} height={BAND_H} fill="url(#lt-bed-shade)" opacity={0.45 + band * 0.18} /> : null}
          </g>
        ))}

        {/* Open sea and sky beyond the wreck: the horizon never leaves the picture, even at the lowest ebb. */}
        <rect x="0" y="0" width={SCENE_W} height={SKY_H} fill="url(#lt-sky)" />
        <rect x="0" y={SKY_H} width={SCENE_W} height={HORIZON_H - SKY_H} className={styles.farSea} />
        <path d={waveAt(HORIZON_H)} className={styles.farFoam} />
        {dark ? <g className={styles.stars}>{STARS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".7" />)}</g> : null}

        {/* Terrace lips: a dark line along each step down toward the sea, with a short shadow under it. */}
        {[1, 2, 3].map(band => {
          const y = bandTop(band as Band) + BAND_H;
          const curve = `M0 ${y} C 60 ${y - 5} 120 ${y + 4} 180 ${y} S 300 ${y - 4} 360 ${y}`;
          return (
            <g key={band}>
              <path d={`${curve} L 360 ${y + 10} L 0 ${y + 10} Z`} fill="url(#lt-lip-shade)" />
              <path d={curve} className={styles.lip} />
            </g>
          );
        })}

        {/* The wreck: ribs and a keel, always there, under water or not. */}
        <g className={styles.wreck}>
          <path d="M230 52 C 250 60 290 60 310 50" />
          <path d="M240 54 L236 18" />
          <path d="M258 58 L258 10" />
          <path d="M276 58 L280 14" />
          <path d="M296 54 L304 22" />
          <path d="M250 30 L300 26" />
        </g>
        {/* Reef heads. */}
        <g className={styles.reefHeads}>
          <ellipse cx="60" cy="86" rx="22" ry="7" />
          <ellipse cx="170" cy="104" rx="16" ry="5" />
          <ellipse cx="300" cy="90" rx="26" ry="8" />
        </g>

        {/* Camp on the shingle: hut, then everything built grows beside it. */}
        <Camp state={state} lit={dark} />

        {/* Night on the land: cooler and darker, but light enough that the terraces keep their textures. */}
        {dark ? <rect x="0" y={HORIZON_H} width={SCENE_W} height={SCENE_H - HORIZON_H} className={styles.nightShade} /> : null}

        {/* Flooded bands dim before the water sweeps over them, as the rules say. */}
        {BANDS.filter(band => band > 0).map(band => {
          const flood = floodTime(state, band);
          const flooded = flood !== undefined && flood !== null && state.time >= flood;
          return flooded || flood === undefined ? <rect key={band} x="0" y={bandTop(band)} width={SCENE_W} height={BAND_H} className={styles.wet} /> : null;
        })}

        {/* The water. Its edge is animated by CSS between ticks; the sheet stops at the horizon. */}
        <g clipPath="url(#lt-sea-clip)">
          <g className={styles.water} style={{ transform: `translateY(${edge - SCENE_H}px)` }}>
            {/* Wet sand just beyond the edge, so the margin of the sea is visible as it moves. */}
            <rect x="0" y={SCENE_H} width={SCENE_W} height="14" fill="url(#lt-wet)" />
            <rect x="0" y="0" width={SCENE_W} height={SCENE_H} fill="url(#lt-depth)" />
            <rect x="0" y="0" width={SCENE_W} height={SCENE_H} fill="url(#lt-waves)" className={styles.waves} />
            <path d={waveAt(SCENE_H - 1)} className={styles.foam} />
          </g>
        </g>

        {/* Moon, and its glint on whatever water lies below it. */}
        {dark ? (
          <g className={styles.night}>
            <circle cx={MOON_X} cy="7" r="14" fill="url(#lt-moon-halo)" />
            <circle cx={MOON_X} cy="7" r="5" className={styles.moon} />
            <g className={styles.glint}>
              {GLINT.map(([y, w], i) => (
                <rect key={y} x={MOON_X - w * 0.65} y={y} width={w * 1.3} height="2" rx="1" style={{ opacity: Math.max(0, Math.min(1, (Math.max(edge, HORIZON_H) - y) / 10)) * (0.85 - i * 0.07) }} />
              ))}
            </g>
          </g>
        ) : null}

        {/* Bands under water but within reach (waders, raft): outlined, so wading is a visible option. */}
        {BANDS.filter(band => band >= depth && beyondWaterline(state, band) <= reach(state)).map(band => (
          <g key={band}>
            <rect x="3" y={bandTop(band) + 3} width={SCENE_W - 6} height={BAND_H - 6} className={styles.reachableUnder} />
            <rect x="3" y={bandTop(band) + 3} width={SCENE_W - 6} height={BAND_H - 6} className={styles.reachable} />
            <text x={SCENE_W / 2} y={bandTop(band) + BAND_H / 2 + 4} textAnchor="middle" className={styles.reachLabel}>
              {beyondWaterline(state, band) === 1 ? "WADE · 1.5× TIME" : "RAFT · 2× TIME"}
            </text>
          </g>
        ))}

        {/* The low-water mark for this tide, so you can see how far out it will go / has gone. */}
        <line x1="0" x2={SCENE_W} y1={(4 - depth) * BAND_H} y2={(4 - depth) * BAND_H} className={styles.lowMarkUnder} />
        <line x1="0" x2={SCENE_W} y1={(4 - depth) * BAND_H} y2={(4 - depth) * BAND_H} className={styles.lowMark} />

        {/* A lantern warms the camp on dark tides. */}
        {dark && hasBuilt(state, "lantern") ? <circle cx="40" cy="206" r="100" fill="url(#lt-lantern)" className={styles.lanternGlow} /> : null}

        {/* Crew. */}
        {figures.map(figure => <Person key={figure.id} figure={figure} index={figure.id} />)}

        {/* Flood clocks drawn on the bands themselves. */}
        {BANDS.filter(band => band > 0 && band < depth).map(band => {
          const offset = floodOffset(depth, band, reach(state));
          if (typeof offset !== "number") return null;
          const left = offset - elapsed;
          if (left <= 0 || left > 60_000) return null;
          return (
            <text key={band} x={SCENE_W - 10} y={bandTop(band) + 16} textAnchor="end" className={styles.clock} data-soon={left < 15_000 || undefined}>
              {Math.ceil(left / 1000)}s
            </text>
          );
        })}
      </svg>

      {/* Tap targets: one per band, stacked over the drawing, in reading order from the sea to the shore. */}
      <div className={styles.targets}>
        {[...BANDS].reverse().map(band => (
          <button
            key={band}
            type="button"
            className={styles.target}
            aria-pressed={selected === band}
            aria-label={`${BAND_NAMES[band]}: ${describeBand(state, band)}`}
            onClick={() => onSelect(band)}
          >
            <span className={styles.targetName}>{BAND_NAMES[band]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Camp({ state, lit }: { state: State; lit: boolean }) {
  const built = (name: Parameters<typeof hasBuilt>[1]) => hasBuilt(state, name);
  return (
    <g className={styles.camp}>
      {/* Hut. */}
      <path d="M24 226 L24 208 L40 196 L56 208 L56 226 Z" className={styles.hut} />
      <rect x="36" y="214" width="8" height="12" className={styles.door} data-lit={lit && built("lantern") || undefined} />
      {built("shelter") ? <path d="M62 226 L62 212 L74 203 L86 212 L86 226 Z" className={styles.hut} /> : null}
      {built("kiln") ? <><path d="M96 226 L98 206 L112 206 L114 226 Z" className={styles.kiln} /><rect x="103" y="198" width="4" height="8" className={styles.kiln} /></> : null}
      {built("fishTrap") ? <path d="M120 226 L120 212 L128 212 L128 226 M124 212 L124 204 M118 206 Q124 200 130 206" className={styles.netLines} /> : null}
      {built("sled") ? <path d="M132 222 L142 222 Q146 222 146 218 M134 218 L144 218" className={styles.netLines} /> : null}
      {built("winch") ? <><rect x="210" y="212" width="14" height="10" className={styles.kiln} /><circle cx="217" cy="209" r="4" className={styles.netLines} /></> : null}
      {built("net") ? <path d="M146 226 L146 206 M146 206 L170 206 M170 206 L170 226 M150 210 L166 222 M166 210 L150 222" className={styles.netLines} /> : null}
      {built("raft") ? <rect x="178" y="214" width="26" height="8" className={styles.raft} /> : null}
      {built("lantern") ? <><path d="M14 226 L14 204" className={styles.netLines} /><circle cx="14" cy="201" r="3.4" className={styles.lamp} />{lit ? <circle cx="14" cy="201" r="8" fill="#ffcf6e" opacity=".45" /> : null}</> : null}
      {built("bellTower") || built("beacon") ? (
        <g>
          <path d="M318 226 L320 182 L340 182 L342 226 Z" className={styles.tower} />
          <path d="M320 196 L340 196 M319 210 L341 210" className={styles.towerLines} />
          {built("beacon") ? <><path d="M324 182 L330 170 L336 182 Z" className={styles.flame} /><circle cx="330" cy="178" r="16" className={styles.flameGlow} /></> : null}
        </g>
      ) : null}
    </g>
  );
}

function Person({ figure, index }: { figure: Figure; index: number }) {
  const x = 40 + ((index * 73) % 220) + (figure.band === 0 ? 100 : 0);
  const y = bandTop(figure.band) + BAND_H * 0.55;
  const r = 13;
  const circumference = 2 * Math.PI * r;
  return (
    <g className={styles.person} data-queued={figure.queued || undefined} data-hungry={figure.hungry || undefined} transform={`translate(${x} ${y})`}>
      {figure.progress !== null ? (
        <>
          <circle r={r} className={styles.ringTrack} />
          <circle r={r} className={styles.ring} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - figure.progress)} transform="rotate(-90)" />
        </>
      ) : null}
      <circle cy="-5" r="3.2" className={styles.head} />
      <rect x="-2.6" y="-1.5" width="5.2" height="9" rx="1.5" className={styles.body} />
      <text y="24" textAnchor="middle" className={styles.name}>{figure.name}</text>
    </g>
  );
}

export function describeBand(state: State, band: Band): string {
  const flood = floodTime(state, band);
  if (flood === undefined) return "under water this tide";
  if (flood === null) return "dry all tide";
  const left = flood - state.time;
  if (left <= 0) return "flooded";
  // Past the waterline but within reach: workable until the turn, at a time penalty.
  if (band >= depthOf(state)) return beyondWaterline(state, band) === 1 ? "under water · wade until the turn, 1.5× time" : "under water · by raft until the turn, 2× time";
  const s = Math.ceil(left / 1000);
  return `floods in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
