# FreeBabyPhoneJs — Description

A minimalist, **server-less baby monitor** that turns two phones (or any two devices with a modern browser) into a one-way audio link. The whole application is just three static files (`index.html`, `script.js`, `style.css`) deployed via GitHub Pages — no backend, no account, no install.

## What the app does

- **One-way audio streaming** over **WebRTC** between two roles:
  - **Émetteur** (Emitter) — placed near the baby; captures the microphone and streams audio.
  - **Récepteur** (Receiver) — the parent's phone; plays the remote audio.
- **No signaling server.** The WebRTC SDP offer/answer is exchanged manually:
  1. Emitter generates an offer → displays it as a **QR code** (or shareable link).
  2. Receiver scans the QR (via the in-page camera scanner) → generates the answer → displays it as a QR.
  3. Emitter scans the answer QR → connection is established.
- **STUN-only** ICE configuration (`stun:stun.l.google.com:19302`). No TURN server, so traversal relies on direct/peer-reflexive candidates → works best on the **same local network**.
- **SDP compression** with `CompressionStream("deflate-raw")` + URL-safe base64 to keep QR codes scannable.
- **Multi-QR splitting** (auto / 1–4 parts) when SDPs are too large for a single QR; the receiver/emitter scans them sequentially with progress tracking.
- **Fallback link sharing** via `navigator.share` / clipboard / manual paste in a `textarea`.
- **Quick reconnect**: last SDPs are cached in `localStorage` for 10 minutes to skip the QR dance after a brief disconnect.
- **Auto-start receiver** if the page is opened with `#sdp=…` in the URL (works as a shareable invite link).

## Mobile / Chrome constraints handled

The app actively fights mobile browser power-saving behavior that would otherwise cut the audio:

- **Screen Wake Lock API** (`navigator.wakeLock.request("screen")`) to prevent the screen (and audio pipeline) from being suspended; re-acquired on `visibilitychange`.
- **Silent `AudioContext` oscillator** (gain ≈ 0.001) kept running to prevent the audio context from being suspended when the page is backgrounded; resumed on visibility change.
- **Heartbeat** every 10 s to: resume the audio context, re-enable mic tracks, and log peer connection stats.
- **Visibility listener** re-arms wake lock, audio context and mic track each time the page comes back to the foreground.
- **Microphone constraints disabled** (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`) to keep faint baby sounds audible.
- **`autoplay playsinline`** on the `<audio>` element + an explicit "▶ Activer l'audio" button when the browser blocks autoplay (mobile Chrome/Safari gesture requirement).
- **Receiver starts muted** with a visible unmute button so the user explicitly grants the audio gesture.
- **HTTPS warning** when opened from `file://` (Chrome refuses `getUserMedia` outside secure contexts).
- **Mobile-first UI**: large touch targets, `viewport` with `user-scalable=no`, modal-based QR display sized to the screen, swipe gestures to navigate multi-QR sequences.
- **VU-meter** so the user can verify the mic is actually picking up sound before leaving the room.

## Deployment

- Static hosting only — published via **GitHub Pages** through `.github/workflows/deploy.yml`.
- The workflow injects the commit hash and date into the page footer via `sed` substitution at build time.
- A "Share this tool" QR code at the bottom encodes the page URL itself, to bootstrap the second device.

## Limitations

### Networking
- **No TURN server** → if both peers are not reachable directly (different NATs, symmetric NAT, mobile carrier CGNAT, restrictive Wi-Fi), the connection will simply fail. Designed for **same-LAN** use.
- **No signaling server** → every (re)connection requires a QR scan or a manually shared link. There is no "always-on" pairing.
- **Quick-reconnect cache expires after 10 minutes** and only works if the previously negotiated ICE candidates are still valid (same network, same IPs).

### Browser / platform
- Requires **HTTPS** (or `localhost`) — opening the file directly does nothing on mobile.
- Relies on relatively recent browser APIs: `CompressionStream`, `wakeLock`, `RTCPeerConnection`, `MediaDevices.getUserMedia`, `BarcodeDetector`/`qr-scanner`. **Mobile Chrome / modern Android** is the main target; **iOS Safari** support is partial (Wake Lock is recent, autoplay rules are stricter, and `CompressionStream` requires iOS 16.4+).
- The Wake Lock can still be released by the OS under aggressive battery saving; there is **no guarantee the screen stays on for hours**.
- If the OS kills the tab in the background (Android Doze, low-memory kill, switching to another app for too long), the connection drops and must be re-established manually.
- Phone calls, Bluetooth audio routing changes, or the browser losing focus may suspend the audio pipeline despite the silent-oscillator workaround.

### Audio
- **One-way audio only** — no talk-back to the baby, no video, no recording.
- No noise gate, no AGC, no compression — raw mic feed (intentional, for sensitivity).
- No volume / sensitivity threshold alert (no "cry detection"), no notification when sound exceeds a level.

### UX / pairing
- Pairing requires a **functional rear camera** on at least one device to scan QR codes (manual link paste is the fallback).
- Large SDPs (lots of ICE candidates) may need to be split into 2–4 QR codes, which the user must scan sequentially.
- UI is **French only**.
- No persistent device identity / pairing — every fresh start needs a new handshake (unless the 10-min reconnect cache is valid).

### Security / privacy
- The signaling payload is exchanged out-of-band (QR / link) — anyone who sees the QR can theoretically connect; usage assumes physical proximity / trust.
- The audio stream itself is end-to-end encrypted by WebRTC (DTLS-SRTP), but there is no authentication beyond the shared SDP.
- Uses Google's public STUN server (`stun.l.google.com:19302`); no telemetry of audio content, but STUN binding requests reach Google.

### Maintenance / robustness
- All state lives in a single `script.js` (~1500 lines) — no build step, no tests, no module system.
- No automatic recovery if the peer connection enters `failed` state outside of the quick-reconnect path; the user must press **Arrêter** then **Démarrer** again.
