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

/**
 * Renders QR codes in a horizontal scrollable carousel.
 * Supports touch swipe, mouse drag, and prev/next navigation.
 * Uses CSS scroll-snap for smooth centering.
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

	/** Max QR code size in px. Defaults to `320`. */
	readonly maxSize = input<number>(320);

	@ViewChild('scrollContainer', { static: true }) scrollContainerRef!: ElementRef<HTMLDivElement>;

	protected readonly currentIndex = signal(0);
	protected readonly isMulti = computed(() => this.parts().length > 1);
	protected readonly counter = computed(
		() => `${this.currentIndex() + 1} / ${this.parts().length}`,
	);

	private resizeObserver: ResizeObserver | null = null;
	private scrollListener: (() => void) | null = null;

	// Mouse drag state
	private isDragging = false;
	private startX = 0;
	private scrollStartLeft = 0;

	constructor() {
		addIcons({ chevronBackOutline, chevronForwardOutline });
	}

	ngAfterViewInit(): void {
		const container = this.scrollContainerRef.nativeElement;

		// Update current index on scroll (snap change)
		this.scrollListener = () => this.updateIndexFromScroll();
		container.addEventListener('scroll', this.scrollListener, { passive: true });

		// Mouse drag support for desktop
		container.addEventListener('mousedown', this.onMouseDown.bind(this));
		container.addEventListener('mousemove', this.onMouseMove.bind(this));
		container.addEventListener('mouseup', this.onMouseUp.bind(this));
		container.addEventListener('mouseleave', this.onMouseUp.bind(this));
		// Prevent text selection during drag
		container.style.userSelect = 'none';

		// Render all QR codes when size changes
		this.resizeObserver = new ResizeObserver(() => this.renderAll());
		this.resizeObserver.observe(container);

		// Initial render
		this.renderAll();
	}

	ngOnChanges(changes: SimpleChanges): void {
		if (changes['parts']) {
			this.currentIndex.set(0);
			// Reset scroll to start
			const container = this.scrollContainerRef?.nativeElement;
			if (container) {
				container.scrollLeft = 0;
			}
			this.renderAll();
		}
	}

	ngOnDestroy(): void {
		this.resizeObserver?.disconnect();
		if (this.scrollListener) {
			this.scrollContainerRef?.nativeElement.removeEventListener('scroll', this.scrollListener);
		}
		const container = this.scrollContainerRef?.nativeElement;
		if (container) {
			container.removeEventListener('mousedown', this.onMouseDown.bind(this));
			container.removeEventListener('mousemove', this.onMouseMove.bind(this));
			container.removeEventListener('mouseup', this.onMouseUp.bind(this));
			container.removeEventListener('mouseleave', this.onMouseUp.bind(this));
		}
	}

	private onMouseDown(e: MouseEvent): void {
		if (!this.isMulti()) return;
		const container = this.scrollContainerRef.nativeElement;
		this.isDragging = true;
		this.startX = e.pageX;
		this.scrollStartLeft = container.scrollLeft;
		container.style.cursor = 'grabbing';
		// Disable snap during drag for smooth scrolling
		container.style.scrollSnapType = 'none';
	}

	private onMouseMove(e: MouseEvent): void {
		if (!this.isDragging) return;
		e.preventDefault();
		const x = e.pageX;
		const walk = (this.startX - x);
		this.scrollContainerRef.nativeElement.scrollLeft = this.scrollStartLeft + walk;
	}

	private onMouseUp(): void {
		if (!this.isDragging) return;
		this.isDragging = false;
		const container = this.scrollContainerRef.nativeElement;
		container.style.cursor = '';
		// Re-enable snap and trigger smooth snap to nearest item
		container.style.scrollSnapType = 'x mandatory';
		// Force a small scroll to trigger snap animation
		requestAnimationFrame(() => {
			this.snapToNearestItem();
		});
	}

	private snapToNearestItem(): void {
		const container = this.scrollContainerRef.nativeElement;
		const itemWidth = this.getItemWidth();
		const containerWidth = container.clientWidth;
		const scrollCenter = container.scrollLeft + containerWidth / 2;
		const itemCenter = itemWidth / 2;
		const index = Math.round((scrollCenter - itemCenter) / itemWidth);
		const clampedIndex = Math.max(0, Math.min(this.parts().length - 1, index));
		// Smooth scroll to the nearest item
		this.scrollToIndex(clampedIndex);
	}

	protected prev(): void {
		const newIndex = Math.max(0, this.currentIndex() - 1);
		this.scrollToIndex(newIndex);
	}

	protected next(): void {
		const newIndex = Math.min(this.parts().length - 1, this.currentIndex() + 1);
		this.scrollToIndex(newIndex);
	}

	private scrollToIndex(index: number): void {
		const container = this.scrollContainerRef.nativeElement;
		const itemWidth = this.getItemWidth();
		const containerWidth = container.clientWidth;
		const scrollPosition = index * itemWidth - (containerWidth - itemWidth) / 2;

		container.scrollTo({
			left: Math.max(0, scrollPosition),
			behavior: 'smooth',
		});
		this.currentIndex.set(index);
	}

	private updateIndexFromScroll(): void {
		const container = this.scrollContainerRef.nativeElement;
		const itemWidth = this.getItemWidth();
		const containerWidth = container.clientWidth;
		const scrollCenter = container.scrollLeft + containerWidth / 2;
		const itemCenter = itemWidth / 2;

		const index = Math.round((scrollCenter - itemCenter) / itemWidth);
		const clampedIndex = Math.max(0, Math.min(this.parts().length - 1, index));

		if (clampedIndex !== this.currentIndex()) {
			this.currentIndex.set(clampedIndex);
		}
	}

	private getItemWidth(): number {
		const container = this.scrollContainerRef.nativeElement;
		const containerWidth = container.clientWidth;
		const qrSize = Math.min(this.maxSize(), containerWidth - 48);
		// Item width includes gap (16px) and padding
		return qrSize + 32;
	}

	private renderAll(): void {
		const parts = this.parts();
		const container = this.scrollContainerRef.nativeElement;
		const canvases = container.querySelectorAll('canvas');

		const itemWidth = this.getItemWidth();
		const qrSize = itemWidth - 32;

		canvases.forEach((canvas, index) => {
			const text = parts[index];
			if (text !== undefined) {
				drawQrToCanvas(canvas, text, qrSize - 16); // Padding within the item
			}
		});
	}
}
