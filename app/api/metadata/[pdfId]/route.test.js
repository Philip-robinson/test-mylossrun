/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('GET /api/metadata/[pdfId]', () => {
  let GET;

  const pdfId = '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a';
  const fixture = { success: true, metadata: { tables: [] } };

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ GET } = require('./route'));
  });

  function makeRequest({ headers = { 'X-Access-Code': 'code-1' } } = {}) {
    return new Request(`http://localhost/api/metadata/${pdfId}`, {
      method: 'GET',
      headers,
    });
  }

  function makeParams(id = pdfId) {
    return { params: Promise.resolve({ pdfId: id }) };
  }

  function mockUpstream({ status = 200, data = fixture } = {}) {
    return {
      status,
      arrayBuffer: async () =>
        Buffer.from(JSON.stringify({ presentationType: 'INLINE', data }), 'utf-8'),
    };
  }

  it('forwards to the upstream metadata URL with method GET and X-Access-Code header', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await GET(makeRequest(), makeParams());

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.example.com/mylossrun/metadata/${pdfId}`,
      expect.objectContaining({
        method: 'GET',
        headers: { 'X-Access-Code': 'code-1' },
        cache: 'no-store',
      })
    );
  });

  it('returns the upstream JSON body and status unchanged', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fixture);
  });

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await GET(makeRequest({ headers: {} }), makeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('propagates the upstream HTTP status', async () => {
    global.fetch.mockResolvedValue(
      mockUpstream({ status: 404, data: { success: false, error: 'not found' } })
    );

    const response = await GET(makeRequest(), makeParams());

    expect(response.status).toBe(404);
  });

  it('returns 500 with the error message when fetch rejects', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'boom' });
  });
});
