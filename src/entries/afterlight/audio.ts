import {frequency, type Star} from './model';

export class Instrument {
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private disposed = false;
  enabled = false;
  voices = new Set<{gain: GainNode}>();

  async enable() {
    if (this.disposed) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
      const rng = (i: number) => Math.sin(i * 127.1) * 43758.5453 % 1;
      const impulse = this.context.createBuffer(2, this.context.sampleRate * 2, this.context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const samples = impulse.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) samples[i] = rng(i + channel * samples.length) * (1 - i / samples.length) ** 3;
      }
      this.reverb = this.context.createConvolver();
      this.reverb.buffer = impulse;
      const wet = this.context.createGain();
      wet.gain.value = 0.25;
      this.reverb.connect(wet).connect(this.master);
    }
    await this.context.resume();
    if (!this.disposed) this.enabled = true;
  }

  silence() {
    if (!this.context) return;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(this.context.currentTime);
      voice.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    }
  }

  disable() {this.enabled = false; this.silence();}

  dispose() {
    this.disposed = true;
    this.disable();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.voices.clear();
  }

  play(star: Star) {
    if (!this.enabled || !this.context || !this.master || !this.reverb || this.context.state !== 'running') return;
    const ctx = this.context, now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const gain = ctx.createGain();
    const harmonic = ctx.createGain();
    const pan = ctx.createStereoPanner();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency(star);
    overtone.type = 'sine';
    overtone.frequency.value = frequency(star) * 2;
    harmonic.gain.value = 0.12;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.55, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
    pan.pan.value = star.x * 1.6 - 0.8;
    oscillator.connect(gain);
    overtone.connect(harmonic).connect(gain);
    gain.connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverb);
    const voice = {gain};
    this.voices.add(voice);
    oscillator.onended = () => {
      this.voices.delete(voice);
      oscillator.disconnect(); overtone.disconnect(); harmonic.disconnect(); gain.disconnect(); pan.disconnect();
    };
    oscillator.start(now); overtone.start(now);
    oscillator.stop(now + 2.6); overtone.stop(now + 2.6);
  }
}
