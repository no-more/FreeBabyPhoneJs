import { Component, inject } from '@angular/core';
import {
	IonBackButton,
	IonButton,
	IonButtons,
	IonContent,
	IonHeader,
	IonIcon,
	IonItem,
	IonLabel,
	IonListHeader,
	IonNote,
	IonRadio,
	IonRadioGroup,
	IonTitle,
	IonToggle,
	IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { PreferencesService } from '../../core/storage/preferences.service';
import type { VuMeterSensitivity } from '../../core/models';

@Component({
	selector: 'app-emitter-settings',
	standalone: true,
	imports: [
		IonBackButton,
		IonButtons,
		IonContent,
		IonHeader,
		IonItem,
		IonLabel,
		IonListHeader,
		IonNote,
		IonRadio,
		IonRadioGroup,
		IonTitle,
		IonToggle,
		IonToolbar,
	],
	template: `
		<ion-header>
			<ion-toolbar>
				<ion-buttons slot="start">
					<ion-back-button defaultHref="/emitter"></ion-back-button>
				</ion-buttons>
				<ion-title>Paramètres</ion-title>
			</ion-toolbar>
		</ion-header>

		<ion-content class="ion-padding">
			<ion-list-header>
				<ion-label>VU-mètre</ion-label>
			</ion-list-header>
			<ion-radio-group [value]="vuSensitivity" (ionChange)="onSensitivityChange($event)">
				<ion-item>
					<ion-label>Faible</ion-label>
					<ion-radio value="low"></ion-radio>
				</ion-item>
				<ion-item>
					<ion-label>Moyen</ion-label>
					<ion-radio value="medium"></ion-radio>
				</ion-item>
				<ion-item>
					<ion-label>Élevé</ion-label>
					<ion-radio value="high"></ion-radio>
				</ion-item>
			</ion-radio-group>

			<ion-note class="settings-note">
				Ajustez la sensibilité du VU-mètre selon votre environnement sonore.
			</ion-note>

			<ion-list-header class="settings-section-header">
				<ion-label>Micro</ion-label>
			</ion-list-header>
			<ion-item>
				<ion-label>Suppression de bruit</ion-label>
				<ion-toggle [checked]="noiseCancellation" (ionChange)="onNoiseCancellationChange($event)"></ion-toggle>
			</ion-item>
			<ion-item>
				<ion-label>Annulation d'écho</ion-label>
				<ion-toggle [checked]="echoCancellation" (ionChange)="onEchoCancellationChange($event)"></ion-toggle>
			</ion-item>
			<ion-item>
				<ion-label>Contrôle automatique du gain</ion-label>
				<ion-toggle [checked]="autoGainControl" (ionChange)="onAutoGainControlChange($event)"></ion-toggle>
			</ion-item>
			<ion-note class="settings-note">
				Ajuste automatiquement le volume pour des sons plus audibles.
			</ion-note>

			<ion-list-header class="settings-section-header">
				<ion-label>Écran</ion-label>
			</ion-list-header>
			<ion-item>
				<ion-label>Garder l'écran allumé</ion-label>
				<ion-toggle [checked]="keepScreenOn" (ionChange)="onKeepScreenOnChange($event)"></ion-toggle>
			</ion-item>
			<ion-note class="settings-note">
				Empêche l'écran de s'éteindre automatiquement.
			</ion-note>
		</ion-content>
	`,
	styles: `
		.settings-note {
			display: block;
			margin-top: 16px;
			color: var(--ion-color-medium);
		}
	`,
})
export class EmitterSettingsPage {
	private readonly preferences = inject(PreferencesService);

	vuSensitivity: VuMeterSensitivity = 'medium';
	noiseCancellation = false;
	echoCancellation = false;
	autoGainControl = false;
	keepScreenOn = false;

	constructor() {
		addIcons({ closeOutline });
		this.vuSensitivity = this.preferences.getVuMeterSensitivity('emitter');
		this.noiseCancellation = this.preferences.getNoiseCancellation();
		this.echoCancellation = this.preferences.getEchoCancellation();
		this.autoGainControl = this.preferences.getAutoGainControl();
		this.keepScreenOn = this.preferences.getKeepScreenOn();
	}

	onSensitivityChange(event: CustomEvent): void {
		const newSensitivity = event.detail.value as VuMeterSensitivity;
		this.vuSensitivity = newSensitivity;
		this.preferences.setVuMeterSensitivity('emitter', newSensitivity);
	}

	onNoiseCancellationChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.noiseCancellation = enabled;
		this.preferences.setNoiseCancellation(enabled);
	}

	onEchoCancellationChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.echoCancellation = enabled;
		this.preferences.setEchoCancellation(enabled);
	}

	onAutoGainControlChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.autoGainControl = enabled;
		this.preferences.setAutoGainControl(enabled);
	}

	onKeepScreenOnChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.keepScreenOn = enabled;
		this.preferences.setKeepScreenOn(enabled);
	}
}
