import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  input,
} from '@angular/core';
import {
  ModalController,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
  IonIcon,
  IonButtons,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, shareOutline, copyOutline } from 'ionicons/icons';
import { drawQrToCanvas } from '../../../core/signaling/qr-draw';

/**
 * Modal component for sharing the app via QR code or native share.
 */
@Component({
  selector: 'app-share-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonIcon, IonButtons],
  templateUrl: './share-modal.component.html',
  styleUrl: './share-modal.component.scss',
})
export class ShareModalComponent implements AfterViewInit {
  /** The URL to share (defaults to current app URL). */
  readonly shareUrl = input<string>(window.location.href.split('#')[0] ?? window.location.href);

  /** Whether native share is available. */
  protected readonly canShare = 'share' in navigator;

  @ViewChild('qrCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly modalCtrl = inject(ModalController);

  constructor() {
    addIcons({ closeOutline, shareOutline, copyOutline });
  }

  ngAfterViewInit(): void {
    this.drawQr();
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async share(): Promise<void> {
    const url = this.shareUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Babyphone',
          text: 'Utilisez cette application pour créer un babyphone via Wi-Fi entre deux appareils.',
          url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        alert('Lien copié dans le presse-papiers !');
      } catch {
        // Clipboard failed
      }
    }
  }

  async copy(): Promise<void> {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(this.shareUrl());
        alert('Lien copié dans le presse-papiers !');
      } catch {
        // Clipboard failed
      }
    }
  }

  private drawQr(): void {
    const canvas = this.canvasRef.nativeElement;
    const url = this.shareUrl();
    drawQrToCanvas(canvas, url, 280);
  }
}
