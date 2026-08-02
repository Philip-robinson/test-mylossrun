/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('POST /api/get-table-images', () => {
  let POST;

  const sentBody = {
    pdfId: '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a',
    width: 150,
    tableImages: [
      { page: 0, tableId: 't-1', bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 } },
    ],
  };
  const fixture = { images: { 't-1': 'base64png' } };

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
    return new Request('http://localhost/api/get-table-images', {
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

  it('forwards the parsed body and X-Access-Code header to the upstream fetch', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await POST(makeRequest());

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/mylossrun/get-table-images',
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

  it('propagates the upstream HTTP status', async () => {
    global.fetch.mockResolvedValue(
      mockUpstream({ status: 404, data: { success: false, error: 'not found' } })
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(404);
  });

  it('returns 500 with the error message when fetch rejects', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'boom' });
  });
});
