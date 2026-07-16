/**
 * Tiny WebAudio synth for arcade-style SFX. No assets — everything is generated
 * with oscillators so it stays self-contained. Muted via the settings toggle.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
  }

  /** Call from a user gesture to unlock audio on browsers that require it. */
  resume(): void {
    this.ensure();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private blip(
    freq: number,
    duration: number,
    type: OscillatorType = "square",
    gain = 0.6,
    slideTo?: number,
  ): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  move(): void {
    this.blip(220, 0.05, "square", 0.25);
  }
  rotate(): void {
    this.blip(330, 0.06, "triangle", 0.3);
  }
  softDrop(): void {
    this.blip(180, 0.03, "sine", 0.15);
  }
  hardDrop(): void {
    this.blip(140, 0.12, "sawtooth", 0.4, 70);
  }
  lock(): void {
    this.blip(160, 0.08, "square", 0.3);
  }
  hold(): void {
    this.blip(440, 0.08, "triangle", 0.3);
  }
  clear(layers: number): void {
    // Ascending arpeggio scaled by number of layers cleared.
    const notes = [523, 659, 784, 1047];
    const n = Math.min(4, Math.max(1, layers));
    for (let i = 0; i < n + 1; i++) {
      window.setTimeout(() => this.blip(notes[Math.min(i, 3)], 0.12, "triangle", 0.4), i * 60);
    }
  }
  levelUp(): void {
    [523, 784, 1047].forEach((f, i) => window.setTimeout(() => this.blip(f, 0.14, "square", 0.35), i * 80));
  }
  gameOver(): void {
    [440, 349, 261, 174].forEach((f, i) =>
      window.setTimeout(() => this.blip(f, 0.25, "sawtooth", 0.35), i * 140),
    );
  }
}
