import { useCallback, useEffect, useRef } from "react";

import { newestTime, slotOf, type History } from "./history";
import { speedColour, speedFraction } from "./speed-scale";
import styles from "./experiment.module.css";

/** Tells the history canvases that the record changed (a sample or a marker). */
export type HistoryFeed = Readonly<{ subscribe(listener: () => void): () => void; notify(): void }>;

export function createHistoryFeed(): HistoryFeed {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

type Palette = Readonly<{ ink: string; secondary: string; muted: string; rule: string; ruleSubtle: string; surface: string; accent: string; mono: string }>;

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: get("--ink", "#17191d"),
    secondary: get("--text-secondary", "#3f4956"),
    muted: get("--text-muted", "#586372"),
    rule: get("--rule", "#848d98"),
    ruleSubtle: get("--rule-subtle", "#c7ccd2"),
    surface: get("--surface", "#ffffff"),
    accent: get("--accent", "#164dcc"),
    mono: get("--font-mono", "monospace"),
  };
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette, canvas: HTMLCanvasElement) => void;

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * A crisp, device-pixel-ratio aware canvas that repaints only when the feed
 * reports new data, `draw` changes (e.g. the selection), the theme changes or
 * the canvas is resized. Repaints are coalesced into the next animation frame.
 */
function useHistoryCanvas(draw: Draw, feed: HistoryFeed) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const requestRef = useRef<() => void>(() => {});

  useEffect(() => {
    drawRef.current = draw;
    requestRef.current();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let palette = readPalette();
    let width = 0;
    let height = 0;
    let frame = 0;

    function paint() {
      frame = 0;
      if (!canvas || !ctx || width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawRef.current(ctx, width, height, palette, canvas);
    }
    function request() {
      if (!frame) frame = requestAnimationFrame(paint);
    }
    function retheme() {
      palette = readPalette();
      request();
    }
    requestRef.current = request;

    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      request();
    });
    resize.observe(canvas);
    const theme = new MutationObserver(retheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const dark = matchMedia(DARK_QUERY);
    dark.addEventListener("change", retheme);
    const unsubscribe = feed.subscribe(request);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      dark.removeEventListener("change", retheme);
      unsubscribe();
      requestRef.current = () => {};
    };
  }, [feed]);

  return canvasRef;
}

function setData(element: HTMLElement | null, name: string, value: number) {
  if (element && element.dataset[name] !== String(value)) element.dataset[name] = String(value);
}

const SPEED_BUCKETS = 40;
const GUTTER = 42;
const TOP = 30;
const BOTTOM = 22;
const RIGHT = 8;
const TICK_SECONDS = 30;
const LABEL_GAP = 13;

function drawSpaceTime(ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette, history: History, selected: number, maxSpeed: number) {
  const left = GUTTER;
  const right = width - RIGHT;
  const top = TOP;
  const bottom = height - BOTTOM;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  if (plotWidth <= 20 || plotHeight <= 20) return;
  const length = history.roadLength;
  const span = history.windowSeconds;
  const now = newestTime(history);
  const t0 = Math.max(0, now - span);
  const x = (position: number) => left + (position / length) * plotWidth;
  const y = (time: number) => top + ((time - t0) / span) * plotHeight;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${palette.mono}`;

  // Time ticks in the gutter, with very faint guides across the plot.
  ctx.font = font(10);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const tickYs: number[] = [];
  for (let t = Math.ceil(t0 / TICK_SECONDS) * TICK_SECONDS; t <= now + 1e-9; t += TICK_SECONDS) {
    const ty = Math.round(y(t)) + 0.5;
    tickYs.push(ty);
    ctx.strokeStyle = palette.ruleSubtle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, ty);
    ctx.lineTo(right, ty);
    ctx.stroke();
    ctx.strokeStyle = palette.rule;
    ctx.beginPath();
    ctx.moveTo(left - 4, ty);
    ctx.lineTo(left, ty);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.fillText(`${t} s`, left - 7, Math.min(bottom - 5, Math.max(top + 5, ty)));
  }
  const nowY = y(now);
  if (now > 0 && tickYs.every((ty) => Math.abs(ty - nowY) > 12)) {
    ctx.fillStyle = palette.secondary;
    ctx.fillText("now", left - 7, Math.min(bottom - 5, nowY));
  }

  // The seam: both edges are the roadside cut on the ring.
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  for (const edge of [left + 0.5, right - 0.5]) {
    ctx.moveTo(edge, top);
    ctx.lineTo(edge, bottom);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const edge of [left + 1, right - 1]) {
    ctx.moveTo(edge, top - 2);
    ctx.lineTo(edge, top - 8);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.ruleSubtle;
  ctx.beginPath();
  ctx.moveTo(left, top + 0.5);
  ctx.lineTo(right, top + 0.5);
  ctx.moveTo(left, bottom - 0.5);
  ctx.lineTo(right, bottom - 0.5);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.muted;
  ctx.font = font(11);
  ctx.textAlign = "left";
  ctx.fillText("0 m (cut)", left, top - 12);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(length)} m = 0 m`, right, top - 12);
  ctx.font = font(10);
  ctx.textAlign = "left";
  ctx.fillText("time ↓", 2, height - 7);
  ctx.textAlign = "center";
  ctx.fillText("direction of travel →", left + plotWidth / 2, height - 7);

  // Traces: every car, one stroke per speed colour.
  const n = history.carCount;
  const buckets: (Path2D | undefined)[] = new Array(SPEED_BUCKETS);
  const casing = new Path2D();
  const selectedBuckets: (Path2D | undefined)[] = new Array(SPEED_BUCKETS);
  for (let car = 0; car < n; car += 1) {
    const isSelected = car === selected;
    for (let i = 1; i < history.count; i += 1) {
      const a = slotOf(history, i - 1);
      const b = slotOf(history, i);
      const p0 = history.position[a * n + car];
      const p1 = history.position[b * n + car];
      const ta = history.time[a];
      const tb = history.time[b];
      const v = (history.speed[a * n + car] + history.speed[b * n + car]) / 2;
      const bucket = Math.round(speedFraction(v, maxSpeed) * (SPEED_BUCKETS - 1));
      const target = isSelected ? selectedBuckets : buckets;
      const path = (target[bucket] ??= new Path2D());
      const segments: [number, number, number, number][] = [];
      if (p1 < p0 - length / 2) {
        // Crossed the cut: leave at the right edge, re-enter at the left at the interpolated time.
        const f = (length - p0) / (p1 + length - p0);
        const tc = ta + f * (tb - ta);
        segments.push([p0, ta, length, tc], [0, tc, p1, tb]);
      } else if (p1 <= p0 + length / 2) {
        segments.push([p0, ta, p1, tb]);
      }
      for (const [xa, ya, xb, yb] of segments) {
        for (const target of isSelected ? [path, casing] : [path]) {
          target.moveTo(x(xa), y(ya));
          target.lineTo(x(xb), y(yb));
        }
      }
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, plotWidth, plotHeight);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  buckets.forEach((path, bucket) => {
    if (!path) return;
    ctx.strokeStyle = speedColour((bucket / (SPEED_BUCKETS - 1)) * maxSpeed, maxSpeed);
    ctx.stroke(path);
  });
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 6;
  ctx.stroke(casing);
  ctx.lineWidth = 3.6;
  selectedBuckets.forEach((path, bucket) => {
    if (!path) return;
    ctx.strokeStyle = speedColour((bucket / (SPEED_BUCKETS - 1)) * maxSpeed, maxSpeed);
    ctx.stroke(path);
  });
  ctx.restore();

  // Markers, newest first so the latest label wins a collision.
  ctx.font = font(10);
  ctx.textBaseline = "alphabetic";
  const placed: { y: number; side: "left" | "right" }[] = [];
  function label(text: string, ly: number, side: "left" | "right", colour: string) {
    if (ly < top + 10 || ly > bottom + 2) return;
    if (placed.some((other) => other.side === side && Math.abs(other.y - ly) < LABEL_GAP)) return;
    placed.push({ y: ly, side });
    const textWidth = ctx.measureText(text).width;
    const lx = side === "right" ? right - 4 - textWidth : left + 4;
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = palette.surface;
    ctx.fillRect(lx - 3, ly - 10, textWidth + 6, 13);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.textAlign = "left";
    ctx.fillText(text, lx, ly);
  }
  for (let index = history.markers.length - 1; index >= 0; index -= 1) {
    const marker = history.markers[index];
    const my = Math.round(y(marker.time)) + 0.5;
    if (marker.kind === "change") {
      ctx.strokeStyle = palette.secondary;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(left - 6, my);
      ctx.lineTo(right, my);
      ctx.stroke();
      ctx.setLineDash([]);
      label(marker.label, my - 4, "right", palette.secondary);
    } else {
      const mx = x(marker.position);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left - 7, my);
      ctx.lineTo(left - 1, my);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = palette.accent;
      ctx.fill();
      // Keep the label clear of the mark it names.
      const side = mx > left + plotWidth * 0.6 ? "left" : "right";
      label(`tap · car ${marker.car + 1}`, my + 14, side, palette.accent);
    }
  }
}

type HistoryViewProps = Readonly<{ history: History; feed: HistoryFeed; selected: number; maxSpeed: number }>;

/**
 * The ring unrolled at the cut: position across, simulated time down. Each
 * car's line runs rightwards; a jam is a band of slow (dark) segments that
 * drifts leftwards as time goes on.
 */
export function HistoryView({ history, feed, selected, maxSpeed }: HistoryViewProps) {
  const draw = useCallback<Draw>(
    (ctx, width, height, palette, canvas) => {
      setData(canvas.parentElement, "samples", history.count);
      setData(canvas.parentElement, "markers", history.markers.length);
      drawSpaceTime(ctx, width, height, palette, history, selected, maxSpeed);
    },
    [history, selected, maxSpeed],
  );
  const canvasRef = useHistoryCanvas(draw, feed);
  const minutes = history.windowSeconds / 60;
  return (
    <figure className={styles.history}>
      <div className={styles.historyPlot} data-testid="history">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Space-time history of the last ${minutes} minutes: position round the ring from the 0 m cut across, simulated time downwards, one line per car coloured by speed, with brake taps and setting changes marked.`}
        />
      </div>
      <figcaption className={styles.historyKey}>Each line is one car, moving right. Where cars slow, their lines kink dark; the kinks line up into jams that drift left.</figcaption>
    </figure>
  );
}

type SparklineProps = Readonly<{ history: History; feed: HistoryFeed; values: "meanSpeed" | "speedSpread"; max: number; label: string }>;

/** A small fixed-scale trace of one traffic statistic over the same window. */
export function Sparkline({ history, feed, values, max, label }: SparklineProps) {
  const draw = useCallback<Draw>(
    (ctx, width, height, palette) => {
      const now = newestTime(history);
      const t0 = Math.max(0, now - history.windowSeconds);
      const x = (time: number) => ((time - t0) / history.windowSeconds) * width;
      const y = (value: number) => height - 1.5 - (Math.min(max, Math.max(0, value)) / max) * (height - 3);
      ctx.lineWidth = 1;
      ctx.strokeStyle = palette.ruleSubtle;
      ctx.beginPath();
      ctx.moveTo(0, height - 0.5);
      ctx.lineTo(width, height - 0.5);
      ctx.stroke();
      ctx.strokeStyle = palette.rule;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const marker of history.markers) {
        const mx = Math.round(x(marker.time)) + 0.5;
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, height);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const series = history[values];
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < history.count; i += 1) {
        const slot = slotOf(history, i);
        const px = x(history.time[slot]);
        const py = y(series[slot]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    },
    [history, values, max],
  );
  const canvasRef = useHistoryCanvas(draw, feed);
  return <canvas ref={canvasRef} className={styles.spark} role="img" aria-label={label} />;
}
