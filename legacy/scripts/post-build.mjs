// Copies the compiled service worker from dist/ to the site root so its
// registration scope covers the whole app (GitHub Pages cannot set the
// Service-Worker-Allowed header, so the SW file must sit at the scope root).
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const src = resolve(root, 'dist', 'sw.js');
const dst = resolve(root, 'sw.js');

if (!existsSync(src)) {
  console.error(`[post-build] Missing ${src}. Did tsc run?`);
  process.exit(1);
}

copyFileSync(src, dst);
console.log(`[post-build] Copied ${src} -> ${dst}`);
