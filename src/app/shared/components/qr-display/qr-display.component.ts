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

  @ViewChild('canvasPrev', { static: true }) canvasPrevRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasCurrent', { static: true }) canvasCurrentRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasNext', { static: true }) canvasNextRef!: ElementRef<HTMLCanvasElement>;
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

  /** Signals for CSS transforms during carousel swipe. */
  protected readonly prevTransform = signal<string>('translateX(-100%)');
  protected readonly currentTransform = signal<string>('translateX(0px)');
  protected readonly nextTransform = signal<string>('translateX(100%)');
  protected readonly prevOpacity = signal<number>(0);
  protected readonly nextOpacity = signal<number>(0);
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

  /** Handle pointer move for real-time carousel drag feedback. */
  protected onPointerMove(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.currentX = event.clientX;
    const deltaX = this.currentX - this.startX;

    const canGoPrev = this.currentIndex() > 0;
    const canGoNext = this.currentIndex() < this.parts().length - 1;

    let adjustedDelta = deltaX;
    if (!canGoPrev && deltaX > 0) adjustedDelta = deltaX * 0.3;
    if (!canGoNext && deltaX < 0) adjustedDelta = deltaX * 0.3;

    // Carousel effect: move current, show prev/next sliding in
    this.currentTransform.set(`translateX(${adjustedDelta}px)`);

    // Show previous QR when dragging right
    if (canGoPrev && deltaX > 0) {
      const prevProgress = Math.min(1, adjustedDelta / 100);
      this.prevTransform.set(`translateX(${-100 + adjustedDelta}px)`);
      this.prevOpacity.set(prevProgress);
    } else {
      this.prevTransform.set('translateX(-100%)');
      this.prevOpacity.set(0);
    }

    // Show next QR when dragging left
    if (canGoNext && deltaX < 0) {
      const nextProgress = Math.min(1, Math.abs(adjustedDelta) / 100);
      this.nextTransform.set(`translateX(${100 + adjustedDelta}px)`);
      this.nextOpacity.set(nextProgress);
    } else {
      this.nextTransform.set('translateX(100%)');
      this.nextOpacity.set(0);
    }
  }

  /** Handle pointer up (touch or mouse) for carousel swipe completion. */
  protected onPointerUp(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;

    const deltaX = this.currentX - this.startX;
    const deltaY = Math.abs(event.clientY - this.startY);
    const deltaTime = Date.now() - this.startTime;

    const canGoPrev = this.currentIndex() > 0;
    const canGoNext = this.currentIndex() < this.parts().length - 1;

    const isHorizontal = Math.abs(deltaX) > deltaY;
    const isFast = deltaTime < 500;
    const isLong = Math.abs(deltaX) > SWIPE_THRESHOLD;

    this.transitionStyle.set('transform 0.3s ease-out, opacity 0.3s ease-out');

    if (isHorizontal && (isFast || isLong)) {
      if (deltaX > SWIPE_THRESHOLD && canGoPrev) {
        // Swipe right -> go to previous
        this.currentTransform.set('translateX(100%)');
        this.prevTransform.set('translateX(0%)');
        this.prevOpacity.set(1);
        setTimeout(() => {
          this.prev();
          this.resetCarousel();
        }, 300);
        return;
      } else if (deltaX < -SWIPE_THRESHOLD && canGoNext) {
        // Swipe left -> go to next
        this.currentTransform.set('translateX(-100%)');
        this.nextTransform.set('translateX(0%)');
        this.nextOpacity.set(1);
        setTimeout(() => {
          this.next();
          this.resetCarousel();
        }, 300);
        return;
      }
    }

    // Snap back to center
    this.resetCarousel();
  }

  private resetCarousel(): void {
    this.currentTransform.set('translateX(0px)');
    this.prevTransform.set('translateX(-100%)');
    this.nextTransform.set('translateX(100%)');
    this.prevOpacity.set(0);
    this.nextOpacity.set(0);
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
    const index = this.currentIndex();
    const host = this.hostRef.nativeElement;
    const available = Math.max(240, host.clientWidth || host.getBoundingClientRect().width || 280);
    const size = Math.min(this.maxSize(), available);

    // Render current
    const currentText = parts[index] ?? parts[0];
    if (currentText !== undefined) {
      drawQrToCanvas(this.canvasCurrentRef.nativeElement, currentText, size);
    }

    // Render previous if exists
    if (index > 0) {
      const prevText = parts[index - 1];
      if (prevText !== undefined) {
        drawQrToCanvas(this.canvasPrevRef.nativeElement, prevText, size);
      }
    }

    // Render next if exists
    if (index < parts.length - 1) {
      const nextText = parts[index + 1];
      if (nextText !== undefined) {
        drawQrToCanvas(this.canvasNextRef.nativeElement, nextText, size);
      }
    }
  }
}
