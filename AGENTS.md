# Agent instructions — remaining work on the Angular/Ionic rewrite

This file is written **for an autonomous coding agent** (Cascade or similar)
resuming work on the rewrite. It assumes the agent can read files, run
shell commands, make git commits and use `ng` / `ionic` CLI.

Keep the spirit of the rest of the project: small focused commits,
conventional commit messages in English, French user-facing copy, tight
bundles, standalone Angular components, signals + OnPush, Angular 17+
control flow (`@if` / `@switch`).

---

## 0. Current state (as of last commit)

- Node: **24** (via `nvm use --lts`). Build runs with `npm run build`.
  If your shell is not NVM-sourced, prefix with:
  `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use --lts >/dev/null 2>&1; npm run build'`.
- The two pages work end-to-end (manual offer QR ↔ answer QR handshake,
  audio plays on the receiver).
- Legacy (vanilla TS) reference implementation lives in `legacy/` and
  is the source of truth for behaviours not yet ported.

## 1. Ground rules

1. **Do not touch `legacy/`** except to read it. It is frozen reference
   code.
2. **Never weaken tests.** There are no tests yet; when you add logic,
   add a Karma spec alongside (`*.spec.ts`).
3. **Pure logic → pure TS modules** under `src/app/core/**`. Angular
   services only for stateful orchestration or DOM / browser API
   access.
4. **Signals over RxJS** for local UI state; only reach for RxJS if a
   stream (e.g. stats pipeline) genuinely calls for it.
5. **French UI copy** to match the legacy app. Error messages too.
6. **Wire-compatibility with legacy** must stay intact for the SDP
   codec (see `core/signaling/sdp-codec.ts`). A v2 device must be able
   to pair with a v1 device.
7. Prefer `ng generate` / `ionic g` to scaffold new components, pages
   and services so filenames + Angular conventions are correct.
   Example: `npx ng g service core/media/wake-lock --flat=false`.
8. **Commit message style:** `<type>(<scope>): <short imperative>`
   followed by a body explaining why + what. Types used so far:
   `feat`, `chore`, `fix`. Scopes used: `home`, `emitter`, `receiver`,
   `signaling`, `webrtc`, `shared`, `pwa`, `ci`.

## 2. Architecture recap

```
src/app/
  core/
    media/        mic.service.ts
    signaling/    sdp-codec.ts, qr-parts.ts, qr-draw.ts
    storage/      preferences.service.ts
    webrtc/       peer-connection.service.ts, certificate.service.ts
    models.ts
  pages/
    home/         role selection
    emitter/      role=emitter full flow
    receiver/     role=receiver full flow
  shared/
    components/
      qr-display/
      qr-scanner/
  app.component.ts, app.routes.ts
```

## 3. Remaining work — one commit per bullet

For **every** task below:
- Read the cited legacy line range first.
- Prefer to create a dedicated Angular service (DI, testable) rather
  than scattering logic into pages.
- Run `npm run build` and `npm run typecheck` after each change.
- Write a regression spec if non-trivial.

### 3.1 Wake lock service

**Goal:** keep the screen from sleeping while a session is active on
both sides; gracefully re-request on visibilitychange.

**Legacy reference:**
- `legacy/src/main.ts:419-499` — `requestWakeLock()`, `reRequestWakeLock()`, `releaseWakeLock()`
- `legacy/src/main.ts:364-416` — `visibilitychange` handler

**Plan:**
- `src/app/core/media/wake-lock.service.ts` with `acquire()`, `release()`,
  auto re-acquire on `visibilitychange: visible`.
- Inject into both `EmitterPage` and `ReceiverPage`; call `acquire()`
  on entering the `connected` phase, `release()` on teardown.

**Caveats / pits:**
- `navigator.wakeLock` is undefined on iOS Safari < 16.4; guard with
  `'wakeLock' in navigator`.
- `wakeLock.request('screen')` **throws** if the page is not visible
  — catch and swallow. Browsers also auto-release the sentinel when
  the tab is backgrounded; hence the visibility re-arm.
- Do NOT hold a wake lock from `HomePage`; only while actively
  streaming or listening.

### 3.2 Silent audio keepalive

**Goal:** on the **emitter** side (and arguably the receiver too), play
an imperceptibly silent looped audio element so mobile browsers keep
the tab at a higher background priority and don't throttle the
WebRTC send rate when the screen is off.

**Legacy reference:** `legacy/src/main.ts:501-565` (`startSilentAudio`,
`stopSilentAudio`).

**Plan:**
- `src/app/core/media/audio-keepalive.service.ts`.
- Build a tiny silent WAV once (bytes are hard-coded in the legacy
  file — don't bloat the bundle with an imported asset).
- Service exposes `start()` / `stop()`. Uses a real `<audio>` element
  and, as a fallback, a muted `AudioContext` + oscillator (legacy
  does both in a specific order — respect it).

**Caveats:**
- Must call `start()` from inside a user-gesture handler (same
  constraints as `audio.play()`); otherwise iOS rejects.
- The `AudioContext` must be resumed on `visibilitychange: visible`
  because iOS suspends it when the app is backgrounded.
- Do NOT start the keepalive on the role-selection landing page.

### 3.3 Connection heartbeat + auto-recovery watchdog

**Goal:** detect silent link failures (PC stays at `connecting` or
transitions to `failed` after a network change) and attempt up to N
quick reconnects before giving up and asking the user to re-pair.

**Legacy reference:**
- `legacy/src/main.ts:567-614` — `startHeartbeat`, `stopHeartbeat`
- `legacy/src/main.ts:616-686` — `attachConnectionStateRecovery`, `attemptAutoRecover`
- Constants: `AUTO_RECONNECT_MAX_ATTEMPTS = 5`,
  `QUICK_RECONNECT_TIMEOUT_MS = 10000`

**Plan:**
- Extract as `src/app/core/webrtc/reconnect.service.ts`.
- Consumes an `RTCPeerConnection` + cached SDPs (see 3.4); no UI
  coupling.
- Emits status via a signal (e.g. `status = 'stable' | 'reconnecting' | 'gave-up'`).
- Pages observe the signal to switch to a `'reconnecting'` phase (show
  a spinner + "Tentative de reconnexion…" copy) and to a
  `'failed'` phase on give-up.

**Caveats:**
- Backoff is linear in the legacy (1s, 2s, 3s …). Keep the same feel.
- Always **re-request a fresh offer** when reconnect attempt count
  exceeds `AUTO_RECONNECT_MAX_ATTEMPTS`; never retry forever.
- Clean up timers in `ngOnDestroy`.

### 3.4 Quick reconnect (cached SDP)

**Goal:** on the next launch, if we have a previously-successful SDP
pair in `localStorage`, **skip the QR flow** and try to re-establish
the link directly. Show a small "Reconnexion…" toast and fall back to
the QR flow on failure.

**Legacy reference:**
- `legacy/src/main.ts:134-167` — `LS_KEYS.LAST_CONNECTION`,
  `saveConnectionData`, `getLastConnectionData`, `clearLastConnection`
- `legacy/src/main.ts:1556-1560` — save on the receiver side
- `legacy/src/main.ts:1654-1657` — save on the emitter side
- `legacy/src/main.ts:24` — `QUICK_RECONNECT_TIMEOUT_MS = 10000`

**Plan:**
- `src/app/core/storage/quick-reconnect.service.ts` with
  `save(pairing: CachedPairing)`, `load(): CachedPairing | null`,
  `clear()`. `CachedPairing` is already declared in `core/models.ts`.
- Hook `save()` on the `connected` phase in both pages.
- On mount of emitter / receiver pages, attempt quick-reconnect
  **before** showing the idle CTA. Use a hard 10s watchdog; on
  timeout, close the PC, clear the cache, and drop to `idle`.
- **Certificate continuity** is already handled by
  `CertificateService` — do not create a new cert per session or
  cached SDPs become invalid.

**Caveats:**
- Do NOT restore from cache unless the stored role matches
  `PreferencesService.getRole()`.
- `RTCSessionDescriptionInit` is JSON-serialisable; no special
  handling needed.
- If this blows up in the wild, suspect a rotated DTLS cert; verify
  `navigator.storage.persist()` was granted (done in main.ts on the
  legacy side; we should add it to app bootstrap).

### 3.5 VU meter

**Goal:** visual feedback — a bar that reacts to local mic level on
the emitter, and to remote audio level on the receiver.

**Legacy reference:** `legacy/src/main.ts:688-710` (`startVuMeter`,
`stopVuMeter`).

**Plan:**
- `src/app/shared/components/vu-meter/vu-meter.component.ts`.
  Signal-based, `input() stream: MediaStream | null`.
- Internally runs `AnalyserNode.getByteFrequencyData` inside
  `requestAnimationFrame`, cancels on destroy.
- Both pages embed it in their `connected` state.

**Caveats:**
- Create the `AudioContext` on first user gesture to avoid iOS
  autoplay-policy errors. Use `new AudioContext()` only once per
  mount; reuse it if the stream changes.
- Stop the RAF loop in `ngOnDestroy` and close the context
  (`await ctx.close()`).
- Apply `aria-hidden="true"` — this is decorative.

### 3.6 PWA — manifest + service worker

**Goal:** installable PWA with offline app-shell cache; audio and
WebRTC streams are obviously live, but the UI + QR flow must load
offline once visited.

**Legacy reference:**
- `legacy/manifest.webmanifest`
- `legacy/src/sw.ts` (64 lines — take inspiration, don't copy verbatim)
- `legacy/icon.svg`, `legacy/icon-maskable.svg`

**Plan:**
- Use Angular's first-party support: `npx ng add @angular/service-worker`.
  This scaffolds `ngsw-config.json`, registers SW in `main.ts`, wires
  the manifest.
- Replace the Angular-generated manifest with one identical in intent
  to `legacy/manifest.webmanifest` (name = "Babyphone",
  `display: "standalone"`, `theme_color: "#1f2933"`, two icons).
- Copy the SVG icons from `legacy/` to `src/assets/icons/` (keep
  same filenames). Produce 192/512 PNGs if `@angular/service-worker`
  insists.

**Caveats:**
- The SW must **bypass** `/emitter` and `/receiver` dynamic chunks
  for the first navigation otherwise getUserMedia / camera
  permissions may race. The default `ngsw-config.json`
  `freshness` strategy for navigations is fine — keep it.
- Test on a real phone over HTTPS: SWs don't install on `http://` +
  non-localhost origins.
- Do NOT register the SW during `ng test`.

### 3.7 HTTPS / dev-server serving

**Goal:** allow `npm start` to serve over HTTPS on LAN so phones can
hit the dev server and use `getUserMedia` / camera.

**Plan:**
- Add an `ng serve --ssl --host 0.0.0.0` npm script (`start:lan`).
- Document in README with a note about self-signed cert warnings.

**Caveats:**
- `--ssl` uses a generated self-signed cert; phones will warn.
  Tell the user they may need to install a local CA (e.g. `mkcert`)
  or use `ngrok`.

### 3.8 CI — GitHub Actions

**Goal:** reproducible build + lint + typecheck + deploy to GH Pages
on push to `main`.

**Plan:**
- Replace / update `.github/workflows/deploy.yml`. Use
  `actions/setup-node@v4` with the `node-version-file: '.nvmrc'`
  option.
- Steps: checkout → setup-node → `npm ci` → `npm run lint` →
  `npm run typecheck` → `npm run build` → upload `www/` as
  Pages artifact → deploy.
- Use `peaceiris/actions-gh-pages` **or** the official
  `actions/deploy-pages@v4`.

**Caveats:**
- GH Pages serves from a subpath; rebuild with
  `ng build --base-href=/FreeBabyPhoneJs/` in CI.
- Ensure the manifest `start_url` matches the subpath.
- Cache `~/.npm` with `actions/cache` keyed by `package-lock.json`
  hash to keep CI < 2 minutes.

### 3.9 Tests

**Goal:** cover the pure signaling code and the quick-reconnect
service; at minimum.

**Plan:**
- `npm run test:ci` is already wired (`ng test --configuration ci --browsers=ChromeHeadless`).
- Specs to add:
  - `sdp-codec.spec.ts`: round-trip compress/decompress,
    `encodeSdp`/`decodeSdp`, `extractPayloadFromHash`.
  - `qr-parts.spec.ts`: `splitIntoParts` + `combineParts` round-trip;
    `QrPartsAssembler` reordering + dedupe; `autoSplit` threshold.
  - `quick-reconnect.service.spec.ts`: save / load / clear; role
    mismatch returns null.

**Caveats:**
- `CompressionStream` exists in Chrome and recent Firefox. Karma
  headless Chrome has it. If you need to run tests in environments
  without it, polyfill via `pako` (dev-dep only) — avoid in shipped
  code.
- Do not mock `RTCPeerConnection` broadly; keep reconnect tests as
  integration-style using the real API in a headless browser.

### 3.10 README

Write `README.md` at repo root with:
- What the app does (link to `legacy/DESCRIPTION.md` for the backstory).
- Dev setup (`nvm use`, `npm ci`, `npm start`, `npm run start:lan`).
- How to pair two devices (step-by-step with a screenshot placeholder).
- Build / deploy / test commands.
- Browser support matrix (Chromium ≥ 100, Safari iOS ≥ 16, Firefox
  desktop — `qr-scanner` requires `BarcodeDetector` fallback, check
  compatibility).
- License (MIT), heritage note pointing to `legacy/`.

## 4. Gotchas already encountered (don't repeat)

1. **`angular.json` schema:** the project uses the new
   `@angular-devkit/build-angular:application` builder. Valid
   option names are `browser`, `polyfills` (array), `outputPath`
   (string or `{base, browser}`). **Do not add `main`** — it is
   rejected by schema validation at build time.
2. **`qrcode-generator` is CommonJS.** It is already on the
   `allowedCommonJsDependencies` list in `angular.json`. If you add
   another CJS dep, add it to that list too.
3. **My `run_command` subshells don't auto-source NVM.** Always
   prefix long-running commands with the NVM bootstrap snippet in
   section 0, otherwise you'll hit `Node.js v18.19.1 detected. The
   Angular CLI requires a minimum Node.js version of v20.19`.
4. **`write_to_file` refuses existing files.** To replace a file,
   either `rm` it first (sequential, not parallel) or use `edit` /
   `multi_edit` on the existing content.
5. **Lint warning `Property progress is not allowed`** in
   `angular.json` at ~line 87 is a false positive from the IDE's
   stale JSON schema. The CLI accepts it. Ignore.
6. **`IonicModule` is not imported here by design.** Every page
   imports only the specific Ionic standalone components it uses
   (`IonButton`, `IonContent`, etc.). Do not regress to
   `IonicModule.forRoot()`.

## 5. Verification loop (do this after every commit)

```bash
bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use --lts >/dev/null'
npm run typecheck
npm run lint
npm run format:check
npm run build
# When tests exist:
npm run test:ci
```

Only commit if all five pass.

## 6. When in doubt

- Port behaviour literally from `legacy/` first; refactor for
  idiomatic Angular afterwards in a separate commit.
- Prefer the smallest possible diff. A good commit changes ≤ 200
  LOC, one concern.
- Ask the user for clarification only if an actual product decision
  is required (UX copy, UX flow). For anything code-mechanical,
  decide and move on.
