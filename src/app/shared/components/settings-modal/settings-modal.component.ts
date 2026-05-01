import { Component, inject, input } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import type { Role, VuMeterSensitivity } from '../../../core/models';
import { PreferencesService } from '../../../core/storage/preferences.service';

@Component({
	selector: 'app-settings-modal',
	standalone: true,
	imports: [IonicModule],
	template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button (click)="close()"></ion-back-button>
        </ion-buttons>
        <ion-title>Paramètres</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-list-header>
        <ion-label>VU-mètre</ion-label>
      </ion-list-header>
      <ion-radio-group [value]="sensitivity" (ionChange)="onSensitivityChange($event)">
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

      @if (role() === 'emitter') {
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
      }
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
export class SettingsModalComponent {
	private readonly modalCtrl = inject(ModalController);
	private readonly preferencesService = inject(PreferencesService);

	role = input.required<Role>();
	sensitivity = input.required<VuMeterSensitivity>();
	noiseCancellation = input(false);
	echoCancellation = input(false);
	autoGainControl = input(false);
	keepScreenOn = input(false);

	onSensitivityChange(event: CustomEvent): void {
		const newSensitivity = event.detail.value as VuMeterSensitivity;
		this.preferencesService.setVuMeterSensitivity(this.role(), newSensitivity);
	}

	onNoiseCancellationChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.preferencesService.setNoiseCancellation(enabled);
	}

	onEchoCancellationChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.preferencesService.setEchoCancellation(enabled);
	}

	onAutoGainControlChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.preferencesService.setAutoGainControl(enabled);
	}

	onKeepScreenOnChange(event: CustomEvent): void {
		const enabled = event.detail.checked;
		this.preferencesService.setKeepScreenOn(enabled);
	}

	close(): void {
		this.modalCtrl.dismiss();
	}
}
