import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Label } from "./label";

type SectionTitleProps = Readonly<{
  children: ReactNode;
  className?: string;
  id?: string;
}>;

/** A section heading. Give it an `id` so the enclosing section can be labelled by it. */
export function SectionTitle({ children, className, id }: SectionTitleProps) {
  return (
    <h2
      id={id}
      className={cn(
        "text-3xl font-bold leading-tight tracking-heading text-balance sm:text-4xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

type SectionProps = Readonly<{
  children: ReactNode;
  className?: string;
  /** Labels the section and identifies its heading. */
  id: string;
  /** The short accent label above the title. */
  kicker: string;
  title: string;
}>;

/**
 * A titled explainer section: kicker, heading, then the body.
 *
 * Sections with a subject-specific layout can compose `Label` and
 * `SectionTitle` inside their own `<section aria-labelledby>` instead.
 */
export function Section({
  children,
  className,
  id,
  kicker,
  title,
}: SectionProps) {
  return (
    <section aria-labelledby={id} className={className}>
      <Label>{kicker}</Label>
      <SectionTitle id={id} className="mt-4">
        {title}
      </SectionTitle>
      <div className="mt-7">{children}</div>
    </section>
  );
}
