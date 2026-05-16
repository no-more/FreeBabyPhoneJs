import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { timeOutline, wifiOutline, cellularOutline } from 'ionicons/icons';

@Component({
	selector: 'app-session-info',
	templateUrl: './session-info.component.html',
	styleUrls: ['./session-info.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [IonIcon],
})
export class SessionInfoComponent {
	peer = input<RTCPeerConnection | null>(null);
	remoteStream = input<MediaStream | null>(null);
	connectionStartTime = input<number | null>(null);

	protected readonly sessionDuration = signal<string>('00:00');
	protected readonly connectionQuality = signal<'excellent' | 'good' | 'fair' | 'poor' | 'unknown'>('unknown');
	protected readonly bitrate = signal<string>('--');
	protected readonly packetLoss = signal<number>(0);

	private lastBytesReceived = 0;
	private lastTimestamp = 0;

	constructor() {
		addIcons({ timeOutline, wifiOutline, cellularOutline });

		// Update duration every second while a start time is set
		effect((onCleanup) => {
			const start = this.connectionStartTime();
			if (!start) {
				this.sessionDuration.set('00:00');
				return;
			}
			const tick = (): void => {
				const elapsed = Math.floor((Date.now() - start) / 1000);
				const mins = Math.floor(elapsed / 60);
				const secs = elapsed % 60;
				this.sessionDuration.set(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
			};
			tick();
			const id = window.setInterval(tick, 1000);
			onCleanup(() => window.clearInterval(id));
		});

		// Poll stats every 2 seconds while a peer exists
		effect((onCleanup) => {
			const peer = this.peer();
			if (!peer) return;
			this.updateStats(peer);
			const id = window.setInterval(() => this.updateStats(peer), 2000);
			onCleanup(() => window.clearInterval(id));
		});
	}

	private updateStats(peer: RTCPeerConnection): void {
		peer.getStats().then((stats) => {
			let bytesReceived = 0;
			let packetsLost = 0;
			let packetsReceived = 0;
			let timestamp = 0;

			stats.forEach((report) => {
				if (report.type === 'inbound-rtp' && report.kind === 'audio') {
					bytesReceived = report.bytesReceived ?? 0;
					packetsLost = report.packetsLost ?? 0;
					packetsReceived = report.packetsReceived ?? 0;
					timestamp = report.timestamp ?? 0;
				}
			});

			const lossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
			this.packetLoss.set(lossRate * 100);

			if (lossRate > 0.1) {
				this.connectionQuality.set('poor');
			} else if (lossRate > 0.05) {
				this.connectionQuality.set('fair');
			} else if (lossRate > 0.02) {
				this.connectionQuality.set('good');
			} else if (lossRate <= 0.02 && packetsReceived > 0) {
				this.connectionQuality.set('excellent');
			}

			// Bitrate in KB/s using delta between polls
			let rate = '--';
			if (this.lastTimestamp && timestamp > this.lastTimestamp && bytesReceived > this.lastBytesReceived) {
				const deltaBytes = bytesReceived - this.lastBytesReceived;
				const deltaMs = timestamp - this.lastTimestamp;
				const kbps = (deltaBytes * 8) / (deltaMs / 1000) / 1024;
				rate = `${kbps.toFixed(1)} KB/s`;
			}
			this.bitrate.set(rate);
			this.lastBytesReceived = bytesReceived;
			this.lastTimestamp = timestamp;
		});
	}

	protected getQualityLabel(quality: string): string {
		const labels: Record<string, string> = {
			excellent: 'Excellente',
			good: 'Bonne',
			fair: 'Moyenne',
			poor: 'Faible',
			unknown: 'Inconnue',
		};
		return labels[quality] || quality;
	}
}
