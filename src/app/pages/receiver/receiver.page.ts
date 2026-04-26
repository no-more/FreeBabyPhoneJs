import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
	IonBackButton,
	IonButtons,
	IonContent,
	IonHeader,
	IonTitle,
	IonToolbar,
} from '@ionic/angular/standalone';

@Component({
	selector: 'app-receiver-page',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar],
	template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/"></ion-back-button>
        </ion-buttons>
        <ion-title>Récepteur</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p>Implémentation du récepteur à venir.</p>
    </ion-content>
  `,
})
export class ReceiverPage { }
