import { authHeaders } from './authHeaders';
import { sleep } from './pdfDisplayList';
import { entryPollIntervalMs, awaitEntryTimeoutMs } from 'config';

/**
 * Poll a single display-list entry until it changes, then resolve with the fresh
 * entry. Fetches /api/pdf-display-entry/{pdfId} sending If-Modified-Since from
 * getTimestampFunc(); a 304 means unchanged, so it waits entryPollIntervalMs()
 * and retries, up to awaitEntryTimeoutMs() total. The first call (no stored
 * timestamp) sends no If-Modified-Since and so returns the current entry at once.
 *
 * Elapsed time is accumulated from the slept intervals (not Date.now()) so tests
 * can drive it deterministically with fake timers.
 *
 * @param {() => string|null|undefined} getTimestampFunc - last-known Last-Modified for this pdfId
 * @param {string} pdfId
 * @param {AbortSignal} [signal] - aborts the in-flight fetch and the waits
 * @returns {Promise<{ entry: object, lastModified: string|null } | null>} the changed
 *   entry + its Last-Modified, or null when nothing changed within the timeout.
 */
export async function awaitEntryChange(getTimestampFunc, pdfId, signal) {
  let elapsed = 0;
  while (elapsed < awaitEntryTimeoutMs()) {
    const lastModified = getTimestampFunc();
    const headers = authHeaders(lastModified ? { 'If-Modified-Since': lastModified } : {});
    const response = await fetch(`/api/pdf-display-entry/${encodeURIComponent(pdfId)}`, {
      headers,
      cache: 'no-store',
      signal,
    });
    if (response.status === 304) {
      await sleep(entryPollIntervalMs(), signal);
      elapsed += entryPollIntervalMs();
      continue;
    }
    if (response.status !== 200) {
      throw new Error(`Failed to load PDF entry (status ${response.status})`);
    }
    const entry = await response.json();
    return { entry, lastModified: response.headers.get('Last-Modified') };
  }
  return null;
}
