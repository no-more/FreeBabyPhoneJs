let localStream;
let peerConnection;
let isEmetteur = true;
let isStarted = false;
let wakeLock = null;
let silentAudioCtx = null;
let silentAudioEl = null;
let silentAudioUrl = null;
let vuAnimFrame = null;
let heartbeatInterval = null;

// Auto-recovery state (used when the connection drops, e.g. screen-off network change)
let autoReconnectTimer = null;
let autoReconnectAttempts = 0;
const AUTO_RECONNECT_MAX_ATTEMPTS = 5;

// Register service worker as early as possible (PWA install + lighter throttling on Android).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js').catch((err) => {
			console.warn('Service worker registration failed:', err);
		});
	});
	if ('storage' in navigator && navigator.storage.persist) {
		navigator.storage.persist().catch(() => { });
	}
}

let qrScannerOffer = null;
let qrScannerAnswer = null;
let isScanningOffer = false;
let isScanningAnswer = false;

// Last connection data for quick reconnect
const LS_KEYS = {
	ROLE: "babyphoneRole",
	EMITTER_SDP: "babyphoneEmitterSdp",
	RECEIVER_SDP: "babyphoneReceiverSdp",
	LAST_CONNECTION: "babyphoneLastConnection",
	DEVICE_NAME: "babyphoneDeviceName"
};

function saveConnectionData(emitterSdp, receiverSdp) {
	const data = {
		timestamp: Date.now(),
		emitterSdp: emitterSdp,
		receiverSdp: receiverSdp
	};
	localStorage.setItem(LS_KEYS.LAST_CONNECTION, JSON.stringify(data));
}

function getLastConnectionData() {
	try {
		const data = localStorage.getItem(LS_KEYS.LAST_CONNECTION);
		if (!data) return null;
		const parsed = JSON.parse(data);
		// Valid for 10 minutes
		const isValid = (Date.now() - parsed.timestamp) < 10 * 60 * 1000;
		return isValid ? parsed : null;
	} catch (e) {
		return null;
	}
}

function clearLastConnection() {
	localStorage.removeItem(LS_KEYS.LAST_CONNECTION);
}

// QR code splitting variables
let answerQrParts = [];
let currentQrIndex = 0;
let offerQrParts = [];
let currentOfferQrIndex = 0;
let partialScans = new Map();
let expectedTotalParts = 0;

const configuration = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" }
	]
};

if (location.protocol === "file:") {
	document.getElementById("httpsWarning").classList.remove("hidden");
}

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusDiv = document.getElementById("status");
const errorDiv = document.getElementById("error");
const roleSelect = document.getElementById("role");
const remoteAudio = document.getElementById("remoteAudio");

const savedRole = localStorage.getItem(LS_KEYS.ROLE);
if (savedRole) {
	roleSelect.value = savedRole;
	isEmetteur = savedRole === "emetteur";
	if (!isEmetteur) {
		show("scanOfferSection");
		setStatus("Prêt à scanner le QR de l'Émetteur.");
	}
}

// Check for last connection and show reconnect option
const lastConn = getLastConnectionData();
if (lastConn) {
	const minutesAgo = Math.floor((Date.now() - lastConn.timestamp) / 60000);
	document.getElementById("reconnectInfo").textContent =
		`Dernière connexion il y a ${minutesAgo} minute${minutesAgo > 1 ? 's' : ''}`;
	show("reconnectSection");

	document.getElementById("reconnectBtn").addEventListener("click", () => {
		hide("reconnectSection");
		startQuickReconnect(lastConn);
	});

	document.getElementById("newConnectionBtn").addEventListener("click", () => {
		clearLastConnection();
		hide("reconnectSection");
	});
}

roleSelect.addEventListener("change", () => {
	isEmetteur = roleSelect.value === "emetteur";
	localStorage.setItem(LS_KEYS.ROLE, roleSelect.value);
	if (!isEmetteur && !isStarted) {
		show("scanOfferSection");
		setStatus("Prêt à scanner le QR de l'Émetteur.");
	} else {
		hide("scanOfferSection");
	}
});

startBtn.addEventListener("click", startBabyphone);
stopBtn.addEventListener("click", stopBabyphone);
document.getElementById("processAnswerBtn").addEventListener("click", processAnswer);

// Mute toggle functionality
const muteBtn = document.getElementById("muteBtn");
let isMuted = true; // Start muted, user must unmute
remoteAudio.muted = isMuted;

muteBtn.addEventListener("click", () => {
	isMuted = !isMuted;
	remoteAudio.muted = isMuted;
	muteBtn.textContent = isMuted ? "🔊 Activer le son" : "🔇 Couper le son";
	muteBtn.classList.toggle("muted", isMuted);
});

// Mute microphone functionality (emitter side)
const muteMicBtn = document.getElementById("muteMicBtn");
let isMicMuted = false;

muteMicBtn.addEventListener("click", () => {
	isMicMuted = !isMicMuted;
	if (localStream) {
		localStream.getAudioTracks().forEach(track => {
			track.enabled = !isMicMuted;
		});
	}
	muteMicBtn.textContent = isMicMuted ? "🎤 Micro coupé" : "🎤 Micro activé";
	muteMicBtn.classList.toggle("muted", isMicMuted);
});

document.getElementById("prevQrBtn").addEventListener("click", showPrevQr);
document.getElementById("nextQrBtn").addEventListener("click", showNextQr);
document.getElementById("prevOfferQrBtn").addEventListener("click", showPrevOfferQr);
document.getElementById("nextOfferQrBtn").addEventListener("click", showNextOfferQr);
document.getElementById("resetPartialScanBtn").addEventListener("click", resetPartialScans);
document.getElementById("splitModeOffer").addEventListener("change", regenerateOfferQrCodes);
document.getElementById("splitMode").addEventListener("change", regenerateAnswerQrCodes);

// Modal open/close event listeners
document.getElementById("showOfferQrBtn").addEventListener("click", () => openModal("offerQrModal"));
document.getElementById("closeOfferQrModal").addEventListener("click", () => closeModal("offerQrModal"));
document.getElementById("showScanOfferBtn").addEventListener("click", () => {
	openModal("scanOfferModal");
	startScanOffer();
});
document.getElementById("closeScanOfferModal").addEventListener("click", () => {
	closeModal("scanOfferModal");
	if (isScanningOffer) stopScanOffer();
});
document.getElementById("showAnswerQrBtn").addEventListener("click", () => openModal("answerQrModal"));
document.getElementById("closeAnswerQrModal").addEventListener("click", () => closeModal("answerQrModal"));
document.getElementById("showScanAnswerBtn").addEventListener("click", () => {
	openModal("scanAnswerModal");
	startScanAnswer();
});
document.getElementById("closeScanAnswerModal").addEventListener("click", () => {
	closeModal("scanAnswerModal");
	if (isScanningAnswer) stopScanAnswer();
});

// Close modals when clicking outside
window.addEventListener("click", (e) => {
	if (e.target.classList.contains("modal")) {
		e.target.classList.add("hidden");
		if (isScanningOffer && e.target.id === "scanOfferModal") stopScanOffer();
		if (isScanningAnswer && e.target.id === "scanAnswerModal") stopScanAnswer();
	}
});

// QR code statique de partage de la page
(function () {
	const pageUrl = location.href.split("#")[0];
	const el = document.getElementById("pageQr");
	el.innerHTML = "";
	const canvas = document.createElement("canvas");
	el.appendChild(canvas);
	drawQrToCanvas(canvas, pageUrl, 160);
})();

// Auto-start récepteur si l'URL contient déjà une offre
if (location.hash.includes("sdp=")) {
	roleSelect.value = "recepteur";
	isEmetteur = false;
	window.addEventListener("load", () => startBabyphone(), { once: true });
}

// Handle visibility change to keep connection alive
document.addEventListener("visibilitychange", async () => {
	if (document.visibilityState === "visible") {
		console.log("Page became visible");
		await reRequestWakeLock();
		await keepAudioContextAlive();
		ensureMicTrackEnabled();
		// If the connection died while the screen was off, try to recover automatically.
		if (isStarted && peerConnection) {
			const s = peerConnection.connectionState;
			if (s === 'failed' || s === 'disconnected') {
				attemptAutoRecover('visibility-return');
			}
		}
	} else {
		console.log("Page became hidden");
		ensureMicTrackEnabled();
	}
});

function show(id) {
	document.getElementById(id).classList.remove("hidden");
}
function hide(id) {
	document.getElementById(id).classList.add("hidden");
}

function openModal(modalId) {
	const modal = document.getElementById(modalId);
	modal.classList.remove("hidden");
	// Recalculate QR size after modal is rendered
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			recalcQrSize();
		});
	});
}

function closeModal(modalId) {
	document.getElementById(modalId).classList.add("hidden");
}

function setStatus(msg) { statusDiv.textContent = "Statut : " + msg; }
function setError(msg) { errorDiv.textContent = msg ? "⚠️ " + msg : ""; }

function showToast(message) {
	const toast = document.getElementById('toast');
	toast.textContent = message;
	toast.classList.remove('hidden');
	toast.classList.add('visible');
	setTimeout(() => {
		toast.classList.remove('visible');
		toast.classList.add('hidden');
	}, 3000);
}

async function requestWakeLock() {
	if ("wakeLock" in navigator) {
		try {
			wakeLock = await navigator.wakeLock.request("screen");
			console.log("Wake lock acquired");
			wakeLock.addEventListener("release", () => {
				console.log("Wake lock released");
				wakeLock = null;
			});
		} catch (e) {
			console.error("Wake lock failed:", e);
		}
	}
}

async function reRequestWakeLock() {
	if (isStarted && "wakeLock" in navigator) {
		try {
			if (!wakeLock) {
				wakeLock = await navigator.wakeLock.request("screen");
				console.log("Wake lock re-acquired");
				wakeLock.addEventListener("release", () => {
					console.log("Wake lock released");
					wakeLock = null;
				});
			}
		} catch (e) {
			console.error("Wake lock re-acquisition failed:", e);
		}
	}
}

// Build a 1-second silent WAV blob URL that we can loop in a real <audio> element.
// A *playing* HTMLAudioElement is treated as foreground media playback by Android Chrome,
// which is significantly more resistant to background throttling than an AudioContext.
function buildSilentWavUrl() {
	const sampleRate = 8000;
	const durationSec = 1;
	const numSamples = sampleRate * durationSec;
	const buffer = new ArrayBuffer(44 + numSamples * 2);
	const view = new DataView(buffer);
	const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
	writeStr(0, 'RIFF');
	view.setUint32(4, 36 + numSamples * 2, true);
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	view.setUint32(16, 16, true);          // PCM chunk size
	view.setUint16(20, 1, true);           // PCM format
	view.setUint16(22, 1, true);           // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true);           // block align
	view.setUint16(34, 16, true);          // bits per sample
	writeStr(36, 'data');
	view.setUint32(40, numSamples * 2, true);
	// PCM samples already zero-filled.
	return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	try {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: isEmetteur ? 'Babyphone — Émetteur (chambre)' : 'Babyphone — Récepteur',
			artist: 'FreeBabyPhoneJs',
			album: 'Écoute en cours'
		});
		navigator.mediaSession.playbackState = 'playing';
		// The OS exposes lock-screen play/pause buttons. We refuse to be paused
		// (the whole point is to keep streaming), but we honor an explicit Stop.
		const keepAlive = () => {
			navigator.mediaSession.playbackState = 'playing';
			if (silentAudioEl && silentAudioEl.paused) silentAudioEl.play().catch(() => { });
		};
		navigator.mediaSession.setActionHandler('play', keepAlive);
		navigator.mediaSession.setActionHandler('pause', keepAlive);
		navigator.mediaSession.setActionHandler('stop', () => stopBabyphone());
	} catch (e) {
		console.warn('Media Session setup failed:', e);
	}
}

function startSilentAudio() {
	try {
		// 1. Real <audio> element looping silence — the primary keep-alive on mobile.
		if (!silentAudioEl) {
			silentAudioUrl = buildSilentWavUrl();
			silentAudioEl = new Audio(silentAudioUrl);
			silentAudioEl.loop = true;
			// Non-zero volume so the track is treated as actually producing sound,
			// but low enough to be inaudible.
			silentAudioEl.volume = 0.001;
			silentAudioEl.setAttribute('playsinline', '');
			silentAudioEl.preload = 'auto';
		}
		const playPromise = silentAudioEl.play();
		if (playPromise && playPromise.catch) {
			playPromise.catch((e) => console.warn('Silent loop play deferred:', e && e.message));
		}

		// 2. Legacy AudioContext oscillator kept as a belt-and-suspenders fallback.
		if (!silentAudioCtx) {
			silentAudioCtx = new AudioContext();
			const oscillator = silentAudioCtx.createOscillator();
			const gain = silentAudioCtx.createGain();
			gain.gain.value = 0.0001;
			oscillator.connect(gain);
			gain.connect(silentAudioCtx.destination);
			oscillator.start();
		}

		// 3. Tell the OS we are media playback so we get the lock-screen treatment.
		setupMediaSession();

		console.log('Silent audio started (loop element + AudioContext + MediaSession)');
	} catch (e) {
		console.error('Silent audio failed:', e);
	}
}

async function keepAudioContextAlive() {
	if (silentAudioCtx && silentAudioCtx.state === 'suspended') {
		try {
			await silentAudioCtx.resume();
			console.log('Audio context resumed');
		} catch (e) {
			console.error('Failed to resume audio context:', e);
		}
	}
	if (silentAudioEl && silentAudioEl.paused && isStarted) {
		try { await silentAudioEl.play(); console.log('Silent loop resumed'); } catch (e) { /* ignored */ }
	}
	if ('mediaSession' in navigator && isStarted) {
		navigator.mediaSession.playbackState = 'playing';
	}
}

function ensureMicTrackEnabled() {
	if (localStream && isEmetteur) {
		localStream.getAudioTracks().forEach(track => {
			if (!track.enabled) {
				track.enabled = true;
				console.log("Microphone track re-enabled");
			}
		});
	}
}

function startHeartbeat() {
	if (heartbeatInterval) clearInterval(heartbeatInterval);
	heartbeatInterval = setInterval(() => {
		if (isStarted) {
			keepAudioContextAlive();
			ensureMicTrackEnabled();
			if (peerConnection && peerConnection.connectionState === 'connected') {
				peerConnection.getStats().then(stats => {
					console.log("Connection stats:", stats);
				}).catch(() => { });
			}
		}
	}, 10000); // Check every 10 seconds
	console.log("Heartbeat started");
}

function stopHeartbeat() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
		console.log("Heartbeat stopped");
	}
}

function stopSilentAudio() {
	if (silentAudioEl) {
		try { silentAudioEl.pause(); } catch (e) { /* ignored */ }
		silentAudioEl.removeAttribute('src');
		try { silentAudioEl.load(); } catch (e) { /* ignored */ }
		silentAudioEl = null;
	}
	if (silentAudioUrl) { URL.revokeObjectURL(silentAudioUrl); silentAudioUrl = null; }
	if (silentAudioCtx) { silentAudioCtx.close().catch(() => { }); silentAudioCtx = null; }
	if ('mediaSession' in navigator) {
		try {
			navigator.mediaSession.playbackState = 'none';
			navigator.mediaSession.metadata = null;
		} catch (e) { /* ignored */ }
	}
}

// === Auto-recovery =========================================================
// Without a signaling server we cannot truly renegotiate, but on a stable LAN
// the cached SDPs from the last successful handshake are usually valid for a
// while, so a tear-down + quick-reconnect often succeeds.
function clearAutoReconnect() {
	if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
}

function attachConnectionStateRecovery(pc) {
	pc.onconnectionstatechange = () => {
		const state = pc.connectionState;
		console.log('PC connectionState:', state);
		if (state === 'connected') {
			setStatus('Connexion établie ! Audio actif.');
			hide('scanOfferDoneSection');
			hide('answerSection');
			hide('offerDoneSection');
			hide('pasteAnswerSection');
			startHeartbeat();
			clearAutoReconnect();
			autoReconnectAttempts = 0;
		} else if (state === 'failed') {
			setStatus('Connexion perdue — tentative de récupération…');
			attemptAutoRecover('failed');
		} else if (state === 'disconnected') {
			setStatus('Connexion interrompue — surveillance…');
			if (!autoReconnectTimer) {
				autoReconnectTimer = setTimeout(() => {
					autoReconnectTimer = null;
					if (peerConnection && ['disconnected', 'failed'].includes(peerConnection.connectionState)) {
						attemptAutoRecover('disconnected-timeout');
					}
				}, 8000);
			}
		}
	};
}

function attemptAutoRecover(reason) {
	if (!isStarted) return;
	if (autoReconnectAttempts >= AUTO_RECONNECT_MAX_ATTEMPTS) {
		setStatus('Reconnexion automatique abandonnée — relancez manuellement.');
		return;
	}
	autoReconnectAttempts++;
	console.log('attemptAutoRecover #' + autoReconnectAttempts + ' (' + reason + ')');

	// Step 1: trigger an ICE restart on the existing PC. This is mostly useful when
	// the same NAT rebinding happens on both sides (rare without signaling), but
	// it costs nothing and may save us a full re-handshake.
	if (peerConnection && peerConnection.signalingState !== 'closed' &&
		typeof peerConnection.restartIce === 'function') {
		try { peerConnection.restartIce(); console.log('ICE restart issued'); }
		catch (e) { console.warn('restartIce failed:', e); }
	}

	// Step 2: after a short grace period, if still not back, tear everything down
	// and replay the last known-good handshake from localStorage.
	setTimeout(() => {
		if (!isStarted) return;
		const s = peerConnection ? peerConnection.connectionState : 'closed';
		if (s === 'connected') { autoReconnectAttempts = 0; return; }

		const lastConn = getLastConnectionData();
		if (lastConn) {
			showToast('Reconnexion automatique…');
			stopBabyphone();
			setTimeout(() => startQuickReconnect(lastConn), 300);
		} else {
			setStatus('Connexion perdue — données expirées, relance manuelle requise.');
		}
	}, 4000);
}

function startVuMeter(stream) {
	const ctx = new AudioContext();
	const src = ctx.createMediaStreamSource(stream);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 256;
	src.connect(analyser);
	const data = new Uint8Array(analyser.frequencyBinCount);
	const bar = document.getElementById("vuBar");
	document.getElementById("vuMeter").classList.remove("hidden");
	function tick() {
		analyser.getByteFrequencyData(data);
		const avg = data.reduce((s, v) => s + v, 0) / data.length;
		bar.style.width = Math.min(100, avg * 2.5) + "%";
		bar.classList.toggle("warning", avg > 30);
		vuAnimFrame = requestAnimationFrame(tick);
	}
	tick();
}

function stopVuMeter() {
	if (vuAnimFrame) { cancelAnimationFrame(vuAnimFrame); vuAnimFrame = null; }
	document.getElementById("vuMeter").classList.add("hidden");
}

async function compress(str) {
	const enc = new TextEncoder().encode(str);
	const cs = new CompressionStream("deflate-raw");
	const writer = cs.writable.getWriter();
	writer.write(enc); writer.close();
	const buf = await new Response(cs.readable).arrayBuffer();
	const bytes = new Uint8Array(buf);
	let b64 = "";
	for (let i = 0; i < bytes.length; i++) { b64 += String.fromCharCode(bytes[i]); }
	return btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function decompress(b64) {
	const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
	const buf = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) { buf[i] = bin.charCodeAt(i); }
	const ds = new DecompressionStream("deflate-raw");
	const writer = ds.writable.getWriter();
	writer.write(buf); writer.close();
	const out = await new Response(ds.readable).arrayBuffer();
	return new TextDecoder().decode(out);
}

async function sdpToUrl(sdp) {
	const compressed = await compress(JSON.stringify(sdp));
	return location.href.split("#")[0] + "#sdp=" + compressed;
}

async function sdpFromUrl(hash) {
	try {
		console.log("Début sdpFromUrl avec:", hash);
		const m = hash.match(/[#&]sdp=([^&]*)/);
		if (!m) {
			console.log("Aucun match pour le pattern sdp=");
			return null;
		}
		console.log("Match trouvé:", m[1]);

		// Check if this is combined partial data (comma-separated)
		let data = m[1];
		if (data.includes(',') && isPartialQr(data.split(',')[0])) {
			const parts = data.split(',').map(p => p.trim()).filter(p => p);
			data = combineData(parts);
		}

		const json = await decompress(data);
		const result = JSON.parse(json);
		console.log("SDP parsé avec succès");
		return result;
	} catch (e) {
		console.error("Erreur dans sdpFromUrl:", e);
		return null;
	}
}

function drawQrToCanvas(canvas, text, size) {
	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();
	const cellCount = qr.getModuleCount();
	const cellSize = Math.floor(size / cellCount);
	const actualSize = cellSize * cellCount;
	canvas.width = actualSize;
	canvas.height = actualSize;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, actualSize, actualSize);
	ctx.fillStyle = '#000000';
	for (let row = 0; row < cellCount; row++) {
		for (let col = 0; col < cellCount; col++) {
			if (qr.isDark(row, col)) {
				ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
			}
		}
	}
	// Center the canvas if needed by setting display style
	canvas.style.display = 'block';
}

function makeQr(containerId, url) {
	const el = document.getElementById(containerId);
	el.innerHTML = "";

	// Check if container is inside a modal
	const modal = el.closest('.modal-content');
	let availableWidth;

	if (modal) {
		// Use modal width if inside a modal
		const modalWidth = modal.offsetWidth;
		const padding = 20;
		availableWidth = modalWidth - padding;
	} else {
		// Use screen width if not in a modal
		const screenWidth = window.innerWidth;
		const margin = 32; // 16px padding on each side
		availableWidth = screenWidth - margin;
	}

	const qrSize = Math.min(600, Math.max(250, availableWidth));
	const canvas = document.createElement("canvas");
	el.appendChild(canvas);
	drawQrToCanvas(canvas, url, qrSize);
}

function shareOrCopy(url, label) {
	if (navigator.share) {
		navigator.share({ title: "Babyphone", text: label, url: url }).catch(() => { });
	} else if (navigator.clipboard) {
		navigator.clipboard.writeText(url).then(() => setStatus("Lien copié !"));
	} else {
		prompt("Copiez ce lien :", url);
	}
}

function waitForIceGathering(pc) {
	return new Promise((resolve) => {
		if (pc.iceGatheringState === "complete") { resolve(); return; }
		const check = () => {
			if (pc.iceGatheringState === "complete") {
				pc.removeEventListener("icegatheringstatechange", check);
				resolve();
			}
		};
		pc.addEventListener("icegatheringstatechange", check);
		setTimeout(resolve, 4000);
	});
}

// Split data into chunks for multiple QR codes
function splitData(data, numParts) {
	const chunks = [];
	const chunkSize = Math.ceil(data.length / numParts);
	for (let i = 0; i < numParts; i++) {
		const start = i * chunkSize;
		const end = Math.min(start + chunkSize, data.length);
		const chunk = data.substring(start, end);
		// Add metadata: part index, total parts, and chunk data
		chunks.push(`${i + 1}/${numParts}:${chunk}`);
	}
	return chunks;
}

// Combine chunks back into original data
function combineData(chunks) {
	// Sort by part index and extract data
	const sorted = chunks.sort((a, b) => {
		const idxA = parseInt(a.split(':')[0].split('/')[0]);
		const idxB = parseInt(b.split(':')[0].split('/')[0]);
		return idxA - idxB;
	});
	return sorted.map(chunk => chunk.split(':').slice(1).join(':')).join('');
}

// Check if text is a partial QR code
function isPartialQr(text) {
	return /^\d+\/\d+:/.test(text);
}

// Parse partial QR code metadata
function parsePartialQr(text) {
	const match = text.match(/^(\d+)\/(\d+):(.+)$/);
	if (!match) return null;
	return {
		index: parseInt(match[1]),
		total: parseInt(match[2]),
		data: match[3]
	};
}

// Update QR code display with navigation
function updateQrDisplay() {
	const container = document.getElementById("answerQr");
	if (answerQrParts.length === 0) return;

	const part = answerQrParts[currentQrIndex];
	const modalContent = document.getElementById("answerQrModal").querySelector(".modal-content");
	const modalWidth = modalContent ? modalContent.offsetWidth : window.innerWidth;
	const padding = 20;
	const availableWidth = modalWidth - padding;
	const qrSize = Math.min(600, Math.max(250, availableWidth));

	container.innerHTML = "";
	const canvas = document.createElement("canvas");
	container.appendChild(canvas);
	drawQrToCanvas(canvas, part, qrSize);

	// Update counter
	document.getElementById("qrCounter").textContent = `${currentQrIndex + 1} / ${answerQrParts.length}`;

	// Update button states
	document.getElementById("prevQrBtn").disabled = currentQrIndex === 0;
	document.getElementById("nextQrBtn").disabled = currentQrIndex === answerQrParts.length - 1;

	// Show/hide swipe hint for multi-QR mode
	const swipeHint = document.getElementById("answerSwipeHint");
	if (swipeHint) {
		if (answerQrParts.length > 1) {
			swipeHint.classList.remove("hidden");
			swipeHint.classList.add("visible-block");
		} else {
			swipeHint.classList.add("hidden");
			swipeHint.classList.remove("visible-block");
		}
	}
}

// Recalculate QR size after modal is rendered
function recalcQrSize() {
	if (answerQrParts.length > 0) {
		updateQrDisplay();
	}
	if (offerQrParts.length > 0) {
		updateOfferQrDisplay();
	}
}

function showPrevQr() {
	if (currentQrIndex > 0) {
		currentQrIndex--;
		updateQrDisplay();
	}
}

function showNextQr() {
	if (currentQrIndex < answerQrParts.length - 1) {
		currentQrIndex++;
		updateQrDisplay();
	}
}

function updateOfferQrDisplay() {
	const container = document.getElementById("offerQr");
	if (offerQrParts.length === 0) return;

	const part = offerQrParts[currentOfferQrIndex];
	const modalContent = document.getElementById("offerQrModal").querySelector(".modal-content");
	const modalWidth = modalContent ? modalContent.offsetWidth : window.innerWidth;
	const padding = 20;
	const availableWidth = modalWidth - padding;
	const qrSize = Math.min(600, Math.max(250, availableWidth));

	container.innerHTML = "";
	const canvas = document.createElement("canvas");
	container.appendChild(canvas);
	drawQrToCanvas(canvas, part, qrSize);

	document.getElementById("offerQrCounter").textContent = `${currentOfferQrIndex + 1} / ${offerQrParts.length}`;
	document.getElementById("prevOfferQrBtn").disabled = currentOfferQrIndex === 0;
	document.getElementById("nextOfferQrBtn").disabled = currentOfferQrIndex === offerQrParts.length - 1;

	// Show/hide swipe hint for multi-QR mode
	const swipeHint = document.getElementById("offerSwipeHint");
	if (swipeHint) {
		if (offerQrParts.length > 1) {
			swipeHint.classList.remove("hidden");
			swipeHint.classList.add("visible-block");
		} else {
			swipeHint.classList.add("hidden");
			swipeHint.classList.remove("visible-block");
		}
	}
}

function showPrevOfferQr() {
	if (currentOfferQrIndex > 0) {
		currentOfferQrIndex--;
		updateOfferQrDisplay();
	}
}

function showNextOfferQr() {
	if (currentOfferQrIndex < offerQrParts.length - 1) {
		currentOfferQrIndex++;
		updateOfferQrDisplay();
	}
}

// Swipe gesture support for QR code navigation
function addSwipeSupport(elementId, onSwipeLeft, onSwipeRight) {
	const element = document.getElementById(elementId);
	if (!element) return;

	let startX = 0;
	let startY = 0;
	let isSwiping = false;

	element.addEventListener('touchstart', (e) => {
		startX = e.touches[0].clientX;
		startY = e.touches[0].clientY;
		isSwiping = true;
		element.style.transition = 'transform 0.1s ease-out';
	}, { passive: true });

	element.addEventListener('touchmove', (e) => {
		if (!isSwiping) return;
		const currentX = e.touches[0].clientX;
		const diffX = currentX - startX;
		// Only horizontal swipes
		if (Math.abs(diffX) > 10) {
			element.style.transform = `translateX(${diffX * 0.3}px)`;
		}
	}, { passive: true });

	element.addEventListener('touchend', (e) => {
		if (!isSwiping) return;
		isSwiping = false;
		element.style.transition = 'transform 0.2s ease-out';
		element.style.transform = 'translateX(0)';

		const endX = e.changedTouches[0].clientX;
		const diffX = endX - startX;
		const diffY = e.changedTouches[0].clientY - startY;

		// Minimum swipe distance (50px) and mostly horizontal
		if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 2) {
			if (diffX > 0) {
				onSwipeRight();
			} else {
				onSwipeLeft();
			}
		}
	}, { passive: true });

	// Mouse support for desktop testing
	let mouseDown = false;
	element.addEventListener('mousedown', (e) => {
		startX = e.clientX;
		isSwiping = true;
		mouseDown = true;
	});

	element.addEventListener('mousemove', (e) => {
		if (!mouseDown) return;
		const diffX = e.clientX - startX;
		if (Math.abs(diffX) > 10) {
			element.style.transform = `translateX(${diffX * 0.3}px)`;
		}
	});

	element.addEventListener('mouseup', (e) => {
		if (!mouseDown) return;
		mouseDown = false;
		isSwiping = false;
		element.style.transform = 'translateX(0)';

		const diffX = e.clientX - startX;
		if (Math.abs(diffX) > 50) {
			if (diffX > 0) {
				onSwipeRight();
			} else {
				onSwipeLeft();
			}
		}
	});

	element.addEventListener('mouseleave', () => {
		if (mouseDown) {
			mouseDown = false;
			isSwiping = false;
			element.style.transform = 'translateX(0)';
		}
	});
}

// Initialize swipe support for QR containers
function initQrSwipeSupport() {
	// Answer QR (receiver side) - swipe left = next, swipe right = prev
	addSwipeSupport('answerQr',
		() => showNextQr(),      // swipe left → next
		() => showPrevQr()       // swipe right → previous
	);

	// Offer QR (emitter side) - swipe left = next, swipe right = prev
	addSwipeSupport('offerQr',
		() => showNextOfferQr(), // swipe left → next
		() => showPrevOfferQr()  // swipe right → previous
	);
}

// Regenerate offer QR codes when split mode changes
async function regenerateOfferQrCodes() {
	if (!isStarted || !isEmetteur || !peerConnection || !peerConnection.localDescription) return;

	const compressedOffer = await compress(JSON.stringify(peerConnection.localDescription));
	const modeValue = document.getElementById("splitModeOffer").value;
	const isAuto = modeValue === "auto";
	const splitModeOffer = isAuto ? 1 : parseInt(modeValue);
	const navDivOffer = document.getElementById("offerQrNavigation");
	const multiMsgOffer = document.getElementById("multiQrMessageOffer");

	if (!isAuto && splitModeOffer > 1) {
		// Manual multi-QR mode
		offerQrParts = splitData(compressedOffer, splitModeOffer);
		currentOfferQrIndex = 0;
		updateOfferQrDisplay();
		navDivOffer.classList.remove("hidden");
		navDivOffer.classList.add("visible-flex");
		multiMsgOffer.classList.remove("hidden");
		multiMsgOffer.classList.add("visible-block");
		document.getElementById("shareOfferBtn").onclick = () => {
			const baseUrl = location.href.split("#")[0] + "#sdp=";
			shareOrCopy(baseUrl + offerQrParts.join(","), "Lien babyphone (toutes les parties)");
		};
		setStatus(`${offerQrParts.length} QR codes prêts — faites-les scanner un par un par le Récepteur.`);
	} else if (isAuto && compressedOffer.length > 800) {
		// Auto mode with large data
		const autoParts = Math.ceil(compressedOffer.length / 600);
		offerQrParts = splitData(compressedOffer, autoParts);
		currentOfferQrIndex = 0;
		updateOfferQrDisplay();
		navDivOffer.classList.remove("hidden");
		navDivOffer.classList.add("visible-block");
		multiMsgOffer.classList.remove("hidden");
		multiMsgOffer.classList.add("visible-block");
		document.getElementById("shareOfferBtn").onclick = () => {
			const baseUrl = location.href.split("#")[0] + "#sdp=";
			shareOrCopy(baseUrl + offerQrParts.join(","), "Lien babyphone (toutes les parties)");
		};
		setStatus(`${offerQrParts.length} QR codes générés automatiquement (données volumineuses).`);
	} else {
		// Single QR code (manual 1 or auto with small data)
		offerQrParts = [compressedOffer];
		currentOfferQrIndex = 0;
		updateOfferQrDisplay();
		navDivOffer.classList.add("hidden");
		navDivOffer.classList.remove("visible-flex", "visible-block");
		multiMsgOffer.classList.add("hidden");
		multiMsgOffer.classList.remove("visible-block");
		const offerUrl = location.href.split("#")[0] + "#sdp=" + compressedOffer;
		document.getElementById("shareOfferBtn").onclick = () => shareOrCopy(offerUrl, "Ouvre ce lien pour recevoir l'audio du babyphone");
		setStatus("QR code prêt — faites-le scanner par le Récepteur.");
	}
}

// Regenerate answer QR codes when split mode changes
async function regenerateAnswerQrCodes() {
	if (!isStarted || isEmetteur || !peerConnection || !peerConnection.localDescription) return;

	const compressedAnswer = await compress(JSON.stringify(peerConnection.localDescription));
	const modeValue = document.getElementById("splitMode").value;
	const isAuto = modeValue === "auto";
	const splitMode = isAuto ? 1 : parseInt(modeValue);
	const navDiv = document.getElementById("qrNavigation");
	const multiMsg = document.getElementById("multiQrMessage");

	if (!isAuto && splitMode > 1) {
		// Manual multi-QR mode
		answerQrParts = splitData(compressedAnswer, splitMode);
		currentQrIndex = 0;
		updateQrDisplay();
		navDiv.classList.remove("hidden");
		navDiv.classList.add("visible-flex");
		multiMsg.classList.remove("hidden");
		multiMsg.classList.add("visible-block");
		document.getElementById("shareAnswerBtn").onclick = () => {
			const combined = answerQrParts.join(",");
			shareOrCopy(combined, "Réponse babyphone (toutes les parties)");
		};
		setStatus(`${answerQrParts.length} QR codes prêts — faites-les scanner un par un par l'Émetteur.`);
	} else if (isAuto && compressedAnswer.length > 800) {
		// Auto mode with large data
		const autoParts = Math.ceil(compressedAnswer.length / 600);
		answerQrParts = splitData(compressedAnswer, autoParts);
		currentQrIndex = 0;
		updateQrDisplay();
		navDiv.classList.remove("hidden");
		navDiv.classList.add("visible-block");
		multiMsg.classList.remove("hidden");
		multiMsg.classList.add("visible-block");
		document.getElementById("shareAnswerBtn").onclick = () => {
			const combined = answerQrParts.join(",");
			shareOrCopy(combined, "Réponse babyphone (toutes les parties)");
		};
		setStatus(`${answerQrParts.length} QR codes générés automatiquement (données volumineuses).`);
	} else {
		// Single QR code (manual 1 or auto with small data)
		answerQrParts = [compressedAnswer];
		currentQrIndex = 0;
		updateQrDisplay();
		navDiv.classList.add("hidden");
		navDiv.classList.remove("visible-flex", "visible-block");
		multiMsg.classList.add("hidden");
		multiMsg.classList.remove("visible-block");
		document.getElementById("shareAnswerBtn").onclick = () => shareOrCopy(compressedAnswer, "Réponse babyphone");
		setStatus("QR code prêt — faites-le scanner par l'Émetteur.");
	}
}

// Update partial scan status display
function updatePartialScanStatus() {
	const statusDiv = document.getElementById("partialScanStatus");
	if (partialScans.size === 0) {
		statusDiv.classList.add("hidden");
		statusDiv.classList.remove("visible-block");
		return;
	}

	statusDiv.classList.remove("hidden");
	statusDiv.classList.add("visible-block");
	document.getElementById("partialScanCount").textContent = partialScans.size;

	// Show which parts are scanned
	const parts = [];
	for (let i = 1; i <= expectedTotalParts; i++) {
		parts.push(partialScans.has(i) ? `✓ Partie ${i}` : `○ Partie ${i}`);
	}
	document.getElementById("partialScanParts").textContent = parts.join(" | ");
}

function resetPartialScans() {
	partialScans.clear();
	expectedTotalParts = 0;
	updatePartialScanStatus();
	setStatus("Scan partiel réinitialisé. Rescannez les QR codes.");
}

// Handle partial QR code scan
function handlePartialScan(text) {
	const parsed = parsePartialQr(text);
	if (!parsed) return false;

	// Set expected total if this is the first partial scan
	if (expectedTotalParts === 0) {
		expectedTotalParts = parsed.total;
	} else if (expectedTotalParts !== parsed.total) {
		setError("Incohérence : ce QR code appartient à un ensemble différent.");
		return true;
	}

	// Store this part
	partialScans.set(parsed.index, text);
	updatePartialScanStatus();

	// Check if we have all parts
	if (partialScans.size === expectedTotalParts) {
		const allParts = [];
		for (let i = 1; i <= expectedTotalParts; i++) {
			allParts.push(partialScans.get(i));
		}
		const combined = combineData(allParts);
		return combined;
	}

	const remaining = expectedTotalParts - partialScans.size;
	const remainingList = [];
	for (let i = 1; i <= expectedTotalParts; i++) {
		if (!partialScans.has(i)) remainingList.push(i);
	}
	const message = `Partie ${parsed.index}/${parsed.total} scannée ! Encore ${remaining} QR code${remaining > 1 ? 's' : ''} à scanner (${remainingList.join(', ')})`;
	setStatus(message);
	showToast(message);
	return "pending";
}

async function startQuickReconnect(lastConn) {
	setStatus("Tentative de reconnexion rapide...");
	isEmetteur = roleSelect.value === "emetteur";

	try {
		peerConnection = new RTCPeerConnection(configuration);

		peerConnection.onconnectionstatechange = () => {
			const state = peerConnection.connectionState;
			console.log('PC connectionState (quick-reconnect):', state);
			if (state === "connected") {
				setStatus("Reconnexion réussie ! Audio actif.");
				showToast("Reconnecté avec succès !");
				hide("scanOfferDoneSection");
				hide("answerSection");
				hide("offerDoneSection");
				hide("pasteAnswerSection");
				startHeartbeat();
				clearAutoReconnect();
				autoReconnectAttempts = 0;
			} else if (state === "failed") {
				setStatus("Reconnexion échouée — nouvelle tentative…");
				attemptAutoRecover('quick-reconnect-failed');
			} else if (state === "disconnected") {
				setStatus("Connexion interrompue — surveillance…");
				if (!autoReconnectTimer) {
					autoReconnectTimer = setTimeout(() => {
						autoReconnectTimer = null;
						if (peerConnection && ['disconnected', 'failed'].includes(peerConnection.connectionState)) {
							attemptAutoRecover('quick-reconnect-disconnected');
						}
					}, 8000);
				}
			}
		};

		peerConnection.ontrack = (event) => {
			if (event.streams && event.streams[0]) {
				remoteAudio.srcObject = event.streams[0];
			} else {
				const ms = new MediaStream();
				ms.addTrack(event.track);
				remoteAudio.srcObject = ms;
			}
			remoteAudio.play().catch(() => {
				setStatus("Appuyez sur ▶ pour activer l'audio.");
				showPlayButton();
			});
			setStatus("Audio reçu !");
		};

		if (isEmetteur) {
			// Emitter: restore local description from stored offer
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
				video: false
			});
			await requestWakeLock();
			startSilentAudio();
			startVuMeter(localStream);
			muteMicBtn.classList.remove("hidden");
			localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

			if (lastConn.emitterSdp) {
				await peerConnection.setLocalDescription(new RTCSessionDescription(lastConn.emitterSdp));
				setStatus("Reprise de la connexion... Scannez la réponse du récepteur.");
				show("pasteAnswerSection");
				startBtn.disabled = true;
				stopBtn.disabled = false;
				roleSelect.disabled = true;
				isStarted = true;
			} else {
				throw new Error("Données émetteur manquantes");
			}
		} else {
			// Receiver: restore from stored answer
			await requestWakeLock();
			startSilentAudio();

			if (lastConn.emitterSdp) {
				// First set remote description (the emitter's offer)
				await peerConnection.setRemoteDescription(new RTCSessionDescription(lastConn.emitterSdp));

				// Then set local description (our answer)
				if (lastConn.receiverSdp) {
					await peerConnection.setLocalDescription(new RTCSessionDescription(lastConn.receiverSdp));
					setStatus("Reconnexion en cours...");
					startBtn.disabled = true;
					stopBtn.disabled = false;
					roleSelect.disabled = true;
					isStarted = true;
				} else {
					throw new Error("Données réponse manquantes");
				}
			} else {
				throw new Error("Données offre manquantes");
			}
		}
	} catch (error) {
		console.error("Quick reconnect failed:", error);
		setStatus("Reconnexion rapide impossible — utilisation des QR codes.");
		showToast("Données expirées, utilisez les QR codes");
		setTimeout(() => startBabyphone(), 1500);
	}
}

async function startBabyphone() {
	if (isStarted) return;
	isStarted = true;
	isEmetteur = roleSelect.value === "emetteur";

	startBtn.disabled = true;
	stopBtn.disabled = false;
	roleSelect.disabled = true;
	document.getElementById("playAudioBtn").classList.add("hidden");
	setError("");
	setStatus("Connexion en cours...");

	try {
		peerConnection = new RTCPeerConnection(configuration);

		attachConnectionStateRecovery(peerConnection);

		peerConnection.ontrack = (event) => {
			let receivedStream;
			if (event.streams && event.streams[0]) {
				receivedStream = event.streams[0];
				remoteAudio.srcObject = receivedStream;
			} else {
				const ms = new MediaStream();
				ms.addTrack(event.track);
				receivedStream = ms;
				remoteAudio.srcObject = ms;
			}
			remoteAudio.play().catch(() => {
				setStatus("Appuyez sur ▶ pour activer l'audio.");
				showPlayButton();
			});
			setStatus("Audio reçu !");
			muteBtn.classList.remove("hidden");
			// Start VU meter for received audio (works even when muted)
			startVuMeter(receivedStream);
		};

		if (isEmetteur) {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				},
				video: false
			});
			await requestWakeLock();
			startSilentAudio();
			startVuMeter(localStream);
			setStatus("Micro activé");
			muteMicBtn.classList.remove("hidden");
			localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

			const offer = await peerConnection.createOffer();
			await peerConnection.setLocalDescription(offer);
			await waitForIceGathering(peerConnection);

			const offerUrl = await sdpToUrl(peerConnection.localDescription);
			const compressedOffer = offerUrl.split("#sdp=")[1];

			// Get split mode preference for offer
			const modeOfferValue = document.getElementById("splitModeOffer").value;
			const isAutoOffer = modeOfferValue === "auto";
			const splitModeOffer = isAutoOffer ? 1 : parseInt(modeOfferValue);
			const navDivOffer = document.getElementById("offerQrNavigation");
			const multiMsgOffer = document.getElementById("multiQrMessageOffer");

			if (!isAutoOffer && splitModeOffer > 1) {
				// Manual multi-QR mode
				offerQrParts = splitData(compressedOffer, splitModeOffer);
				currentOfferQrIndex = 0;
				updateOfferQrDisplay();
				navDivOffer.classList.remove("hidden");
				navDivOffer.classList.add("visible-flex");
				multiMsgOffer.classList.remove("hidden");
				multiMsgOffer.classList.add("visible-block");
				document.getElementById("shareOfferBtn").onclick = () => {
					const baseUrl = location.href.split("#")[0] + "#sdp=";
					shareOrCopy(baseUrl + offerQrParts.join(","), "Lien babyphone (toutes les parties)");
				};
				setStatus(`${offerQrParts.length} QR codes prêts — faites-les scanner un par un par le Récepteur.`);
			} else if (isAutoOffer && compressedOffer.length > 800) {
				// Auto mode with large data
				const autoParts = Math.ceil(compressedOffer.length / 600);
				offerQrParts = splitData(compressedOffer, autoParts);
				currentOfferQrIndex = 0;
				updateOfferQrDisplay();
				navDivOffer.classList.remove("hidden");
				navDivOffer.classList.add("visible-block");
				multiMsgOffer.classList.remove("hidden");
				multiMsgOffer.classList.add("visible-block");
				document.getElementById("shareOfferBtn").onclick = () => {
					const baseUrl = location.href.split("#")[0] + "#sdp=";
					shareOrCopy(baseUrl + offerQrParts.join(","), "Lien babyphone (toutes les parties)");
				};
				setStatus(`${offerQrParts.length} QR codes générés automatiquement (données volumineuses).`);
			} else {
				// Single QR code (manual 1 or auto with small data)
				offerQrParts = [compressedOffer];
				currentOfferQrIndex = 0;
				updateOfferQrDisplay();
				navDivOffer.classList.add("hidden");
				navDivOffer.classList.remove("visible-flex", "visible-block");
				multiMsgOffer.classList.add("hidden");
				multiMsgOffer.classList.remove("visible-block");
				makeQr("offerQr", offerUrl);
				document.getElementById("shareOfferBtn").onclick = () => shareOrCopy(offerUrl, "Ouvre ce lien pour recevoir l'audio du babyphone");
				setStatus("QR code prêt — faites-le scanner par le Récepteur.");
			}
			show("offerSection");
			show("pasteAnswerSection");
			openModal("offerQrModal");
			initQrSwipeSupport();
		} else {
			await requestWakeLock();
			startSilentAudio();
			const incomingOffer = await sdpFromUrl(location.hash);
			if (incomingOffer) {
				await processIncomingOffer(incomingOffer);
			} else {
				show("scanOfferSection");
				openModal("scanOfferModal");
				startScanOffer();
				setStatus("Aucune offre détectée. Scannez le QR de l'Émetteur.");
			}
		}

	} catch (error) {
		let msg = error.message;
		if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
			if (location.protocol !== "https:" && location.hostname !== "localhost") {
				msg = "Micro refusé : Chrome exige HTTPS. Voir le bandeau rouge ci-dessus.";
				document.getElementById("httpsWarning").classList.remove("hidden");
			} else {
				msg = "Accès au micro refusé. Vérifiez les permissions dans les réglages Chrome.";
			}
		} else if (error.name === "NotFoundError") {
			msg = "Aucun micro détecté sur cet appareil.";
		}
		setError(msg);
		stopBabyphone();
	}
}

async function processIncomingOffer(offer) {
	try {
		await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
		const answer = await peerConnection.createAnswer();
		await peerConnection.setLocalDescription(answer);
		await waitForIceGathering(peerConnection);

		// Save connection data for quick reconnect (receiver side)
		saveConnectionData(offer, peerConnection.localDescription);

		const compressedAnswer = await compress(JSON.stringify(peerConnection.localDescription));

		// Get split mode preference
		const modeValue = document.getElementById("splitMode").value;
		const isAuto = modeValue === "auto";
		const splitMode = isAuto ? 1 : parseInt(modeValue);
		const navDiv = document.getElementById("qrNavigation");
		const multiMsg = document.getElementById("multiQrMessage");

		if (!isAuto && splitMode > 1) {
			// Manual multi-QR mode
			answerQrParts = splitData(compressedAnswer, splitMode);
			currentQrIndex = 0;
			updateQrDisplay();
			navDiv.classList.remove("hidden");
			navDiv.classList.add("visible-flex");
			multiMsg.classList.remove("hidden");
			multiMsg.classList.add("visible-block");

			// Share button combines all parts
			document.getElementById("shareAnswerBtn").onclick = () => {
				const combined = answerQrParts.join(",");
				shareOrCopy(combined, "Réponse babyphone (toutes les parties)");
			};

			setStatus(`${answerQrParts.length} QR codes prêts — faites-les scanner un par un par l'Émetteur.`);
		} else if (isAuto && compressedAnswer.length > 800) {
			// Auto mode with large data
			const autoParts = Math.ceil(compressedAnswer.length / 600);
			answerQrParts = splitData(compressedAnswer, autoParts);
			currentQrIndex = 0;
			updateQrDisplay();
			navDiv.classList.remove("hidden");
			navDiv.classList.add("visible-block");
			multiMsg.classList.remove("hidden");
			multiMsg.classList.add("visible-block");
			document.getElementById("shareAnswerBtn").onclick = () => {
				const combined = answerQrParts.join(",");
				shareOrCopy(combined, "Réponse babyphone (toutes les parties)");
			};
			setStatus(`${answerQrParts.length} QR codes générés automatiquement (données volumineuses).`);
		} else {
			// Single QR code (manual 1 or auto with small data)
			answerQrParts = [compressedAnswer];
			currentQrIndex = 0;
			updateQrDisplay();
			navDiv.classList.add("hidden");
			navDiv.classList.remove("visible-flex", "visible-block");
			multiMsg.classList.add("hidden");
			multiMsg.classList.remove("visible-block");
			document.getElementById("shareAnswerBtn").onclick = () => shareOrCopy(compressedAnswer, "Réponse babyphone");
			setStatus("QR code prêt — faites-le scanner par l'Émetteur.");
		}

		hide("scanOfferSection");
		show("scanOfferDoneSection");
		show("answerSection");
		openModal("answerQrModal");
		initQrSwipeSupport();
		setError("");
	} catch (e) {
		setError("Offre invalide : " + e.message);
	}
}

async function processAnswer() {
	const raw = document.getElementById("answerInput").value.trim();
	if (!raw) { setError("Veuillez coller la réponse."); return; }
	try {
		if (!peerConnection) {
			setError("Erreur : connexion non initialisée. Veuillez d'abord cliquer sur 'Démarrer'.");
			return;
		}
		let dataToProcess = raw;

		// Check if this is comma-separated partial QR codes
		if (raw.includes(',') && isPartialQr(raw.split(',')[0])) {
			const parts = raw.split(',').map(p => p.trim()).filter(p => p);
			dataToProcess = combineData(parts);
		}

		let answer;
		const fromUrl = await sdpFromUrl(dataToProcess);
		if (fromUrl) {
			answer = fromUrl;
		} else if (dataToProcess.includes('{')) {
			answer = JSON.parse(dataToProcess);
		} else {
			const json = await decompress(dataToProcess);
			answer = JSON.parse(json);
		}
		await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

		// Save connection data for quick reconnect (emitter side)
		if (peerConnection.localDescription) {
			saveConnectionData(peerConnection.localDescription, answer);
		}

		// Reset partial scan status after successful connection
		resetPartialScans();

		closeModal("scanAnswerModal");
		hide("offerSection");
		show("offerDoneSection");
		setStatus("Connexion en cours… En attente de l'audio.");
		setError("");
	} catch (e) {
		setError("Réponse invalide : " + e.message);
	}
}

function showPlayButton() {
	const btn = document.getElementById("playAudioBtn");
	btn.classList.remove("hidden");
	btn.onclick = () => {
		remoteAudio.play().then(() => {
			btn.classList.add("hidden");
			setStatus("Audio actif !");
		});
	};
}

async function startScanOffer() {
	if (isScanningOffer) return;
	const readerElement = document.getElementById("reader");
	if (!readerElement) {
		setError("Erreur : élément vidéo introuvable");
		return;
	}
	try {
		// Ensure video element is clean and ready
		readerElement.removeAttribute('src');
		readerElement.setAttribute('playsinline', '');

		qrScannerOffer = new QrScanner(
			readerElement,
			async (result) => {
				console.log("QR scanné:", result.data);
				const decodedText = result.data;
				const pageUrl = location.href.split("#")[0];
				if (decodedText === pageUrl) {
					setStatus("❌ Mauvais QR code ! Vous avez scanné le QR de partage de page. Scannez le QR code de l'Émetteur.");
					showToast("Mauvais QR code — scannez celui de l'Émetteur");
					return;
				}

				// Check if this is a partial QR code
				if (isPartialQr(decodedText)) {
					const scanResult = handlePartialScan(decodedText);
					if (scanResult === "pending") {
						// Keep scanning for more parts
						return;
					} else if (scanResult && scanResult !== true) {
						// We have all parts, reconstruct the URL
						await stopScanOffer();
						closeModal("scanOfferModal");
						const fullUrl = pageUrl + "#sdp=" + scanResult;
						try {
							const offer = await sdpFromUrl(fullUrl);
							if (offer) {
								await processIncomingOffer(offer);
								setStatus("QR codes scannés ! Connexion en cours...");
							} else {
								setError("QR code invalide.");
								show("scanOfferSection");
								openModal("scanOfferModal");
							}
						} catch (e) {
							setError("Erreur lors du scan : " + e.message);
							show("scanOfferSection");
							openModal("scanOfferModal");
						}
					}
					return;
				}

				// Check if this is a URL with sdp
				if (!decodedText.includes("#sdp=")) {
					setStatus("❌ Mauvais QR code ! Scannez le QR code de l'Émetteur.");
					showToast("QR code invalide — réessayez");
					return;
				}

				await stopScanOffer();
				closeModal("scanOfferModal");
				try {
					const offer = await sdpFromUrl(decodedText);
					if (offer) {
						await processIncomingOffer(offer);
						setStatus("QR code scanné ! Connexion en cours...");
					} else {
						setError("QR code invalide.");
						show("scanOfferSection");
						openModal("scanOfferModal");
					}
				} catch (e) {
					setError("Erreur lors du scan : " + e.message);
					show("scanOfferSection");
					openModal("scanOfferModal");
				}
			},
			{
				returnDetailedScanResult: true,
				highlightScanRegion: true,
				highlightCodeOutline: true,
			}
		);
		await qrScannerOffer.start();
		isScanningOffer = true;
		setStatus("Scanner actif — pointez vers le QR de l'Émetteur");
	} catch (e) {
		setError("Impossible d'accéder à la caméra : " + e.message);
	}
}

async function stopScanOffer() {
	if (!isScanningOffer || !qrScannerOffer) return;
	try {
		await qrScannerOffer.stop();
		qrScannerOffer.destroy();
	} catch (e) { }
	qrScannerOffer = null;
	isScanningOffer = false;
}

async function startScanAnswer() {
	if (isScanningAnswer) return;
	const readerElement = document.getElementById("readerAnswer");
	if (!readerElement) {
		setError("Erreur : élément vidéo introuvable");
		return;
	}
	try {
		// Ensure video element is clean and ready
		readerElement.removeAttribute('src');
		readerElement.setAttribute('playsinline', '');

		qrScannerAnswer = new QrScanner(
			readerElement,
			async (result) => {
				const decodedText = result.data;
				// Check if this is a partial QR code
				if (isPartialQr(decodedText)) {
					const scanResult = handlePartialScan(decodedText);
					if (scanResult === "pending") {
						// Keep scanning for more parts
						return;
					} else if (scanResult && scanResult !== true) {
						// We have all parts, use the combined data
						await stopScanAnswer();
						closeModal("scanAnswerModal");
						document.getElementById("answerInput").value = scanResult;
						await processAnswer();
					}
					return;
				}

				// Single QR code (not split)
				await stopScanAnswer();
				closeModal("scanAnswerModal");
				document.getElementById("answerInput").value = decodedText;
				await processAnswer();
			},
			{
				returnDetailedScanResult: true,
				highlightScanRegion: true,
				highlightCodeOutline: true,
			}
		);
		await qrScannerAnswer.start();
		isScanningAnswer = true;
		setStatus("Scanner actif — pointez vers le QR du Récepteur");
	} catch (e) {
		setError("Impossible d'accéder à la caméra : " + e.message);
	}
}

async function stopScanAnswer() {
	if (!isScanningAnswer || !qrScannerAnswer) return;
	try {
		await qrScannerAnswer.stop();
		qrScannerAnswer.destroy();
	} catch (e) { }
	qrScannerAnswer = null;
	isScanningAnswer = false;
}

function stopBabyphone() {
	isStarted = false;
	startBtn.disabled = false;
	stopBtn.disabled = true;
	roleSelect.disabled = false;
	document.getElementById("playAudioBtn").classList.add("hidden");

	// Reset mute button
	isMuted = true;
	remoteAudio.muted = isMuted;
	muteBtn.classList.add("hidden");
	muteBtn.classList.remove("muted");
	muteBtn.textContent = "🔊 Activer le son";

	// Reset mute mic button
	isMicMuted = false;
	muteMicBtn.classList.add("hidden");
	muteMicBtn.classList.remove("muted");
	muteMicBtn.textContent = "🎤 Micro activé";

	stopVuMeter();
	stopHeartbeat();
	clearAutoReconnect();
	if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
	if (peerConnection) { peerConnection.close(); peerConnection = null; }
	remoteAudio.srcObject = null;
	if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
	stopSilentAudio();

	// Reset QR splitting state
	answerQrParts = [];
	currentQrIndex = 0;
	offerQrParts = [];
	currentOfferQrIndex = 0;
	resetPartialScans();
	document.getElementById("qrNavigation").classList.add("hidden");
	document.getElementById("qrNavigation").classList.remove("visible-flex", "visible-block");
	document.getElementById("offerQrNavigation").classList.add("hidden");
	document.getElementById("offerQrNavigation").classList.remove("visible-flex", "visible-block");

	// Close all modals
	closeModal("offerQrModal");
	closeModal("scanOfferModal");
	closeModal("answerQrModal");
	closeModal("scanAnswerModal");

	["offerSection", "scanOfferSection", "answerSection", "pasteAnswerSection"].forEach(hide);
	setStatus("Arrêté");
}