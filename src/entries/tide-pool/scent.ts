import type { Vec2 } from "./types";

/** Scent field tuning. Concentration is "mass per cell"; sampling squashes it into [0,1). */
export const SCENT = {
  cols: 96,
  rows: 60,
  /** Diffusion coefficient in world units^2 / s. Larger = smoother, longer-range gradients. */
  diffusion: 60,
  /** Fractional decay per second. Together with diffusion: reach ≈ sqrt(diffusion / decay) ≈ 45 units. */
  decay: 0.03,
  /** Mass a single food particle deposits per second. ~0.8 gives a peak sample of ~0.3 at the source. */
  depositRate: 0.8,
  /** Values below this are snapped to zero so the field really does empty out. */
  floor: 1e-4,
};

/** Flow used to advect scent: uniform part plus a per-cell swirl grid (units/s). */
export type ScentFlow = { ux: number; uy: number; fx: Float32Array; fy: Float32Array };

/** Coarse concentration grid over the pool, cheap enough to update every few steps. */
export class ScentField {
  readonly cols: number;
  readonly rows: number;
  private readonly cellW: number;
  private readonly cellH: number;
  private data: Float32Array;
  private scratch: Float32Array;

  constructor(readonly width: number, readonly height: number, cols = SCENT.cols, rows = SCENT.rows) {
    this.cols = cols;
    this.rows = rows;
    this.cellW = width / cols;
    this.cellH = height / rows;
    this.data = new Float32Array(cols * rows);
    this.scratch = new Float32Array(cols * rows);
  }

  /** Add `amount` of scent at a point, spread bilinearly over the four nearest cells. */
  deposit(x: number, y: number, amount: number): void {
    const gx = Math.min(this.cols - 1, Math.max(0, x / this.cellW - 0.5));
    const gy = Math.min(this.rows - 1, Math.max(0, y / this.cellH - 0.5));
    const x0 = Math.min(this.cols - 2, Math.floor(gx));
    const y0 = Math.min(this.rows - 2, Math.floor(gy));
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * this.cols + x0;
    this.data[i] += amount * (1 - fx) * (1 - fy);
    this.data[i + 1] += amount * fx * (1 - fy);
    this.data[i + this.cols] += amount * (1 - fx) * fy;
    this.data[i + this.cols + 1] += amount * fx * fy;
  }

  /** Scent in [0, 1) at a point (bilinear). */
  sample(point: Vec2): number {
    const raw = this.raw(this.data, point.x / this.cellW - 0.5, point.y / this.cellH - 0.5);
    return raw <= 0 ? 0 : 1 - Math.exp(-raw);
  }

  /** Total mass in the field (diagnostics and tests). */
  total(): number {
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum;
  }

  /** Advect (optional), diffuse and decay by `dt`. Reflecting walls. */
  step(dt: number, flow?: ScentFlow): void {
    if (flow) this.advect(dt, flow);
    this.diffuse(dt);
  }

  private raw(grid: Float32Array, gxIn: number, gyIn: number): number {
    const gx = Math.min(this.cols - 1, Math.max(0, gxIn));
    const gy = Math.min(this.rows - 1, Math.max(0, gyIn));
    const x0 = Math.min(this.cols - 2, Math.floor(gx));
    const y0 = Math.min(this.rows - 2, Math.floor(gy));
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * this.cols + x0;
    const top = grid[i] * (1 - fx) + grid[i + 1] * fx;
    const bottom = grid[i + this.cols] * (1 - fx) + grid[i + this.cols + 1] * fx;
    return top * (1 - fy) + bottom * fy;
  }

  /** Semi-Lagrangian advection: each cell pulls from where its water came from. */
  private advect(dt: number, flow: ScentFlow): void {
    const { cols, rows } = this;
    const sx = dt / this.cellW;
    const sy = dt / this.cellH;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const vx = flow.ux + flow.fx[i];
        const vy = flow.uy + flow.fy[i];
        this.scratch[i] = this.raw(this.data, x - vx * sx, y - vy * sy);
      }
    }
    [this.data, this.scratch] = [this.scratch, this.data];
  }

  private diffuse(dt: number): void {
    const { cols, rows, data, scratch } = this;
    const kx = (SCENT.diffusion * dt) / (this.cellW * this.cellW);
    const ky = (SCENT.diffusion * dt) / (this.cellH * this.cellH);
    const keep = Math.max(0, 1 - SCENT.decay * dt);
    for (let y = 0; y < rows; y++) {
      const up = (y > 0 ? y - 1 : y) * cols;
      const down = (y < rows - 1 ? y + 1 : y) * cols;
      const row = y * cols;
      for (let x = 0; x < cols; x++) {
        const left = x > 0 ? x - 1 : x;
        const right = x < cols - 1 ? x + 1 : x;
        const c = data[row + x];
        const next = c + kx * (data[row + left] + data[row + right] - 2 * c) + ky * (data[up + x] + data[down + x] - 2 * c);
        const v = next * keep;
        scratch[row + x] = v < SCENT.floor ? 0 : v;
      }
    }
    this.scratch = data;
    this.data = scratch;
  }
}
