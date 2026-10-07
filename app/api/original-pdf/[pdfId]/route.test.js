/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('GET /api/original-pdf/[pdfId]', () => {
  let GET;

  const pdfId = 'a b';
  const endpoint = 'https://api.example.com/mylossrun/original-pdf/a%20b';
  const downloadUrl = 'https://s3.example.com/originals/losses.pdf?X-Amz-Signature=abc';
  const pdfBytes = Buffer.from('%PDF-1.7 the original', 'utf-8');

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ GET } = require('./route'));
  });

  function callGet({ headers = { 'X-Access-Code': 'code-1' } } = {}) {
    return GET(
      new Request(`http://localhost/api/original-pdf/${encodeURIComponent(pdfId)}`, { headers }),
      { params: Promise.resolve({ pdfId }) }
    );
  }

  function jsonUpstream({ status = 200, data = { downloadUrl } } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => Buffer.from(JSON.stringify(data), 'utf-8'),
    };
  }

  function fileUpstream({ status = 200, bytes = pdfBytes } = {}) {
    return { ok: status >= 200 && status < 300, status, body: new Response(bytes).body };
  }

  // Keyed on the url rather than on call order, so a route that skipped a call fails.
  function mockBothStages({ json = jsonUpstream(), file = fileUpstream() } = {}) {
    global.fetch.mockImplementation(async (url) => (url === endpoint ? json : file));
  }

  it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
    const response = await callGet({ headers: {} });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('asks the back end for the original with the encoded id and the access code', async () => {
    mockBothStages();

    await callGet();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      endpoint,
      expect.objectContaining({
        method: 'GET',
        headers: { 'X-Access-Code': 'code-1' },
        cache: 'no-store',
      })
    );
  });

  it('returns the upstream JSON and status when the back end fails, and fetches no file', async () => {
    mockBothStages({
      json: jsonUpstream({ status: 404, data: { success: false, error: 'not found' } }),
    });

    const response = await callGet();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'not found' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches the PDF from the presigned url and returns its bytes', async () => {
    mockBothStages();

    const response = await callGet();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(downloadUrl, { cache: 'no-store' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
  });

  it('returns 500 when the PDF cannot be collected from the presigned url', async () => {
    mockBothStages({ file: fileUpstream({ status: 403 }) });

    const response = await callGet();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('Original PDF download failed');
  });
});
