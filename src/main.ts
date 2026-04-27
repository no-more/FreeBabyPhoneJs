import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { isDevMode } from '@angular/core';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

// Register service worker in production (skip during tests)
if ('serviceWorker' in navigator && !isDevMode()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/ngsw-worker.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

// Request persistent storage on supported browsers
if ('storage' in navigator && 'persist' in navigator.storage) {
  void navigator.storage.persist().then((granted) => {
    if (granted) {
      console.log('Persistent storage granted');
    }
  });
}

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
  ],
});
