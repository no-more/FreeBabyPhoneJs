import { TestBed } from '@angular/core/testing';
import { QuickReconnectService } from './quick-reconnect.service';
import { CachedPairing } from '../models';

describe('QuickReconnectService', () => {
  let service: QuickReconnectService;

  const mockPairing: CachedPairing = {
    timestamp: Date.now(),
    emitterSdp: { type: 'offer', sdp: 'test-offer-sdp' } as RTCSessionDescriptionInit,
    receiverSdp: { type: 'answer', sdp: 'test-answer-sdp' } as RTCSessionDescriptionInit,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [QuickReconnectService],
    });
    service = TestBed.inject(QuickReconnectService);
    // Clear storage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('save', () => {
    it('should save pairing to localStorage', () => {
      service.save(mockPairing);
      const stored = localStorage.getItem('babyphoneLastConnection');
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toEqual(mockPairing);
    });

    it('should not throw if localStorage is unavailable', () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('Storage disabled');
      };
      expect(() => service.save(mockPairing)).not.toThrow();
      localStorage.setItem = originalSetItem;
    });
  });

  describe('load', () => {
    it('should return null when nothing stored', () => {
      expect(service.load()).toBeNull();
    });

    it('should return cached pairing when valid data exists', () => {
      localStorage.setItem('babyphoneLastConnection', JSON.stringify(mockPairing));
      const result = service.load();
      expect(result).toEqual(mockPairing);
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('babyphoneLastConnection', 'invalid json');
      expect(service.load()).toBeNull();
    });

    it('should return null for incomplete data', () => {
      localStorage.setItem('babyphoneLastConnection', JSON.stringify({ timestamp: Date.now() }));
      expect(service.load()).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove stored pairing', () => {
      service.save(mockPairing);
      service.clear();
      expect(service.load()).toBeNull();
    });

    it('should not throw if localStorage is unavailable', () => {
      service.save(mockPairing);
      const originalRemoveItem = localStorage.removeItem;
      localStorage.removeItem = () => {
        throw new Error('Storage disabled');
      };
      expect(() => service.clear()).not.toThrow();
      localStorage.removeItem = originalRemoveItem;
    });
  });
});
