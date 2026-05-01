import { Injectable, signal } from '@angular/core';

/**
 * Simple WebRTC service that combines peer connection creation,
 * certificate management, and ICE gathering into a single easy-to-use interface.
 * 
 * This service extracts the essential WebRTC functionality that was working
 * on the deploy-test-1 branch, providing a simplified API for establishing
 * peer-to-peer audio connections.
 */
@Injectable({ providedIn: 'root' })
export class WebRTCService {
	/** Current peer connection instance */
	private peer: RTCPeerConnection | null = null;
	
	/** Connection state signal for UI consumption */
	readonly connectionState = signal<RTCPeerConnectionState>('new');
	
	/** ICE gathering state signal for UI consumption */
	readonly iceGatheringState = signal<RTCIceGatheringState>('new');

	/** STUN-only ICE config. No TURN by design: local-network pairing only. */
	private readonly rtcConfig: RTCConfiguration = {
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	};

	/** How long to wait for ICE gathering before proceeding */
	private readonly iceGatheringTimeoutMs = 4000;

	/** Certificate persistence */
	private cert: RTCCertificate | null = null;
	private readonly dbName = 'babyphone-webrtc';
	private readonly storeName = 'certs';
	private readonly certKey = 'main';
	private readonly certValidityMs = 365 * 24 * 60 * 60 * 1000; // one year
	private readonly renewBeforeMs = 24 * 60 * 60 * 1000; // renew one day before expiry

	/**
	 * Create a new peer connection with persistent certificate
	 */
	async createPeerConnection(): Promise<RTCPeerConnection> {
		await this.loadOrCreateCertificate();
		
		const config: RTCConfiguration = {
			...this.rtcConfig,
			...(this.cert ? { certificates: [this.cert] } : {}),
		};

		this.peer = new RTCPeerConnection(config);
		this.attachEventListeners(this.peer);
		
		return this.peer;
	}

	/**
	 * Get the current peer connection instance
	 */
	getPeerConnection(): RTCPeerConnection | null {
		return this.peer;
	}

	/**
	 * Close and cleanup the current peer connection
	 */
	close(): void {
		if (this.peer) {
			this.peer.close();
			this.peer = null;
			this.connectionState.set('new');
			this.iceGatheringState.set('new');
		}
	}

	/**
	 * Create an offer and set it as local description
	 */
	async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
		const pc = this.peer;
		if (!pc) throw new Error('No peer connection');

		const offer = await pc.createOffer(options);
		await pc.setLocalDescription(offer);
		await this.waitForIceGathering(pc);

		const local = pc.localDescription;
		if (!local) throw new Error('No local description');
		
		return local.toJSON();
	}

	/**
	 * Create an answer and set it as local description
	 */
	async createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
		const pc = this.peer;
		if (!pc) throw new Error('No peer connection');

		const answer = await pc.createAnswer(options);
		await pc.setLocalDescription(answer);
		await this.waitForIceGathering(pc);

		const local = pc.localDescription;
		if (!local) throw new Error('No local description');
		
		return local.toJSON();
	}

	/**
	 * Set the remote description
	 */
	async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
		const pc = this.peer;
		if (!pc) throw new Error('No peer connection');

		await pc.setRemoteDescription(new RTCSessionDescription(desc));
	}

	/**
	 * Add a track to the peer connection
	 */
	addTrack(track: MediaStreamTrack, stream: MediaStream): void {
		const pc = this.peer;
		if (!pc) throw new Error('No peer connection');

		pc.addTrack(track, stream);
	}

	/**
	 * Wait for ICE gathering to complete or timeout
	 */
	private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
		return new Promise((resolve) => {
			if (pc.iceGatheringState === 'complete') {
				resolve();
				return;
			}

			const timeout = window.setTimeout(() => {
				pc.removeEventListener('icegatheringstatechange', check);
				resolve();
			}, this.iceGatheringTimeoutMs);

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

	/**
	 * Attach event listeners to track connection state
	 */
	private attachEventListeners(pc: RTCPeerConnection): void {
		pc.addEventListener('connectionstatechange', () => {
			this.connectionState.set(pc.connectionState);
		});

		pc.addEventListener('icegatheringstatechange', () => {
			this.iceGatheringState.set(pc.iceGatheringState);
		});
	}

	/**
	 * Load or create a persistent DTLS certificate
	 */
	private async loadOrCreateCertificate(): Promise<void> {
		if (this.cert) return;

		try {
			let cert = await this.loadCertificate();
			
			if (cert && cert.expires && cert.expires < Date.now() + this.renewBeforeMs) {
				cert = null;
			}

			if (!cert) {
				cert = await RTCPeerConnection.generateCertificate({
					name: 'ECDSA',
					namedCurve: 'P-256',
					expires: this.certValidityMs,
				} as unknown as AlgorithmIdentifier);
				await this.saveCertificate(cert);
			}

			this.cert = cert;
		} catch (err) {
			console.warn('Falling back to per-session certificate:', err);
		}
	}

	/**
	 * Load certificate from IndexedDB
	 */
	private async loadCertificate(): Promise<RTCCertificate | null> {
		try {
			const db = await this.openDb();
			return new Promise<RTCCertificate | null>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readonly');
				const req = tx.objectStore(this.storeName).get(this.certKey);
				req.onsuccess = () => resolve((req.result as RTCCertificate | undefined) ?? null);
				req.onerror = () => reject(req.error ?? new Error('IDB read failed'));
			});
		} catch {
			return null;
		}
	}

	/**
	 * Save certificate to IndexedDB
	 */
	private async saveCertificate(cert: RTCCertificate): Promise<void> {
		try {
			const db = await this.openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readwrite');
				tx.objectStore(this.storeName).put(cert, this.certKey);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'));
			});
		} catch {
			/* best-effort */
		}
	}

	/**
	 * Open IndexedDB
	 */
	private openDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			if (!('indexedDB' in window)) {
				reject(new Error('IndexedDB not available'));
				return;
			}
			const req = indexedDB.open(this.dbName, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
		});
	}
}
