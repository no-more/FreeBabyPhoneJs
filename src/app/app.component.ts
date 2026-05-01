import { Component, inject, Optional, OnDestroy } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate } from '@angular/service-worker';
import { AlertController } from '@ionic/angular/standalone';

@Component({
	selector: 'app-root',
	templateUrl: 'app.component.html',
	imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnDestroy {
	private readonly alertCtrl = inject(AlertController);
	private readonly swUpdate = inject(SwUpdate, { optional: true });
	private updateCheckInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		this.setupServiceWorkerUpdate();
	}

	private setupServiceWorkerUpdate(): void {
		if (!this.swUpdate?.isEnabled) return;

		this.swUpdate.versionUpdates.subscribe(async (event) => {
			if (event.type === 'VERSION_DETECTED') {
				console.log('New version detected');
			} else if (event.type === 'VERSION_READY') {
				console.log('New version ready');
				void this.showUpdateAlert();
			} else if (event.type === 'VERSION_INSTALLATION_FAILED') {
				console.error('Version installation failed');
			}
		});

		// Check for updates when the app becomes visible again
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				void this.swUpdate?.checkForUpdate();
			}
		});

		// Periodic check every 2 minutes (120000ms) for new versions
		this.updateCheckInterval = setInterval(() => {
			void this.swUpdate?.checkForUpdate();
		}, 120000);
	}

	private async showUpdateAlert(): Promise<void> {
		const alert = await this.alertCtrl.create({
			header: 'Nouvelle version disponible',
			message: 'Une nouvelle version de l\'application est disponible. Voulez-vous mettre à jour maintenant ?',
			buttons: [
				{
					text: 'Plus tard',
					role: 'cancel',
				},
				{
					text: 'Mettre à jour',
					handler: async () => {
						try {
							await this.swUpdate?.activateUpdate();
							window.location.reload();
						} catch (err) {
							console.error('Failed to activate update:', err);
						}
					},
				},
			],
		});
		await alert.present();
	}

	ngOnDestroy(): void {
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
			this.updateCheckInterval = null;
		}
	}
}
