import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate } from '@angular/service-worker';
import { AlertController } from '@ionic/angular/standalone';

@Component({
	selector: 'app-root',
	templateUrl: 'app.component.html',
	imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
	private readonly alertCtrl = inject(AlertController);
	private readonly swUpdate = inject(SwUpdate, { optional: true });

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

		// One-time check at startup
		void this.swUpdate.checkForUpdate();
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

}
