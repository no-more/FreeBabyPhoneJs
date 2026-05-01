import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
	ModalController,
	IonContent,
	IonHeader,
	IonIcon,
	IonTitle,
	IonToolbar,
	IonButton,
	IonButtons,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { downloadOutline, headsetOutline, micOutline, shareOutline } from 'ionicons/icons';

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

	protected readonly canInstall = signal(false);
	private deferredPrompt: Event | null = null;

	constructor() {
		addIcons({ micOutline, headsetOutline, shareOutline, downloadOutline });
		this.setupInstallPrompt();
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
