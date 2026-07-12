/**
 * Tiny reward effects: synthesized WebAudio chimes + vibration.
 * No audio assets — everything is generated with oscillators, tuned quiet
 * and gentle for a rehab audience. All functions no-op safely on the server,
 * when the browser blocks audio (no user gesture yet), or without vibration
 * support.
 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  /** Seconds from now. */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** Glide pitch toward this frequency over the tone's duration. */
  glideTo?: number;
}

function tone(c: AudioContext, { freq, at = 0, dur = 0.15, type = 'sine', gain = 0.1, glideTo }: ToneOpts) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  // Fast attack, exponential release — soft "ding" envelope
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Soft two-note blip for a completed rep. */
export function playRepChime() {
  const c = audioCtx();
  if (!c) return;
  tone(c, { freq: 880, dur: 0.1, gain: 0.08 });
  tone(c, { freq: 1174.66, at: 0.08, dur: 0.14, gain: 0.08 });
}

/** Ascending C-major arpeggio for finishing a session. */
export function playCompletionFanfare() {
  const c = audioCtx();
  if (!c) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    tone(c, { freq, at: i * 0.11, dur: i === notes.length - 1 ? 0.45 : 0.18, type: 'triangle', gain: 0.09 });
  });
}

/** Rising sparkle for a garden element being revealed. */
export function playBloomSparkle() {
  const c = audioCtx();
  if (!c) return;
  tone(c, { freq: 660, glideTo: 1760, dur: 0.35, gain: 0.07 });
  tone(c, { freq: 1318.5, at: 0.18, dur: 0.3, gain: 0.06 });
  tone(c, { freq: 2093, at: 0.3, dur: 0.35, gain: 0.05 });
}

/** Vibrate on devices that support it (mobile); silently no-ops elsewhere. */
export function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw on unusual patterns — ignore */
  }
}
