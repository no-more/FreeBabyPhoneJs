import { Injectable, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * Service to keep the screen awake during an active babyphone session.
 * Uses the Screen Wake Lock API when available, with auto re-acquisition
 * on visibility change (browsers release the lock when the tab is backgrounded).
 */
@Injectable({
  providedIn: 'root',
})
export class WakeLockService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private wakeLock: WakeLockSentinel | null = null;
  private isAcquired = false;

  constructor() {
    this.document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
  }

  ngOnDestroy(): void {
    this.release();
    this.document.removeEventListener('visibilitychange', () => this.handleVisibilityChange());
  }

  /**
   * Request a screen wake lock. Safe to call multiple times — only one lock is held.
   * Swallows errors (e.g., unsupported browser, page not visible) silently.
   */
  async acquire(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    this.isAcquired = true;
    await this.requestWakeLock();
  }

  /**
   * Release the wake lock explicitly.
   */
  release(): void {
    this.isAcquired = false;
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      // The request throws if the page is not visible — catch and swallow.
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // Ignore — will retry on next visibility change if needed.
    }
  }

  private handleVisibilityChange(): void {
    if (this.document.visibilityState === 'visible' && this.isAcquired) {
      // Re-acquire the lock when returning to foreground (browser auto-releases it).
      void this.requestWakeLock();
    }
  }
}
