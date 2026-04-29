import { bootstrapApplication } from '@angular/platform-browser';
import {
	RouteReuseStrategy,
	provideRouter,
	withPreloading,
	PreloadAllModules,
	withHashLocation,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

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
		provideRouter(routes, withPreloading(PreloadAllModules), withHashLocation()),
		provideServiceWorker('ngsw-worker.js', {
			enabled: !isDevMode(),
			registrationStrategy: 'registerWhenStable:30000',
		}),
	],
});
