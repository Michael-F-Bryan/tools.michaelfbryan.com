/**
 * Class strings for the native form controls this entry builds its nine
 * forms from. Local to the entry: these are plain labelled inputs, selects
 * and buttons styled with site tokens, not a shared design-system layer.
 */

export const FIELD_LABEL = "block text-sm font-bold text-ink";

export const FIELD_HINT = "mt-1 text-sm text-muted";

export const FIELD_ERROR = "mt-1 text-sm text-error";

const FIELD_BASE =
  "mt-1 block w-full min-h-11 border border-rule bg-surface px-3 py-2 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent sm:min-h-0 sm:py-1.5 sm:text-sm";

export function fieldClass(invalid: boolean): string {
  return invalid ? `${FIELD_BASE} border-error` : FIELD_BASE;
}

export const CHECKBOX_ROW = "mt-3 flex items-center gap-2 text-sm text-secondary";

export const CHECKBOX_INPUT = "size-4 accent-accent";

export const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-accent bg-accent px-4 text-sm font-bold text-paper transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-panel disabled:text-muted sm:min-h-0 sm:py-2";

export const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-rule bg-surface px-4 text-sm font-bold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-rule-subtle disabled:text-muted sm:min-h-0 sm:py-2";

export const LINK_BUTTON =
  "inline-flex min-h-11 items-center px-1 text-secondary underline underline-offset-4 hover:text-accent sm:min-h-0 sm:px-0 focus-visible:outline-2 focus-visible:outline-accent";

export const DISCLOSURE_SUMMARY =
  "list-item min-h-11 cursor-pointer py-2 text-sm font-bold text-ink marker:text-muted focus-visible:outline-2 focus-visible:outline-accent";
