import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	effect,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';

@Component({
	selector: 'app-audio-graph',
	templateUrl: './audio-graph.component.html',
	styleUrls: ['./audio-graph.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
})
export class AudioGraphComponent {
	readonly stream = input<MediaStream | null>(null);
	readonly maxHistory = input<number>(100); // Number of data points to keep

	private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
	private readonly destroyRef = inject(DestroyRef);

	private audioCtx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private dataArray: Uint8Array | null = null;
	private rafId: number | null = null;

	// Historical data: array of audio levels (0-255)
	private readonly audioHistory = signal<number[]>([]);
	private readonly currentLevel = signal(0);

	private readonly visibilityHandler = (): void => {
		if (document.visibilityState === 'visible' && this.audioCtx?.state === 'suspended') {
			void this.audioCtx.resume();
		}
	};

	constructor() {
		// Watch for stream changes
		effect(() => {
			const stream = this.stream();
			if (stream) {
				void this.startAnalyzing(stream);
			} else {
				this.stopAnalyzing();
			}
		});

		// Re-resume AudioContext when tab becomes visible (iOS suspends it)
		document.addEventListener('visibilitychange', this.visibilityHandler);

		// Cleanup on destroy
		this.destroyRef.onDestroy(() => {
			this.stopAnalyzing();
			document.removeEventListener('visibilitychange', this.visibilityHandler);
		});
	}

	private async startAnalyzing(stream: MediaStream): Promise<void> {
		this.stopAnalyzing();

		try {
			this.audioCtx = new AudioContext();
			// Browsers (especially mobile) start AudioContext suspended.
			// Resume immediately so the analyser actually receives data.
			if (this.audioCtx.state === 'suspended') {
				await this.audioCtx.resume();
			}
			const source = this.audioCtx.createMediaStreamSource(stream);
			this.analyser = this.audioCtx.createAnalyser();
			this.analyser.fftSize = 256;
			source.connect(this.analyser);

			const bufferLength = this.analyser.frequencyBinCount;
			this.dataArray = new Uint8Array(bufferLength);

			this.tick();
		} catch (e) {
			console.error('Audio graph failed to start:', e);
		}
	}

	private stopAnalyzing(): void {
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

	private tick(): void {
		if (!this.analyser || !this.dataArray) return;

		// @ts-expect-error - Type mismatch between Uint8Array generics in DOM types
		this.analyser.getByteFrequencyData(this.dataArray);

		// Calculate average level
		let sum = 0;
		for (let i = 0; i < this.dataArray.length; i++) {
			sum += this.dataArray[i];
		}
		const average = sum / this.dataArray.length;

		// Update current level
		this.currentLevel.set(average);

		// Add to history
		this.audioHistory.update((history) => {
			const newHistory = [...history, average];
			const max = this.maxHistory();
			if (newHistory.length > max) {
				return newHistory.slice(-max);
			}
			return newHistory;
		});

		// Draw the graph
		this.draw();

		this.rafId = requestAnimationFrame(() => this.tick());
	}

	private draw(): void {
		const canvas = this.canvasRef().nativeElement;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const history = this.audioHistory();
		const width = canvas.width;
		const height = canvas.height;

		// Clear canvas
		ctx.clearRect(0, 0, width, height);

		if (history.length < 2) return;

		// Draw grid lines
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = (height / 4) * i;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}

		// Draw the audio level graph
		ctx.strokeStyle = '#2dd36f';
		ctx.lineWidth = 2;
		ctx.beginPath();

		const stepX = width / (this.maxHistory() - 1);

		history.forEach((level, index) => {
			const x = index * stepX;
			const y = height - (level / 255) * height;
			if (index === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		});

		ctx.stroke();

		// Fill area under the curve
		ctx.lineTo((history.length - 1) * stepX, height);
		ctx.lineTo(0, height);
		ctx.closePath();
		ctx.fillStyle = 'rgba(45, 211, 111, 0.2)';
		ctx.fill();
	}
}
