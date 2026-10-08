import { Markov, Vocabulary } from "./markov";
import { SIMILAR } from "./seeds";
import { pick, rand } from "./random";

export type Cell = Readonly<{ col: number; row: number }>;

/**
 * Everything the simulation needs to know about the space it draws into.
 * Measuring the DOM and the canvas font is the engine's job; the model only
 * ever sees the numbers that come out of that measurement.
 */
export type FieldGeometry = Readonly<{
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}>;

const DEFAULT_GEOMETRY: FieldGeometry = { cols: 20, rows: 8, cellW: 10, cellH: 16, ox: 0, oy: 0, width: 200, height: 128 };

type Slot = Readonly<{ dc: number; dr: number; blank?: boolean }>;

export class Sentence {
  text: string;
  col: number;
  row: number;
  slots: Slot[] = [];
  glyphs: Array<Glyph | null> = [];
  held = false;
  regrow: { index: number; timer: number } | null = null;
  lastReread = -999;
  width = 0;
  height = 0;

  constructor(text: string, col: number, row: number) {
    this.text = text;
    this.col = col;
    this.row = row;
  }
}

export class Glyph {
  ch: string;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  alpha = 1;
  loose = false;
  fading = false;
  fragility = rand(0.55, 1.6);
  born = 0;
  sentence: Sentence | null;
  index: number;
  readonly origin: Sentence | null;

  constructor(ch: string, x: number, y: number, sentence: Sentence, index: number) {
    this.ch = ch;
    this.x = x;
    this.y = y;
    this.sentence = sentence;
    this.index = index;
    this.origin = sentence;
  }
}

export type Ghost = { ch: string; x: number; y: number; alpha: number };

export type SoundEvent = Readonly<{ y: number; gain: number; duration: number }>;

export const MAX_SENTENCES = 90;

/**
 * The letter field: layout, decay (fading/misremembering/drift), adoption
 * into neighbouring sentences, and the Markov "re-reading" of exhausted
 * sentences. Pure simulation state — no canvas, no audio, no DOM. The
 * engine measures the page and calls {@link Field.resize}; drawing and
 * sound live outside this class and read its public state each frame.
 */
export class Field {
  readonly sentences: Sentence[] = [];
  loose: Glyph[] = [];
  readonly ghosts: Ghost[] = [];
  time = 0;
  cursor: Cell | null = null;
  buffer = "";
  lostCount = 0;
  tideAngle = rand(0, Math.PI * 2);
  reducedMotion = false;
  geometry: FieldGeometry = DEFAULT_GEOMETRY;

  private markov = new Markov();
  private markovAge = Infinity;
  private readonly vocabulary: Vocabulary;
  private readonly seeds: readonly string[];
  private pendingSounds: SoundEvent[] = [];

  constructor(seeds: readonly string[]) {
    this.seeds = seeds;
    this.vocabulary = new Vocabulary(seeds);
  }

  /** Re-measured container/font metrics: re-anchors every sentence without animating the jump. */
  resize(geometry: FieldGeometry): void {
    this.geometry = geometry;
    for (const sentence of this.sentences) {
      sentence.col = Math.max(0, Math.min(sentence.col, Math.max(0, geometry.cols - 4)));
      sentence.row = Math.max(0, Math.min(sentence.row, Math.max(0, geometry.rows - 1)));
      this.layout(sentence);
      if (sentence.row + sentence.height > geometry.rows) sentence.row = Math.max(0, geometry.rows - sentence.height);
      for (let i = 0; i < sentence.glyphs.length; i++) {
        const glyph = sentence.glyphs[i];
        if (!glyph) continue;
        const home = this.home(sentence, i);
        glyph.x = home.x;
        glyph.y = home.y;
        glyph.vx = 0;
        glyph.vy = 0;
      }
    }
  }

  /** Breaks a sentence into grid cells, wrapping at word boundaries. Drops glyphs whose slot disappeared. */
  private layout(sentence: Sentence): void {
    const maxWidth = Math.max(8, this.geometry.cols - sentence.col);
    const slots: Slot[] = [];
    let column = 0, row = 0, index = 0;
    const words = sentence.text.split(" ");
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (column > 0 && column + word.length > maxWidth) {
        column = 0;
        row++;
      }
      for (let k = 0; k < word.length; k++) {
        if (column >= maxWidth) {
          column = 0;
          row++;
        }
        slots[index++] = { dc: column++, dr: row };
      }
      if (w < words.length - 1) {
        if (column >= maxWidth) {
          column = 0;
          row++;
          slots[index++] = { dc: 0, dr: row, blank: true };
        } else {
          slots[index++] = { dc: column++, dr: row };
        }
      }
    }
    sentence.slots = slots;
    sentence.height = row + 1;
    sentence.width = 0;
    for (const slot of slots) sentence.width = Math.max(sentence.width, slot.dc + 1);

    for (let k = 0; k < sentence.glyphs.length; k++) {
      const glyph = sentence.glyphs[k];
      if (glyph && !slots[k]) {
        sentence.glyphs[k] = null;
        this.detach(glyph);
      }
    }
    sentence.glyphs.length = slots.length;
    for (let k = 0; k < slots.length; k++) if (sentence.glyphs[k] === undefined) sentence.glyphs[k] = null;
  }

  private cellX(col: number): number {
    return this.geometry.ox + col * this.geometry.cellW;
  }
  private cellY(row: number): number {
    return this.geometry.oy + row * this.geometry.cellH;
  }
  private home(sentence: Sentence, index: number): Cell & { x: number; y: number } {
    const slot = sentence.slots[index];
    return { col: sentence.col + slot.dc, row: sentence.row + slot.dr, x: this.cellX(sentence.col + slot.dc), y: this.cellY(sentence.row + slot.dr) };
  }

  cellAt(x: number, y: number): Cell {
    return { col: Math.floor((x - this.geometry.ox) / this.geometry.cellW), row: Math.floor((y - this.geometry.oy) / this.geometry.cellH) };
  }

  moveCursor(x: number, y: number): void { this.cursor = this.cellAt(x, y); }
  clearBuffer(): void { this.buffer = ""; }
  backspace(): void { this.buffer = this.buffer.slice(0, -1); }
  type(letter: string): void {
    this.cursor ??= { col: Math.max(0, Math.floor(this.geometry.cols / 2) - 12), row: Math.floor(this.geometry.rows / 2) };
    if (this.buffer.length < 140) this.buffer += letter;
  }

  private occupancy(): Uint8Array {
    const grid = new Uint8Array(this.geometry.cols * this.geometry.rows);
    for (const sentence of this.sentences) this.mark(grid, sentence);
    return grid;
  }
  private mark(grid: Uint8Array, sentence: Sentence): void {
    const { cols, rows } = this.geometry;
    for (let r = sentence.row - 1; r <= sentence.row + sentence.height; r++) {
      if (r < 0 || r >= rows) continue;
      for (let c = sentence.col - 1; c <= sentence.col + sentence.width; c++) {
        if (c < 0 || c >= cols) continue;
        grid[r * cols + c] = 1;
      }
    }
  }
  private fits(grid: Uint8Array, sentence: Sentence): boolean {
    const { cols, rows } = this.geometry;
    if (sentence.row + sentence.height > rows || sentence.col + sentence.width > cols) return false;
    for (let r = sentence.row; r < sentence.row + sentence.height; r++)
      for (let c = sentence.col; c < sentence.col + sentence.width; c++) if (grid[r * cols + c]) return false;
    return true;
  }

  /** Plants every seed sentence at a free spot, then builds the first Markov chain. */
  seed(): void {
    const grid = this.occupancy();
    const order = [...this.seeds].sort(() => Math.random() - 0.5);
    for (const text of order) {
      const sentence = this.place(text, grid);
      if (!sentence) continue;
      for (let i = 0; i < sentence.slots.length; i++) {
        if (sentence.slots[i].blank) continue;
        const home = this.home(sentence, i);
        const glyph = new Glyph(text[i], home.x, home.y, sentence, i);
        glyph.born = this.time;
        sentence.glyphs[i] = glyph;
      }
    }
    this.rebuildMarkov();
  }

  private place(text: string, grid: Uint8Array): Sentence | null {
    const sentence = new Sentence(text, 0, 0);
    for (let tries = 0; tries < 80; tries++) {
      sentence.col = Math.floor(rand(0, Math.max(1, this.geometry.cols - Math.min(text.length, 24))));
      sentence.row = Math.floor(rand(0, this.geometry.rows));
      this.layout(sentence);
      if (this.fits(grid, sentence)) {
        this.mark(grid, sentence);
        this.sentences.push(sentence);
        return sentence;
      }
    }
    return null;
  }

  /** A sentence spoken into a place: instantly, or letter by letter via `regrow`. */
  private speak(text: string, col: number, row: number, instant: boolean): Sentence {
    if (this.sentences.length >= MAX_SENTENCES) {
      const faintest = this.faintest();
      if (faintest) this.washAway(faintest);
    }
    const sentence = new Sentence(text, 0, 0);
    sentence.col = Math.max(0, Math.min(col, this.geometry.cols - Math.min(text.length, 24)));
    sentence.row = Math.max(0, Math.min(row, this.geometry.rows - 1));
    this.layout(sentence);
    if (sentence.row + sentence.height > this.geometry.rows) sentence.row = Math.max(0, this.geometry.rows - sentence.height);
    this.sentences.push(sentence);
    if (instant) {
      for (let i = 0; i < sentence.slots.length; i++) {
        if (sentence.slots[i].blank) continue;
        const home = this.home(sentence, i);
        const glyph = new Glyph(text[i], home.x, home.y, sentence, i);
        glyph.born = this.time;
        sentence.glyphs[i] = glyph;
      }
    } else {
      sentence.regrow = { index: 0, timer: 0 };
    }
    sentence.lastReread = this.time;
    this.markovAge = Infinity;
    return sentence;
  }

  private faintest(): Sentence | null {
    let best: Sentence | null = null;
    let bestRatio = 2;
    for (const sentence of this.sentences) {
      if (sentence.held) continue;
      const ratio = this.liveRatio(sentence);
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = sentence;
      }
    }
    return best;
  }

  private liveRatio(sentence: Sentence): number {
    let live = 0, total = 0;
    for (let i = 0; i < sentence.slots.length; i++) {
      if (sentence.slots[i].blank || sentence.text[i] === " ") continue;
      total++;
      if (sentence.glyphs[i]) live++;
    }
    return total ? live / total : 0;
  }

  private washAway(sentence: Sentence): void {
    for (let i = 0; i < sentence.glyphs.length; i++) {
      const glyph = sentence.glyphs[i];
      if (glyph) {
        sentence.glyphs[i] = null;
        this.detach(glyph);
      }
    }
    const index = this.sentences.indexOf(sentence);
    if (index >= 0) this.sentences.splice(index, 1);
  }

  /** Sends a glyph adrift. Callers must already have cleared its slot. */
  private detach(glyph: Glyph): void {
    glyph.loose = true;
    glyph.sentence = null;
    glyph.index = -1;
    const speed = this.reducedMotion ? 0 : rand(4, 14);
    glyph.vx = this.reducedMotion ? 0 : Math.cos(this.tideAngle) * speed + rand(-3, 3);
    glyph.vy = this.reducedMotion ? 0 : Math.sin(this.tideAngle) * speed + rand(-3, 3);
    this.loose.push(glyph);
  }

  /** A letter leaves its sentence: fades in place, or drifts off, depending on chance. */
  private lose(glyph: Glyph): void {
    const sentence = glyph.sentence;
    if (!sentence) return;
    sentence.glyphs[glyph.index] = null;
    this.lostCount++;
    this.emitSound(glyph.y, 0.5, rand(0.9, 1.8));
    if (Math.random() < 0.35 || this.reducedMotion) {
      glyph.loose = true;
      glyph.fading = true;
      glyph.sentence = null;
      glyph.index = -1;
      glyph.vx = 0;
      glyph.vy = 0;
      this.loose.push(glyph);
    } else {
      this.detach(glyph);
    }
  }

  /** A letter slips to a visually similar glyph, or a neighbour in the alphabet. */
  private slip(glyph: Glyph): void {
    const lower = glyph.ch.toLowerCase();
    let next: string | null = null;
    const similar = SIMILAR[lower];
    if (similar && Math.random() < 0.6) next = pick(similar.split(""));
    else if (/[a-z]/.test(lower)) {
      const code = lower.charCodeAt(0) + (Math.random() < 0.5 ? -1 : 1);
      if (code >= 97 && code <= 122) next = String.fromCharCode(code);
    }
    if (!next || next === " ") return;
    glyph.ch = glyph.ch === lower ? next : next.toUpperCase();
  }

  private rebuildMarkov(): void {
    const markov = new Markov();
    for (const text of this.seeds) markov.feed(text, 2);
    for (const sentence of this.sentences) {
      if (sentence.regrow || this.liveRatio(sentence) < 0.65) continue;
      let text = "";
      for (let i = 0; i < sentence.slots.length; i++) {
        if (sentence.slots[i].blank) {
          text += " ";
          continue;
        }
        const glyph = sentence.glyphs[i];
        text += glyph ? glyph.ch : " ";
      }
      // A single stray letter is not a word, except the ones that are. A
      // misremembered word is only sometimes believed, or the field drifts
      // toward noise instead of ever-more-faithful copies of the seeds.
      const words = text
        .split(/\s+/)
        .filter((word) => word.length > 1 || /^[IAa]$/.test(word))
        .filter((word) => this.vocabulary.has(word) || Math.random() < 0.1);
      if (words.length >= 3) markov.feed(words.join(" "), 1.5);
    }
    this.markov = markov;
    this.markovAge = 0;
  }

  private reread(sentence: Sentence): void {
    const text = this.markov.generate(this.seeds);
    for (let i = 0; i < sentence.glyphs.length; i++) {
      const glyph = sentence.glyphs[i];
      if (glyph) {
        sentence.glyphs[i] = null;
        this.detach(glyph);
      }
    }
    sentence.text = text;
    sentence.glyphs = [];
    this.layout(sentence);
    if (sentence.row + sentence.height > this.geometry.rows) sentence.row = Math.max(0, this.geometry.rows - sentence.height);
    sentence.regrow = { index: 0, timer: 0 };
    sentence.lastReread = this.time;
  }

  /** The sentence (if any) with a glyph under, or adjacent to, this point. */
  sentenceAt(x: number, y: number): Sentence | null {
    const cell = this.cellAt(x, y);
    for (const sentence of this.sentences) {
      if (cell.row < sentence.row - 1 || cell.row > sentence.row + sentence.height || cell.col < sentence.col - 1 || cell.col > sentence.col + sentence.width)
        continue;
      for (let i = 0; i < sentence.slots.length; i++) {
        const slot = sentence.slots[i];
        if (!sentence.glyphs[i]) continue;
        if (Math.abs(sentence.col + slot.dc - cell.col) <= 1 && sentence.row + slot.dr === cell.row) return sentence;
      }
    }
    return null;
  }

  hold(sentence: Sentence | null): void {
    if (sentence) sentence.held = true;
  }
  release(sentence: Sentence | null): void {
    if (sentence) sentence.held = false;
  }

  /** Stirs the field near a point: pushes loose glyphs and unheld sentence glyphs off their rest positions. */
  stir(x: number, y: number, dx: number, dy: number): void {
    const radius = 70, push = this.reducedMotion ? 0 : 0.9;
    const radiusSquared = radius * radius;
    const apply = (glyph: Glyph) => {
      const ex = glyph.x + this.geometry.cellW / 2 - x, ey = glyph.y + this.geometry.cellH / 2 - y;
      const distanceSquared = ex * ex + ey * ey;
      if (distanceSquared > radiusSquared) return;
      const k = (1 - distanceSquared / radiusSquared) * push;
      glyph.vx += dx * k * 2;
      glyph.vy += dy * k * 2;
    };
    for (const glyph of this.loose) apply(glyph);
    for (const sentence of this.sentences) {
      if (sentence.held) continue;
      for (const glyph of sentence.glyphs) if (glyph) apply(glyph);
    }
  }

  /** Plants a sentence of the visitor's own at `cell` (or the last known cursor cell). Returns null for empty input. */
  plant(text: string, cell: Cell | null): Sentence | null {
    const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!trimmed) return null;
    this.vocabulary.learn(trimmed);
    const target = cell ??
      this.cursor ?? { col: Math.floor(this.geometry.cols / 2) - Math.min(12, Math.floor(trimmed.length / 2)), row: Math.floor(this.geometry.rows / 2) };
    const sentence = this.speak(trimmed, target.col, target.row, true);
    for (const glyph of sentence.glyphs) if (glyph) glyph.fragility = rand(0.7, 1.4);
    return sentence;
  }

  /** Re-reads a new sentence into an empty place that was clicked or tapped. */
  speakAt(cell: Cell): Sentence {
    const text = this.markov.generate(this.seeds);
    return this.speak(text, Math.max(0, cell.col - 2), cell.row, false);
  }

  private emitSound(y: number, gain: number, duration: number): void {
    this.pendingSounds.push({ y, gain, duration });
  }

  /** Returns and clears the sound events emitted since the last call. */
  drainSoundEvents(): readonly SoundEvent[] {
    if (!this.pendingSounds.length) return [];
    const events = this.pendingSounds;
    this.pendingSounds = [];
    return events;
  }

  tick(dt: number): void {
    this.time += dt;
    this.markovAge += dt;
    if (this.markovAge > 7) this.rebuildMarkov();
    this.tideAngle += dt * 0.03;
    const tide = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.time / 37 + 1.2));
    const pLose = 0.0055 * tide * dt;
    const pSlip = 0.0011 * tide * dt;
    const damp = Math.pow(0.08, dt);
    const homing = 1 - Math.pow(0.0025, dt);
    const { cellW, cellH, width, height } = this.geometry;

    // Empty slots a passing loose letter might settle into.
    const empties = new Map<string, { sentence: Sentence; index: number }>();
    for (const sentence of this.sentences) {
      if (sentence.regrow) continue;
      for (let i = 0; i < sentence.slots.length; i++) {
        const slot = sentence.slots[i];
        if (!slot.blank && !sentence.glyphs[i] && sentence.text[i] !== " ")
          empties.set(`${sentence.col + slot.dc},${sentence.row + slot.dr}`, { sentence, index: i });
      }
    }

    for (const sentence of this.sentences) {
      if (sentence.regrow) {
        sentence.regrow.timer -= dt;
        while (sentence.regrow.timer <= 0 && sentence.regrow.index < sentence.slots.length) {
          const i = sentence.regrow.index++;
          const ch = sentence.text[i];
          if (!sentence.slots[i].blank && ch !== " ") {
            const home = this.home(sentence, i);
            const glyph = new Glyph(ch, home.x, home.y, sentence, i);
            glyph.born = this.time;
            glyph.alpha = 0.2;
            sentence.glyphs[i] = glyph;
            this.emitSound(home.y, 0.12, 0.25);
          }
          sentence.regrow.timer += 0.045;
        }
        if (sentence.regrow.index >= sentence.slots.length) sentence.regrow = null;
      }

      const lifting = sentence.held;
      for (let i = 0; i < sentence.glyphs.length; i++) {
        const glyph = sentence.glyphs[i];
        if (!glyph) continue;
        const home = this.home(sentence, i);
        glyph.vx *= damp;
        glyph.vy *= damp;
        glyph.x += glyph.vx * dt;
        glyph.y += glyph.vy * dt;
        glyph.x += (home.x - glyph.x) * homing;
        glyph.y += (home.y - glyph.y) * homing;
        const distanceFromHome = Math.abs(glyph.x - home.x) + Math.abs(glyph.y - home.y);
        if (distanceFromHome > cellW * 2.4 && !lifting) {
          sentence.glyphs[i] = null;
          glyph.sentence = null;
          glyph.index = -1;
          glyph.loose = true;
          this.loose.push(glyph);
          this.lostCount++;
          this.emitSound(glyph.y, 0.4, 1.2);
          continue;
        }
        if (glyph.alpha < 1) glyph.alpha = Math.min(1, glyph.alpha + dt * (lifting ? 1.2 : 0.5));
        if (lifting || sentence.regrow) continue;
        const fragility = glyph.fragility * Math.min(1, (this.time - glyph.born) / 25 + 0.15);
        const roll = Math.random();
        if (roll < pLose * fragility) this.lose(glyph);
        else if (roll < (pLose + pSlip) * fragility) this.slip(glyph);
      }

      if (!sentence.held && !sentence.regrow && this.time - sentence.lastReread > 25 && this.liveRatio(sentence) < 0.5) this.reread(sentence);
    }

    const keep: Glyph[] = [];
    for (const glyph of this.loose) {
      if (glyph.fading || this.reducedMotion) {
        glyph.alpha -= dt * 0.22;
      } else {
        glyph.vx += rand(-6, 6) * dt;
        glyph.vy += rand(-6, 6) * dt;
        glyph.vx *= Math.pow(0.5, dt);
        glyph.vy *= Math.pow(0.5, dt);
        glyph.x += glyph.vx * dt;
        glyph.y += glyph.vy * dt;
        glyph.alpha -= dt * 0.085;

        // Called back by a held sentence it originally belonged to.
        if (glyph.origin?.held && this.sentences.includes(glyph.origin)) {
          const origin = glyph.origin;
          let targetIndex = -1;
          for (let i = 0; i < origin.slots.length; i++) {
            if (!origin.slots[i].blank && !origin.glyphs[i] && origin.text[i] !== " ") {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex >= 0) {
            const home = this.home(origin, targetIndex);
            const distance = Math.hypot(home.x - glyph.x, home.y - glyph.y);
            if (distance < 220) {
              glyph.loose = false;
              glyph.sentence = origin;
              glyph.index = targetIndex;
              glyph.vx = glyph.vy = 0;
              origin.glyphs[targetIndex] = glyph;
              glyph.alpha = Math.max(glyph.alpha, 0.4);
              continue;
            }
          }
        }

        // Or adopted by a sentence it happens to drift across.
        const cell = this.cellAt(glyph.x + cellW / 2, glyph.y + cellH / 2);
        const key = `${cell.col},${cell.row}`;
        const empty = empties.get(key);
        if (empty && !empty.sentence.regrow && glyph.alpha > 0.12) {
          const home = this.home(empty.sentence, empty.index);
          if (Math.abs(home.x - glyph.x) < cellW * 0.9 && Math.abs(home.y - glyph.y) < cellH * 0.6) {
            empties.delete(key);
            glyph.loose = false;
            glyph.sentence = empty.sentence;
            glyph.index = empty.index;
            glyph.vx = glyph.vy = 0;
            empty.sentence.glyphs[empty.index] = glyph;
            glyph.fragility = rand(0.8, 1.8);
            glyph.born = this.time;
            continue;
          }
        }
      }

      if (glyph.alpha <= 0.02 || glyph.x < -40 || glyph.x > width + 40 || glyph.y < -40 || glyph.y > height + 40) {
        if (this.ghosts.length < 500) this.ghosts.push({ ch: glyph.ch, x: glyph.x, y: glyph.y, alpha: 0.32 });
        continue;
      }
      keep.push(glyph);
    }
    this.loose = keep;

    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const ghost = this.ghosts[i];
      ghost.alpha -= dt * 0.006;
      if (ghost.alpha <= 0.005) this.ghosts.splice(i, 1);
    }
  }

  stats(): { time: number; sentences: number; attached: number; loose: number; ghosts: number; lost: number; nan: number } {
    let attached = 0;
    for (const sentence of this.sentences) for (const glyph of sentence.glyphs) if (glyph) attached++;
    let nan = 0;
    const check = (glyph: Glyph) => {
      if (!Number.isFinite(glyph.x) || !Number.isFinite(glyph.y) || !Number.isFinite(glyph.alpha)) nan++;
    };
    for (const sentence of this.sentences) for (const glyph of sentence.glyphs) if (glyph) check(glyph);
    for (const glyph of this.loose) check(glyph);
    return { time: this.time, sentences: this.sentences.length, attached, loose: this.loose.length, ghosts: this.ghosts.length, lost: this.lostCount, nan };
  }
}
