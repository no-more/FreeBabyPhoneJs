import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { micOutline, stopCircleOutline } from 'ionicons/icons';

import { MicService } from '../../core/media/mic.service';
import { autoSplit } from '../../core/signaling/qr-parts';
import { encodeSdp } from '../../core/signaling/sdp-codec';
import { PeerConnectionService } from '../../core/webrtc/peer-connection.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';

type Phase = 'idle' | 'preparing' | 'awaiting-answer' | 'failed';

@Component({
  selector: 'app-emitter-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
    QrDisplayComponent,
  ],
  templateUrl: './emitter.page.html',
  styleUrl: './emitter.page.scss',
})
export class EmitterPage implements OnDestroy {
  private readonly mic = inject(MicService);
  private readonly peerService = inject(PeerConnectionService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly offerParts = signal<string[]>([]);

  protected readonly isPreparing = computed(() => this.phase() === 'preparing');
  protected readonly isAwaitingAnswer = computed(() => this.phase() === 'awaiting-answer');
  protected readonly isFailed = computed(() => this.phase() === 'failed');

  private peer: RTCPeerConnection | null = null;

  constructor() {
    addIcons({ micOutline, stopCircleOutline });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  protected async start(): Promise<void> {
    this.errorMessage.set(null);
    this.phase.set('preparing');
    try {
      const stream = await this.mic.acquire();
      const peer = await this.peerService.create();
      this.peer = peer;

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.peerService.waitForIceGathering(peer);

      const local = peer.localDescription;
      if (!local) throw new Error('Aucune description locale produite.');

      const payload = await encodeSdp(local.toJSON());
      this.offerParts.set(autoSplit(payload));
      this.phase.set('awaiting-answer');
    } catch (err) {
      this.errorMessage.set(this.toMessage(err));
      this.phase.set('failed');
      this.teardown();
    }
  }

  protected stop(): void {
    this.teardown();
    this.phase.set('idle');
    this.errorMessage.set(null);
    this.offerParts.set([]);
  }

  private teardown(): void {
    this.peer?.getSenders().forEach((s) => s.track?.stop());
    this.peer?.close();
    this.peer = null;
    this.mic.release();
  }

  private toMessage(err: unknown): string {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return 'Accès au microphone refusé. Autorisez le micro dans les réglages du navigateur.';
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
