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
	closeOutline,
	qrCodeOutline,
	stopCircleOutline,
	volumeHighOutline,
	volumeMuteOutline,
} from 'ionicons/icons';

import { AudioKeepaliveService } from '../../core/media/audio-keepalive.service';
import { QrPartsAssembler, autoSplit } from '../../core/signaling/qr-parts';
import { WakeLockService } from '../../core/media/wake-lock.service';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { PeerConnectionService } from '../../core/webrtc/peer-connection.service';
import { ReconnectService } from '../../core/webrtc/reconnect.service';
import { QuickReconnectService } from '../../core/storage/quick-reconnect.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { VuMeterComponent } from '../../shared/components/vu-meter/vu-meter.component';

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
	private readonly toastController = inject(ToastController);

	protected readonly phase = signal<Phase>('idle');
	protected readonly errorMessage = signal<string | null>(null);
	protected readonly answerParts = signal<string[]>([]);
	protected readonly needsTapToPlay = signal(false);
	protected readonly remoteStream = signal<MediaStream | null>(null);
	protected readonly scanProgress = signal<{ received: number; total: number; missing: number[] } | null>(null);
	protected readonly isMuted = signal(true); // Start muted like legacy
	protected readonly isEmitterMuted = signal(false);
	protected readonly debugLogs = signal<string[]>([]);
	protected readonly showDebugPanel = signal(true); // Set to false to hide

	protected readonly isFailed = computed(() => this.phase() === 'failed');
	protected readonly isReconnecting = computed(() => this.reconnect.status() === 'reconnecting');

	@ViewChild('audio', { static: false }) audioRef?: ElementRef<HTMLAudioElement>;

	private peer: RTCPeerConnection | null = null;
	private quickReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private readonly qrAssembler = new QrPartsAssembler();

	private log(message: string): void {
		console.log('[Receiver]', message);
		const timestamp = new Date().toLocaleTimeString('fr-FR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
		this.debugLogs.update(logs => {
			const newLogs = [`${timestamp} ${message}`, ...logs];
			return newLogs.slice(0, 20); // Keep last 20 logs
		});
	}

	constructor() {
		addIcons({ checkmarkCircle, closeOutline, qrCodeOutline, stopCircleOutline, volumeHighOutline, volumeMuteOutline });
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
		this.scanProgress.set(null);
		this.qrAssembler.reset();
		this.audioKeepalive.start();
	}

	protected async onOfferScanned(payload: string): Promise<void> {
		this.log('onOfferScanned called with payload: ' + payload.substring(0, 50) + (payload.length > 50 ? '...' : ''));
		try {
			const result = this.qrAssembler.push(payload);
			this.log('Assembler result: ' + JSON.stringify(result));

			if (result.complete) {
				// All parts received or single QR
				this.scanProgress.set(null);
				this.phase.set('preparing-answer');
				const offer = await decodeSdp(result.payload);
				this.log('Decoded SDP (offer): ' + (offer.sdp?.substring(0, 200) || 'no sdp') + '...');
				this.log('Decoded SDP tracks: ' + (offer.sdp?.match(/a=mid:/g) || []).length + ' media sections');
				const peer = await this.peerService.create();
				this.peer = peer;

				peer.addEventListener('track', (event) => this.onRemoteTrack(event));

				await peer.setRemoteDescription(new RTCSessionDescription(offer));
				this.log('Peer transceivers after setRemote: ' + peer.getTransceivers().length);
				peer.getTransceivers().forEach((t, i) => {
					this.log('Transceiver ' + i + ': mid=' + (t.mid || 'null') + ' currentDirection=' + (t.currentDirection || 'null') + ' direction=' + (t.direction || 'null'));
				});
				const answer = await peer.createAnswer();
				await peer.setLocalDescription(new RTCSessionDescription(answer));
				await this.peerService.waitForIceGathering(peer);

				const local = peer.localDescription;
				if (!local) throw new Error('Aucune description locale produite.');

				const encoded = await encodeSdp(local.toJSON());
				this.answerParts.set(autoSplit(encoded));
				this.phase.set('awaiting-emitter');
				this.reconnect.attach(peer);
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
		const peer = this.peer;
		this.log('onRemoteTrack fired: kind=' + event.track.kind + ' id=' + event.track.id + ' enabled=' + event.track.enabled);
		if (peer) {
			this.log('Connection state at track event: ' + peer.connectionState + ', ICE: ' + peer.iceConnectionState + ', Signaling: ' + peer.signalingState);
		}
		const stream = event.streams[0] ?? new MediaStream([event.track]);
		this.log('Stream tracks: ' + JSON.stringify(stream.getTracks().map(t => ({ kind: t.kind, id: t.id, enabled: t.enabled, muted: t.muted }))));
		this.remoteStream.set(stream);
		this.attachStreamToAudio(); // Attach immediately like legacy
		this.monitorEmitterMuteState(event.track);
	}

	private monitorEmitterMuteState(track: MediaStreamTrack): void {
		this.log('monitorEmitterMuteState: initial enabled=' + track.enabled + ' muted=' + track.muted);
		// Initial state
		this.isEmitterMuted.set(!track.enabled);

		// Listen for mute/unmute events from emitter
		track.addEventListener('mute', () => {
			this.log('Remote track muted event fired');
			this.isEmitterMuted.set(true);
		});
		track.addEventListener('unmute', () => {
			this.log('Remote track unmuted event fired');
			this.isEmitterMuted.set(false);
		});
		track.addEventListener('ended', () => {
			this.log('Remote track ended event fired');
		});
	}

	private attachStreamToAudio(): void {
		const audio = this.audioRef?.nativeElement;
		const stream = this.remoteStream();
		this.log('attachStreamToAudio: audio=' + !!audio + ' stream=' + !!stream + ' phase=' + this.phase());
		if (!audio || !stream) {
			this.log('attachStreamToAudio: missing audio or stream, skipping (will retry on connected)');
			return;
		}
		audio.srcObject = stream;
		this.log('Stream attached to audio element');
		this.log('Audio element state: volume=' + audio.volume + ' muted=' + audio.muted + ' readyState=' + audio.readyState);

		// Try to unmute the audio track on receiver side
		stream.getAudioTracks().forEach(track => {
			this.log('Receiver track before unmute: enabled=' + track.enabled + ' muted=' + track.muted);
			track.enabled = true;
			this.log('Receiver track after unmute: enabled=' + track.enabled + ' muted=' + track.muted);
		});

		audio.play().then(() => {
			this.log('Audio playback started successfully');
			this.log('Audio element playing: ' + !audio.paused);
		}).catch((err) => {
			this.log('Audio playback failed (needs user gesture): ' + err.message);
			// Browsers may require an explicit user gesture to start playback.
			this.needsTapToPlay.set(true);
		});
	}

	private watchForConnected(peer: RTCPeerConnection): void {
		this.log('watchForConnected: starting to monitor connection state');
		peer.addEventListener('iceconnectionstatechange', () => {
			this.log('ICE connection state: ' + peer.iceConnectionState);
		});
		peer.addEventListener('signalingstatechange', () => {
			this.log('Signaling state: ' + peer.signalingState);
		});
		const check = (): void => {
			const state = peer.connectionState;
			this.log('Connection state: ' + state + ', ICE: ' + peer.iceConnectionState + ', Signaling: ' + peer.signalingState);
			if (state === 'connected' && this.phase() !== 'connected') {
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
		// Get the current stream from signal before clearing
		const currentStream = this.remoteStream();
		currentStream?.getTracks().forEach((t) => t.stop());
		this.remoteStream.set(null);
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
