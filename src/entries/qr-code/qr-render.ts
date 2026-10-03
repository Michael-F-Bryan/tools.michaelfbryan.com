import * as QRCode from "qrcode";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export const ERROR_CORRECTION_LEVELS: readonly ErrorCorrectionLevel[] = ["L", "M", "Q", "H"];

export const ERROR_CORRECTION_DESCRIPTIONS: Record<ErrorCorrectionLevel, string> = {
  L: "Low — about 7% error-correction capacity. Fits the most data at a given size.",
  M: "Medium (default) — about 15% error-correction capacity. A good balance for screens and printouts.",
  Q: "Quartile — about 25% error-correction capacity. More redundancy for exposed prints.",
  H: "High — about 30% error-correction capacity. More redundancy, but a denser code. Print it larger, not smaller.",
};

export type QrAppearance = {
  errorCorrectionLevel: ErrorCorrectionLevel;
  dark: string;
  light: string;
};

/** Standard 4-module quiet zone on every exported or previewed code. */
const QUIET_ZONE_MODULES = 4;

/** Thrown when the payload cannot fit in a QR code at the chosen error-correction level. */
export class QrTooLargeError extends Error {}

function toRenderOptions(appearance: QrAppearance, width: number) {
  return {
    errorCorrectionLevel: appearance.errorCorrectionLevel,
    margin: QUIET_ZONE_MODULES,
    width,
    color: { dark: appearance.dark, light: appearance.light },
  };
}

function wrapEncodingError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/too big|too big to be stored|overflow/i.test(message)) {
    throw new QrTooLargeError("This content is too long to fit in a QR code at the current error-correction level.");
  }
  throw cause instanceof Error ? cause : new Error(message);
}

export async function renderToCanvas(
  canvas: HTMLCanvasElement,
  payload: string,
  appearance: QrAppearance,
  width: number,
): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, payload, toRenderOptions(appearance, width));
    // The encoder sets fixed CSS dimensions as well as bitmap dimensions.
    // Leave sizing to our responsive CSS so narrow previews stay square.
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
  } catch (cause) {
    wrapEncodingError(cause);
  }
}

export async function renderToPngBlob(payload: string, appearance: QrAppearance, width: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderToCanvas(canvas, payload, appearance, width);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create a PNG image."))), "image/png");
  });
}

export async function renderToSvgString(payload: string, appearance: QrAppearance, width: number): Promise<string> {
  try {
    return await QRCode.toString(payload, { ...toRenderOptions(appearance, width), type: "svg" });
  } catch (cause) {
    return wrapEncodingError(cause);
  }
}
