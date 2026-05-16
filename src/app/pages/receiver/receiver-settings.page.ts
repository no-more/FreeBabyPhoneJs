import { Component, inject } from '@angular/core';
import {
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
} from '@ionic/angular/standalone';
import { PreferencesService } from '../../core/storage/preferences.service';
import type { VuMeterSensitivity } from '../../core/models';

@Component({
	selector: 'app-receiver-settings',
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
					<ion-back-button defaultHref="/receiver"></ion-back-button>
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
export class ReceiverSettingsPage {
	private readonly preferences = inject(PreferencesService);

	vuSensitivity: VuMeterSensitivity = 'medium';
	keepScreenOn = false;

	constructor() {
		this.vuSensitivity = this.preferences.getVuMeterSensitivity('receiver');
		this.keepScreenOn = this.preferences.getKeepScreenOn();
	}

	onSensitivityChange(event: CustomEvent): void {
		const newSensitivity = event.detail.value as VuMeterSensitivity;
		this.vuSensitivity = newSensitivity;
		this.preferences.setVuMeterSensitivity('receiver', newSensitivity);
	}

	onKeepScreenOnChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.keepScreenOn = enabled;
		this.preferences.setKeepScreenOn(enabled);
	}
}
