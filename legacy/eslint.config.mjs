// ESLint v9 flat config
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
	{
		ignores: ['dist/**', 'node_modules/**', 'sw.js', '*.min.js'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				console: 'readonly',
				location: 'readonly',
				self: 'readonly',
				caches: 'readonly',
				fetch: 'readonly',
				URL: 'readonly',
				Blob: 'readonly',
				indexedDB: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				AudioContext: 'readonly',
				webkitAudioContext: 'readonly',
				RTCPeerConnection: 'readonly',
				RTCSessionDescription: 'readonly',
				RTCIceCandidate: 'readonly',
				MediaRecorder: 'readonly',
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'no-unused-vars': 'off',
			'no-undef': 'off',
		},
	},
];
