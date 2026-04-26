/**
 * Pure utilities to (de)serialise WebRTC SDPs for out-of-band signaling via
 * QR codes or URL hashes.
 *
 * The payload is a JSON-serialised `RTCSessionDescriptionInit`, compressed with
 * deflate-raw and encoded as URL-safe base64 (no padding). This matches the
 * format used by the legacy vanilla implementation so a phone running the new
 * app can still pair with a device running the old one.
 */

/** Compress a UTF-8 string with `deflate-raw` and return URL-safe base64 (no padding). */
export async function compress(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const stream = new Response(
    new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw')),
  );
  const compressed = new Uint8Array(await stream.arrayBuffer());
  let binary = '';
  for (const byte of compressed) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decompress a URL-safe base64 `deflate-raw` payload back to a UTF-8 string. */
export async function decompress(encoded: string): Promise<string> {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
  );
  return new TextDecoder().decode(new Uint8Array(await stream.arrayBuffer()));
}

/** Encode an SDP to the compact payload used in QR codes and URL hashes. */
export async function encodeSdp(sdp: RTCSessionDescriptionInit): Promise<string> {
  return compress(JSON.stringify(sdp));
}

/** Decode a compact payload (as produced by {@link encodeSdp}) back to an SDP. */
export async function decodeSdp(payload: string): Promise<RTCSessionDescriptionInit> {
  const json = await decompress(payload);
  return JSON.parse(json) as RTCSessionDescriptionInit;
}

/** Produce a shareable URL with the SDP embedded in the `#sdp=` hash. */
export function sdpToShareableUrl(baseUrl: string, payload: string): string {
  const withoutHash = baseUrl.split('#')[0] ?? baseUrl;
  return `${withoutHash}#sdp=${payload}`;
}

/** Extract the raw payload from a URL hash (or return null if absent). */
export function extractPayloadFromHash(hash: string): string | null {
  const match = hash.match(/[#&]sdp=([^&]*)/);
  return match ? decodeURIComponent(match[1] ?? '') : null;
}
