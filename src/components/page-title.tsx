import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageTitleProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/**
 * The display heading at the top of a page.
 *
 * String titles are split into unbreakable words so a hyphenated term such as
 * "AI-assisted" never wraps mid-word on narrow screens.
 */
export function PageTitle({ children, className }: PageTitleProps) {
  return (
    <h1
      className={cn(
        "text-4xl font-bold leading-display tracking-display text-balance sm:text-6xl",
        className,
      )}
    >
      {typeof children === "string" ? unbreakableWords(children) : children}
    </h1>
  );
}

function unbreakableWords(title: string) {
  return title.split(" ").map((word, index) => (
    <Fragment key={`${index}-${word}`}>
      {index > 0 ? " " : null}
      <span className="whitespace-nowrap">{word}</span>
    </Fragment>
  ));
}
