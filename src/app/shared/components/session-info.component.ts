import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
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

	protected readonly sessionDuration = computed(() => {
		const start = this.connectionStartTime();
		if (!start) return '00:00';
		const elapsed = Math.floor((Date.now() - start) / 1000);
		const mins = Math.floor(elapsed / 60);
		const secs = elapsed % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	});

	protected readonly connectionQuality = signal<'excellent' | 'good' | 'fair' | 'poor' | 'unknown'>('unknown');
	protected readonly bitrate = signal<string>('--');
	protected readonly packetLoss = signal<number>(0);

	constructor() {
		addIcons({ timeOutline, wifiOutline, cellularOutline });
	}

	private updateStats(): void {
		const peer = this.peer();
		if (!peer) return;

		peer.getStats().then((stats) => {
			let bytesReceived = 0;
			let packetsLost = 0;
			let packetsReceived = 0;

			stats.forEach((report) => {
				if (report.type === 'inbound-rtp' && report.kind === 'audio') {
					bytesReceived = report.bytesReceived ?? 0;
					packetsLost = report.packetsLost ?? 0;
					packetsReceived = report.packetsReceived ?? 0;
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

			// Simple bitrate calculation (KB/s)
			this.bitrate.set(bytesReceived > 0 ? `${(bytesReceived / 1024).toFixed(1)} KB` : '--');
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
