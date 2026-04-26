import { Injectable, inject } from '@angular/core';
import { CertificateService } from './certificate.service';

/** STUN-only ICE config. No TURN by design: local-network pairing only. */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** How long to wait for ICE gathering before proceeding with whatever candidates we have. */
const ICE_GATHERING_TIMEOUT_MS = 4000;

@Injectable({ providedIn: 'root' })
export class PeerConnectionService {
  private readonly certs = inject(CertificateService);

  async create(extra?: Partial<RTCConfiguration>): Promise<RTCPeerConnection> {
    const cert = await this.certs.getOrCreate();
    const config: RTCConfiguration = {
      ...DEFAULT_RTC_CONFIG,
      ...extra,
      ...(cert ? { certificates: [cert] } : {}),
    };
    return new RTCPeerConnection(config);
  }

  /**
   * Resolve when `pc.iceGatheringState === 'complete'`, or after a hard timeout.
   * Works around mobile browsers that never fire `complete` when one of the
   * STUN probes hangs.
   */
  waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timeout = window.setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }, ICE_GATHERING_TIMEOUT_MS);
      const check = (): void => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          window.clearTimeout(timeout);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
}
