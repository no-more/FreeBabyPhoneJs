import { ChangeDetectionStrategy, Component, inject, signal, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import {
	ModalController,
	IonContent,
	IonHeader,
	IonIcon,
	IonTitle,
	IonToolbar,
	IonButton,
	IonButtons,
	IonAlert,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { downloadOutline, headsetOutline, micOutline, refreshOutline, shareOutline } from 'ionicons/icons';

import { environment } from '../../../environments/environment';
import { PreferencesService } from '../../core/storage/preferences.service';
import type { Role } from '../../core/models';
import { ShareModalComponent } from '../../shared/components/share-modal/share-modal.component';

@Component({
	selector: 'app-home-page',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [
		IonContent,
		IonHeader,
		IonIcon,
		IonTitle,
		IonToolbar,
		IonButton,
		IonButtons,
	],
	templateUrl: './home.page.html',
	styleUrl: './home.page.scss',
})
export class HomePage {
	private readonly router = inject(Router);
	private readonly prefs = inject(PreferencesService);
	private readonly modalCtrl = inject(ModalController);
	private readonly swUpdate = inject(SwUpdate, { optional: true });

	protected readonly canInstall = signal(false);
	private deferredPrompt: Event | null = null;

	constructor() {
		addIcons({ micOutline, headsetOutline, shareOutline, downloadOutline, refreshOutline });
		this.setupInstallPrompt();
		this.setupServiceWorkerUpdate();
	}

	private setupInstallPrompt(): void {
		window.addEventListener('beforeinstallprompt', (e: Event) => {
			e.preventDefault();
			this.deferredPrompt = e;
			this.canInstall.set(true);
		});

		window.addEventListener('appinstalled', () => {
			this.deferredPrompt = null;
			this.canInstall.set(false);
		});
	}

	async installPwa(): Promise<void> {
		if (!this.deferredPrompt) return;
		(this.deferredPrompt as any).prompt();
		const { outcome } = await (this.deferredPrompt as any).userChoice;
		this.deferredPrompt = null;
		this.canInstall.set(false);
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
	}

	private async showUpdateAlert(): Promise<void> {
		const alert = await this.modalCtrl.create({
			component: IonAlert,
			componentProps: {
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
			},
		});
		await alert.present();
	}

	async openShareModal(): Promise<void> {
		const modal = await this.modalCtrl.create({
			component: ShareModalComponent,
		});
		await modal.present();
	}

	select(role: Role): void {
		this.prefs.setRole(role);
		void this.router.navigate([role === 'emitter' ? '/emitter' : '/receiver']);
	}

	/** Reference to navigator for template access. */
	protected readonly navigator = navigator;

	/** Version info from environment (commit hash and deploy date). */
	protected readonly versionInfo = () => {
		const { commitHash, deployDate } = environment;
		if (!commitHash || !deployDate) return null;
		return { commitHash, deployDate };
	};
}
