import { Injectable } from '@angular/core';

/**
 * Microphone acquisition for the emitter role.
 *
 * All auto-processing is explicitly disabled: babyphone sensitivity to faint
 * sounds matters more than clean voice. See legacy DESCRIPTION.md §Audio.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  video: false,
};

@Injectable({ providedIn: 'root' })
export class MicService {
  private current: MediaStream | null = null;

  async acquire(): Promise<MediaStream> {
    if (this.current && this.current.getTracks().some((t) => t.readyState === 'live')) {
      return this.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    this.current = stream;
    return stream;
  }

  /** Re-enable all audio tracks. Mobile browsers sometimes silently disable them. */
  rearm(): void {
    this.current?.getAudioTracks().forEach((track) => {
      if (!track.enabled) track.enabled = true;
    });
  }

  release(): void {
    this.current?.getTracks().forEach((t) => t.stop());
    this.current = null;
  }

  get stream(): MediaStream | null {
    return this.current;
  }
}
