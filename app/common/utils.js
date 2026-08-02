// Shared, framework-agnostic helpers.

// Precomputed 00..ff byte -> two-hex-digit strings, so UUID formatting is a lookup
// rather than per-call string work.
const BYTE_TO_HEX = [];
for (let i = 0; i < 256; i += 1) {
  BYTE_TO_HEX.push((i + 0x100).toString(16).slice(1));
}

// Generate an RFC 4122 version-4 UUID.
//
// Prefers the native `crypto.randomUUID()`, but that is only defined in SECURE contexts
// (https, or localhost) and modern browsers — over plain http on a LAN/staging host it
// is `undefined` and calling it throws. So fall back to building a v4 UUID from
// `crypto.getRandomValues()` when that is present, and finally to `Math.random()` when
// no Web Crypto is available at all. The result is always a valid v4 UUID string.
export function newUUID() {
  const webCrypto = typeof crypto !== 'undefined' ? crypto : undefined;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set the version (4) and variant (10xx) bits per RFC 4122 §4.4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const h = BYTE_TO_HEX;
  return (
    h[bytes[0]] +
    h[bytes[1]] +
    h[bytes[2]] +
    h[bytes[3]] +
    '-' +
    h[bytes[4]] +
    h[bytes[5]] +
    '-' +
    h[bytes[6]] +
    h[bytes[7]] +
    '-' +
    h[bytes[8]] +
    h[bytes[9]] +
    '-' +
    h[bytes[10]] +
    h[bytes[11]] +
    h[bytes[12]] +
    h[bytes[13]] +
    h[bytes[14]] +
    h[bytes[15]]
  );
}
