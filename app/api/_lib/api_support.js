import zlib from 'node:zlib';
import { NextResponse } from 'next/server';
import * as logger from 'common/logger';
import { baseUrl } from 'config';

// Decode a response body to text, gunzipping only if it is actually gzip-compressed.
// The runtime (Node 20 / undici) may auto-decompress gzip, so we sniff the gzip magic
// number (0x1f 0x8b) rather than branching on Content-Encoding. JSON text never begins
// with those bytes, so this can never double-decode.
function decodeBody(arrayBuffer) {
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return zlib.gunzipSync(bytes).toString('utf-8');
  }
  return bytes.toString('utf-8');
}

// Resolve one envelope to its plain data. Backward compatible: a body with no
// presentationType is returned as-is (so un-enveloped endpoints keep working).
async function unwrapEnvelope(envelope) {
  if (envelope && envelope.presentationType === 'BY_URL') {
    const res = await fetch(envelope.url, { cache: 'no-store' });
    const inner = JSON.parse(decodeBody(await res.arrayBuffer()));
    return inner.data; // the stored object is always an INLINE envelope
  }
  if (envelope && envelope.presentationType === 'INLINE') {
    return envelope.data;
  }
  return envelope; // backward-compat: not enveloped
}

// Read an upstream response into plain data. `tolerateEmpty` preserves the
// existing PUT behaviour (empty 200 body -> {}).
export async function readEnvelopeData(response, { tolerateEmpty = false } = {}) {
  const text = decodeBody(await response.arrayBuffer());
  if (tolerateEmpty && !text) return {};
  return unwrapEnvelope(JSON.parse(text));
}

export function logRequest(request) {
  logger.info(`${request.method} ${request.url}`);
}

export function requireAccessCode(request) {
  const accessCode = request.headers.get('X-Access-Code');
  if (!accessCode) {
    return NextResponse.json({ success: false, error: 'Access code required' }, { status: 401 });
  }
  return accessCode;
}

export function errorResponse(logLabel, error) {
  logger.error(`${logLabel}: ${error}`);
  return NextResponse.json({ success: false, error: error.message }, { status: 500 });
}

// Shared proxy: forward a request to the backend with the access code, returning the upstream
// JSON + status (or a 401/500 via the guards above). Two flags cover the three call shapes:
//   withBody       — read and forward the incoming JSON body (POST/PUT); GET sends none.
//   tolerateEmpty  — read the upstream as text and parse only when non-empty, so an empty 200
//                    (the PUT-tables endpoint returns no body) yields {} instead of throwing.
async function proxyJson(request, path, logLabel, { method, withBody = false, tolerateEmpty = false }) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const headers = { 'X-Access-Code': guard };
    const init = { method, headers, cache: 'no-store' };
    if (withBody) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(await request.json());
    }
    const response = await fetch(`${baseUrl()}${path}`, init);
    const data = await readEnvelopeData(response, { tolerateEmpty });
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return errorResponse(logLabel, error);
  }
}

export async function proxyJsonGet(request, path, logLabel) {
  return proxyJson(request, path, logLabel, { method: 'GET' });
}

export async function proxyJsonPost(request, path, logLabel) {
  return proxyJson(request, path, logLabel, { method: 'POST', withBody: true });
}

export async function proxyJsonPut(request, path, logLabel) {
  return proxyJson(request, path, logLabel, { method: 'PUT', withBody: true, tolerateEmpty: true });
}
