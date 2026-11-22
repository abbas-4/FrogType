import type { SoundMode } from '../types';

let ctx: AudioContext | null = null;

/** Synthesized key sounds (no audio assets to download). */
export function playKey(mode: SoundMode, error: boolean): void {
  if (mode === 'off' || typeof window === 'undefined' || !('AudioContext' in window)) return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = mode === 'click' ? 'square' : 'sine';
    osc.frequency.value = error ? 180 : mode === 'click' ? 1200 : 600;
    gain.gain.setValueAtTime(mode === 'click' ? 0.03 : 0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (error ? 0.12 : 0.05));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    /* audio blocked; ignore */
  }
}
