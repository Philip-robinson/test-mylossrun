/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('POST /api/calculate-cells', () => {
  let POST;

  // The request shape is "rectangles the caller already knows": table bounds, every
  // cell rectangle with its row/column, and the optional title/specials rectangles.
  const sentBody = {
    pdfId: '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a',
    pdfPage: 2,
    colouredAreas: [
      {
        left: 0.1,
        top: 0.1,
        width: 0.2,
        height: 0.2,
        foreground: '#000000',
        background: '#ffff00',
      },
    ],
    tables: [
      {
        tableInPage: 0,
        left: 0.1,
        top: 0.2,
        width: 0.5,
        height: 0.4,
        cells: [{ left: 0.1, top: 0.2, width: 0.25, height: 0.1, row: 0, column: 0 }],
        title: { left: 0.1, top: 0.15, width: 0.5, height: 0.04 },
        specials: [{ left: 0.1, top: 0.55, width: 0.5, height: 0.05 }],
      },
    ],
  };
  const fixture = {
    pdfPage: 2,
    tables: [
      {
        tableInPage: 0,
        cells: [{ row: 0, column: 0, text: 'Claim', confidence: 92 }],
        title: { text: 'Losses', confidence: 88 },
        specials: [{ text: 'Total', confidence: 71 }],
      },
    ],
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
    return new Request('http://localhost/api/calculate-cells', {
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
      'https://api.example.com/mylossrun/calculate-cells',
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
