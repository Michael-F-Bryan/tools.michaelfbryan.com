# Agent contract

This repository publishes browser-based tools and visual technical explainers under Michael F. Bryan's name. Prefer the smallest change that fits the existing site; do not import generic architecture, visual defaults, or adjacent features.

Read `README.md` once before structural or user-visible work, then inspect only task-relevant files. For a new entry, read its entry instructions, `src/entries/index.ts`, its types, one relevant entry, and the nearest browser test. Read `src/app/globals.css`, affected shared components, and the component kitchen sink only when changing the visual system. Do not inventory the repository or component library without a concrete need.

## Architecture

Add tools and explainers through `src/entries/<collection>/<slug>/`; discovery derives routes and catalogue records automatically. Do not add parallel routes or manual registries. The shared entry page owns the kind, title, description, and optional section navigation; `content.tsx` supplies the body. Keep `definition.sections` aligned with rendered heading IDs.

Pages remain statically generated Server Components by default. Interactive tools use the narrowest useful Client Component boundary and process input in the browser unless a server dependency is genuinely required. Do not add persistence, telemetry, dependencies, or infrastructure without an immediate product need. Tool inputs and outputs must not leave the browser or reach analytics.

## Design system

Reuse the tokens in `globals.css` and existing semantic components. Do not copy a shared component's class list into an entry; use the component unless its meaning is wrong for that job. Keep subject-specific layouts, illustrations, and ordinary one-off controls local to their entry.

Use native semantic HTML for straightforward buttons, textareas, inputs, and alerts, styled locally with site tokens. Do not run `shadcn add` or create `src/components/ui/` wrappers merely to obtain them. Introduce Base UI or shadcn only when native HTML cannot provide required interaction behaviour, or when the same component contract has already recurred. Strip unused variants and generic styling from generated code.

Promote a shared component only after the same semantic job appears in more than one published entry. Adding or changing one requires updating the kitchen sink and relevant browser coverage.

Published explanations must distinguish current behaviour from proposals and synthetic examples. Do not invent claims or publish private material, secrets, or user-provided data.

## Verification

During implementation, run the narrowest relevant check. At the end, run each check in `README.md` once; rerun only a failed check after fixing it. Add Playwright coverage for changed public behaviour and verify desktop and narrow-mobile behaviour, including focus and horizontal overflow. Do not create ad hoc screenshot harnesses or repeatedly restart the development server unless visual diagnosis is the task.

Keep the managed Next.js block below intact. Read only the local guide relevant to the API or convention being changed; do not enumerate the documentation tree.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
