import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ContainerProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/** The page frame: centred, capped at the page width, with the site gutters. */
export function Container({ children, className }: ContainerProps) {
  return (
    <div className={cn("mx-auto max-w-page px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}
