import { baseUrl, envelopeByUrl, envelopeInline } from 'config';

/** Returns the absolute back-end URL for a path. */
export function backendUrl(path) {
  return `${baseUrl()}${path}`;
}

/** Reads a back-end response body and unwraps its response envelope to plain data. */
export async function readEnvelopeData(response, { tolerateEmpty = false } = {}) {
  const text = await response.text();
  if (tolerateEmpty && !text) return {};
  const envelope = JSON.parse(text);
  if (envelope && envelope.presentationType === envelopeByUrl()) {
    const stored = await fetch(envelope.url, { cache: 'no-store' });
    return JSON.parse(await stored.text()).data;
  }
  if (envelope && envelope.presentationType === envelopeInline()) {
    return envelope.data;
  }
  return envelope;
}
