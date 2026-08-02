import { authHeaders } from './authHeaders';
import { pollIntervalMs } from 'config';

export async function pdfDisplayList() {
  const response = await fetch('/api/pdf-display-list', {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`pdfDisplayList failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Abortable sleep.
 * @param {number} ms - milliseconds to wait
 * @param {AbortSignal} [signal] - rejects the promise with an AbortError when aborted
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abortError = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return error;
    };
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Resolve with fresh table data. Fetches /api/pdf-display-list immediately and
 * then every pollIntervalMs() while receiving 304s; resolves on the first 200.
 * @param {() => string|null} getLastModified - returns the current last-modified value (null on first call)
 * @param {AbortSignal} signal - aborts both in-flight fetches and the 30s waits
 * @returns {Promise<{ pdfs: Array, lastModified: string|null }>}
 */
export async function getPdfDisplayList(getLastModified, signal) {
  while (true) {
    const lastModified = getLastModified();
    const headers = authHeaders(lastModified ? { 'If-Modified-Since': lastModified } : {});
    const response = await fetch('/api/pdf-display-list', { headers, cache: 'no-store', signal });
    if (response.status === 304) {
      await sleep(pollIntervalMs(), signal);
      continue;
    }
    if (response.status !== 200) {
      throw new Error(`Failed to load PDF list (status ${response.status})`);
    }
    const data = await response.json();
    if (data.success === false) {
      throw new Error(data.error);
    }
    return { pdfs: data.pdfs || [], lastModified: response.headers.get('Last-Modified') };
  }
}
