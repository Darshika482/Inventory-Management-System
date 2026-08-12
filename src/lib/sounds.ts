/**
 * Short built-in chimes played on success. Synthesised with the Web Audio API
 * so there is no sound file to download — it works offline and adds nothing
 * to the bundle. Every call fails silently if the browser blocks audio.
 */

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * iOS and Chrome only start audio from a real tap. Call this inside the click
 * handler so the chime that plays later — once the AI has answered — is allowed.
 */
export function unlockSound(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/** Two rising notes, about a third of a second in total. */
export function playSuccessChime(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  try {
    const notes: Array<{ frequency: number; startAt: number; duration: number }> = [
      { frequency: 880, startAt: 0, duration: 0.16 },
      { frequency: 1318.5, startAt: 0.11, duration: 0.26 },
    ];

    for (const { frequency, startAt, duration } of notes) {
      const startTime = ctx.currentTime + startAt;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Fade in and out so the note does not click at either end.
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration + 0.02);
    }
  } catch {
    // A missing or blocked audio device must never break the form.
  }
}
