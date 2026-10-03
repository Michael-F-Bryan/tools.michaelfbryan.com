/**
 * Class strings for this entry's plain labelled inputs, selects and buttons,
 * styled with site tokens. Local to the entry, not a shared design-system
 * layer — see `qr-code/controls.ts` for the sibling pattern this mirrors.
 */

export const FIELD_LABEL = "block text-sm font-bold text-ink";

export const FIELD_HINT = "text-sm text-muted";

export const FIELD_ERROR = "text-sm text-error";

const FIELD_BASE =
  "mt-1 block min-h-11 w-full border border-rule bg-surface px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-accent sm:min-h-0 sm:py-1.5 sm:text-sm";

export const FIELD_CLASS = FIELD_BASE;

export const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-accent bg-accent px-4 text-sm font-bold text-paper transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-panel disabled:text-muted sm:min-h-0 sm:py-2";

export const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-rule bg-surface px-4 text-sm font-bold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-rule-subtle disabled:text-muted sm:min-h-0 sm:py-2";

export const LINK_BUTTON =
  "inline-flex min-h-11 items-center px-1 text-secondary underline underline-offset-4 hover:text-accent sm:min-h-0 sm:px-0 focus-visible:outline-2 focus-visible:outline-accent";
