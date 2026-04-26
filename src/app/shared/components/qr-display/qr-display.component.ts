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
import {
  IonButton,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';

import { drawQrToCanvas } from '../../../core/signaling/qr-draw';

/**
 * Renders one or more QR codes in sequence with prev / next controls when
 * there is more than one part. Size adapts to the container width.
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
  protected readonly counter = computed(() => `${this.currentIndex() + 1} / ${this.parts().length}`);

  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline });
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
