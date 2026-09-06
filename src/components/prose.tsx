import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const sizes = {
  base: "leading-7",
  lg: "text-lg leading-8",
  xl: "text-xl leading-9",
} as const;

type ProseProps = Readonly<{
  children: ReactNode;
  className?: string;
  /** `lg` is running body text; `xl` is a standfirst or closing passage; `base` is a quieter follow-on note. */
  size?: keyof typeof sizes;
}>;

/** A run of paragraphs at the site's reading measure, in the secondary body colour. */
export function Prose({ children, className, size = "lg" }: ProseProps) {
  return (
    <div
      className={cn("max-w-measure space-y-6 text-secondary", sizes[size], className)}
    >
      {children}
    </div>
  );
}
