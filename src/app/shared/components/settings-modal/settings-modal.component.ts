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
      <ion-radio-group [value]="sensitivity()" (ionChange)="onSensitivityChange($event)">
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

	onSensitivityChange(event: CustomEvent): void {
		const newSensitivity = event.detail.value as VuMeterSensitivity;
		this.preferencesService.setVuMeterSensitivity(this.role(), newSensitivity);
	}

	close(): void {
		this.modalCtrl.dismiss();
	}
}
