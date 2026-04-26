import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
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
import {
  checkmarkCircle,
  qrCodeOutline,
  stopCircleOutline,
  volumeHighOutline,
} from 'ionicons/icons';

import { autoSplit } from '../../core/signaling/qr-parts';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { PeerConnectionService } from '../../core/webrtc/peer-connection.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';

type Phase =
  | 'idle'
  | 'scanning-offer'
  | 'preparing-answer'
  | 'awaiting-emitter'
  | 'connecting'
  | 'connected'
  | 'failed';

@Component({
  selector: 'app-receiver-page',
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
    QrScannerComponent,
  ],
  templateUrl: './receiver.page.html',
  styleUrl: './receiver.page.scss',
})
export class ReceiverPage implements OnDestroy {
  private readonly peerService = inject(PeerConnectionService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly answerParts = signal<string[]>([]);
  protected readonly needsTapToPlay = signal(false);

  protected readonly isFailed = computed(() => this.phase() === 'failed');

  @ViewChild('audio', { static: false }) audioRef?: ElementRef<HTMLAudioElement>;

  private peer: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;

  constructor() {
    addIcons({ checkmarkCircle, qrCodeOutline, stopCircleOutline, volumeHighOutline });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  protected startOfferScan(): void {
    this.errorMessage.set(null);
    this.phase.set('scanning-offer');
  }

  protected async onOfferScanned(payload: string): Promise<void> {
    try {
      this.phase.set('preparing-answer');
      const offer = await decodeSdp(payload);
      const peer = await this.peerService.create();
      this.peer = peer;

      peer.addEventListener('track', (event) => this.onRemoteTrack(event));

      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await this.peerService.waitForIceGathering(peer);

      const local = peer.localDescription;
      if (!local) throw new Error('Aucune description locale produite.');

      const encoded = await encodeSdp(local.toJSON());
      this.answerParts.set(autoSplit(encoded));
      this.phase.set('awaiting-emitter');
      this.watchForConnected(peer);
    } catch (err) {
      this.errorMessage.set('Offre invalide : ' + this.toMessage(err));
      this.phase.set('failed');
      this.teardown();
    }
  }

  protected onScanError(err: Error): void {
    this.errorMessage.set(
      'Impossible d\u2019ouvrir la caméra : ' + (err.message || 'accès refusé'),
    );
    this.phase.set('failed');
  }

  protected stop(): void {
    this.teardown();
    this.errorMessage.set(null);
    this.answerParts.set([]);
    this.needsTapToPlay.set(false);
    this.phase.set('idle');
  }

  protected async tapToPlay(): Promise<void> {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;
    try {
      await audio.play();
      this.needsTapToPlay.set(false);
    } catch (err) {
      this.errorMessage.set('Lecture audio refusée : ' + this.toMessage(err));
    }
  }

  private onRemoteTrack(event: RTCTrackEvent): void {
    this.remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    queueMicrotask(() => this.attachStreamToAudio());
  }

  private attachStreamToAudio(): void {
    const audio = this.audioRef?.nativeElement;
    if (!audio || !this.remoteStream) return;
    audio.srcObject = this.remoteStream;
    audio.play().catch(() => {
      // Browsers may require an explicit user gesture to start playback.
      this.needsTapToPlay.set(true);
    });
  }

  private watchForConnected(peer: RTCPeerConnection): void {
    const check = (): void => {
      const state = peer.connectionState;
      if (state === 'connected') {
        peer.removeEventListener('connectionstatechange', check);
        this.phase.set('connected');
        // Re-attach the stream now that the audio element is in the DOM.
        queueMicrotask(() => this.attachStreamToAudio());
      } else if (state === 'failed' || state === 'closed') {
        peer.removeEventListener('connectionstatechange', check);
        this.errorMessage.set('\u00c9chec de la connexion. Relancez l\u2019appairage.');
        this.phase.set('failed');
        this.teardown();
      }
    };
    peer.addEventListener('connectionstatechange', check);
    check();
  }

  private teardown(): void {
    if (this.audioRef?.nativeElement) {
      this.audioRef.nativeElement.srcObject = null;
    }
    this.remoteStream?.getTracks().forEach((t) => t.stop());
    this.remoteStream = null;
    this.peer?.close();
    this.peer = null;
  }

  private toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
