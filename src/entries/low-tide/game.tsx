"use client";

import styles from "./game.module.css";

/** Placeholder shell so the route and preview deploy exist; the playable camp lands in the next commits. */
export function Game() {
  return (
    <div className={styles.game}>
      <section className={styles.panel} aria-label="The camp">
        <p className={styles.muted}>The crew are still unloading the boat. Come back shortly.</p>
      </section>
    </div>
  );
}
