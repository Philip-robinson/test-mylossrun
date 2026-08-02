/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('GET /api/pdf-display-entry/[pdfId]', () => {
  let GET;

  const pdfId = '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a';
  const fixture = {
    pdfId,
    name: 'Some Loss Run Report 2026.pdf',
    created: '2026-06-09T14:31:22.000Z',
    status: 'READY_FOR_REVIEW',
    error: null,
    pageCount: 12,
    tableCount: 3,
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ GET } = require('./route'));
  });

  function makeRequest(headers = { 'X-Access-Code': 'code-1' }) {
    return new Request(`http://localhost/api/pdf-display-entry/${pdfId}`, { headers });
  }

  function makeParams(id = pdfId) {
    return { params: Promise.resolve({ pdfId: id }) };
  }

  function mockUpstream({ status = 200, lastModified = null, arrayBuffer } = {}) {
    return {
      status,
      headers: { get: (name) => (name === 'Last-Modified' ? lastModified : null) },
      arrayBuffer:
        arrayBuffer ??
        (async () =>
          Buffer.from(JSON.stringify({ presentationType: 'INLINE', data: fixture }), 'utf-8')),
    };
  }

  it('fetches the upstream single-entry URL with the pdfId path param', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await GET(makeRequest(), makeParams());

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.example.com/mylossrun/pdf-display-entry/${pdfId}`,
      expect.objectContaining({ headers: { 'X-Access-Code': 'code-1' }, cache: 'no-store' })
    );
  });

  it('returns the upstream (unwrapped) entry body on 200', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    const response = await GET(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fixture);
  });

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await GET(makeRequest({}), makeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards the If-Modified-Since header to the upstream fetch when present', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await GET(
      makeRequest({
        'X-Access-Code': 'code-1',
        'If-Modified-Since': 'Thu, 11 Jun 2026 14:31:22 GMT',
      }),
      makeParams()
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'X-Access-Code': 'code-1',
          'If-Modified-Since': 'Thu, 11 Jun 2026 14:31:22 GMT',
        },
      })
    );
  });

  it('passes the upstream Last-Modified header back on 200 responses', async () => {
    global.fetch.mockResolvedValue(
      mockUpstream({ status: 200, lastModified: 'Thu, 11 Jun 2026 14:31:22 GMT' })
    );

    const response = await GET(makeRequest(), makeParams());

    expect(response.status).toBe(200);
    expect(response.headers.get('Last-Modified')).toBe('Thu, 11 Jun 2026 14:31:22 GMT');
  });

  it('returns 304 with no body and without reading the body when upstream returns 304', async () => {
    const arrayBufferMock = jest.fn();
    global.fetch.mockResolvedValue(
      mockUpstream({
        status: 304,
        lastModified: 'Thu, 11 Jun 2026 14:31:22 GMT',
        arrayBuffer: arrayBufferMock,
      })
    );

    const response = await GET(makeRequest(), makeParams());

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Last-Modified')).toBe('Thu, 11 Jun 2026 14:31:22 GMT');
    expect(arrayBufferMock).not.toHaveBeenCalled();
  });

  it('propagates the upstream 404 status for an unknown id', async () => {
    global.fetch.mockResolvedValue(mockUpstream({ status: 404, arrayBuffer: async () => Buffer.from(JSON.stringify({ message: 'not found' }), 'utf-8') }));

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
