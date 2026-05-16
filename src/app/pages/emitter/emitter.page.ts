import {
	ChangeDetectionStrategy,
	Component,
	OnDestroy,
	computed,
	effect,
	inject,
	signal,
} from '@angular/core';
import { Router } from '@angular/router';
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
import { checkmarkCircle, micOffOutline, micOutline, qrCodeOutline, settingsOutline, stopCircleOutline } from 'ionicons/icons';

import { AudioKeepaliveService } from '../../core/media/audio-keepalive.service';
import { MicService } from '../../core/media/mic.service';
import { WakeLockService } from '../../core/media/wake-lock.service';
import { autoSplit } from '../../core/signaling/qr-parts';
import { decodeSdp, encodeSdp } from '../../core/signaling/sdp-codec';
import { WebRTCService } from '../../core/webrtc/webrtc.service';
import { QuickReconnectService } from '../../core/storage/quick-reconnect.service';
import { PreferencesService } from '../../core/storage/preferences.service';
import type { VuMeterSensitivity } from '../../core/models';
import { QrDisplayComponent } from '../../shared/components/qr-display/qr-display.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { VuMeterComponent } from '../../shared/components/vu-meter/vu-meter.component';
import { ConnectionStatusComponent } from '../../shared/components/connection-status/connection-status.component';

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
		ConnectionStatusComponent,
	],
	templateUrl: './emitter.page.html',
	styleUrl: './emitter.page.scss',
})
export class EmitterPage implements OnDestroy {
	private readonly mic = inject(MicService);
	private readonly webrtc = inject(WebRTCService);
	private readonly wakeLock = inject(WakeLockService);
	private readonly audioKeepalive = inject(AudioKeepaliveService);
	private readonly quickReconnect = inject(QuickReconnectService);
	private readonly preferences = inject(PreferencesService);
	private readonly router = inject(Router);

	protected readonly phase = signal<Phase>('idle');
	protected readonly errorMessage = signal<string | null>(null);
	protected readonly offerParts = signal<string[]>([]);
	protected readonly localStream = signal<MediaStream | null>(null);
	protected readonly isMuted = signal(false);
	protected readonly vuSensitivity = signal<VuMeterSensitivity>('medium');
	protected readonly noiseCancellation = signal(false);
	protected readonly echoCancellation = signal(false);
	protected readonly autoGainControl = signal(false);
	protected readonly keepScreenOn = signal(false);

	protected readonly isPreparing = computed(() => this.phase() === 'preparing');
	protected readonly isAwaitingAnswer = computed(() => this.phase() === 'awaiting-answer');
	protected readonly isScanningAnswer = computed(() => this.phase() === 'scanning-answer');
	protected readonly isFailed = computed(() => this.phase() === 'failed');
	protected readonly isReconnecting = computed(() => this.webrtc.connectionState() === 'connecting');
	protected readonly reconnectStatusSignal = computed(() => {
		const state = this.webrtc.connectionState();
		if (state === 'connecting') return 'Tentative de reconnexion...';
		if (state === 'failed' || state === 'disconnected') return 'Échec de la connexion';
		return null;
	});

	private quickReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private batteryInterval: ReturnType<typeof setInterval> | null = null;

	// Getter for template access
	protected get peerInstance(): RTCPeerConnection | null {
		return this.webrtc.getPeerConnection();
	}

	constructor() {
		addIcons({ checkmarkCircle, micOffOutline, micOutline, qrCodeOutline, settingsOutline, stopCircleOutline });
		// Load VU meter sensitivity from preferences
		this.vuSensitivity.set(this.preferences.getVuMeterSensitivity('emitter'));
		// Load noise cancellation from preferences
		this.noiseCancellation.set(this.preferences.getNoiseCancellation());
		// Load echo cancellation from preferences
		this.echoCancellation.set(this.preferences.getEchoCancellation());
		// Load auto gain control from preferences
		this.autoGainControl.set(this.preferences.getAutoGainControl());
		// Load keep screen on from preferences
		this.keepScreenOn.set(this.preferences.getKeepScreenOn());
		// Watch connection state: on failure, fail the session
		effect(() => {
			const state = this.webrtc.connectionState();
			if (state === 'failed' || state === 'closed') {
				this.errorMessage.set('Connexion perdue. Relancez l\u2019appairage.');
				this.phase.set('failed');
				this.teardown();
			}
		});
		// Expose peer for status widget
		effect(() => {
			// This effect ensures the status widget updates when peer changes
			const _ = this.webrtc.getPeerConnection();
		});
		// Manage wake lock based on keep screen on preference
		effect(() => {
			if (this.keepScreenOn()) {
				void this.wakeLock.acquire();
			} else if (this.phase() !== 'connected') {
				// Only release wake lock if not in connected phase (connected phase has its own wake lock)
				this.wakeLock.release();
			}
		});
		// Listen for mic settings updates from receiver via data channel
		effect(() => {
			const msg = this.webrtc.lastDataChannelMessage();
			if (msg?.type === 'micSettings' && msg.payload) {
				const payload = msg.payload as { noiseCancellation: boolean; echoCancellation: boolean; autoGainControl: boolean };
				this.noiseCancellation.set(payload.noiseCancellation);
				this.echoCancellation.set(payload.echoCancellation);
				this.autoGainControl.set(payload.autoGainControl);
				this.preferences.setNoiseCancellation(payload.noiseCancellation);
				this.preferences.setEchoCancellation(payload.echoCancellation);
				this.preferences.setAutoGainControl(payload.autoGainControl);
				void this.mic.applyConstraints(payload.noiseCancellation, payload.echoCancellation, payload.autoGainControl);
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
			const stream = await this.mic.acquire(this.noiseCancellation(), this.echoCancellation(), this.autoGainControl());
			this.localStream.set(stream);

			await this.webrtc.createPeerConnection();
			const peer = this.webrtc.getPeerConnection();
			if (!peer) throw new Error('Impossible de créer la connexion peer.');

			this.webrtc.createDataChannel('status');

			stream.getTracks().forEach((track) => {
				this.webrtc.addTrack(track, stream);
			});

			const offer = await this.webrtc.createOffer();

			this.audioKeepalive.start();

			const payload = await encodeSdp(offer);
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
		// Enable/disable audio track without stopping the stream or connection
		stream.getAudioTracks().forEach((track) => {
			track.enabled = !newMutedState;
		});
	}

	protected startAnswerScan(): void {
		this.phase.set('scanning-answer');
	}

	protected openSettings(): void {
		void this.router.navigate(['/emitter/settings']);
	}

	protected async onAnswerScanned(payload: string): Promise<void> {
		const peer = this.webrtc.getPeerConnection();
		if (!peer) return;
		try {
			this.phase.set('connecting');
			const answer = await decodeSdp(payload);
			await this.webrtc.setRemoteDescription(answer);
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
		const check = (): void => {
			const state = peer.connectionState;
			if (state === 'connected' && this.phase() !== 'connected') {
				this.phase.set('connected');
				void this.wakeLock.acquire();
				this.startBatteryReporting();
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
		const peer = this.webrtc.getPeerConnection();
		peer?.getSenders().forEach((s) => s.track?.stop());
		this.webrtc.close();
		this.mic.release();
		this.wakeLock.release();
		this.audioKeepalive.stop();
		this.localStream.set(null);
		if (this.quickReconnectTimeout) {
			clearTimeout(this.quickReconnectTimeout);
			this.quickReconnectTimeout = null;
		}
		if (this.batteryRef) {
			this.batteryRef.removeEventListener('chargingchange', this.sendBatteryPayload);
			this.batteryRef.removeEventListener('levelchange', this.sendBatteryPayload);
			this.batteryRef = null;
		}
		if (this.batteryInterval) {
			clearInterval(this.batteryInterval);
			this.batteryInterval = null;
		}
	}

	private batteryRef: any = null;

	private async startBatteryReporting(): Promise<void> {
		if (this.batteryInterval) return;
		if (!('getBattery' in navigator)) return;

		try {
			this.batteryRef = await (navigator as any).getBattery();
			this.sendBatteryPayload();

			// Immediate updates on state changes
			this.batteryRef.addEventListener('chargingchange', this.sendBatteryPayload);
			this.batteryRef.addEventListener('levelchange', this.sendBatteryPayload);

			// Fallback heartbeat every 30s
			this.batteryInterval = setInterval(() => {
				this.sendBatteryPayload();
			}, 30000);
		} catch {
			// Battery API unavailable or denied
		}
	}

	private readonly sendBatteryPayload = (): void => {
		if (!this.batteryRef) return;
		this.webrtc.sendDataChannelMessage({
			type: 'battery',
			payload: { level: this.batteryRef.level, charging: this.batteryRef.charging },
		});
	};

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
			await this.webrtc.createPeerConnection();

			// Restore local description (our offer)
			await this.webrtc.setRemoteDescription(cached.emitterSdp);

			// Watch for connection or failure
			const peer = this.webrtc.getPeerConnection();
			if (peer) {
				this.watchForConnected(peer);
			}
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
