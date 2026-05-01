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
	ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
	checkmarkCircle,
	qrCodeOutline,
	stopCircleOutline,
	volumeHighOutline,
	volumeMuteOutline,
} from 'ionicons/icons';

import { AudioKeepaliveService } from '../../core/media/audio-keepalive.service';
import { QrPartsAssembler, autoSplit } from '../../core/signaling/qr-parts';
import { WakeLockService } from '../../core/media/wake-lock.service';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { WebRTCService } from '../../core/webrtc/webrtc.service';
import { QuickReconnectService } from '../../core/storage/quick-reconnect.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { VuMeterComponent } from '../../shared/components/vu-meter/vu-meter.component';
import { ConnectionStatusComponent } from '../../shared/components/connection-status/connection-status.component';
import { WidgetSliderComponent } from '../../shared/components/widget-slider.component';
import { SessionInfoComponent } from '../../shared/components/session-info.component';

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
		VuMeterComponent,
		ConnectionStatusComponent,
		WidgetSliderComponent,
		SessionInfoComponent,
	],
	templateUrl: './receiver.page.html',
	styleUrl: './receiver.page.scss',
})
export class ReceiverPage implements OnDestroy {
	private readonly webrtc = inject(WebRTCService);
	private readonly wakeLock = inject(WakeLockService);
	private readonly audioKeepalive = inject(AudioKeepaliveService);
	private readonly quickReconnect = inject(QuickReconnectService);
	private readonly toastController = inject(ToastController);

	protected readonly phase = signal<Phase>('idle');
	protected readonly errorMessage = signal<string | null>(null);
	protected readonly answerParts = signal<string[]>([]);
	protected readonly needsTapToPlay = signal(false);
	protected readonly remoteStream = signal<MediaStream | null>(null);
	protected readonly scanProgress = signal<{ received: number; total: number; missing: number[] } | null>(null);
	protected readonly isMuted = signal(true); // Start muted like legacy
	protected readonly isEmitterMuted = signal(false);
	protected readonly connectionStartTime = signal<number | null>(null);

	protected readonly isFailed = computed(() => this.phase() === 'failed');
	protected readonly isReconnecting = computed(() => this.webrtc.connectionState() === 'connecting');
	protected readonly reconnectStatusSignal = computed(() => {
		const state = this.webrtc.connectionState();
		if (state === 'connecting') return 'Tentative de reconnexion...';
		if (state === 'failed' || state === 'disconnected') return 'Échec de la connexion';
		return null;
	});

	@ViewChild('audio', { static: false }) audioRef?: ElementRef<HTMLAudioElement>;

	// Getter for template access
	protected get peerInstance(): RTCPeerConnection | null {
		return this.webrtc.getPeerConnection();
	}
	private quickReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private readonly qrAssembler = new QrPartsAssembler();

	constructor() {
		addIcons({ checkmarkCircle, qrCodeOutline, stopCircleOutline, volumeHighOutline, volumeMuteOutline });
		// Watch connection state: on failure, fail the session
		effect(() => {
			const state = this.webrtc.connectionState();
			if (state === 'failed' || state === 'closed') {
				this.errorMessage.set('Connexion perdue. Relancez l’appairage.');
				this.phase.set('failed');
				this.teardown();
			}
		});
		// Sync audio element muted state with signal
		effect(() => {
			const audio = this.audioRef?.nativeElement;
			if (audio) {
				audio.muted = this.isMuted();
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
		this.scanProgress.set(null);
		this.qrAssembler.reset();
		this.audioKeepalive.start();
	}

	protected async onOfferScanned(payload: string): Promise<void> {
		try {
			const result = this.qrAssembler.push(payload);

			if (result.complete) {
				// All parts received or single QR
				this.scanProgress.set(null);
				this.phase.set('preparing-answer');
				const offer = await decodeSdp(result.payload);
				await this.webrtc.createPeerConnection();
				const peer = this.webrtc.getPeerConnection();
				if (!peer) throw new Error('Impossible de créer la connexion peer.');

				peer.addEventListener('track', (event) => this.onRemoteTrack(event));

				await this.webrtc.setRemoteDescription(offer);
				const answer = await this.webrtc.createAnswer();

				const local = peer.localDescription;
				if (!local) throw new Error('Aucune description locale produite.');

				const encoded = await encodeSdp(local.toJSON());
				this.answerParts.set(autoSplit(encoded));
				this.phase.set('awaiting-emitter');
				this.watchForConnected(peer);
			} else {
				// More parts needed
				const missing = this.qrAssembler.missingIndices();
				this.scanProgress.set({ received: result.received, total: result.total, missing });
				void this.showPartReceivedToast(result.received, result.total, missing);
			}
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

	private async showPartReceivedToast(received: number, total: number, missing: number[]): Promise<void> {
		const remaining = total - received;
		const remainingText = remaining > 1 ? 'QR codes' : 'QR code';
		const message = `Partie ${received}/${total} scannée ! Encore ${remaining} ${remainingText} à scanner (${missing.join(', ')})`;
		const toast = await this.toastController.create({
			message,
			duration: 3000,
			position: 'top',
			color: 'primary',
		});
		await toast.present();
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

	protected toggleMute(): void {
		const audio = this.audioRef?.nativeElement;
		if (!audio) return;

		const newMutedState = !this.isMuted();
		this.isMuted.set(newMutedState);
		audio.muted = newMutedState;
	}

	private onRemoteTrack(event: RTCTrackEvent): void {
		const stream = event.streams[0] ?? new MediaStream([event.track]);
		this.remoteStream.set(stream);
		this.attachStreamToAudio(); // Attach immediately like legacy
		this.monitorEmitterMuteState(event.track);
	}

	private monitorEmitterMuteState(track: MediaStreamTrack): void {
		// Initial state
		this.isEmitterMuted.set(!track.enabled);

		// Listen for mute/unmute events from emitter
		track.addEventListener('mute', () => {
			this.isEmitterMuted.set(true);
		});
		track.addEventListener('unmute', () => {
			this.isEmitterMuted.set(false);
		});
	}

	private attachStreamToAudio(): void {
		const audio = this.audioRef?.nativeElement;
		const stream = this.remoteStream();
		if (!audio || !stream) {
			return;
		}
		audio.srcObject = stream;

		audio.play().then(() => {
			// Playback started
		}).catch((err) => {
			// Browsers may require an explicit user gesture to start playback.
			this.needsTapToPlay.set(true);
		});
	}

	private watchForConnected(peer: RTCPeerConnection): void {
		const check = (): void => {
			const state = peer.connectionState;
			if (state === 'connected' && this.phase() !== 'connected') {
				this.phase.set('connected');
				this.connectionStartTime.set(Date.now());
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
		// Get the current stream from signal before clearing
		const currentStream = this.remoteStream();
		currentStream?.getTracks().forEach((t) => t.stop());
		this.remoteStream.set(null);
		this.webrtc.close();
		this.wakeLock.release();
		this.audioKeepalive.stop();
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
			await this.wakeLock.acquire();
			this.audioKeepalive.start();

			await this.webrtc.createPeerConnection();
			const peer = this.webrtc.getPeerConnection();
			if (!peer) throw new Error('Impossible de créer la connexion peer.');

			peer.addEventListener('track', (event) => this.onRemoteTrack(event));

			// Restore remote (emitter's offer) then local (our answer)
			await this.webrtc.setRemoteDescription(cached.emitterSdp);
			const peerInternal = this.webrtc.getPeerConnection();
			if (peerInternal) {
				await peerInternal.setLocalDescription(new RTCSessionDescription(cached.receiverSdp));
			}

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
