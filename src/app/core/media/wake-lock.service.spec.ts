import { TestBed } from '@angular/core/testing';
import { WakeLockService } from './wake-lock.service';

describe('WakeLockService', () => {
  let service: WakeLockService;
  let mockWakeLock: jasmine.SpyObj<WakeLockSentinel>;

  beforeEach(() => {
    mockWakeLock = jasmine.createSpyObj('WakeLockSentinel', ['release', 'addEventListener']);

    TestBed.configureTestingModule({
      providers: [WakeLockService],
    });
    service = TestBed.inject(WakeLockService);
  });

  afterEach(() => {
    TestBed.inject(WakeLockService).ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('when wakeLock API is available', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: { request: jasmine.createSpy('request').and.resolveTo(mockWakeLock) },
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: undefined,
        configurable: true,
      });
    });

    it('should request screen wake lock on acquire', async () => {
      const requestSpy = navigator.wakeLock!.request as jasmine.Spy;
      await service.acquire();
      expect(requestSpy).toHaveBeenCalledWith('screen');
    });

    it('should release wake lock on release', async () => {
      await service.acquire();
      service.release();
      expect(mockWakeLock.release).toHaveBeenCalled();
    });

    it('should not throw if release called without prior acquire', () => {
      expect(() => service.release()).not.toThrow();
    });

    it('should swallow errors when request throws', async () => {
      const requestSpy = navigator.wakeLock!.request as jasmine.Spy;
      requestSpy.and.rejectWith(new Error('Page not visible'));
      await expectAsync(service.acquire()).toBeResolved();
    });
  });

  describe('when wakeLock API is unavailable', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: undefined,
        configurable: true,
      });
    });

    it('should not throw on acquire', async () => {
      await expectAsync(service.acquire()).toBeResolved();
    });

    it('should not throw on release', () => {
      expect(() => service.release()).not.toThrow();
    });
  });
});
