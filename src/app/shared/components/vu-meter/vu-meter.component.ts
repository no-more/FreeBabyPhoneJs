import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  input,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
export class VuMeterComponent implements OnInit {
  /** MediaStream to analyze (local mic or remote audio). */
  readonly stream = input<MediaStream | null>(null);

  private readonly barRef = viewChild.required<ElementRef<HTMLDivElement>>('bar');
  private readonly destroyRef = inject(DestroyRef);

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private rafId: number | null = null;

  ngOnInit(): void {
    // React to stream changes
    // Note: In a real component we'd use a computed or effect, but for simplicity
    // we watch the stream input via a microtask pattern in the constructor
    setTimeout(() => this.setupStreamWatcher(), 0);
  }

  private setupStreamWatcher(): void {
    let previousStream: MediaStream | null = null;

    const checkStream = (): void => {
      const current = this.stream();
      if (current !== previousStream) {
        previousStream = current;
        if (current) {
          void this.startAnalyzing(current);
        } else {
          this.stopAnalyzing();
        }
      }
      this.rafId = requestAnimationFrame(checkStream);
    };

    this.rafId = requestAnimationFrame(checkStream);

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      this.stopAnalyzing();
    });
  }

  private async startAnalyzing(stream: MediaStream): Promise<void> {
    // Close any existing context
    this.stopAnalyzing();

    try {
      this.audioCtx = new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      this.tick();
    } catch (e) {
      console.error('VU meter failed to start:', e);
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

    // @ts-expect-error Type mismatch between Uint8Array generics in DOM types
    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length;

    // Scale to percentage (0-100), with some amplification for visibility
    const percentage = Math.min(100, average * 2.5);

    const bar = this.barRef().nativeElement;
    bar.style.width = `${percentage}%`;

    // Toggle warning class when level is high
    bar.classList.toggle('warning', average > 30);

    this.rafId = requestAnimationFrame(() => this.tick());
  }
}
