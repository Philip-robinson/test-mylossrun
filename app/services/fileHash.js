/** Returns the base64-encoded SHA-256 digest of a Blob's bytes. */
export async function sha256Base64(blob) {
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const byte of digest) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
