import { TestBed } from '@angular/core/testing';

import { WebRTCService } from './webrtc.service';

describe('WebRTCService', () => {
	let service: WebRTCService;

	beforeEach(() => {
		TestBed.configureTestingModule({});
		service = TestBed.inject(WebRTCService);
	});

	afterEach(() => {
		service.close();
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	it('should start with new connection state', () => {
		expect(service.connectionState()).toBe('new');
	});

	it('should start with new ice gathering state', () => {
		expect(service.iceGatheringState()).toBe('new');
	});

	it('should return null for peer connection before creation', () => {
		expect(service.getPeerConnection()).toBeNull();
	});

	it('should create a peer connection', async () => {
		const pc = await service.createPeerConnection();
		expect(pc).toBeInstanceOf(RTCPeerConnection);
		expect(service.getPeerConnection()).toBe(pc);
	});

	it('should close peer connection', async () => {
		await service.createPeerConnection();
		service.close();
		expect(service.getPeerConnection()).toBeNull();
		expect(service.connectionState()).toBe('new');
	});

	it('should create offer', async () => {
		const pc = await service.createPeerConnection();
		const offer = await service.createOffer();
		expect(offer).toBeDefined();
		expect(offer.type).toBe('offer');
		expect(pc.localDescription).toBeDefined();
	});

	it('should set remote description', async () => {
		const pc1 = await service.createPeerConnection();
		const offer = await pc1.createOffer();
		await pc1.setLocalDescription(offer);

		service.close();
		const pc2 = await service.createPeerConnection();
		await service.setRemoteDescription(offer);
		expect(pc2.remoteDescription).toBeDefined();
	});

	it('should add track to peer connection', async () => {
		await service.createPeerConnection();
		const pc = service.getPeerConnection();
		expect(pc).toBeTruthy();

		// Create a mock track
		const stream = new MediaStream();
		const mockTrack = {
			kind: 'audio',
			id: 'mock-track-id',
			enabled: true,
			muted: false,
			stop: () => {},
		} as unknown as MediaStreamTrack;

		expect(() => service.addTrack(mockTrack, stream)).not.toThrow();
	});

	it('should handle close when no peer connection exists', () => {
		expect(() => service.close()).not.toThrow();
	});

	it('should throw error when creating offer without peer connection', async () => {
		service.close();
		await expectAsync(service.createOffer()).toBeRejectedWithError('No peer connection');
	});

	it('should throw error when creating answer without peer connection', async () => {
		service.close();
		await expectAsync(service.createAnswer()).toBeRejectedWithError('No peer connection');
	});

	it('should throw error when setting remote description without peer connection', async () => {
		service.close();
		await expectAsync(service.setRemoteDescription({ type: 'offer', sdp: '' })).toBeRejectedWithError('No peer connection');
	});

	it('should throw error when adding track without peer connection', () => {
		service.close();
		const stream = new MediaStream();
		const mockTrack = {
			kind: 'audio',
			id: 'mock-track-id',
			enabled: true,
			muted: false,
			stop: () => {},
		} as unknown as MediaStreamTrack;
		expect(() => service.addTrack(mockTrack, stream)).toThrowError('No peer connection');
	});
});
