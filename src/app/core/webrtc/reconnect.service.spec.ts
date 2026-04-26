import { TestBed } from '@angular/core/testing';
import { ReconnectService } from './reconnect.service';

describe('ReconnectService', () => {
  let service: ReconnectService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ReconnectService],
    });
    service = TestBed.inject(ReconnectService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start with stable status', () => {
    expect(service.status()).toBe('stable');
  });

  it('should detach and reset on destroy', () => {
    // Create a mock peer connection
    const pc = new RTCPeerConnection({ iceServers: [] });
    service.attach(pc);
    service.ngOnDestroy();
    expect(service.status()).toBe('stable');
  });

  it('should reset attempts when resetAttempts called', () => {
    service.resetAttempts();
    expect(service.status()).toBe('stable');
  });

  describe('with mock peer connection', () => {
    let pc: RTCPeerConnection;

    beforeEach(() => {
      pc = new RTCPeerConnection({ iceServers: [] });
      service.attach(pc);
    });

    afterEach(() => {
      pc.close();
    });

    it('should detach cleanly', () => {
      service.detach();
      expect(service.status()).toBe('stable');
    });

    it('should transition to stable on connected', (done) => {
      // Simulate connection state change
      Object.defineProperty(pc, 'connectionState', {
        get: () => 'connected',
        configurable: true,
      });
      pc.dispatchEvent(new Event('connectionstatechange'));

      // Check status in next tick
      setTimeout(() => {
        expect(service.status()).toBe('stable');
        done();
      }, 0);
    });
  });
});
