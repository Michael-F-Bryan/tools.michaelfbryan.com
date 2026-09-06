import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StepsProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/**
 * An ordered sequence of steps, numbered from their order in the list.
 * Kept compact so a simple sequence does not turn into diagram theatre.
 */
export function Steps({ children, className }: StepsProps) {
  return (
    <ol
      className={cn(
        "border-t border-rule [counter-reset:step]",
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
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 border-b border-rule py-4 [counter-increment:step] sm:grid-cols-[2rem_12rem_minmax(0,1fr)] sm:items-baseline">
      <span
        aria-hidden="true"
        className="font-mono text-xs font-bold text-accent before:content-[counter(step,decimal-leading-zero)]"
      />
      <strong className="block text-base">{title}</strong>
      <span className="col-start-2 mt-1 block text-sm leading-6 text-muted sm:col-start-3 sm:mt-0">
        {children}
      </span>
    </li>
  );
}
