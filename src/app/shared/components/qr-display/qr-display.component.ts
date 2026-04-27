import {
	AfterViewInit,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	OnChanges,
	OnDestroy,
	SimpleChanges,
	ViewChild,
	computed,
	input,
	signal,
} from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';

import { drawQrToCanvas } from '../../../core/signaling/qr-draw';

/** Minimum swipe distance in pixels to trigger navigation. */
const SWIPE_THRESHOLD = 50;

/**
 * Renders one or more QR codes in sequence with prev / next controls when
 * there is more than one part. Size adapts to the container width.
 * Supports swipe gestures for navigation on touch devices.
 */
@Component({
	selector: 'app-qr-display',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [IonButton, IonIcon],
	templateUrl: './qr-display.component.html',
	styleUrl: './qr-display.component.scss',
})
export class QrDisplayComponent implements AfterViewInit, OnChanges, OnDestroy {
	/** Array of payloads, one per QR code. */
	readonly parts = input.required<string[]>();

	/** Optional max size in px. Defaults to `600`. */
	readonly maxSize = input<number>(600);

	@ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
	@ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

	protected readonly currentIndex = signal(0);
	protected readonly isMulti = computed(() => this.parts().length > 1);
	protected readonly counter = computed(
		() => `${this.currentIndex() + 1} / ${this.parts().length}`,
	);

	private resizeObserver: ResizeObserver | null = null;
	private startX = 0;
	private startY = 0;
	private startTime = 0;
	private isDragging = false;
	private currentX = 0;

	/** Signal for CSS transform during drag/swipe animation. */
	protected readonly transformStyle = signal<string>('translateX(0px)');
	protected readonly transitionStyle = signal<string>('none');

	constructor() {
		addIcons({ chevronBackOutline, chevronForwardOutline });
	}

	/** Handle pointer down (touch or mouse) for swipe/drag detection. */
	protected onPointerDown(event: PointerEvent): void {
		this.isDragging = true;
		this.startX = event.clientX;
		this.currentX = event.clientX;
		this.startY = event.clientY;
		this.startTime = Date.now();
		this.transitionStyle.set('none'); // Disable transition during drag
	}

	/** Handle pointer move for real-time drag feedback. */
	protected onPointerMove(event: PointerEvent): void {
		if (!this.isDragging) return;
		this.currentX = event.clientX;
		const deltaX = this.currentX - this.startX;

		// Apply resistance at edges
		const canGoPrev = this.currentIndex() > 0;
		const canGoNext = this.currentIndex() < this.parts().length - 1;

		let adjustedDelta = deltaX;
		if (!canGoPrev && deltaX > 0) adjustedDelta = deltaX * 0.3; // Resistance at start
		if (!canGoNext && deltaX < 0) adjustedDelta = deltaX * 0.3; // Resistance at end

		this.transformStyle.set(`translateX(${adjustedDelta}px)`);
	}

	/** Handle pointer up (touch or mouse) for swipe/drag detection. */
	protected onPointerUp(event: PointerEvent): void {
		if (!this.isDragging) return;
		this.isDragging = false;

		const deltaX = this.currentX - this.startX;
		const deltaY = Math.abs(event.clientY - this.startY);
		const deltaTime = Date.now() - this.startTime;

		// Enable smooth transition for snap
		this.transitionStyle.set('transform 0.3s ease-out');

		// Determine if we should snap to next/prev or return to center
		const canGoPrev = this.currentIndex() > 0;
		const canGoNext = this.currentIndex() < this.parts().length - 1;

		const isHorizontal = Math.abs(deltaX) > deltaY;
		const isFast = deltaTime < 500;
		const isLong = Math.abs(deltaX) > SWIPE_THRESHOLD;

		if (isHorizontal && (isFast || isLong)) {
			if (deltaX > SWIPE_THRESHOLD && canGoPrev) {
				// Drag/swipe right -> go to previous
				this.transformStyle.set('translateX(100%)');
				setTimeout(() => {
					this.prev();
					this.transformStyle.set('translateX(0px)');
					this.transitionStyle.set('none');
				}, 300);
				return;
			} else if (deltaX < -SWIPE_THRESHOLD && canGoNext) {
				// Drag/swipe left -> go to next
				this.transformStyle.set('translateX(-100%)');
				setTimeout(() => {
					this.next();
					this.transformStyle.set('translateX(0px)');
					this.transitionStyle.set('none');
				}, 300);
				return;
			}
		}

		// Snap back to center
		this.transformStyle.set('translateX(0px)');
		setTimeout(() => {
			this.transitionStyle.set('none');
		}, 300);
	}

	/** Cancel drag if pointer leaves the element. */
	protected onPointerLeave(event: PointerEvent): void {
		if (this.isDragging) {
			this.onPointerUp(event);
		}
	}

	ngAfterViewInit(): void {
		this.resizeObserver = new ResizeObserver(() => this.render());
		this.resizeObserver.observe(this.hostRef.nativeElement);
		this.render();
	}

	ngOnChanges(changes: SimpleChanges): void {
		if (changes['parts']) {
			this.currentIndex.set(0);
			this.render();
		}
	}

	ngOnDestroy(): void {
		this.resizeObserver?.disconnect();
	}

	protected prev(): void {
		if (this.currentIndex() > 0) {
			this.currentIndex.update((i) => i - 1);
			this.render();
		}
	}

	protected next(): void {
		if (this.currentIndex() < this.parts().length - 1) {
			this.currentIndex.update((i) => i + 1);
			this.render();
		}
	}

	private render(): void {
		const parts = this.parts();
		if (parts.length === 0) return;
		const text = parts[this.currentIndex()] ?? parts[0];
		if (text === undefined) return;
		const host = this.hostRef.nativeElement;
		const available = Math.max(240, host.clientWidth || host.getBoundingClientRect().width || 280);
		const size = Math.min(this.maxSize(), available);
		drawQrToCanvas(this.canvasRef.nativeElement, text, size);
	}
}
