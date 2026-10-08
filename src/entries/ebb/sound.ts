/**
 * A quiet tone for every letter the field loses, pitched by where it was
 * lost. Off by default; `enable()` must run from a user gesture so the
 * browser allows the `AudioContext` to start.
 */
export class FieldSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private disposed = false;
  private lastNoteAt = 0;
  enabled = false;

  private static readonly SCALE = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5, 2, 12 / 5, 8 / 3, 3, 18 / 5, 4, 24 / 5, 16 / 3];

  enable(): boolean {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.ratio.value = 6;
        this.master.connect(compressor).connect(this.context.destination);
      }
      void this.context.resume();
      this.enabled = true;
      this.master!.gain.setTargetAtTime(0.11, this.context.currentTime, 0.4);
      return true;
    } catch {
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.master && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.2);
  }

  /** `heightFraction` is 0 (top of the field) to 1 (bottom); pitch runs high to low. */
  note(heightFraction: number, gain: number, duration: number): void {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    if (now - this.lastNoteAt < 0.07) return;
    this.lastNoteAt = now;
    const scale = FieldSound.SCALE;
    const index = Math.max(0, Math.min(scale.length - 1, Math.floor((1 - heightFraction) * scale.length)));
    const frequency = 165 * scale[index];

    const oscillator = this.context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1600;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(lowpass).connect(envelope).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      lowpass.disconnect();
      envelope.disconnect();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    if (this.context && this.context.state !== "closed") void this.context.close();
    this.context = null;
    this.master = null;
  }
}
