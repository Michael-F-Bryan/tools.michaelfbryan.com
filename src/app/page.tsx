import Link from "next/link";

import { catalogueItems } from "@/lib/catalogue";

export default function Home() {
  return (
    <main className="mx-auto max-w-[70rem] px-5 sm:px-8">
      <section className="py-14 sm:py-20">
        <h1 className="max-w-2xl text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl">
          Tools and explainers
        </h1>
      </section>

      <section aria-label="Catalogue" className="pb-24">
        <ol className="border-t border-rule">
          {catalogueItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group grid gap-4 border-b border-rule py-7 outline-none transition-colors hover:bg-surface focus-visible:bg-surface sm:grid-cols-[1fr_auto] sm:px-4"
              >
                <span>
                  <span className="block text-xl font-bold tracking-[-0.015em] group-hover:text-accent">
                    {item.title}
                  </span>
                  <span className="mt-2 block max-w-[45rem] leading-7 text-secondary">
                    {item.description}
                  </span>
                </span>
                <span className="flex items-start gap-3 font-mono text-xs uppercase tracking-[0.1em] text-muted sm:justify-end">
                  <span>{item.kind}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
