"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";

import { DISCLOSURE_SUMMARY, FIELD_LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./controls";
import { contrastRatio, hasSafeContrast, MIN_SCANNABLE_CONTRAST } from "./contrast";
import type { BuildResult } from "./payload";
import {
  ERROR_CORRECTION_DESCRIPTIONS,
  ERROR_CORRECTION_LEVELS,
  QrTooLargeError,
  renderToCanvas,
  renderToPngBlob,
  renderToSvgString,
  type ErrorCorrectionLevel,
} from "./qr-render";
import type { QrType } from "./types";

export type Appearance = {
  dark: string;
  light: string;
  errorCorrectionLevel: ErrorCorrectionLevel;
  exportSize: 512 | 1024 | 2048;
};

export const DEFAULT_APPEARANCE: Appearance = {
  dark: "#000000",
  light: "#ffffff",
  errorCorrectionLevel: "M",
  exportSize: 1024,
};

const PREVIEW_WIDTH = 288;
const EXPORT_SIZE_OPTIONS = [512, 1024, 2048] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Feedback = { kind: "success" | "error"; text: string } | null;

function noopSubscribe() {
  return () => {};
}

function getServerSnapshotFalse() {
  return false;
}

/**
 * Detects a browser capability without a server/client hydration mismatch:
 * the server snapshot is always `false`, and the real client snapshot is
 * read only once hydrated, which is what `useSyncExternalStore` guarantees.
 */
function useClientCapability(test: () => boolean): boolean {
  return useSyncExternalStore(noopSubscribe, test, getServerSnapshotFalse);
}

export function PreviewPanel({
  type,
  build,
  appearance,
  onAppearanceChange,
}: Readonly<{
  type: QrType;
  build: BuildResult | null;
  appearance: Appearance;
  onAppearanceChange: (next: Appearance) => void;
}>) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);

  const [rendered, setRendered] = useState<{ key: string; build: BuildResult | null; error: string | null }>({ key: "", build: null, error: null });
  const [copyFeedback, setCopyFeedback] = useState<Feedback>(null);
  const [shareFeedback, setShareFeedback] = useState<Feedback>(null);

  const clipboardImageSupported = useClientCapability(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.clipboard !== "undefined" &&
      typeof navigator.clipboard.write === "function" &&
      typeof window.ClipboardItem === "function",
  );
  const shareSupported = useClientCapability(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );

  const contrastOk = hasSafeContrast(appearance.dark, appearance.light);
  const ratio = contrastRatio(appearance.dark, appearance.light);
  const renderKey = JSON.stringify([type, build?.payload, appearance.dark, appearance.light, appearance.errorCorrectionLevel]);
  const lastGood = rendered.build;
  const renderError = rendered.key === renderKey ? rendered.error : null;
  const stale = !build || !contrastOk || rendered.key !== renderKey || renderError !== null;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const canvas = previewCanvasRef.current;
    if (!canvas || !build || !contrastOk) {
      return;
    }
    renderToCanvas(canvas, build.payload, appearance, PREVIEW_WIDTH)
      .then(() => {
        if (requestId !== requestIdRef.current) return;
        setRendered({ key: renderKey, build, error: null });
      })
      .catch((cause: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setRendered({ key: renderKey, build: null, error: cause instanceof QrTooLargeError
            ? cause.message
            : "Could not render this QR code. Try shortening the content." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, contrastOk]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      triggerRef.current?.focus();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  function exportWidth() {
    return appearance.exportSize;
  }

  function filename(extension: string) {
    const hint = build?.filenameHint ?? "code";
    return `qr-${type}-${hint}.${extension}`;
  }

  async function handleExportPng() {
    if (!build || !contrastOk) return;
    try {
      const blob = await renderToPngBlob(build.payload, appearance, exportWidth());
      downloadBlob(blob, filename("png"));
    } catch {
      setCopyFeedback({ kind: "error", text: "Could not create the PNG file." });
    }
  }

  async function handleExportSvg() {
    if (!build || !contrastOk) return;
    try {
      const svg = await renderToSvgString(build.payload, appearance, exportWidth());
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename("svg"));
    } catch {
      setCopyFeedback({ kind: "error", text: "Could not create the SVG file." });
    }
  }

  async function handleCopyImage() {
    if (!build || !contrastOk) return;
    try {
      const blob = renderToPngBlob(build.payload, appearance, exportWidth());
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
      setCopyFeedback({ kind: "success", text: "Copied the QR code image." });
    } catch {
      setCopyFeedback({ kind: "error", text: "Couldn't copy the image in this browser." });
    }
    setTimeout(() => setCopyFeedback(null), 3000);
  }

  async function handleShare() {
    if (!build || !contrastOk) return;
    try {
      const blob = await renderToPngBlob(build.payload, appearance, exportWidth());
      const file = new File([blob], filename("png"), { type: "image/png" });
      if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) {
        throw new Error("Sharing images isn't supported in this browser.");
      }
      await navigator.share({ files: [file], title: "QR code" });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setShareFeedback({ kind: "error", text: "Couldn't share the image from this browser." });
      setTimeout(() => setShareFeedback(null), 3000);
    }
  }

  async function openFullscreen(event: MouseEvent<HTMLButtonElement>) {
    if (!build || !contrastOk) return;
    const canvas = fullscreenCanvasRef.current;
    if (!canvas) return;
    triggerRef.current = event.currentTarget;
    try {
      await renderToCanvas(canvas, build.payload, appearance, Math.min(exportWidth(), 1024));
      dialogRef.current?.showModal();
    } catch {
      setCopyFeedback({ kind: "error", text: "Could not open the full-screen code." });
    }
  }

  const exportDisabled = stale;

  return (
    <div id="qr-preview" className="min-w-0 border border-rule bg-surface p-5 md:sticky md:top-8 sm:p-6">
      <p className={FIELD_LABEL}>Preview</p>

      <div className="relative mt-3 flex items-center justify-center border border-rule-subtle bg-panel p-4">
        <canvas
          ref={previewCanvasRef}
          width={PREVIEW_WIDTH}
          height={PREVIEW_WIDTH}
          className={`h-auto max-w-full ${stale && lastGood ? "opacity-30" : lastGood ? "" : "opacity-0"}`}
          aria-hidden="true"
        />
        {!lastGood && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
            Fill in the form to see a preview.
          </p>
        )}
        {lastGood && stale && (
          <p role="status" className="absolute inset-0 flex items-center justify-center bg-panel/80 px-6 text-center text-sm font-bold text-secondary">
            Preview is out of date — complete the form or adjust the settings.
          </p>
        )}
      </div>

      {renderError && (
        <p role="alert" className="mt-3 text-sm text-error">
          {renderError}
        </p>
      )}
      {!contrastOk && !renderError && (
        <p role="alert" className="mt-3 text-sm text-error">
          Colours are too close in contrast or inverted ({ratio.toFixed(1)}:1). Use a dark foreground on a light background;
          this tool requires at least {MIN_SCANNABLE_CONTRAST}:1 contrast. Test the result on your phone.
        </p>
      )}

      {lastGood && !stale && <p className="mt-4 text-base leading-6 text-ink">{lastGood.sentence}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className={PRIMARY_BUTTON} disabled={exportDisabled} onClick={handleExportPng}>
          Download PNG
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={exportDisabled} onClick={handleExportSvg}>
          Download SVG
        </button>
        {clipboardImageSupported && (
          <button type="button" className={SECONDARY_BUTTON} disabled={exportDisabled} onClick={handleCopyImage}>
            Copy image
          </button>
        )}
        {shareSupported && (
          <button type="button" className={SECONDARY_BUTTON} disabled={exportDisabled} onClick={handleShare}>
            Share
          </button>
        )}
        <button type="button" className={SECONDARY_BUTTON} disabled={exportDisabled} onClick={openFullscreen}>
          View full screen
        </button>
      </div>

      <p role="status" className="mt-2 min-h-5 text-sm text-secondary">
        {copyFeedback?.text ?? shareFeedback?.text ?? ""}
      </p>

      <details className="mt-4 text-sm text-muted">
        <summary className={DISCLOSURE_SUMMARY}>Check before printing</summary>
        <p>
        Scan the exported code yourself before printing or sharing it widely — appearance and content both affect
        whether a given scanner can read it.
        </p>
      </details>

      <details className="mt-5 border-t border-rule-subtle pt-3">
        <summary className={DISCLOSURE_SUMMARY}>View raw data</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all border border-rule-subtle bg-panel p-3 font-mono text-xs text-secondary">
          {build?.payload ?? ""}
        </pre>
      </details>

      <details className="mt-3 border-t border-rule-subtle pt-3">
        <summary className={DISCLOSURE_SUMMARY}>Appearance</summary>
        <div className="mt-3 grid gap-4">
          <div className="flex flex-wrap gap-6">
            <label className="text-sm">
              <span className="block font-bold text-ink">Foreground</span>
              <input
                type="color"
                value={appearance.dark}
                onChange={(event) => onAppearanceChange({ ...appearance, dark: event.target.value })}
                className="mt-1 h-9 w-14 border border-rule"
                aria-label="Foreground colour"
              />
            </label>
            <label className="text-sm">
              <span className="block font-bold text-ink">Background</span>
              <input
                type="color"
                value={appearance.light}
                onChange={(event) => onAppearanceChange({ ...appearance, light: event.target.value })}
                className="mt-1 h-9 w-14 border border-rule"
                aria-label="Background colour"
              />
            </label>
          </div>

          <label className="text-sm">
            <span className="block font-bold text-ink">Export size</span>
            <select
              value={appearance.exportSize}
              onChange={(event) =>
                onAppearanceChange({ ...appearance, exportSize: Number(event.target.value) as Appearance["exportSize"] })
              }
              className="mt-1 block border border-rule bg-surface px-2 py-1 text-sm"
            >
              {EXPORT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}×{size} px
                </option>
              ))}
            </select>
          </label>

          <details>
            <summary className={DISCLOSURE_SUMMARY}>Advanced: error correction</summary>
          <fieldset className="mt-2">
            <legend className="text-sm font-bold text-ink">Error correction</legend>
            <div className="mt-1 grid gap-2">
              {ERROR_CORRECTION_LEVELS.map((level) => (
                <label key={level} className="flex items-start gap-2 text-sm text-secondary">
                  <input
                    type="radio"
                    name="qr-ecc"
                    checked={appearance.errorCorrectionLevel === level}
                    onChange={() => onAppearanceChange({ ...appearance, errorCorrectionLevel: level })}
                    className="mt-1 accent-accent"
                  />
                  <span>{ERROR_CORRECTION_DESCRIPTIONS[level]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          </details>

          <p className="text-sm text-muted">
            No logos or decorative modules — overlays like these reduce how reliably scanners can read the code.
          </p>
        </div>
      </details>

      <p className="mt-5 border-t border-rule-subtle pt-3 text-sm text-muted">
        Everything above happens in this browser tab. Nothing you type is uploaded, logged, or saved.
      </p>

      <dialog
        ref={dialogRef}
        aria-label="QR code, full screen"
        className="m-auto max-w-[min(92vw,40rem)] border border-rule bg-surface p-6 backdrop:bg-ink/60"
      >
        <div className="flex flex-col items-center gap-4">
          <canvas ref={fullscreenCanvasRef} className="h-auto w-full max-w-[min(72vw,70vh)]" />
          <button type="button" className={SECONDARY_BUTTON} onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}
