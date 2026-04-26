/**
 * Role of the local device in a babyphone pairing.
 * - `emitter` (Émetteur): device placed near the baby, captures microphone and streams audio.
 * - `receiver` (Récepteur): parent's device, plays the remote audio.
 */
export type Role = 'emitter' | 'receiver';

/**
 * High-level session state, used to drive the UI.
 */
export type SessionStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-offer'
  | 'awaiting-answer'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'stopped';

export interface ConnectionQuality {
  rttMs: number | null;
  lossPercent: number | null;
  level: 'good' | 'fair' | 'poor' | 'unknown';
}

/**
 * A cached pairing, persisted to enable quick reconnect on next launch.
 */
export interface CachedPairing {
  timestamp: number;
  emitterSdp: RTCSessionDescriptionInit;
  receiverSdp: RTCSessionDescriptionInit;
}
