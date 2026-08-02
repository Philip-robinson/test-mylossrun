/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('POST /api/to-excel', () => {
  let POST;

  // The request is the amalgamated table — { name, title, cells, headerCount } — plus the
  // pdf it came from, its root table and the uploaded filename the workbook is named after.
  const sentBody = {
    pdfId: '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a',
    rootTableId: 't-1',
    originalFilename: 'losses.pdf',
    name: 'Table 1',
    title: {
      tableId: 't-1',
      text: 'Losses',
      confidence: 88,
      bounds: { left: 0.1, top: 0.15, width: 0.5, height: 0.04 },
    },
    headerCount: 1,
    cells: [
      [
        { tableId: 't-1', row: 0, column: 0, text: 'Claim', confidence: 92 },
        { tableId: 't-1', row: 0, column: 1, text: 'Amount', confidence: 90 },
      ],
      [
        { tableId: 't-1', row: 1, column: 0, text: 'C-001', confidence: 84 },
        { tableId: 't-2', sectionTitleIndex: 0, text: 'Motor', confidence: 66 },
      ],
    ],
  };
  const fixture = {
    downloadUrl: 'https://api.example.com/download/losses.xlsx',
    key: 'exports/9b2f0c52/losses.xlsx',
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ POST } = require('./route'));
  });

  function makeRequest({
    headers = { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
    body = sentBody,
  } = {}) {
    return new Request('http://localhost/api/to-excel', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function mockUpstream({ status = 200, data = fixture } = {}) {
    return {
      status,
      arrayBuffer: async () =>
        Buffer.from(JSON.stringify({ presentationType: 'INLINE', data }), 'utf-8'),
    };
  }

  it('forwards the parsed body and X-Access-Code header to the synchronous upstream endpoint', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await POST(makeRequest());

    // Exactly one fetch: the endpoint is synchronous, so there is no status long-poll.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/mylossrun/to-excel',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': 'code-1' },
        body: JSON.stringify(sentBody),
        cache: 'no-store',
      })
    );
  });

  it('returns the upstream JSON body and status unchanged', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fixture);
  });

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await POST(
      makeRequest({ headers: { 'Content-Type': 'application/json' } })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when fetch rejects', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'boom' });
  });
});
