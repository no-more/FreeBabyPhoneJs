import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren,
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

  @ViewChild('scrollContainer', { static: true }) scrollContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;
  @ViewChildren('qrCanvas') canvasRefs!: QueryList<ElementRef<HTMLCanvasElement>>;

  protected readonly currentIndex = signal(0);
  protected readonly isMulti = computed(() => this.parts().length > 1);
  protected readonly counter = computed(
    () => `${this.currentIndex() + 1} / ${this.parts().length}`,
  );

  private resizeObserver: ResizeObserver | null = null;
  private scrollObserver: IntersectionObserver | null = null;

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline });
  }

  protected onIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const index = Number(entry.target.getAttribute('data-index'));
        this.currentIndex.set(index);
      }
    }
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.hostRef.nativeElement);

    // Use IntersectionObserver to detect which QR is visible
    this.scrollObserver = new IntersectionObserver((entries) => this.onIntersection(entries), {
      root: this.scrollContainerRef.nativeElement,
      threshold: 0.5,
    });

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
    this.scrollObserver?.disconnect();
  }

  protected prev(): void {
    if (this.currentIndex() > 0) {
      this.currentIndex.update((i) => i - 1);
      const container = this.scrollContainerRef.nativeElement;
      const items = container.querySelectorAll('.qr-display__item');
      const targetItem = items[this.currentIndex()];
      targetItem?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
  }

  protected next(): void {
    if (this.currentIndex() < this.parts().length - 1) {
      this.currentIndex.update((i) => i + 1);
      const container = this.scrollContainerRef.nativeElement;
      const items = container.querySelectorAll('.qr-display__item');
      const targetItem = items[this.currentIndex()];
      targetItem?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
  }

  private render(): void {
    const parts = this.parts();
    if (parts.length === 0) return;
    const host = this.hostRef.nativeElement;
    const available = Math.max(240, host.clientWidth || host.getBoundingClientRect().width || 280);
    const size = Math.min(this.maxSize(), available);

    // Render all canvases
    this.canvasRefs.forEach((ref, index) => {
      const text = parts[index];
      if (text !== undefined) {
        drawQrToCanvas(ref.nativeElement, text, size);
      }
    });

    // Re-observe canvases for intersection
    this.scrollObserver?.disconnect();
    this.canvasRefs.forEach((ref, index) => {
      ref.nativeElement.setAttribute('data-index', index.toString());
      this.scrollObserver?.observe(ref.nativeElement);
    });
  }

  /** Track items for ngFor. */
  protected trackByIndex(index: number): number {
    return index;
  }
}
