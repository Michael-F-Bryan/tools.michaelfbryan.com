import { useRef, useState } from "react";

type ScrollHintState = "hidden" | "visible";

/**
 * Wraps a wide table in a horizontally scrollable region with an explicit,
 * accessible affordance (rather than a silent crop) for narrow viewports:
 * a focusable, named scroll region plus a "scroll -->" hint that disappears
 * once the region has actually been scrolled.
 */
export function ScrollableMatrix({
  ariaLabel,
  children,
}: Readonly<{ ariaLabel: string; children: React.ReactNode }>) {
  const [hint, setHint] = useState<ScrollHintState>("visible");
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        className="focus-visible:outline-2 focus-visible:outline-accent overflow-x-auto"
        onScroll={(event) => {
          if (event.currentTarget.scrollLeft > 4) setHint("hidden");
        }}
      >
        {children}
      </div>
      {hint === "visible" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bg-surface pl-2 font-mono text-xs text-muted sm:hidden"
          data-scroll-hint
        >
          scroll →
        </span>
      ) : null}
    </div>
  );
}

type CopyButtonProps = Readonly<{
  getText: () => string;
  label?: string;
}>;

/** A "Copy" text button that writes the current matrix text to the clipboard and reports the result. */
export function MatrixCopyButton({ getText, label = "Copy" }: CopyButtonProps) {
  const [status, setStatus] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText());
      setStatus(`Copied ${getText().split("\n")[0]}`);
    } catch {
      setStatus("Could not copy — clipboard access was refused");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className="font-mono text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
      <span aria-hidden="true" className="text-sm text-muted">
        {status}
      </span>
    </>
  );
}

type RotationTableProps = Readonly<{
  name: string;
  takes: string;
  gives: string;
  columnHeaders: readonly [string, string, string];
  rowHeaders: readonly [string, string, string];
  rows: readonly (readonly [string, string, string])[];
  ariaLabel: string;
  onInvert: () => void;
  invertLabel: string;
  copyText: string;
}>;

/** A read-only 3x3 rotation matrix: name, takes/gives statement, table, invert and copy. */
export function RotationTable({
  name,
  takes,
  gives,
  columnHeaders,
  rowHeaders,
  rows,
  ariaLabel,
  onInvert,
  invertLabel,
  copyText,
}: RotationTableProps) {
  return (
    <div>
      <span className="block font-mono text-base font-bold text-ink">{name}</span>
      <span className="mt-1 block text-sm text-secondary">
        <strong className="text-ink">Takes</strong> {takes} · <strong className="text-ink">gives</strong> {gives}.
      </span>
      <table
        aria-label={ariaLabel}
        className="mt-3 border-l-2 border-r-2 border-ink font-mono text-sm tabular-nums"
      >
        <thead>
          <tr>
            <th scope="col" />
            {columnHeaders.map((header) => (
              <th key={header} scope="col" className="px-3 pb-1 text-xs font-normal tracking-label text-muted">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={rowHeaders[r]}>
              <th scope="row" className="pr-2 text-left text-xs uppercase tracking-label text-muted">
                {rowHeaders[r]}
              </th>
              {row.map((cell, c) => (
                <td key={`${rowHeaders[r]}-${c}`} className="whitespace-nowrap px-3 py-0.5 text-right">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onInvert}
          className="font-mono text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {invertLabel}
        </button>
        <span className="text-sm text-muted">the inverse of a rotation is its transpose</span>
        <MatrixCopyButton getText={() => copyText} />
      </div>
    </div>
  );
}

type TransformTableProps = Readonly<{
  name: string;
  takes: string;
  gives: string;
  columnHeaders: readonly [string, string, string, string];
  rowHeaders: readonly [string, string, string];
  /** 3 rows x 4 columns: the rotation block (first 3 columns, tinted) plus the translation column. */
  rows: readonly (readonly [string, string, string, string])[];
  ariaLabel: string;
  onInvert?: () => void;
  invertLabel?: string;
  invertNote?: string;
  copyText: string;
}>;

/** A read-only 4x4 homogeneous transform, with a tinted rotation block and identified translation column. */
export function TransformTable({
  name,
  takes,
  gives,
  columnHeaders,
  rowHeaders,
  rows,
  ariaLabel,
  onInvert,
  invertLabel,
  invertNote,
  copyText,
}: TransformTableProps) {
  return (
    <div>
      <span className="block font-mono text-base font-bold text-ink">{name}</span>
      <span className="mt-1 block text-sm text-secondary">
        <strong className="text-ink">Takes</strong> {takes} · <strong className="text-ink">gives</strong> {gives}.
      </span>
      <ScrollableMatrix ariaLabel={`${name} matrix, scrollable`}>
        <table
          aria-label={ariaLabel}
          className="mt-3 border-l-2 border-r-2 border-ink font-mono text-sm tabular-nums"
        >
          <thead>
            <tr>
              <th scope="col" />
              {columnHeaders.map((header) => (
                <th key={header} scope="col" className="px-3 pb-1 text-xs font-normal tracking-label text-muted">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={rowHeaders[r]}>
                <th scope="row" className="pr-2 text-left text-xs uppercase tracking-label text-muted">
                  {rowHeaders[r]}
                </th>
                {row.map((cell, c) => (
                  <td
                    key={`${rowHeaders[r]}-${c}`}
                    className={
                      c < 3
                        ? "whitespace-nowrap bg-accent/10 px-3 py-0.5 text-right"
                        : "whitespace-nowrap border-l border-dashed border-rule px-3 py-0.5 text-right text-secondary"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" />
              <td className="whitespace-nowrap px-3 py-0.5 text-right text-muted">0</td>
              <td className="whitespace-nowrap px-3 py-0.5 text-right text-muted">0</td>
              <td className="whitespace-nowrap px-3 py-0.5 text-right text-muted">0</td>
              <td className="whitespace-nowrap border-l border-dashed border-rule px-3 py-0.5 text-right text-muted">1</td>
            </tr>
          </tbody>
        </table>
      </ScrollableMatrix>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {onInvert && invertLabel ? (
          <button
            type="button"
            onClick={onInvert}
            className="font-mono text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {invertLabel}
          </button>
        ) : null}
        {invertNote ? <span className="text-sm text-muted">{invertNote}</span> : null}
        <MatrixCopyButton getText={() => copyText} />
      </div>
    </div>
  );
}
