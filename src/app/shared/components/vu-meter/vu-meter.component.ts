import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	effect,
	input,
	inject,
	viewChild,
} from '@angular/core';
import type { VuMeterSensitivity } from '../../../core/models';

/**
 * Visual feedback component — a bar that reacts to audio levels.
 * Used on emitter (local mic) and receiver (remote audio).
 *
 * Uses AnalyserNode.getByteFrequencyData inside requestAnimationFrame.
 * Creates AudioContext on first stream change; closes on destroy.
 */
@Component({
	selector: 'app-vu-meter',
	standalone: true,
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
    <div class="vu-container" aria-hidden="true">
      <div class="vu-bar" #bar></div>
    </div>
  `,
	styles: `
    :host {
      display: block;
      width: 100%;
    }
    .vu-container {
      width: 100%;
      height: 8px;
      background: var(--ion-color-medium, #92949c);
      border-radius: 4px;
      overflow: hidden;
    }
    .vu-bar {
      height: 100%;
      width: 0%;
      background: var(--ion-color-success, #2dd36f);
      transition:
        width 50ms linear,
        background 200ms ease;
    }
    .vu-bar.warning {
      background: var(--ion-color-warning, #ffc409);
    }
  `,
})
export class VuMeterComponent {
	/** MediaStream to analyze (local mic or remote audio). */
	readonly stream = input<MediaStream | null>(null);

	/** Sensitivity level for the VU meter. */
	readonly sensitivity = input<VuMeterSensitivity>('medium');

	private readonly barRef = viewChild.required<ElementRef<HTMLDivElement>>('bar');
	private readonly destroyRef = inject(DestroyRef);

	private audioCtx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private dataArray: Uint8Array | null = null;
	private rafId: number | null = null;
	private isTicking = false;

	constructor() {
		// Watch stream changes
		effect(() => {
			const current = this.stream();
			if (current) {
				void this.startAnalyzing(current);
			} else {
				this.stopAnalyzing();
			}
		});

		// Pause/resume with page visibility to save battery on emitter
		document.addEventListener('visibilitychange', this.onVisibilityChange);

		this.destroyRef.onDestroy(() => {
			document.removeEventListener('visibilitychange', this.onVisibilityChange);
			this.stopAnalyzing();
		});
	}

	private readonly onVisibilityChange = (): void => {
		if (document.hidden) {
			// Pause the render loop; suspend AudioContext to free CPU
			if (this.rafId) {
				cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
			this.isTicking = false;
			if (this.audioCtx?.state === 'running') {
				void this.audioCtx.suspend();
			}
		} else if (this.analyser && !this.isTicking) {
			// Resume AudioContext and restart tick loop
			if (this.audioCtx?.state === 'suspended') {
				void this.audioCtx.resume().then(() => this.tick());
			} else {
				this.tick();
			}
		}
	};

	private async startAnalyzing(stream: MediaStream): Promise<void> {
		this.stopAnalyzing();

		try {
			this.audioCtx = new AudioContext();
			// Browsers (especially mobile) start AudioContext suspended.
			if (this.audioCtx.state === 'suspended') {
				await this.audioCtx.resume();
			}
			const source = this.audioCtx.createMediaStreamSource(stream);
			this.analyser = this.audioCtx.createAnalyser();
			this.analyser.fftSize = 256;
			source.connect(this.analyser);

			const bufferLength = this.analyser.frequencyBinCount;
			this.dataArray = new Uint8Array(bufferLength);

			if (!document.hidden) {
				this.tick();
			}
		} catch (e) {
			console.error('VU meter failed to start:', e);
		}
	}

	private stopAnalyzing(): void {
		this.isTicking = false;
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.audioCtx) {
			void this.audioCtx.close();
			this.audioCtx = null;
		}
		this.analyser = null;
		this.dataArray = null;
	}

	private getSensitivityConfig(): { multiplier: number; warningThreshold: number } {
		switch (this.sensitivity()) {
			case 'low':
				return { multiplier: 0.6, warningThreshold: 80 };
			case 'high':
				return { multiplier: 2.0, warningThreshold: 40 };
			case 'medium':
			default:
				return { multiplier: 1.2, warningThreshold: 60 };
		}
	}

	private tick(): void {
		if (!this.analyser || !this.dataArray) return;
		this.isTicking = true;

		// @ts-expect-error Type mismatch between Uint8Array generics in DOM types
		this.analyser.getByteFrequencyData(this.dataArray);
		let sum = 0;
		for (let i = 0; i < this.dataArray.length; i++) {
			sum += this.dataArray[i];
		}
		const average = sum / this.dataArray.length;

		const { multiplier, warningThreshold } = this.getSensitivityConfig();

		// Scale to percentage (0-100), with amplification based on sensitivity
		const percentage = Math.min(100, average * multiplier);

		const bar = this.barRef().nativeElement;
		bar.style.width = `${percentage}%`;

		// Toggle warning class when level is high
		bar.classList.toggle('warning', average > warningThreshold);

		if (!document.hidden) {
			this.rafId = requestAnimationFrame(() => this.tick());
		} else {
			this.isTicking = false;
			this.rafId = null;
		}
	}
}
