import { Injectable } from '@angular/core';
import type { Role, VuMeterSensitivity } from '../models';

/** Keys used in localStorage. Prefixed to avoid clashing with other apps on the same origin. */
const LS = {
	ROLE: 'babyphone.role',
	DEVICE_NAME: 'babyphone.deviceName',
	VU_SENSITIVITY_EMITTER: 'babyphone.vuSensitivity.emitter',
	VU_SENSITIVITY_RECEIVER: 'babyphone.vuSensitivity.receiver',
	NOISE_CANCELLATION: 'babyphone.noiseCancellation',
	ECHO_CANCELLATION: 'babyphone.echoCancellation',
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

	getVuMeterSensitivity(role: Role): VuMeterSensitivity {
		const key = role === 'emitter' ? LS.VU_SENSITIVITY_EMITTER : LS.VU_SENSITIVITY_RECEIVER;
		const raw = this.read(key);
		return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'medium';
	}

	setVuMeterSensitivity(role: Role, sensitivity: VuMeterSensitivity): void {
		const key = role === 'emitter' ? LS.VU_SENSITIVITY_EMITTER : LS.VU_SENSITIVITY_RECEIVER;
		this.write(key, sensitivity);
	}

	getNoiseCancellation(): boolean {
		const raw = this.read(LS.NOISE_CANCELLATION);
		return raw === 'true';
	}

	setNoiseCancellation(enabled: boolean): void {
		this.write(LS.NOISE_CANCELLATION, String(enabled));
	}

	getEchoCancellation(): boolean {
		const raw = this.read(LS.ECHO_CANCELLATION);
		return raw === 'true';
	}

	setEchoCancellation(enabled: boolean): void {
		this.write(LS.ECHO_CANCELLATION, String(enabled));
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
