import type { SoundKey } from '../storage/assets';
let context: AudioContext | undefined;
let playing: HTMLAudioElement | undefined;
export function playSound(
  key: SoundKey,
  urls: Record<string, string>,
  volume: number,
  muted: boolean,
) {
  if (muted || volume <= 0) return;
  if (urls[`audio:${key}`]) {
    playing?.pause();
    const audio = new Audio(urls[`audio:${key}`]);
    playing = audio;
    audio.volume = volume;
    void audio.play().catch(() => {
      /* Browser or codec may reject playback; gameplay remains available. */
    });
    return;
  }
  try {
    context ??= new AudioContext();
    void context.resume();
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      now = context.currentTime;
    const frequencies: Record<SoundKey, number> = {
      click: 420,
      reveal: 640,
      flag: 880,
      warning: 180,
      boom: 70,
      win: 1046,
      timeout: 150,
    };
    oscillator.type = key === 'boom' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(frequencies[key], now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequencies[key] / 2),
      now + 0.18,
    );
    gain.gain.setValueAtTime(volume * 0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(now + 0.25);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch {
    /* Audio is optional and must never block a move. */
  }
}
