import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	EventEmitter,
	Output,
	effect,
	inject,
	input,
	signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { batteryChargingOutline, batteryDeadOutline, batteryFullOutline, batteryHalfOutline, pulseOutline } from 'ionicons/icons';

export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

interface StatusState {
	connectionState: string;
	iceState: string;
	signalingState: string;
	localTracks: number;
	remoteTracks: number;
	bytesReceived: number;
	bytesSent: number;
	packetsLost: number;
	rtt: number | null;
	quality: ConnectionQuality;
	lastUpdated: string;
}

@Component({
	selector: 'app-connection-status',
	templateUrl: './connection-status.component.html',
	styleUrl: './connection-status.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [IonIcon],
})
export class ConnectionStatusComponent {
	private readonly destroyRef = inject(DestroyRef);

	peer = input<RTCPeerConnection | null>(null);
	role = input<'emitter' | 'receiver'>('emitter');
	localStream = input<MediaStream | null>(null);
	remoteStream = input<MediaStream | null>(null);
	isMuted = input<boolean>(false);
	reconnectStatus = input<string | null>(null);
	batteryLevel = input<{ level: number; charging: boolean } | null>(null);
	networkInfo = input<{ effectiveType: string; downlink: number | null; rtt: number | null } | null>(null);

	@Output() qualityChange = new EventEmitter<ConnectionQuality>();

	protected readonly status = signal<StatusState>({
		connectionState: 'new',
		iceState: 'new',
		signalingState: 'stable',
		localTracks: 0,
		remoteTracks: 0,
		bytesReceived: 0,
		bytesSent: 0,
		packetsLost: 0,
		rtt: null,
		quality: 'unknown',
		lastUpdated: '--:--:--',
	});

	private statsHistory: { timestamp: number; bytesReceived: number; bytesSent: number }[] = [];

	constructor() {
		addIcons({ batteryChargingOutline, batteryDeadOutline, batteryFullOutline, batteryHalfOutline, pulseOutline });
		// Update stats every 2 seconds
		effect(() => {
			const peer = this.peer();
			if (!peer) return;

			this.updateStatus(peer);
			this.setupEventListeners(peer);

			const subscription = interval(2000)
				.pipe(takeUntilDestroyed(this.destroyRef))
				.subscribe(() => this.updateStats(peer));

			return () => subscription.unsubscribe();
		});
	}

	private setupEventListeners(peer: RTCPeerConnection): void {
		const update = () => this.updateStatus(peer);
		peer.addEventListener('connectionstatechange', update);
		peer.addEventListener('iceconnectionstatechange', update);
		peer.addEventListener('signalingstatechange', update);
	}

	private updateStatus(peer: RTCPeerConnection): void {
		const now = new Date();
		const timeStr = now.toLocaleTimeString('fr-FR', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});

		const localStream = this.localStream();
		const remoteStream = this.remoteStream();

		this.status.update((s) => ({
			...s,
			connectionState: peer.connectionState,
			iceState: peer.iceConnectionState,
			signalingState: peer.signalingState,
			localTracks: localStream?.getTracks().length ?? 0,
			remoteTracks: remoteStream?.getTracks().length ?? 0,
			lastUpdated: timeStr,
		}));
	}

	private async updateStats(peer: RTCPeerConnection): Promise<void> {
		// Skip when backgrounded — saves battery on emitter where nobody is looking.
		if (typeof document !== 'undefined' && document.hidden) return;

		try {
			const stats = await peer.getStats();
			let bytesReceived = 0;
			let bytesSent = 0;
			let packetsLost = 0;
			let packetsReceived = 0;
			let rtt: number | null = null;

			stats.forEach((report) => {
				if (report.type === 'inbound-rtp' && report.kind === 'audio') {
					bytesReceived = report.bytesReceived ?? 0;
					packetsLost = report.packetsLost ?? 0;
					packetsReceived = report.packetsReceived ?? 0;
				}
				if (report.type === 'outbound-rtp' && report.kind === 'audio') {
					bytesSent = report.bytesSent ?? 0;
				}
				if (report.type === 'candidate-pair' && report.state === 'succeeded') {
					rtt = report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : null;
				}
			});

			// Calculate quality based on packet loss and RTT
			const quality = this.calculateQuality(packetsLost, packetsReceived, rtt);

			// Store for rate calculation
			const now = Date.now();
			this.statsHistory.push({ timestamp: now, bytesReceived, bytesSent });
			if (this.statsHistory.length > 10) this.statsHistory.shift();

			if (quality !== this.status().quality) {
				this.qualityChange.emit(quality);
			}

			this.status.update((s) => ({
				...s,
				bytesReceived,
				bytesSent,
				packetsLost,
				rtt,
				quality,
			}));
		} catch {
			// Stats not available yet
		}
	}

	private calculateQuality(
		packetsLost: number,
		packetsReceived: number,
		rtt: number | null,
	): ConnectionQuality {
		if (packetsReceived === 0) return 'unknown';

		const lossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;

		if (lossRate > 0.1 || (rtt && rtt > 300)) return 'poor';
		if (lossRate > 0.05 || (rtt && rtt > 150)) return 'fair';
		if (lossRate > 0.02 || (rtt && rtt > 100)) return 'good';
		return 'excellent';
	}

	// Human-readable labels in French
	protected getConnectionStateLabel(state: string): string {
		const labels: Record<string, string> = {
			new: 'Nouveau',
			connecting: 'Connexion...',
			connected: 'Connecté',
			disconnected: 'Déconnecté',
			failed: 'Échec',
			closed: 'Fermé',
		};
		return labels[state] || state;
	}

	protected getIceStateLabel(state: string): string {
		const labels: Record<string, string> = {
			new: 'Nouveau',
			checking: 'Vérification...',
			connected: 'Connecté',
			completed: 'Complété',
			disconnected: 'Déconnecté',
			failed: 'Échec',
			closed: 'Fermé',
		};
		return labels[state] || state;
	}

	protected getSignalingStateLabel(state: string): string {
		const labels: Record<string, string> = {
			stable: 'Stable',
			'have-local-offer': 'Offre envoyée',
			'have-remote-offer': 'Offre reçue',
			'have-local-pranswer': 'Réponse provisoire',
			'have-remote-pranswer': 'Réponse provisoire reçue',
			closed: 'Fermé',
		};
		return labels[state] || state;
	}

	protected getQualityLabel(quality: ConnectionQuality): string {
		const labels: Record<ConnectionQuality, string> = {
			excellent: 'Excellente',
			good: 'Bonne',
			fair: 'Moyenne',
			poor: 'Faible',
			unknown: 'Inconnue',
		};
		return labels[quality];
	}

	protected getQualityColor(quality: ConnectionQuality): string {
		const colors: Record<ConnectionQuality, string> = {
			excellent: 'success',
			good: 'success',
			fair: 'warning',
			poor: 'danger',
			unknown: 'medium',
		};
		return colors[quality];
	}

	protected formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	protected formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	protected getBatteryIcon(battery: { level: number; charging: boolean } | null): string {
		if (!battery) return 'battery-dead-outline';
		if (battery.charging) return 'battery-charging-outline';
		if (battery.level > 0.5) return 'battery-full-outline';
		if (battery.level > 0.2) return 'battery-half-outline';
		return 'battery-dead-outline';
	}

	protected getBatteryColor(battery: { level: number; charging: boolean } | null): string {
		if (!battery) return 'medium';
		if (battery.charging) return 'success';
		if (battery.level <= 0.2) return 'danger';
		if (battery.level <= 0.5) return 'warning';
		return 'success';
	}

	protected formatBatteryPercent(battery: { level: number; charging: boolean } | null): string {
		if (!battery) return '--';
		return `${Math.round(battery.level * 100)} %`;
	}

	protected getBatteryStatusText(battery: { level: number; charging: boolean } | null): string {
		if (!battery) return '';
		return battery.charging ? 'En charge' : 'Sur batterie';
	}
}

