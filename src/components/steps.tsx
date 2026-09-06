import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StepsProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/**
 * An ordered sequence of steps, numbered from their order in the list.
 * Stacked on small screens and laid out in a row of equal columns from `sm`.
 */
export function Steps({ children, className }: StepsProps) {
  return (
    <ol
      className={cn(
        "grid overflow-hidden border border-rule bg-surface [counter-reset:step] sm:auto-cols-fr sm:grid-flow-col",
        className,
      )}
    >
      {children}
    </ol>
  );
}

type StepProps = Readonly<{
  children: ReactNode;
  title: string;
}>;

/** One step. The number is drawn from a CSS counter, so leave it out of the title. */
export function Step({ children, title }: StepProps) {
  return (
    <li className="group relative border-t border-rule px-5 py-6 [counter-increment:step] first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <span
        aria-hidden="true"
        className="font-mono text-xs font-bold text-accent before:content-[counter(step,decimal-leading-zero)]"
      />
      <strong className="mt-3 block text-lg">{title}</strong>
      <span className="mt-2 block text-sm leading-6 text-muted">{children}</span>
      <span
        aria-hidden="true"
        className="absolute -bottom-3 left-5 z-10 grid h-6 w-6 place-items-center rounded-full border border-rule bg-paper text-sm text-accent group-last:hidden sm:-right-3 sm:bottom-auto sm:left-auto sm:top-7 sm:-rotate-90"
      >
        ↓
      </span>
    </li>
  );
}
