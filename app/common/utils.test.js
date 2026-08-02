import { newUUID } from 'common/utils';

// RFC 4122 version-4 UUID shape: 8-4-4-4-12 hex, version nibble '4', variant nibble
// one of 8/9/a/b.
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// jsdom defines `crypto` as a getter-only global, so a plain `global.crypto = …`
// assignment is ignored. Override it with a configurable data property and restore
// the original descriptor afterwards.
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
function setCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('newUUID', () => {
  afterEach(() => {
    if (originalCrypto) {
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    } else {
      delete globalThis.crypto;
    }
  });

  test('delegates to crypto.randomUUID when available', () => {
    const randomUUID = jest.fn(() => 'delegated-uuid');
    setCrypto({ randomUUID });
    expect(newUUID()).toBe('delegated-uuid');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  test('falls back to a valid v4 UUID from crypto.getRandomValues when randomUUID is absent', () => {
    // A non-secure context / older browser: crypto exists but has no randomUUID.
    let seed = 0;
    setCrypto({
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = (seed += 1) & 0xff;
        return arr;
      },
    });
    expect(newUUID()).toMatch(UUID_V4);
  });

  test('falls back to a valid v4 UUID when crypto is entirely unavailable', () => {
    setCrypto(undefined);
    expect(newUUID()).toMatch(UUID_V4);
  });

  test('produces distinct ids across calls (using the environment crypto)', () => {
    expect(newUUID()).not.toBe(newUUID());
  });
});
