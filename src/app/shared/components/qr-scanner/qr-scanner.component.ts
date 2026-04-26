import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import QrScanner from 'qr-scanner';

import { QrPartsAssembler } from '../../../core/signaling/qr-parts';

/**
 * Camera-based QR scanner. Starts the rear camera on mount, emits
 * `scanned` with the reassembled payload (supports multi-part QR sequences).
 */
@Component({
  selector: 'app-qr-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.scss',
})
export class QrScannerComponent implements AfterViewInit, OnDestroy {
  /** Reset assembler state when the reset counter changes. */
  readonly resetToken = input<number>(0);

  readonly scanned = output<string>();
  readonly progress = output<{ received: number; total: number }>();
  readonly error = output<Error>();

  @ViewChild('video', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;

  private readonly assembler = new QrPartsAssembler();
  private scanner: QrScanner | null = null;
  private lastRaw = '';
  private lastResetToken = 0;

  protected readonly progressSig = signal<{ received: number; total: number } | null>(null);
  protected readonly hasProgress = computed(() => this.progressSig() !== null);

  private readonly elementRef = inject(ElementRef);

  async ngAfterViewInit(): Promise<void> {
    await this.start();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** Public stop method, callable from parent via template ref if needed. */
  stop(): void {
    this.scanner?.stop();
    this.scanner?.destroy();
    this.scanner = null;
  }

  private async start(): Promise<void> {
    try {
      this.scanner = new QrScanner(
        this.videoRef.nativeElement,
        (result) => this.onResult(result),
        {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 5,
        },
      );
      await this.scanner.start();
    } catch (err) {
      this.error.emit(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onResult(result: QrScanner.ScanResult): void {
    if (this.resetToken() !== this.lastResetToken) {
      this.lastResetToken = this.resetToken();
      this.assembler.reset();
      this.progressSig.set(null);
      this.lastRaw = '';
    }

    const raw = result.data;
    if (raw === this.lastRaw) return; // dedupe consecutive scans of the same part
    this.lastRaw = raw;

    const outcome = this.assembler.push(raw);
    if (outcome.complete) {
      this.progressSig.set(null);
      this.scanned.emit(outcome.payload);
    } else {
      this.progressSig.set({ received: outcome.received, total: outcome.total });
      this.progress.emit({ received: outcome.received, total: outcome.total });
    }
  }
}
