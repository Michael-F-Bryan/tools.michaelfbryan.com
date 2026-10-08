import type { Field, Glyph } from "./model";

export type Palette = Readonly<{ ink: string; accent: string; paper: string }>;

export function drawField(ctx: CanvasRenderingContext2D, field: Field, font: string, palette: Palette): void {
  const { width, height, cellW, cellH, ox, oy } = field.geometry;
  const baseline = cellH * 0.72;
  const cellX = (col: number) => ox + col * cellW;
  const cellY = (row: number) => oy + row * cellH;
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  const glyph = (g: Pick<Glyph, "ch" | "x" | "y" | "alpha">, colour: string) => {
    ctx.fillStyle = colour;
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
    ctx.fillText(g.ch, g.x, g.y + baseline);
  };
  for (const ghost of field.ghosts) glyph(ghost, palette.ink);
  for (const loose of field.loose) glyph(loose, palette.ink);
  for (const sentence of field.sentences) {
    if (sentence.held) {
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.12;
      for (let row = 0; row < sentence.height; row++) {
        const slots = sentence.slots.filter(slot => slot.dr === row && !slot.blank);
        if (!slots.length) continue;
        const left = Math.min(...slots.map(slot => slot.dc));
        const right = Math.max(...slots.map(slot => slot.dc));
        ctx.fillRect(cellX(sentence.col + left) - 3, cellY(sentence.row + row) + 2, (right - left + 1) * cellW + 6, cellH - 4);
      }
    }
    for (const attached of sentence.glyphs) if (attached) glyph(attached, sentence.held ? palette.accent : palette.ink);
    if (sentence.regrow && sentence.regrow.index < sentence.slots.length) {
      const slot = sentence.slots[sentence.regrow.index];
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = palette.accent;
      ctx.fillRect(cellX(sentence.col + slot.dc), cellY(sentence.row + slot.dr) + 3, cellW, cellH - 6);
    }
  }
  if (field.buffer && field.cursor) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.accent;
    const x = cellX(field.cursor.col), y = cellY(field.cursor.row);
    ctx.fillText(field.buffer, x, y + baseline);
    ctx.globalAlpha = field.reducedMotion || field.time % 1 < 0.6 ? 0.9 : 0.2;
    ctx.fillRect(x + cellW * field.buffer.length, y + 3, cellW, cellH - 6);
  }
  ctx.globalAlpha = 1;
}
