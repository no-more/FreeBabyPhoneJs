# Improvement plan

> Constraints for every item below:
> - **Zero cost**: no backend, no paid services, no external API key.
> - **Zero-maintenance**: static hosting only (GitHub Pages today). Nothing that would require a server to run.
> - **No new runtime dependency** unless it can be vendored as a single static file.
>
> This document is meant to be executed **one step at a time by an AI agent**.
> Each step is self-contained: it states *why*, *where*, *how*, and *when it is done*.
> Pick any step, do it, open a PR, move on. Do **not** mix multiple steps in one PR unless explicitly noted.

## Conventions for the agent

- Always run `node --check script.js` after editing JS, and a browser smoke test if Playwright is available.
- Never introduce a build step. The site must remain 3+ static files served as-is.
- Never introduce a framework (React, Vue, etc.) — keep vanilla JS.
- French is the default UI language; all new strings must be added in French, and also in the i18n dictionary if step 9 has been done.
- Bump `CACHE` in `sw.js` (`babyphone-shell-vN`) **every time** you modify `index.html`, `script.js`, `style.css`, or the manifest; otherwise deployed clients will not pick up the change.
- Keep `script.js` comment-free unless asked; follow the existing minimalist style.

---

## Step 1 — Cry / sound detection with local alert

**Priority: HIGH · Effort: M · Risk: Low**

### Why
This is the #1 feature users expect from a babyphone. Everything is done client-side on the receiver so there is no cost.

### Where
- `script.js` (new module-like section near `startVuMeter`).
- `index.html`: add a settings panel (threshold slider, on/off switch) in the receiver UI block.
- `style.css`: styles for the alert banner + settings row.
- `sw.js`: already present, used to fire a `Notification` when the page is backgrounded.

### How
1. On the receiver, once `remoteAudio.srcObject` is set, tap into it with an `AnalyserNode` (the existing `startVuMeter` already does this — factor the `AnalyserNode` out so both VU meter and detection share it).
2. Compute a running RMS every 100 ms. Maintain a short rolling baseline (e.g. last 30 s) to auto-adapt to ambient noise.
3. Trigger an alert when `currentRMS > baseline * multiplier` **and** `currentRMS > absoluteFloor` for **at least N consecutive samples** (debounce; ~500 ms). Default: multiplier = 3.0, floor = 0.02, window = 5 samples. Expose both in UI.
4. Alert behavior:
   - Visible banner at top of the page (red pulsing).
   - `navigator.vibrate([400, 150, 400, 150, 400])` if available.
   - If `document.hidden === true` and `Notification.permission === 'granted'` → `new Notification("👶 Bruit détecté", { body: "…", silent: false, vibrate: [...] })`. Ask for permission on first session after the user toggles the feature on.
   - Temporarily **unmute** the remote `<audio>` (if the user had muted it) for a short window (configurable, default 10 s), then restore previous mute state.
5. Persist settings in `localStorage` under `LS_KEYS.CRY_SETTINGS`.

### Acceptance criteria
- Toggle visible only on the Receiver role.
- Alert fires within 1 s of a sustained loud sound; no false positive during 30 s of silence.
- Works with the tab in the background on Android (tested on a PWA install).
- Setting persists across reloads.
- No impact on audio playback latency.

---

## Step 2 — Vendor external CDN libraries (full offline)

**Priority: HIGH · Effort: S · Risk: Low**

### Why
Today `index.html` loads `qrcode-generator` and `qr-scanner` from cloudflare / jsdelivr. If the CDN is down or blocks the country, the app is broken. The PWA is also not truly offline on first install because these come from a different origin and the SW cannot cache opaque cross-origin responses reliably.

### Where
- New folder `vendor/` at repo root.
- `index.html` (swap `<script src>` URLs).
- `sw.js` (add vendored files to `SHELL`).

### How
1. Download the **exact pinned versions** currently referenced:
   - `qrcode-generator@1.4.4` → `vendor/qrcode.min.js`
   - `qr-scanner@1.4.2` → `vendor/qr-scanner.umd.min.js`
   - The QR scanner also ships a worker — download `qr-scanner-worker.min.js` alongside, and set `QrScanner.WORKER_PATH = './vendor/qr-scanner-worker.min.js'` before first use.
2. Update `<script src>` tags in `index.html` to point to the local files.
3. Add `./vendor/qrcode.min.js`, `./vendor/qr-scanner.umd.min.js`, `./vendor/qr-scanner-worker.min.js` to the `SHELL` array in `sw.js`. Bump `CACHE` name.
4. Verify the license of both libraries allows redistribution (both are MIT) and drop a `vendor/LICENSES.md` listing them with links.

### Acceptance criteria
- Turning off network after first load, reload → app still works fully (including QR scan).
- No cross-origin script request in the Network tab.
- Cache version bumped.

---

## Step 3 — Connection quality indicator

**Priority: HIGH · Effort: S · Risk: Low**

### Why
Users currently have no visibility into whether the link is healthy. A visible pill (RTT + packet loss) lets them notice degradation before the connection fully drops.

### Where
- `script.js` (extend the existing heartbeat in `startHeartbeat`).
- `index.html`: new `<div id="connQuality" class="hidden"></div>` in the status area.
- `style.css`: pill styles + color thresholds (green/amber/red).

### How
1. Every 5 s (replacing the 10 s stats call), call `pc.getStats()` and aggregate the latest `candidate-pair` where `state === 'succeeded' && nominated === true`:
   - `currentRoundTripTime` (seconds).
   - Combined `bytesReceived` + `bytesSent` delta for a rough throughput.
2. Also read `inbound-rtp` (audio): `packetsLost`, `packetsReceived`, `jitter`. Compute loss % over the delta since last call.
3. Update the pill:
   - `<50 ms RTT && <1% loss` → green "Bon signal"
   - `<200 ms && <5% loss` → amber "Signal moyen"
   - else → red "Signal faible"
4. Hide the pill when not `connected`.

### Acceptance criteria
- Pill updates live, no audio hitching.
- Values look sane on the same Wi-Fi (~1–20 ms RTT, ~0% loss).

---

## Step 4 — Session passcode (QR tampering protection)

**Priority: HIGH · Effort: M · Risk: Low**

### Why
Anyone who photographs the QR code while it is displayed can connect to the emitter. Adding a 4-digit PIN chosen by the user and mixed into the payload prevents casual eavesdropping without any server.

### Where
- `script.js`: new helpers `encryptSdp(obj, pin)` / `decryptSdp(payload, pin)` based on `SubtleCrypto` AES-GCM with a PIN-derived key (PBKDF2).
- `index.html`: add a PIN input (4 digits, numeric) next to the role selector, stored in `localStorage`.
- Both emitter and receiver must enter the same PIN. Default: empty (= no encryption, backward-compatible) until the user opts in.

### How
1. Key derivation:
   ```js
   const salt = new TextEncoder().encode('babyphone-v1'); // static salt is OK, PIN is low-entropy anyway
   const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
   const key = await crypto.subtle.deriveKey(
     { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
     baseKey,
     { name: 'AES-GCM', length: 256 },
     false, ['encrypt', 'decrypt']
   );
   ```
2. `encryptSdp`: generate 12-byte random IV, AES-GCM encrypt JSON, output `iv || ciphertext` as base64url.
3. Wrap `compress`/`decompress`: if PIN is set, encrypt **after** compression, decrypt **before** decompression. Add a 1-byte prefix (`0x01`) to distinguish encrypted payloads from the current plain ones so old pairings still work.
4. Show a friendly error on decrypt failure: "PIN incorrect ou QR corrompu".

### Acceptance criteria
- No PIN set → identical behavior to today.
- With PIN → QR codes are slightly larger but still fit; wrong PIN on receiver → clean error message, not a crash.
- PIN persisted per device.

---

## Step 5 — Data channel keep-alive + RTP watchdog

**Priority: MED · Effort: S · Risk: Low**

### Why
`iceConnectionState` transitions can lag reality by 15–30 s. A 2 s ping over an `RTCDataChannel` + monitoring that `inbound-rtp.packetsReceived` is still growing detects dead links much faster and triggers `attemptAutoRecover` immediately. Also keeps NAT mappings warm during long silences.

### Where
- `script.js`: in `startBabyphone` and `startQuickReconnect`, after `peerConnection = await newPeerConnection()`.

### How
1. Emitter creates an ordered data channel: `const dc = pc.createDataChannel('keepalive', { ordered: true });`. Receiver handles `pc.ondatachannel`.
2. Send `{ t: Date.now() }` every 2 s. On receive, the other side echoes it back. Track last-echo time.
3. If `Date.now() - lastEcho > 8000` **or** `inbound-rtp.packetsReceived` has not increased over 3 consecutive `getStats` polls → `attemptAutoRecover('keepalive-stall')`.
4. Clean up the timer/channel in `stopBabyphone`.

### Acceptance criteria
- `pc.getStats` shows an active data channel once connected.
- Pulling the Wi-Fi on the receiver for 10 s → emitter triggers recovery within ~10 s (vs. current ~30 s).

---

## Step 6 — Dim / "night mode" screen for the emitter

**Priority: MED · Effort: S · Risk: Low**

### Why
The emitter lives in the baby's room with Wake Lock on → bright screen all night. A dimmed mode (near-black page with a tiny heartbeat dot) cuts light pollution dramatically.

### Where
- `index.html`: a toggle button "🌙 Mode nuit" only visible when role is *Émetteur* and connection is established.
- `style.css`: new `body.night-mode { background: #000; color: #000; }` plus a small centered pulsing `#nightBeacon` dot (red, 6 px, 2 s pulse).
- `script.js`: click handler toggles the class, persists in `localStorage`. Tapping the screen exits night mode (add a capture-phase click listener while active).

### Acceptance criteria
- Entering night mode hides the VU meter and all text, shows only a tiny animated dot.
- Any tap returns to the normal UI.
- Wake Lock stays active.

---

## Step 7 — Manifest shortcuts (direct-launch role)

**Priority: MED · Effort: S · Risk: Low**

### Why
Long-pressing the installed PWA icon on Android can offer shortcuts like "Démarrer comme Émetteur" / "Démarrer comme Récepteur". One less click in the happy path.

### Where
- `manifest.webmanifest`: add a `"shortcuts"` array.
- `script.js`: read a URL parameter (e.g. `?role=emetteur`) on load, auto-select the role, auto-trigger `startBabyphone()` if a cached pairing does not already exist.

### How
```json
"shortcuts": [
  { "name": "Émetteur", "short_name": "Émetteur", "url": "./?role=emetteur", "icons": [{ "src": "icon.svg", "sizes": "any" }] },
  { "name": "Récepteur", "short_name": "Récepteur", "url": "./?role=recepteur", "icons": [{ "src": "icon.svg", "sizes": "any" }] }
]
```

### Acceptance criteria
- Long-press the installed PWA icon → two shortcuts visible.
- Each shortcut lands on the app with the correct role pre-selected and started.

---

## Step 8 — Local notification when the connection is lost

**Priority: MED · Effort: S · Risk: Low**

### Why
If the connection drops while the parents are in another room, they must not discover it 20 min later. A local notification (no push server required) triggered from the page via the SW closes that gap.

### Where
- `script.js`: inside `attemptAutoRecover`, when `autoReconnectAttempts >= AUTO_RECONNECT_MAX_ATTEMPTS` with no recovery.
- `sw.js`: handle a `message` event of type `notify-disconnect` and call `self.registration.showNotification(...)`.

### How
1. On first start of the Receiver, request `Notification.requestPermission()` once (with a clear UI prompt "Autoriser les alertes de déconnexion").
2. When recovery attempts are exhausted, `navigator.serviceWorker.controller.postMessage({ type: 'notify-disconnect' })`.
3. SW shows `"⚠️ Babyphone déconnecté"` with `requireInteraction: true`, vibrate, and a click handler that focuses the window.

### Acceptance criteria
- Kill the emitter's Wi-Fi for 60 s → receiver displays an OS notification even when the tab is in the background.
- Permission prompt never shown more than once per browser profile.

---

## Step 9 — i18n (fr / en / es)

**Priority: MED · Effort: M · Risk: Low**

### Why
Broadens reach. Fully client-side, adds ~1 KB.

### Where
- New file `i18n.js` (static module loaded from `index.html` before `script.js`).
- `index.html`: add `data-i18n` attributes on every user-facing text node.
- `script.js`: replace hard-coded strings passing through `setStatus`/`setError`/`showToast` by lookup `t('statusReady')`.

### How
1. `const dict = { fr: {...}, en: {...}, es: {...} };` with ~60 keys.
2. `function t(key, ...args) { const s = (dict[lang] || dict.fr)[key] || key; return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => args[i]) : s; }`
3. Language detection: `localStorage.getItem('lang')` → `navigator.language.split('-')[0]` → `'fr'`.
4. Add a small language picker in the header.

### Acceptance criteria
- Switching language updates every visible string without reloading.
- All three locales have 100% coverage (no fallback to key shown).

---

## Step 10 — Automated test harness (Playwright)

**Priority: MED · Effort: M · Risk: Low**

### Why
The app has zero tests today and touches fragile browser APIs. Playwright in GitHub Actions is free for public repos and can drive two browser contexts, paste offer→answer between them via shared storage, and assert audio flow via `getStats`.

### Where
- New `tests/` folder with Playwright config + specs.
- New workflow `.github/workflows/test.yml`.
- Add dev dependency in `package.json` (create it if missing, keep it minimal — no runtime deps).

### How
1. `npx playwright install --with-deps chromium`.
2. Test 1: open two pages, simulate the full QR flow by intercepting the compressed offer/answer via `page.evaluate` (read `#offerQr` canvas data URL, feed the QR text back into the other page's `answerInput`).
3. Test 2: verify quick-reconnect path by storing `babyphoneLastConnection` manually and reopening.
4. Test 3: verify auto-fallback when cached SDPs are garbage (watchdog must fire).

### Acceptance criteria
- `npm test` passes locally and in CI.
- All three scenarios green.
- No browser downloaded at install time in the shipped app (only in CI).

---

## Step 11 — Refactor `script.js` into ES modules

**Priority: LOW · Effort: L · Risk: Med**

### Why
Currently ~1700 lines in a single file. Splitting by concern makes steps 1/5/9/10 easier. No build step: use native `<script type="module">`.

### Where
- Split into: `src/signaling.js`, `src/qr.js`, `src/webrtc.js`, `src/ui.js`, `src/storage.js`, `src/keepalive.js`, `src/cry-detect.js`, `src/main.js`.
- `index.html`: replace the single `<script src="script.js">` by `<script type="module" src="src/main.js">`.

### How
- Extract by topic with a single-file-per-concern rule. Keep the external API of `startBabyphone`/`stopBabyphone` identical.
- Module must still be usable directly from `file://` on localhost **or** behind the SW.
- Bump SW cache, add new files to `SHELL`.

### Acceptance criteria
- No behavioral change; all features still work.
- Each module < 400 lines.
- The Playwright suite from step 10 still passes unchanged.

---

## Step 12 — Dark mode

**Priority: LOW · Effort: S · Risk: Low**

### Why
Polish. Also reduces light when looking at the receiver at night.

### Where
- `style.css`: a `@media (prefers-color-scheme: dark)` block overriding the main palette.
- `index.html`: update `<meta name="theme-color">` to switch via `media="(prefers-color-scheme: dark)"` duplicate tag.

### Acceptance criteria
- No color contrast < 4.5:1 in dark mode.
- Modal and QR codes remain readable (QR must keep black-on-white).

---

## Step 13 — Manifest / icon polish

**Priority: LOW · Effort: S · Risk: Low**

### Why
Installed PWA looks rough. Quick wins: dedicated maskable icon with proper safe zone, proper screenshot for install prompts, categories.

### Where
- `manifest.webmanifest`.
- `icon-maskable.svg` (already exists; verify safe zone).

### How
1. Add `"screenshots"`, `"categories": ["utilities", "medical"]`, `"description"`, `"id": "/"`.
2. Generate a PNG fallback (512 and 192) alongside the SVG for iOS / older Android compatibility.
3. Add `apple-touch-icon.png` 180×180.

### Acceptance criteria
- Chrome "Install" prompt shows the screenshot.
- Lighthouse PWA audit: 100%.

---

## Step 14 — Lighthouse + Accessibility audit

**Priority: LOW · Effort: S · Risk: Low**

### Why
Cheap quality gate. Fixing accessibility (ARIA labels on buttons, form labels) costs little and helps real users.

### Where
- `index.html`: audit every `<button>`, `<input>`, `<select>` for missing labels / titles.
- `.github/workflows/`: optional Lighthouse CI action on PRs.

### Acceptance criteria
- Lighthouse ≥ 95 on Performance, Accessibility, Best Practices, SEO, PWA.
- `axe-core` via Playwright reports zero violations.

---

## Step 15 — Two-way push-to-talk (optional, gated)

**Priority: LOW · Effort: L · Risk: Med**

### Why
Lets the parents briefly speak to the baby (e.g. to soothe). Opt-in, off by default so the current one-way trust model is preserved.

### Where
- `script.js`: add `navigator.mediaDevices.getUserMedia` on the receiver when the user taps-and-holds a new "🎙️ Parler" button. Add the track to the existing `peerConnection` via `pc.addTrack()`. Requires renegotiation → triggers fresh offer/answer, which cannot happen without a signaling channel in the current design.
- **Alternative without renegotiation**: plan the connection as bi-directional from the start (emitter adds a `recvonly` transceiver for the reverse direction; receiver adds a `sendonly` transceiver). This only requires adjusting `createOffer` / `createAnswer` options.

### How
1. On the **emitter**: `pc.addTransceiver('audio', { direction: 'recvonly' })` before creating the offer.
2. On the **receiver**: when the user presses the talk button, obtain a mic stream and `transceiver.sender.replaceTrack(micTrack)`. On release, `replaceTrack(null)`.
3. Gate behind a settings toggle; default off.
4. Explain the privacy implication in UI: "l'émetteur pourra jouer votre voix".

### Acceptance criteria
- With toggle off → behavior identical to today.
- With toggle on → pressing the button plays the parent's voice on the emitter's speaker within ~500 ms of press.

---

## Execution order recommendation

Suggested order for an agent picking items off this plan:

1. **Step 2** (vendor libs) — everything else becomes truly offline.
2. **Step 3** (quality pill) — fastest visible improvement.
3. **Step 5** (keep-alive) — hardens step 1 and step 8.
4. **Step 1** (cry detection) — biggest feature delta.
5. **Step 8** (disconnect notification) — depends on step 5.
6. **Step 6** (night mode) — quick polish for real usage.
7. **Step 4** (PIN) — once core UX is stable.
8. **Step 7** (shortcuts) — small UX win.
9. **Step 10** (Playwright tests) — lock in the behavior.
10. **Step 11** (module split) — easier once tests exist.
11. **Step 9** (i18n) — after refactor.
12. **Step 12 / 13 / 14** — polish pass.
13. **Step 15** — optional, consider only if there is user demand.

Each step should land as its own PR, with the SW cache version bumped and a line added to a `CHANGELOG.md` (create it on the first PR).
