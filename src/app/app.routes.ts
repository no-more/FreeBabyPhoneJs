import type { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		pathMatch: 'full',
		loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
	},
	{
		path: 'emitter',
		loadComponent: () => import('./pages/emitter/emitter.page').then((m) => m.EmitterPage),
	},
	{
		path: 'receiver',
		loadComponent: () => import('./pages/receiver/receiver.page').then((m) => m.ReceiverPage),
	},
	{
		path: 'emitter/settings',
		loadComponent: () => import('./pages/emitter/emitter-settings.page').then((m) => m.EmitterSettingsPage),
	},
	{
		path: 'receiver/settings',
		loadComponent: () => import('./pages/receiver/receiver-settings.page').then((m) => m.ReceiverSettingsPage),
	},
	{ path: '**', redirectTo: '' },
];
