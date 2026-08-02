/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('PUT /api/metadata/[pdfId]/tables', () => {
  let PUT;

  const pdfId = '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a';
  const sentBody = { tables: [{ id: 't1', rows: 3, cols: 2 }] };

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ PUT } = require('./route'));
  });

  function makeRequest({
    headers = { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
    body = sentBody,
  } = {}) {
    return new Request(`http://localhost/api/metadata/${pdfId}/tables`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
  }

  function makeParams(id = pdfId) {
    return { params: Promise.resolve({ pdfId: id }) };
  }

  // The tables PUT is NOT enveloped upstream; the proxy reads
  // response.arrayBuffer() and, with tolerateEmpty, maps an empty body to {}.
  function mockUpstream({ status = 200, body = '' } = {}) {
    return { status, arrayBuffer: async () => Buffer.from(body, 'utf-8') };
  }

  it('forwards the JSON body to the upstream tables URL with PUT, Content-Type and X-Access-Code', async () => {
    global.fetch.mockResolvedValue(mockUpstream());

    await PUT(makeRequest(), makeParams());

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.example.com/mylossrun/metadata/${pdfId}/tables`,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': 'code-1' },
        body: JSON.stringify(sentBody),
        cache: 'no-store',
      })
    );
  });

  it('tolerates an empty upstream 200 body without a JSON-parse crash', async () => {
    global.fetch.mockResolvedValue(mockUpstream({ status: 200, body: '' }));

    const response = await PUT(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({});
  });

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await PUT(
      makeRequest({ headers: { 'Content-Type': 'application/json' } }),
      makeParams()
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when fetch rejects', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));

    const response = await PUT(makeRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'boom' });
  });
});
