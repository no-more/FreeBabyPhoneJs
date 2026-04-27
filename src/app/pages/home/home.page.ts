import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
import { headsetOutline, micOutline, shareOutline } from 'ionicons/icons';

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
    ShareModalComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);
  private readonly modalCtrl = inject(ModalController);

  constructor() {
    addIcons({ micOutline, headsetOutline, shareOutline });
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
}
