# tools.michaelfbryan.com

[![CI](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml/badge.svg)](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml)

Source code for **tools.michaelfbryan.com**, a collection of browser-based tools and visual technical explainers by [Michael F. Bryan](https://www.michaelfbryan.com/).

The project is currently at the skeleton stage. It contains the catalogue and a placeholder for the first explainer, which will examine the engineering principles behind reliable AI-assisted transcription.

## Repository structure

- `src/app/page.tsx` renders the catalogue from the discovered entries.
- `src/app/[collection]/[slug]/page.tsx` generates each entry's route, metadata, and shared page chrome.
- `src/entries/<collection>/<slug>/definition.ts` contains an entry's title and description.
- `src/entries/<collection>/<slug>/content.tsx` contains the tool or explainer itself.
- `src/entries/index.ts` discovers entries and derives their kind, slug, and URL from the directory structure.
- `src/app/globals.css` contains the shared design tokens and global styles.
- `src/components/` contains the shared page and explainer structures: `Container`, `PageTitle`, `Label`, `Section`, `Prose`, `Steps`, and `Figure`.
- `tests/` contains browser-level tests for public routes.

Pages are React Server Components and are generated statically. Interactive tools use narrow Client Component boundaries and should process user input in the browser unless a server dependency is genuinely required. Explainers are written in TSX so each one can use a layout suited to its subject.

Entry discovery uses Turbopack's `import.meta.glob()` support. Both development and production builds must use Turbopack.

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

## Adding a tool or explainer

1. Create `src/entries/tools/<slug>/` or `src/entries/explainers/<slug>/`.
2. Export an `EntryDefinition` named `definition` from `definition.ts`.
3. Default-export the tool or explainer body from `content.tsx`.
4. Extend the Playwright coverage to prove the discovered catalogue entry opens the rendered page.

The build discovers the new entry automatically. Its definition supplies the catalogue, document metadata, and visible page chrome; no separate route or catalogue registration is required.

The page renders the entry's kind, title, and description; `content.tsx` supplies only the body. An explainer body is usually a stack of `Section`s holding `Prose`, `Steps`, and `Figure`s, with subject-specific layouts and illustrations written inline against the tokens in `globals.css` (`bg-surface`, `bg-sand`, `border-rule`, `text-accent`, `tracking-label`, `max-w-measure`).

Shared components should represent behaviour or meaning that has already appeared in more than one published item. shadcn/ui is configured with Base UI primitives for accessible controls, while the site's visual identity remains in repository-owned components and design tokens.

## Google Analytics

Google Analytics is disabled unless `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is set. Configure the variable only in Vercel's Production environment so local and preview traffic does not pollute the production property.

Tool inputs and outputs must not be sent to Google Analytics.
