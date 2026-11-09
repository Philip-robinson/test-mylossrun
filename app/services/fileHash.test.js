/** @jest-environment node */
import { sha256Base64 } from './fileHash';

describe('sha256Base64', () => {
  it('returns the base64 SHA-256 digest of "abc"', async () => {
    await expect(sha256Base64(new Blob(['abc']))).resolves.toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('returns the base64 SHA-256 digest of "pdf-bytes"', async () => {
    await expect(sha256Base64(new Blob(['pdf-bytes']))).resolves.toBe('KdEoNoYZPcFGGn3qxPU9m8VAKii5XYVPaelJhnVv0Kk=');
  });
});
