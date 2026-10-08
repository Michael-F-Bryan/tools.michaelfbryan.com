"use client";

import { useEffect, useRef } from "react";
import { mountInstrument } from "./engine";
import styles from "./sky.module.css";

export function Sky() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountInstrument(root.current);
  }, []);

  return (
    <div ref={root} className={styles.instrument} role="region" aria-label="Constellation instrument">
      <canvas id="afterlight-sky" tabIndex={0} aria-label="Constellation sky. Draw to plant stars, or use Add a star. Space pauses playback." role="img" />
      <div id="afterlight-invitation" className={styles.invitation}>
        <p>Leave a little light.</p>
        <span>Draw slowly across the sky.<br />There is no wrong shape.</span>
      </div>
      <aside className={styles.readout} aria-label="Constellation information">
        <span id="afterlight-count">0 stars</span>
        <span id="afterlight-phase">the sky is listening</span>
      </aside>
      <div className={styles.controls}>
        <div className={styles.primary}>
          <button id="afterlight-sound" type="button" aria-pressed="false">Enable sound</button>
          <button id="afterlight-pause" type="button" aria-pressed="false">Pause</button>
          <label className={styles.tempo}>Pace <input id="afterlight-tempo" type="range" min="30" max="120" defaultValue="60" /><output id="afterlight-tempo-value" htmlFor="afterlight-tempo">60</output></label>
        </div>
        <div className={styles.secondary}>
          <button id="afterlight-add" type="button">Add a star</button>
          <button id="afterlight-undo" type="button" disabled>Undo</button>
          <button id="afterlight-clear" type="button" disabled>Clear</button>
          <button id="afterlight-share" type="button">Copy link</button>
          <button id="afterlight-save" type="button">Save image</button>
        </div>
        <p className={styles.footnote}>Draw to plant stars · Space to pause · Each shape has its own song</p>
        <p id="afterlight-status" className={styles.status} role="status" aria-live="polite" />
      </div>
    </div>
  );
}
