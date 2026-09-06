import { useState } from "react";

/**
 * A local "draft" string that mirrors an external value but stays put while
 * the user is mid-edit. When the external value changes for a reason other
 * than the draft's own commit, the draft resets to it.
 *
 * Resets synchronously during render rather than in a `useEffect`, per
 * React's guidance for "adjusting state when a prop changes": comparing
 * against a `previous` value stored in state and calling `setState` in the
 * render body (not an effect) avoids an extra commit-then-effect render.
 */
export function useSyncedDraft(value: string): readonly [string, (next: string) => void, () => void] {
  const [previous, setPrevious] = useState(value);
  const [draft, setDraft] = useState(value);

  if (previous !== value) {
    setPrevious(value);
    setDraft(value);
  }

  return [draft, setDraft, () => setDraft(value)] as const;
}
