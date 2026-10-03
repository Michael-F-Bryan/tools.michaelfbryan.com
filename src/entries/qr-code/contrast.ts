export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A conservative product guardrail, not a QR specification or a guarantee
 * of scanning under every lighting condition. Keep dark modules on light.
 */
export const MIN_SCANNABLE_CONTRAST = 4.5;

export function hasSafeContrast(foreground: string, background: string): boolean {
  if (!HEX_COLOR_RE.test(foreground) || !HEX_COLOR_RE.test(background)) return false;
  return relativeLuminance(foreground) < relativeLuminance(background)
    && contrastRatio(foreground, background) >= MIN_SCANNABLE_CONTRAST;
}
