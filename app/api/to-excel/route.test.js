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
  const endpoint = 'https://api.example.com/mylossrun/to-excel';
  const downloadUrl = 'https://s3.example.com/exports/losses.xlsx?X-Amz-Signature=abc';
  const fixture = { downloadUrl, key: 'exports/9b2f0c52/losses.xlsx' };
  // Enough of a real workbook to be recognisable: xlsx is a zip, so it opens with "PK".
  const workbookBytes = Buffer.from('PK the workbook', 'utf-8');
  const xlsxContentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

  function jsonUpstream({ status = 200, data = fixture } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () =>
        Buffer.from(JSON.stringify({ presentationType: 'INLINE', data }), 'utf-8'),
    };
  }

  function workbookUpstream({ status = 200, bytes = workbookBytes } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => bytes,
    };
  }

  // The build POST answers with the presigned url, the second fetch collects the file
  // from it. Keyed on the url rather than on call order, so a route that stopped making
  // one of the two calls fails rather than silently taking the other one's answer.
  function mockBothStages({ workbook = workbookUpstream(), json = jsonUpstream() } = {}) {
    global.fetch.mockImplementation(async (url) =>
      url === endpoint ? json : workbook
    );
  }

  it('forwards the parsed body and X-Access-Code header to the synchronous upstream endpoint', async () => {
    mockBothStages();

    await POST(makeRequest());

    // One POST to build it: the endpoint is synchronous, so there is no status long-poll.
    expect(global.fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': 'code-1' },
        body: JSON.stringify(sentBody),
        cache: 'no-store',
      })
    );
  });

  // The point of the route: the presigned url is on another origin, so a browser could
  // only navigate to it — a hand-over it cannot await, and one that cancels the requests
  // the page still has in flight. Consumed here, it becomes a same-origin body instead.
  it('fetches the workbook from the presigned url and returns the bytes', async () => {
    mockBothStages();

    const response = await POST(makeRequest());

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(downloadUrl, { cache: 'no-store' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(xlsxContentType);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(workbookBytes);
  });

  it('does not hand the presigned url to the browser', async () => {
    mockBothStages();

    const response = await POST(makeRequest());

    expect(Buffer.from(await response.arrayBuffer()).toString('utf-8')).not.toContain(
      'X-Amz-Signature'
    );
  });

  // A build that failed has no workbook to collect, so it is reported as the upstream JSON
  // and status, exactly as every other proxy in this app reports one.
  it('returns the upstream JSON and status when the build fails, and fetches no workbook', async () => {
    mockBothStages({
      json: jsonUpstream({ status: 502, data: { success: false, error: 'no such table' } }),
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: 'no such table' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the workbook cannot be collected from the presigned url', async () => {
    mockBothStages({ workbook: workbookUpstream({ status: 403 }) });

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Workbook download failed: 403',
    });
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
