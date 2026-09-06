import type { ReactNode } from "react";

type FigureProps = Readonly<{
  /** Short muted caption set beneath the figure. */
  caption?: ReactNode;
  children: ReactNode;
  className?: string;
}>;

/**
 * An illustrated figure with the standard muted caption beneath it. Figures
 * keep their own surface (rules, background, padding) because each
 * illustration frames itself differently; set it through `className`.
 */
export function Figure({ caption, children, className }: FigureProps) {
  return (
    <figure className={className}>
      {children}
      {caption ? (
        <figcaption
          className="mt-5 max-w-measure text-sm leading-6 text-muted"
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
