# tools.michaelfbryan.com

A personal collection of small, useful tools and visual explainers by Michael F. Bryan.

The site is intended to make experimentation easy to finish and share. Each item should solve a real problem, stand on its own, and expose some of the engineering judgement behind it without requiring a substantial article or a long-running project.

The eventual site will live at [tools.michaelfbryan.com](https://tools.michaelfbryan.com).

## What belongs here

The catalogue will contain two kinds of work:

- **Tools** — focused browser-based utilities that produce a useful result without unnecessary server-side processing.
- **Explainers** — bespoke visual artefacts that help capable engineers understand how a system works or why particular design choices matter.

The first explainer will use a reliable interview-transcription pipeline as a concrete case study. Its primary job is to show the engineering principles behind trustworthy AI-assisted transcription so readers can apply them to their own systems.

## Working principles

- Build the smallest complete vertical slice and publish it.
- Prefer real needs and working artefacts over speculative platforms.
- Render pages on the server by default, with static output wherever possible.
- Keep interactive tools in narrow Client Components and process their inputs in the browser by default.
- Build explainers as ordinary TSX so their information structure, diagrams, and interactions can fit the subject.
- Add shared components only after multiple real pages demonstrate the same need.
- Treat shadcn/ui as a source of owned UI primitives, not the site's visual identity.
- Keep all published examples public-safe and synthetic; private source material does not belong in this repository.
- Design for accessible desktop and mobile use from the start.

## Technical direction

- [Next.js](https://nextjs.org/) with the App Router
- Strict TypeScript
- Tailwind CSS
- shadcn/ui with Base UI primitives
- React Server Components by default
- Client Components for interactive tools
- Google Analytics 4, isolated from tool inputs and outputs
- Vercel deployment with GitHub preview deployments
- pnpm for package management

The initial site does not need a CMS, database, authentication, monorepo, Storybook, separate component package, or generic plugin system. Those should only be introduced if a published tool creates a concrete need for them.

## Initial shape

The first release is deliberately small:

1. A catalogue at `/`.
2. One explainer under `/explainers/`.
3. Only the brand tokens and components required by those pages.
4. Social metadata suitable for sharing.
5. A production deployment at `tools.michaelfbryan.com`.

Future tools will live under `/tools/`, with each tool owning its interface and browser-side behaviour inside the shared site shell.

## Status

The application skeleton includes a server-rendered catalogue and a placeholder route for the first explainer. The explainer itself has not been designed or written yet.

## Development

Install dependencies and start the local development server:

```console
pnpm install
pnpm dev
```

Run the repository checks with:

```console
pnpm lint
pnpm typecheck
pnpm test:e2e
pnpm build
```

Google Analytics is disabled unless `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is set. Configure it only for the production Vercel environment so local and preview traffic does not pollute the production property.
