/** @jest-environment node */

import { extractPollIntervalMs, extractPollTimeoutMs } from 'config';
import { pollStatus } from '../../../_lib/status_poll';

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

// Only the long-poll is mocked; decodeBody stays real so the dispatcher body is
// decoded exactly as it is in production.
jest.mock('../../../_lib/status_poll', () => ({
  ...jest.requireActual('../../../_lib/status_poll'),
  pollStatus: jest.fn(),
}));

describe('GET /api/extract/[pdfId]/[tableId]', () => {
  let GET;

  const pdfId = '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a';
  const tableId = 'table-1';
  const mergedTables = {
    tables: [
      { name: 'North', cells: [{ row: 0, column: 0, text: 'A' }] },
      { name: 'South', cells: [{ row: 0, column: 0, text: 'B' }] },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ GET } = require('./route'));
  });

  function makeRequest({ headers = { 'X-Access-Code': 'code-1' } } = {}) {
    return new Request(`http://localhost/api/extract/${pdfId}/${tableId}`, {
      method: 'GET',
      headers,
    });
  }

  function makeParams(id = pdfId, table = tableId) {
    return { params: Promise.resolve({ pdfId: id, tableId: table }) };
  }

  function dispatchResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => Buffer.from(JSON.stringify(obj), 'utf-8'),
    };
  }

  it('dispatches to the upstream extract URL and returns the polled tables', async () => {
    global.fetch.mockResolvedValue(
      dispatchResponse({ status: 'PROCESSING', statusIds: ['status-1'] })
    );
    pollStatus.mockResolvedValue(mergedTables);

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    // The worker's payload already carries the single `tables` key, so it is returned
    // as it stands rather than wrapped again.
    expect(body).toEqual(mergedTables);
    expect(body.tables).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.example.com/mylossrun/extract/${pdfId}/${tableId}`,
      expect.objectContaining({
        headers: { 'X-Access-Code': 'code-1' },
        cache: 'no-store',
      })
    );
    expect(pollStatus).toHaveBeenCalledWith('status-1', 'code-1', {
      intervalMs: extractPollIntervalMs(),
      timeoutMs: extractPollTimeoutMs(),
    });
  });

  it('URL-encodes the path segments', async () => {
    global.fetch.mockResolvedValue(
      dispatchResponse({ status: 'PROCESSING', statusIds: ['status-1'] })
    );
    pollStatus.mockResolvedValue(mergedTables);

    await GET(makeRequest(), makeParams('a/b c', 'table 1/2'));

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/mylossrun/extract/a%2Fb%20c/table%201%2F2',
      expect.anything()
    );
  });

  it('returns 401 and dispatches nothing when X-Access-Code is missing', async () => {
    const response = await GET(makeRequest({ headers: {} }), makeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(pollStatus).not.toHaveBeenCalled();
  });

  it('returns 500 including the status when the dispatch is not ok', async () => {
    global.fetch.mockResolvedValue(dispatchResponse({ error: 'nope' }, 502));

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain('502');
    expect(pollStatus).not.toHaveBeenCalled();
  });

  it('returns 500 when the dispatcher returns no status ids', async () => {
    global.fetch.mockResolvedValue(dispatchResponse({ status: 'PROCESSING', statusIds: [] }));

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
    expect(pollStatus).not.toHaveBeenCalled();
  });

  it('returns 500 with the message when the poll throws', async () => {
    global.fetch.mockResolvedValue(
      dispatchResponse({ status: 'PROCESSING', statusIds: ['status-1'] })
    );
    pollStatus.mockRejectedValue(new Error('worker exploded'));

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'worker exploded' });
  });
});
