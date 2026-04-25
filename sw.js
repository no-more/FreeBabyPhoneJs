/* Babyphone service worker
 * Goals:
 *  - Make the app installable as a PWA (Android Chrome will then apply lighter
 *    background-throttling and let the screen-off "media playback" exemption work).
 *  - Allow offline reload after first visit (3 static files).
 *
 * Strategy: cache-first for the app shell, network-first fallback for everything else.
 */

const CACHE = 'babyphone-shell-v2';
const SHELL = [
	'./',
	'./index.html',
	'./script.js',
	'./style.css',
	'./manifest.webmanifest',
	'./icon.svg',
	'./icon-maskable.svg',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE)
			.then((cache) => cache.addAll(SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(
				keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
			))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	// Only handle same-origin requests; let the browser deal with CDN scripts.
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		caches.match(req).then((cached) => {
			const network = fetch(req)
				.then((resp) => {
					if (resp && resp.ok && resp.type === 'basic') {
						const copy = resp.clone();
						caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { });
					}
					return resp;
				})
				.catch(() => cached);
			return cached || network;
		})
	);
});
