import { Injectable, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * Service to keep the audio pipeline alive during a babyphone session.
 * Mobile browsers throttle background tabs aggressively; a playing audio element
 * keeps the tab at higher priority and prevents WebRTC from being suspended.
 *
 * Uses two techniques:
 * 1. A real <audio> element looping a silent WAV (primary, most effective on mobile)
 * 2. A muted AudioContext + oscillator (fallback belt-and-suspenders)
 *
 * Must be started from a user-gesture handler (iOS requirement).
 */
@Injectable({
  providedIn: 'root',
})
export class AudioKeepaliveService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private audioEl: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private isRunning = false;

  constructor() {
    this.document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
  }

  ngOnDestroy(): void {
    this.stop();
    this.document.removeEventListener('visibilitychange', () => this.handleVisibilityChange());
  }

  /**
   * Start the silent audio keepalive. Must be called from a user gesture handler.
   * Safe to call multiple times — idempotent.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Real <audio> element looping silence — primary keep-alive on mobile.
      if (!this.audioEl) {
        this.audioUrl = this.buildSilentWavUrl();
        this.audioEl = new Audio(this.audioUrl);
        this.audioEl.loop = true;
        // Non-zero volume so the track is treated as producing sound,
        // but low enough to be inaudible.
        this.audioEl.volume = 0.001;
        this.audioEl.setAttribute('playsinline', '');
        this.audioEl.preload = 'auto';
      }
      const playPromise = this.audioEl.play();
      if (playPromise?.catch) {
        playPromise.catch((e) => console.warn('Silent loop play deferred:', (e as Error).message));
      }

      // 2. AudioContext oscillator as belt-and-suspenders fallback.
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
        const oscillator = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(this.audioCtx.destination);
        oscillator.start();
      }

      console.log('Silent audio started');
    } catch (e) {
      console.error('Silent audio failed:', e);
    }
  }

  /**
   * Stop the silent audio keepalive and release resources.
   */
  stop(): void {
    this.isRunning = false;

    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }

    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  /**
   * Resume the audio context if it was suspended (e.g., after tab backgrounding on iOS).
   */
  private async handleVisibilityChange(): Promise<void> {
    if (this.document.visibilityState !== 'visible' || !this.isRunning) return;

    if (this.audioCtx?.state === 'suspended') {
      try {
        await this.audioCtx.resume();
        console.log('Audio context resumed');
      } catch (e) {
        console.error('Failed to resume audio context:', e);
      }
    }

    if (this.audioEl?.paused) {
      try {
        await this.audioEl.play();
        console.log('Silent loop resumed');
      } catch {
        // Ignored — may fail if gesture requirement not met.
      }
    }
  }

  /**
   * Build a 1-second silent WAV blob URL that we can loop in a real <audio> element.
   * A *playing* HTMLAudioElement is treated as foreground media playback by Android Chrome,
   * which is significantly more resistant to background throttling than an AudioContext.
   */
  private buildSilentWavUrl(): string {
    const sampleRate = 8000;
    const durationSec = 1;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (off: number, s: string): void => {
      for (let i = 0; i < s.length; i++) {
        view.setUint8(off + i, s.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    // PCM samples are zero-filled (silent).

    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }
}
