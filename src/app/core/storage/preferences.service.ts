import { Injectable } from '@angular/core';
import type { Role } from '../models';

/** Keys used in localStorage. Prefixed to avoid clashing with other apps on the same origin. */
const LS = {
  ROLE: 'babyphone.role',
  DEVICE_NAME: 'babyphone.deviceName',
} as const;

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  getRole(): Role | null {
    const raw = this.read(LS.ROLE);
    return raw === 'emitter' || raw === 'receiver' ? raw : null;
  }

  setRole(role: Role): void {
    this.write(LS.ROLE, role);
  }

  clearRole(): void {
    this.remove(LS.ROLE);
  }

  getDeviceName(): string | null {
    return this.read(LS.DEVICE_NAME);
  }

  setDeviceName(name: string): void {
    this.write(LS.DEVICE_NAME, name);
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota / private mode errors */
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
