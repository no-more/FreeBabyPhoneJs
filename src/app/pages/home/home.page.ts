import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { headsetOutline, micOutline } from 'ionicons/icons';

import { PreferencesService } from '../../core/storage/preferences.service';
import type { Role } from '../../core/models';

@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonContent, IonHeader, IonIcon, IonTitle, IonToolbar],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);

  constructor() {
    addIcons({ micOutline, headsetOutline });
  }

  select(role: Role): void {
    this.prefs.setRole(role);
    void this.router.navigate([role === 'emitter' ? '/emitter' : '/receiver']);
  }
}
