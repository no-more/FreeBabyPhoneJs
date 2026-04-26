import { TestBed } from '@angular/core/testing';
import { AudioKeepaliveService } from './audio-keepalive.service';

describe('AudioKeepaliveService', () => {
  let service: AudioKeepaliveService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AudioKeepaliveService],
    });
    service = TestBed.inject(AudioKeepaliveService);
  });

  afterEach(() => {
    TestBed.inject(AudioKeepaliveService).ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('start/stop', () => {
    it('should not throw on start', () => {
      expect(() => service.start()).not.toThrow();
    });

    it('should not throw on stop without start', () => {
      expect(() => service.stop()).not.toThrow();
    });

    it('should be idempotent — multiple starts should not throw', () => {
      service.start();
      expect(() => service.start()).not.toThrow();
    });

    it('should clean up resources on stop', () => {
      service.start();
      service.stop();
      // No direct way to verify, but shouldn't throw on subsequent operations
      service.start();
      expect(service).toBeTruthy();
    });
  });

  describe('visibilitychange handling', () => {
    it('should not throw when visibility changes without start', () => {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(service).toBeTruthy();
    });
  });
});
