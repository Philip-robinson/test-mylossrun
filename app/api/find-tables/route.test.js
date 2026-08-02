/** @jest-environment node */

import zlib from 'node:zlib';
import { findTablesPollIntervalMs } from 'config';

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('POST /api/find-tables', () => {
  let POST;

  const table = (name) => ({ name, tableInPage: 0, left: 0.1, top: 0.1, width: 0.5, height: 0.2 });

  const sentBody = {
    pdfId: '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a',
    pages: [{ pdfPage: 0, tables: [table('T')] }],
    mechanism: null,
  };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ POST } = require('./route'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeRequest({
    headers = { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
    body = sentBody,
  } = {}) {
    return new Request('http://localhost/api/find-tables', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function jsonResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => Buffer.from(JSON.stringify(obj), 'utf-8'),
    };
  }

  function gzipResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf-8')),
    };
  }

  // Drive the POST promise to completion under fake timers: repeatedly advance
  // by the poll interval (flushing awaited fetches between advances) so any
  // scheduled sleep resolves and the next poll runs.
  async function settle(promise) {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await jest.advanceTimersByTimeAsync(findTablesPollIntervalMs());
    }
    return promise;
  }

  it('polls PROCESSING -> READY and concatenates data from multiple chunks', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1', 'id-2'] }))
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'READY', presentationType: 'INLINE', data: [table('A')] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 'READY', presentationType: 'INLINE', data: [table('B')] })
      );

    const promise = POST(makeRequest());
    const response = await settle(promise);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ tables: [table('A'), table('B')] });

    // First call forwards the FindTablesRequest body + access code.
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/mylossrun/find-tables',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
        body: JSON.stringify(sentBody),
        cache: 'no-store',
      })
    );
    // Subsequent calls poll the per-run status endpoints.
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/mylossrun/status/id-1',
      expect.objectContaining({ headers: { 'X-Access-Code': 'code-1' }, cache: 'no-store' })
    );
  });

  it('returns a non-200 when a status reaches ERROR', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1'] }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ERROR', error: 'worker exploded' }));

    const response = await settle(POST(makeRequest()));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'worker exploded' });
  });

  it('follows a BY_URL envelope to its inline data', async () => {
    const presignedUrl = 'https://api.example.com/cache/obj';
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1'] }))
      .mockResolvedValueOnce(jsonResponse({ presentationType: 'BY_URL', url: presignedUrl }))
      .mockResolvedValueOnce(
        jsonResponse({ presentationType: 'INLINE', status: 'READY', data: [table('C')] })
      );

    const response = await settle(POST(makeRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ tables: [table('C')] });
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      presignedUrl,
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('tolerates a single transient poll failure (non-2xx) and retries to READY', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1'] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'gateway hiccup' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [table('E')] }));

    const response = await settle(POST(makeRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ tables: [table('E')] });
  });

  it('aborts with a non-200 after a SECOND poll failure rather than spinning to the timeout', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1'] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom again' }, 500));

    const response = await settle(POST(makeRequest()));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    // Gave up after the second failed poll — no further status fetches.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('decodes a gzip-compressed status body', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING', statusIds: ['id-1'] }))
      .mockResolvedValueOnce(gzipResponse({ status: 'READY', data: [table('D')] }));

    const response = await settle(POST(makeRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ tables: [table('D')] });
  });

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await POST(makeRequest({ headers: { 'Content-Type': 'application/json' } }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
