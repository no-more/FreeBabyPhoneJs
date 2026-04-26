import { Injectable, OnDestroy, signal } from '@angular/core';

export type ReconnectStatus =
  | 'stable' // Connection is healthy
  | 'reconnecting' // Attempting to recover
  | 'gave-up'; // Max attempts reached, manual re-pair required

/**
 * Monitors an RTCPeerConnection and attempts auto-recovery on failures.
 * Without a signaling server we cannot truly renegotiate, but on a stable LAN
 * a tear-down + quick-reconnect with cached SDPs often succeeds.
 *
 * Status is exposed as a signal so pages can react (show spinners, toasts, etc).
 */
@Injectable({ providedIn: 'root' })
export class ReconnectService implements OnDestroy {
  /** Exposed status for UI consumption. */
  readonly status = signal<ReconnectStatus>('stable');

  private readonly maxAttempts = 5;
  private attempts = 0;
  private pc: RTCPeerConnection | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onStateChange = (): void => this.handleStateChange();

  ngOnDestroy(): void {
    this.detach();
  }

  /**
   * Attach to a peer connection and start monitoring.
   * Detaches from any previous connection first.
   */
  attach(peer: RTCPeerConnection): void {
    this.detach();
    this.pc = peer;
    this.attempts = 0;
    this.status.set('stable');
    peer.addEventListener('connectionstatechange', this.onStateChange);
    this.handleStateChange(); // Check initial state
  }

  /**
   * Detach from the current peer connection and clear timers.
   */
  detach(): void {
    this.clearTimers();
    if (this.pc) {
      this.pc.removeEventListener('connectionstatechange', this.onStateChange);
      this.pc = null;
    }
    this.attempts = 0;
    this.status.set('stable');
  }

  /**
   * Reset the attempt counter (e.g., after a successful manual reconnect).
   */
  resetAttempts(): void {
    this.attempts = 0;
    this.status.set('stable');
  }

  private handleStateChange(): void {
    const peer = this.pc;
    if (!peer) return;

    const state = peer.connectionState;
    if (state === 'connected') {
      // Success — reset everything
      this.clearTimers();
      this.attempts = 0;
      this.status.set('stable');
    } else if (state === 'failed') {
      this.status.set('reconnecting');
      this.attemptAutoRecover('failed');
    } else if (state === 'disconnected') {
      this.status.set('reconnecting');
      // Wait a bit before triggering recovery — may self-resolve
      if (!this.disconnectTimer) {
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (this.pc && ['disconnected', 'failed'].includes(this.pc.connectionState)) {
            this.attemptAutoRecover('disconnected-timeout');
          }
        }, 8000);
      }
    }
  }

  private attemptAutoRecover(reason: string): void {
    if (this.attempts >= this.maxAttempts) {
      this.status.set('gave-up');
      return;
    }
    this.attempts++;
    console.log(`[Reconnect] attempt #${this.attempts} (${reason})`);

    // Step 1: Try ICE restart first (cheap, may work for NAT rebinding)
    if (
      this.pc &&
      this.pc.signalingState !== 'closed' &&
      typeof this.pc.restartIce === 'function'
    ) {
      try {
        this.pc.restartIce();
        console.log('[Reconnect] ICE restart issued');
      } catch (e) {
        console.warn('[Reconnect] restartIce failed:', e);
      }
    }

    // Step 2: After grace period, if still not connected, trigger full recovery
    // Linear backoff: 1s, 2s, 3s... based on attempt count
    const backoffMs = this.attempts * 1000;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.pc?.connectionState === 'connected') {
        // Recovered via ICE restart
        this.attempts = 0;
        this.status.set('stable');
        return;
      }
      // Signal that we need a full re-handshake
      // Pages should listen to status 'gave-up' or 'reconnecting' and act accordingly
      // After max attempts, we give up
      if (this.attempts >= this.maxAttempts) {
        this.status.set('gave-up');
      }
    }, 4000 + backoffMs);
  }

  private clearTimers(): void {
    this.clearDisconnectTimer();
    this.clearReconnectTimer();
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
