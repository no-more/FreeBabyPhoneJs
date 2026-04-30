import {
	ChangeDetectionStrategy,
	Component,
	OnDestroy,
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
import { checkmarkCircle, closeOutline, micOffOutline, micOutline, qrCodeOutline, stopCircleOutline } from 'ionicons/icons';

import { AudioKeepaliveService } from '../../core/media/audio-keepalive.service';
import { MicService } from '../../core/media/mic.service';
import { WakeLockService } from '../../core/media/wake-lock.service';
import { autoSplit } from '../../core/signaling/qr-parts';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { PeerConnectionService } from '../../core/webrtc/peer-connection.service';
import { ReconnectService } from '../../core/webrtc/reconnect.service';
import { QuickReconnectService } from '../../core/storage/quick-reconnect.service';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { VuMeterComponent } from '../../shared/components/vu-meter/vu-meter.component';

type Phase =
	| 'idle'
	| 'preparing'
	| 'awaiting-answer'
	| 'scanning-answer'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'failed';

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
		QrScannerComponent,
		VuMeterComponent,
	],
	templateUrl: './emitter.page.html',
	styleUrl: './emitter.page.scss',
})
export class EmitterPage implements OnDestroy {
	private readonly mic = inject(MicService);
	private readonly peerService = inject(PeerConnectionService);
	private readonly wakeLock = inject(WakeLockService);
	private readonly audioKeepalive = inject(AudioKeepaliveService);
	private readonly reconnect = inject(ReconnectService);
	private readonly quickReconnect = inject(QuickReconnectService);

	protected readonly phase = signal<Phase>('idle');
	protected readonly errorMessage = signal<string | null>(null);
	protected readonly offerParts = signal<string[]>([]);
	protected readonly localStream = signal<MediaStream | null>(null);
	protected readonly isMuted = signal(false);
	protected readonly debugLogs = signal<string[]>([]);
	protected readonly showDebugPanel = signal(true);

	protected readonly isPreparing = computed(() => this.phase() === 'preparing');
	protected readonly isAwaitingAnswer = computed(() => this.phase() === 'awaiting-answer');
	protected readonly isScanningAnswer = computed(() => this.phase() === 'scanning-answer');
	protected readonly isFailed = computed(() => this.phase() === 'failed');
	protected readonly isReconnecting = computed(() => this.reconnect.status() === 'reconnecting');

	private peer: RTCPeerConnection | null = null;
	private quickReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

	private log(message: string): void {
		console.log('[Emitter]', message);
		const timestamp = new Date().toLocaleTimeString('fr-FR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
		this.debugLogs.update(logs => {
			const newLogs = [`${timestamp} ${message}`, ...logs];
			return newLogs.slice(0, 20);
		});
	}

	constructor() {
		addIcons({ checkmarkCircle, closeOutline, micOffOutline, micOutline, qrCodeOutline, stopCircleOutline });
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

	protected async start(): Promise<void> {
		this.errorMessage.set(null);
		this.phase.set('preparing');
		try {
			const stream = await this.mic.acquire();
			this.log('Mic acquired, tracks: ' + JSON.stringify(stream.getTracks().map(t => ({ kind: t.kind, id: t.id.substring(0, 8), enabled: t.enabled, muted: t.muted, readyState: t.readyState }))));
			this.localStream.set(stream);
			const peer = await this.peerService.create();
			this.peer = peer;

			stream.getTracks().forEach((track) => {
				this.log('Adding track to peer: kind=' + track.kind + ' id=' + track.id + ' enabled=' + track.enabled + ' muted=' + track.muted + ' readyState=' + track.readyState);
				peer.addTrack(track, stream);
			});

			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			await this.peerService.waitForIceGathering(peer);

			this.audioKeepalive.start();
			this.log('Audio keepalive started');

			const local = peer.localDescription;
			if (!local) throw new Error('Aucune description locale produite.');

			this.log('Local SDP (offer): ' + local.sdp.substring(0, 200) + '...');
			this.log('Local SDP tracks: ' + (local.sdp.match(/a=mid:/g) || []).length + ' media sections');

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

	protected toggleMute(): void {
		const stream = this.localStream();
		if (!stream) return;

		const newMutedState = !this.isMuted();
		this.isMuted.set(newMutedState);
		this.log('Toggle mute: ' + (newMutedState ? 'muting' : 'unmuting'));

		// Enable/disable audio track without stopping the stream or connection
		stream.getAudioTracks().forEach((track) => {
			this.log('Track before toggle: enabled=' + track.enabled + ' muted=' + track.muted);
			track.enabled = !newMutedState;
			this.log('Track after toggle: enabled=' + track.enabled + ' muted=' + track.muted);
		});
	}

	protected startAnswerScan(): void {
		this.phase.set('scanning-answer');
	}

	protected async onAnswerScanned(payload: string): Promise<void> {
		const peer = this.peer;
		if (!peer) return;
		try {
			this.phase.set('connecting');
			this.log('Answer scanned, setting remote description');
			const answer = await decodeSdp(payload);
			await peer.setRemoteDescription(answer);
			this.reconnect.attach(peer);
			this.watchForConnected(peer);
		} catch (err) {
			this.errorMessage.set('Réponse invalide : ' + this.toMessage(err));
			this.phase.set('awaiting-answer');
		}
	}

	protected onScanError(err: Error): void {
		this.errorMessage.set(
			'Impossible d\u2019ouvrir la caméra : ' + (err.message || 'accès refusé'),
		);
		this.phase.set('awaiting-answer');
	}

	private watchForConnected(peer: RTCPeerConnection): void {
		this.log('watchForConnected: starting to monitor connection state');
		const check = (): void => {
			const state = peer.connectionState;
			this.log('Connection state changed to: ' + state);
			if (state === 'connected') {
				peer.removeEventListener('connectionstatechange', check);
				this.phase.set('connected');
				void this.wakeLock.acquire();
				// Save for quick reconnect on next launch
				const cached = this.quickReconnect.load();
				if (!cached) {
					const offer = peer.localDescription;
					const answer = peer.remoteDescription;
					if (offer && answer) {
						this.quickReconnect.save({
							timestamp: Date.now(),
							emitterSdp: offer.toJSON(),
							receiverSdp: answer.toJSON(),
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
		this.peer?.getSenders().forEach((s) => s.track?.stop());
		this.peer?.close();
		this.peer = null;
		this.mic.release();
		this.wakeLock.release();
		this.audioKeepalive.stop();
		this.reconnect.detach();
		this.localStream.set(null);
		if (this.quickReconnectTimeout) {
			clearTimeout(this.quickReconnectTimeout);
			this.quickReconnectTimeout = null;
		}
	}

	private async attemptQuickReconnect(): Promise<void> {
		const cached = this.quickReconnect.load();
		if (!cached?.emitterSdp) return;

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

			// Restore local description (our offer)
			await peer.setLocalDescription(cached.emitterSdp);

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
		if (err instanceof DOMException && err.name === 'NotAllowedError') {
			return 'Accès au microphone refusé. Autorisez le micro dans les réglages du navigateur.';
		}
		if (err instanceof Error) return err.message;
		return String(err);
	}
}
