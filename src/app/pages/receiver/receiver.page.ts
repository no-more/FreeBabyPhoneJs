import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
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

import { AudioKeepaliveService } from '../../core/media/audio-keepalive.service';
import { autoSplit } from '../../core/signaling/qr-parts';
import { WakeLockService } from '../../core/media/wake-lock.service';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { PeerConnectionService } from '../../core/webrtc/peer-connection.service';
import { ReconnectService } from '../../core/webrtc/reconnect.service';
import { QuickReconnectService } from '../../core/storage/quick-reconnect.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';

type Phase =
  | 'idle'
  | 'scanning-offer'
  | 'preparing-answer'
  | 'awaiting-emitter'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
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
  private readonly wakeLock = inject(WakeLockService);
  private readonly audioKeepalive = inject(AudioKeepaliveService);
  private readonly reconnect = inject(ReconnectService);
  private readonly quickReconnect = inject(QuickReconnectService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly answerParts = signal<string[]>([]);
  protected readonly needsTapToPlay = signal(false);

  protected readonly isFailed = computed(() => this.phase() === 'failed');
  protected readonly isReconnecting = computed(() => this.reconnect.status() === 'reconnecting');

  @ViewChild('audio', { static: false }) audioRef?: ElementRef<HTMLAudioElement>;

  private peer: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private quickReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    addIcons({ checkmarkCircle, qrCodeOutline, stopCircleOutline, volumeHighOutline });
    // Watch reconnect status: on 'gave-up', fail the session
    effect(() => {
      if (this.reconnect.status() === 'gave-up') {
        this.errorMessage.set('Connexion perdue. Relancez l\u2019appairage.');
        this.phase.set('failed');
        this.teardown();
      }
    });
    // Attempt quick reconnect on mount
    void this.attemptQuickReconnect();
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  protected startOfferScan(): void {
    this.errorMessage.set(null);
    this.phase.set('scanning-offer');
    this.audioKeepalive.start();
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
      this.reconnect.attach(peer);
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
        void this.wakeLock.acquire();
        // Save for quick reconnect on next launch
        const cached = this.quickReconnect.load();
        if (!cached) {
          const remote = peer.remoteDescription;
          const local = peer.localDescription;
          if (remote && local) {
            this.quickReconnect.save({
              timestamp: Date.now(),
              emitterSdp: remote.toJSON(),
              receiverSdp: local.toJSON(),
            });
          }
        }
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
    this.wakeLock.release();
    this.audioKeepalive.stop();
    this.reconnect.detach();
    if (this.quickReconnectTimeout) {
      clearTimeout(this.quickReconnectTimeout);
      this.quickReconnectTimeout = null;
    }
  }

  private async attemptQuickReconnect(): Promise<void> {
    const cached = this.quickReconnect.load();
    if (!cached?.emitterSdp || !cached?.receiverSdp) return;

    this.phase.set('connecting');
    this.errorMessage.set('Reprise de la connexion…');

    // 10s watchdog
    this.quickReconnectTimeout = setTimeout(() => {
      this.quickReconnect.clear();
      this.teardown();
      this.phase.set('idle');
      this.errorMessage.set('Reconnexion échouée — utilisez les QR codes.');
    }, 10000);

    try {
      const peer = await this.peerService.create();
      this.peer = peer;
      this.reconnect.attach(peer);

      peer.addEventListener('track', (event) => this.onRemoteTrack(event));

      // Restore remote (emitter's offer) then local (our answer)
      await peer.setRemoteDescription(cached.emitterSdp);
      await peer.setLocalDescription(cached.receiverSdp);

      // Watch for connection or failure
      this.watchForConnected(peer);
    } catch {
      this.quickReconnect.clear();
      this.teardown();
      this.phase.set('idle');
      this.errorMessage.set(null);
    }
  }

  private toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
