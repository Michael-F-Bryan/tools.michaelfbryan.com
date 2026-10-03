# tools.michaelfbryan.com

[![CI](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml/badge.svg)](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml)

Source code for **tools.michaelfbryan.com**, a collection of browser-based tools and visual technical explainers by [Michael F. Bryan](https://www.michaelfbryan.com/).

The catalogue contains a coordinate-frame visualiser, a GEDCOM family-tree viewer, a Melbourne place finder, a browser-only QR code generator, and a timezone availability clock. The shared component reference lives separately at `/reference/components`.

## Repository structure

- `src/app/page.tsx` renders the catalogue from the discovered entries.
- `src/app/[slug]/page.tsx` generates each entry's route and metadata.
- `src/components/entry-page.tsx` owns the shared page chrome and article/workspace layouts.
- `src/entries/<slug>/definition.ts` contains an entry's title, description, layout, and optional section index.
- `src/entries/<slug>/content.tsx` contains the entry's body.
- `src/entries/<slug>/preview.tsx` optionally supplies a static catalogue illustration.
- `src/entries/index.ts` discovers entries and derives their slug and URL from the directory structure.
- `src/app/reference/components/` contains the component reference, outside catalogue discovery.
- `src/app/globals.css` contains the shared design tokens and global styles.
- `src/components/` contains the shared page and explainer structures: `Container`, `PageTitle`, `Label`, `Section`, `Prose`, `Steps`, and `Figure`.
- `tests/` contains browser-level tests for public routes.

Pages are React Server Components and are generated statically. Interactive tools use narrow Client Component boundaries and should process user input in the browser unless a server dependency is genuinely required. Explainers are written in TSX so each one can use a layout suited to its subject.

Entry discovery uses Turbopack's `import.meta.glob()` support. Both development and production builds must use Turbopack.

### Entry development history

Each entry's intro line shows a real "Updated" date, a "Development history"
dialog (created/updated dates and the commits that touched that entry's
directory), and a "Source" link. `next.config.ts`'s phase function calls
`generateEntryHistory` (`src/lib/entry-history-generator.ts`) before compilation on
both `next dev` and `next build`, which reads `git log` for each
`src/entries/<slug>` directory and writes `.generated/entry-history.json`
(git-ignored; left untouched when its content hasn't changed). `src/entries/index.ts`
reads that file at module load and attaches each entry's history, which is
also how the catalogue sorts by most-recently-updated. The known former
`src/entries/tools/<slug>` and `src/entries/explainers/<slug>` directories
are included so the flat-layout migration does not reset history. Dates
are displayed in UTC to keep static pages and client rendering consistent.

This requires real, non-shallow git history: a shallow clone fails the build
with a clear error rather than publishing wrong dates, so CI checks out with
`fetch-depth: 0`. Vercel production builds explicitly fetch missing ancestry
from the public repository, pinned to `VERCEL_GIT_COMMIT_SHA`, before generating
history. This leaves HEAD unchanged and fails the build if the fetch fails.
Local development never fetches automatically. An entry with no qualifying commits yet (e.g. added but not
yet committed) gets an explicit "unavailable" history instead of invented
dates. Because generation only runs for `next dev`/`next build`, restart the
dev server to pick up new commits — the file is read once per server
lifetime, not per request.

## Development

This project uses Node.js 22 and pnpm.

```console
pnpm install
pnpm dev
```

The development server is available at http://localhost:3000.

### Checks

Install Playwright's Chromium browser once:

```console
pnpm exec playwright install chromium
```

Then run the same checks used by CI:

```console
pnpm lint
pnpm typecheck
pnpm test:e2e
pnpm build
```

Playwright starts its own development server on port 3107. To test a server that is already running, provide its URL explicitly:

```console
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e
```

## Adding an entry

1. Create `src/entries/<slug>/`.
2. Export an `EntryDefinition` named `definition` from `definition.ts`.
3. Default-export the entry body from `content.tsx`.
4. Optionally default-export a static React component from `preview.tsx`.
5. Extend the Playwright coverage to prove the discovered catalogue entry opens the rendered page.

Previews are decorative, non-interactive Server Components, normally inline SVGs using site tokens. The catalogue owns their dimensions and placement; each entry owns its drawing. Keep them legible at thumbnail size, without effects, network requests, or imports of the interactive tool. Entries without a preview use a quiet initial as a fallback.

The build discovers the new entry automatically. Its definition supplies the catalogue, document metadata, and visible page chrome; no separate route or catalogue registration is required.

The page renders the entry's title, description, and optional in-page navigation; `content.tsx` supplies only the body. An explainer body is usually a stack of `Section`s holding `Prose`, `Steps`, and `Figure`s, with subject-specific layouts and illustrations written inline against the tokens in `globals.css` (`bg-surface`, `bg-panel`, `border-rule`, `text-accent`, `tracking-label`, `max-w-measure`).

Shared components should represent behaviour or meaning that has already appeared in more than one published item. shadcn/ui is configured with Base UI primitives for accessible controls, while the site's visual identity remains in repository-owned components and design tokens.

## Google Analytics

Google Analytics is disabled unless `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is set. Configure the variable only in Vercel's Production environment so local and preview traffic does not pollute the production property.

Tool inputs and outputs must not be sent to Google Analytics.
