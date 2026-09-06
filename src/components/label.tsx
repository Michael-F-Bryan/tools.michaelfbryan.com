import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type LabelProps = Readonly<{
  children: ReactNode;
  className?: string;
  id?: string;
  /** Accent for kickers above headings; muted for metadata such as an entry's kind. */
  tone?: "accent" | "muted";
}>;

/** A small monospace utility label: section kickers and entry metadata. */
export function Label({
  children,
  className,
  id,
  tone = "accent",
}: LabelProps) {
  return (
    <span
      id={id}
      className={cn(
        "block font-mono text-xs font-bold uppercase tracking-label",
        tone === "accent" ? "text-accent" : "text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
