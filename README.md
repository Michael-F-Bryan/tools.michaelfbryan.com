# tools.michaelfbryan.com

[![CI](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml/badge.svg)](https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/actions/workflows/ci.yml)

Source code for **tools.michaelfbryan.com**, a collection of browser-based tools and visual technical explainers by [Michael F. Bryan](https://www.michaelfbryan.com/).

The project is currently at the skeleton stage. It contains the catalogue and a placeholder for the first explainer, which will examine the engineering principles behind reliable AI-assisted transcription.

## Repository structure

- `src/app/page.tsx` renders the catalogue.
- `src/app/tools/<slug>/page.tsx` is the convention for browser-based tools.
- `src/app/explainers/<slug>/page.tsx` is the convention for visual explainers.
- `src/lib/catalogue.ts` contains the entries displayed on the home page.
- `src/app/globals.css` contains the shared design tokens and global styles.
- `tests/` contains browser-level tests for public routes.

Pages are React Server Components by default and are statically rendered where possible. Interactive tools use narrow Client Component boundaries and should process user input in the browser unless a server dependency is genuinely required. Explainers are written in TSX so each one can use a layout and visual language suited to its subject.

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

1. Add a route under `src/app/tools/` or `src/app/explainers/`.
2. Give the page its own metadata and keep it server-rendered unless it needs browser interaction.
3. Add its title, description, kind, status, and route to `src/lib/catalogue.ts`.
4. Extend the Playwright coverage to prove the new catalogue entry opens the rendered page.

Shared components should represent behaviour or meaning that has already appeared in more than one published item. shadcn/ui is configured with Base UI primitives for accessible controls, while the site's visual identity remains in repository-owned components and design tokens.

## Google Analytics

Google Analytics is disabled unless `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is set. Configure the variable only in Vercel's Production environment so local and preview traffic does not pollute the production property.

Tool inputs and outputs must not be sent to Google Analytics.
