import { Injectable } from '@angular/core';

/**
 * Microphone acquisition for the emitter role.
 *
 * By default, all auto-processing is explicitly disabled: babyphone sensitivity to faint
 * sounds matters more than clean voice. See legacy DESCRIPTION.md §Audio.
 * Noise suppression, echo cancellation, and auto gain control can be optionally enabled via the acquire() parameters.
 */
const DEFAULT_MIC_CONSTRAINTS: MediaStreamConstraints = {
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

	async acquire(noiseCancellation = false, echoCancellation = false, autoGainControl = false): Promise<MediaStream> {
		if (this.current && this.current.getTracks().some((t) => t.readyState === 'live')) {
			return this.current;
		}

		const constraints: MediaStreamConstraints = {
			audio: {
				echoCancellation: echoCancellation,
				noiseSuppression: noiseCancellation,
				autoGainControl: autoGainControl,
			},
			video: false,
		};

		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		this.current = stream;
		return stream;
	}

	/** Re-enable all audio tracks. Mobile browsers sometimes silently disable them. */
	rearm(): void {
		this.current?.getAudioTracks().forEach((track) => {
			if (!track.enabled) track.enabled = true;
		});
	}

	/**
	 * Apply new audio constraints to the currently live track.
	 * No-op if no track is active.
	 */
	async applyConstraints(
		noiseCancellation = false,
		echoCancellation = false,
		autoGainControl = false,
	): Promise<void> {
		const track = this.current?.getAudioTracks()[0];
		if (!track) return;
		await track.applyConstraints({
			echoCancellation,
			noiseSuppression: noiseCancellation,
			autoGainControl,
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
