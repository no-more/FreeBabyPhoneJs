import { Injectable } from '@angular/core';

/**
 * Persists a single WebRTC DTLS certificate in IndexedDB so the local DTLS
 * fingerprint survives page reloads. This is what makes "quick reconnect"
 * possible after days: the cached SDPs stay valid as long as the fingerprint
 * they reference does.
 */
const DB_NAME = 'babyphone-pairing';
const STORE = 'certs';
const KEY = 'main';
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // renew one day before expiry
const VALIDITY_MS = 365 * 24 * 60 * 60 * 1000; // one year

@Injectable({ providedIn: 'root' })
export class CertificateService {
  private cached: RTCCertificate | null = null;

  async getOrCreate(): Promise<RTCCertificate | null> {
    if (this.cached) return this.cached;

    let cert = await this.load();
    if (cert && cert.expires && cert.expires < Date.now() + RENEW_BEFORE_MS) {
      cert = null;
    }

    if (!cert) {
      try {
        cert = await RTCPeerConnection.generateCertificate({
          name: 'ECDSA',
          namedCurve: 'P-256',
          expires: VALIDITY_MS,
        } as unknown as AlgorithmIdentifier);
        await this.save(cert);
      } catch (err) {
        console.warn('Falling back to a per-session DTLS certificate:', err);
        return null;
      }
    }

    this.cached = cert;
    return cert;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    });
  }

  private async load(): Promise<RTCCertificate | null> {
    try {
      const db = await this.openDb();
      return await new Promise<RTCCertificate | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as RTCCertificate | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error('IDB read failed'));
      });
    } catch {
      return null;
    }
  }

  private async save(cert: RTCCertificate): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(cert, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'));
      });
    } catch {
      /* best-effort */
    }
  }
}
