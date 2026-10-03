"use client";

import { Dialog } from "@base-ui/react/dialog";

import { GITHUB_REPO_URL } from "@/lib/entry";
import type { EntryHistory } from "@/lib/entry-history";

const dateFormatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

type DevelopmentHistoryDialogProps = Readonly<{
  slug: string;
  title: string;
  history: EntryHistory;
}>;

/**
 * The "Development history" button in an entry's intro line and its
 * scrollable commit list. Shared across every catalogue entry, so it owns
 * its own file rather than living in `EntryPage` directly.
 */
export function DevelopmentHistoryDialog({ slug, title, history }: DevelopmentHistoryDialogProps) {
  const pathspec = `src/entries/${slug}`;

  return (
    <Dialog.Root>
      <Dialog.Trigger className="text-sm underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        Development history
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 border border-rule bg-surface p-5 text-ink shadow-lg transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-bold tracking-title">{title} — Development history</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-rule text-secondary hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ×
            </Dialog.Close>
          </div>

          {history.status === "available" ? (
            <>
              <Dialog.Description className="break-words text-sm text-secondary">
                Commits that touched <code className="font-mono [overflow-wrap:anywhere]">{pathspec}</code>. Shared infrastructure and
                site-wide changes aren&rsquo;t included. Earlier commits from the former tool directory are included.
              </Dialog.Description>
              <p className="text-sm text-secondary">
                Created {formatDate(history.createdAt)} · Updated {formatDate(history.updatedAt)} (UTC)
              </p>
              <ol className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 [overflow-wrap:anywhere]">
                {history.commits.map((commit) => (
                  <li key={commit.sha} className="border-t border-rule-subtle pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <a
                        href={`${GITHUB_REPO_URL}/commit/${commit.sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {commit.sha.slice(0, 7)}
                      </a>
                      <time dateTime={commit.committedAt} className="text-xs text-muted">
                        {formatDate(commit.committedAt)}
                      </time>
                    </div>
                    <p className="mt-1 font-bold leading-6">{commit.subject}</p>
                    {commit.body ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-secondary">{commit.body}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-secondary">
              This entry doesn&rsquo;t have recorded development history yet. {history.reason}
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
