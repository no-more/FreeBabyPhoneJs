import {
  compress,
  decompress,
  encodeSdp,
  decodeSdp,
  sdpToShareableUrl,
  extractPayloadFromHash,
} from './sdp-codec';

describe('sdp-codec', () => {
  const mockSdp: RTCSessionDescriptionInit = {
    type: 'offer',
    sdp: 'v=0\r\no=- 12345 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtpmap:111 opus/48000/2\r\n',
  };

  describe('compress / decompress round-trip', () => {
    it('should round-trip a simple string', async () => {
      const input = 'Hello, World! This is a test string for compression.';
      const compressed = await compress(input);
      const decompressed = await decompress(compressed);
      expect(decompressed).toBe(input);
    });

    it('should round-trip JSON SDP data', async () => {
      const input = JSON.stringify(mockSdp);
      const compressed = await compress(input);
      const decompressed = await decompress(compressed);
      expect(decompressed).toBe(input);
    });

    it('should produce URL-safe base64 (no +, /, =)', async () => {
      const input = 'Hello + World / Test = Padding';
      const compressed = await compress(input);
      expect(compressed).not.toMatch(/[+/=]/);
    });

    it('should handle empty string', async () => {
      const input = '';
      const compressed = await compress(input);
      const decompressed = await decompress(compressed);
      expect(decompressed).toBe(input);
    });
  });

  describe('encodeSdp / decodeSdp', () => {
    it('should round-trip an SDP object', async () => {
      const payload = await encodeSdp(mockSdp);
      const decoded = await decodeSdp(payload);
      expect(decoded).toEqual(mockSdp);
    });

    it('should produce a payload that decodes correctly', async () => {
      const payload = await encodeSdp(mockSdp);
      expect(typeof payload).toBe('string');
      expect(payload.length).toBeGreaterThan(0);
      const decoded = await decodeSdp(payload);
      expect(decoded.type).toBe(mockSdp.type);
      expect(decoded.sdp).toBe(mockSdp.sdp);
    });
  });

  describe('sdpToShareableUrl', () => {
    it('should embed payload in hash', () => {
      const baseUrl = 'https://example.com/';
      const payload = 'test-payload';
      const url = sdpToShareableUrl(baseUrl, payload);
      expect(url).toBe('https://example.com/#sdp=test-payload');
    });

    it('should strip existing hash before adding new one', () => {
      const baseUrl = 'https://example.com/#old-hash';
      const payload = 'test-payload';
      const url = sdpToShareableUrl(baseUrl, payload);
      expect(url).toBe('https://example.com/#sdp=test-payload');
    });
  });

  describe('extractPayloadFromHash', () => {
    it('should extract payload from hash', () => {
      const hash = '#sdp=test-payload';
      const payload = extractPayloadFromHash(hash);
      expect(payload).toBe('test-payload');
    });

    it('should extract payload from URL with multiple params', () => {
      const hash = '#other=value&sdp=test-payload&another=param';
      const payload = extractPayloadFromHash(hash);
      expect(payload).toBe('test-payload');
    });

    it('should return null for hash without sdp', () => {
      const hash = '#other=value';
      const payload = extractPayloadFromHash(hash);
      expect(payload).toBeNull();
    });

    it('should decode URL-encoded payload', () => {
      const hash = '#sdp=test%20payload%20with%20spaces';
      const payload = extractPayloadFromHash(hash);
      expect(payload).toBe('test payload with spaces');
    });

    it('should return null for empty hash', () => {
      const payload = extractPayloadFromHash('');
      expect(payload).toBeNull();
    });
  });
});
