import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	afterNextRender,
	computed,
	inject,
	signal,
} from '@angular/core';

@Component({
	selector: 'app-widget-slider',
	templateUrl: './widget-slider.component.html',
	styleUrls: ['./widget-slider.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
})
export class WidgetSliderComponent {
	private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

	protected readonly activeSlide = signal(0);
	protected readonly translateX = signal(0);
	protected readonly isDragging = signal(false);
	protected readonly slideCount = signal(0);
	protected readonly slideIndices = computed(() => Array.from({ length: this.slideCount() }, (_, i) => i));

	private startX = 0;
	private currentX = 0;
	private readonly swipeThreshold = 50;

	constructor() {
		afterNextRender(() => {
			this.attachTouchListeners();
			this.updateSlideCount();
		});
	}

	private updateSlideCount(): void {
		const track = this.elementRef.nativeElement.querySelector('.widget-slider__track');
		const count = track?.children.length ?? 0;
		this.slideCount.set(count);
		this.elementRef.nativeElement.style.setProperty('--slide-count', String(count));
	}

	private attachTouchListeners(): void {
		const container = this.elementRef.nativeElement.querySelector('.widget-slider__container');
		if (!container) return;

		container.addEventListener('touchstart', (e) => this.onTouchStart(e as TouchEvent));
		container.addEventListener('touchmove', (e) => this.onTouchMove(e as TouchEvent));
		container.addEventListener('touchend', (e) => this.onTouchEnd(e as TouchEvent));
		container.addEventListener('mousedown', (e) => this.onTouchStart(e as MouseEvent));
		container.addEventListener('mousemove', (e) => this.onTouchMove(e as MouseEvent));
		container.addEventListener('mouseup', (e) => this.onTouchEnd(e as MouseEvent));
		container.addEventListener('mouseleave', (e) => this.onTouchEnd(e as MouseEvent));
	}

	private onTouchStart(e: TouchEvent | MouseEvent): void {
		this.isDragging.set(true);
		this.startX = this.getClientX(e);
		this.currentX = this.startX;
	}

	private onTouchMove(e: TouchEvent | MouseEvent): void {
		if (!this.isDragging()) return;
		e.preventDefault();
		this.currentX = this.getClientX(e);
		const diff = this.currentX - this.startX;
		this.translateX.set(diff);
	}

	private onTouchEnd(e: TouchEvent | MouseEvent): void {
		if (!this.isDragging()) return;
		this.isDragging.set(false);

		const diff = this.currentX - this.startX;
		const currentSlide = this.activeSlide();
		const maxSlide = this.slideCount() - 1;

		if (Math.abs(diff) > this.swipeThreshold) {
			if (diff > 0 && currentSlide > 0) {
				this.activeSlide.set(currentSlide - 1);
			} else if (diff < 0 && currentSlide < maxSlide) {
				this.activeSlide.set(currentSlide + 1);
			}
		}

		this.translateX.set(0);
	}

	private getClientX(e: TouchEvent | MouseEvent): number {
		return 'touches' in e ? e.touches[0].clientX : e.clientX;
	}

	protected goToSlide(index: number): void {
		if (index >= 0 && index < this.slideCount()) {
			this.activeSlide.set(index);
		}
	}
}
