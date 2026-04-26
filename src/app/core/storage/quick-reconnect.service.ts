import { Injectable } from '@angular/core';
import { CachedPairing } from '../models';

const STORAGE_KEY = 'babyphoneLastConnection';

/**
 * Persists and retrieves cached SDP pairings to enable quick reconnect
 * on next launch without requiring a fresh QR handshake.
 *
 * The cached data is used optimistically — if the ICE candidates are still
 * valid (same network), the connection resumes immediately; otherwise,
 * the app falls back to the full QR flow.
 */
@Injectable({ providedIn: 'root' })
export class QuickReconnectService {
  /**
   * Save the successful pairing to localStorage.
   * Call this when the connection reaches 'connected' state.
   */
  save(pairing: CachedPairing): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
    } catch {
      // Ignore storage errors (e.g., quota exceeded).
    }
  }

  /**
   * Load the cached pairing from localStorage.
   * Returns null if nothing stored or JSON is invalid.
   */
  load(): CachedPairing | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data) as CachedPairing;
      // Basic validation
      if (!parsed.timestamp || !parsed.emitterSdp || !parsed.receiverSdp) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Clear the cached pairing from localStorage.
   * Call this when the quick reconnect fails or user chooses fresh pairing.
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }
}
