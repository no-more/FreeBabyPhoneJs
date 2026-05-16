import { TestBed } from '@angular/core/testing';
import { MicService } from './mic.service';

describe('MicService', () => {
	let service: MicService;
	let mockTrack: jasmine.SpyObj<MediaStreamTrack>;
	let mockStream: MediaStream;

	beforeEach(() => {
		mockTrack = jasmine.createSpyObj('MediaStreamTrack', ['applyConstraints', 'stop']);
		mockStream = new MediaStream();
		Object.defineProperty(mockStream, 'getAudioTracks', {
			value: () => [mockTrack],
			configurable: true,
		});
		Object.defineProperty(mockStream, 'getTracks', {
			value: () => [mockTrack],
			configurable: true,
		});

		spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(mockStream);

		TestBed.configureTestingModule({
			providers: [MicService],
		});
		service = TestBed.inject(MicService);
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('applyConstraints', () => {
		it('should apply constraints to the live audio track', async () => {
			await service.acquire(true, false, true);
			await service.applyConstraints(false, true, false);
			expect(mockTrack.applyConstraints).toHaveBeenCalledWith({
				echoCancellation: true,
				noiseSuppression: false,
				autoGainControl: false,
			});
		});

		it('should be a no-op when no track is active', async () => {
			await service.applyConstraints(true, true, true);
			expect(mockTrack.applyConstraints).not.toHaveBeenCalled();
		});
	});
});
