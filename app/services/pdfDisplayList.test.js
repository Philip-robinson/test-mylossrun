import { pdfDisplayList, getPdfDisplayList, sleep } from './pdfDisplayList';
import { pollIntervalMs } from 'config';

describe('pdfDisplayList service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  function mockOk(json) {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(json),
    });
  }

  it('GETs /api/pdf-display-list with the access code header and no body', async () => {
    mockOk({ pdfs: [{ id: 'pdf-123' }, { id: 'pdf-456' }] });

    const result = await pdfDisplayList();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/pdf-display-list');
    expect(options.method).toBe('GET');
    expect(options.headers['X-Access-Code']).toBe('test-code');
    expect(options.body).toBeUndefined();
    expect(result).toEqual({ pdfs: [{ id: 'pdf-123' }, { id: 'pdf-456' }] });
  });

  it('omits X-Access-Code when localStorage is empty', async () => {
    localStorage.clear();
    mockOk({ pdfs: [] });

    await pdfDisplayList();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Access-Code']).toBeUndefined();
  });

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn(),
    });

    await expect(pdfDisplayList()).rejects.toThrow();
  });
});

function makeResponse({ status = 200, lastModified = null, body = { pdfs: [] } } = {}) {
  return {
    status,
    headers: { get: (name) => (name === 'Last-Modified' ? lastModified : null) },
    json: async () => body,
  };
}

describe('getPdfDisplayList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('first call sends no If-Modified-Since and resolves with the pdfs and Last-Modified', async () => {
    const lastModified = 'Thu, 11 Jun 2026 14:31:22 GMT';
    global.fetch.mockResolvedValue(
      makeResponse({ status: 200, lastModified, body: { pdfs: [{ pdfId: 'a' }] } })
    );
    const controller = new AbortController();

    const result = await getPdfDisplayList(() => null, controller.signal);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/pdf-display-list');
    expect(options.headers).toEqual({ 'X-Access-Code': 'test-code' });
    expect(options.headers['X-Access-Code']).toBe('test-code');
    expect(options.headers['If-Modified-Since']).toBeUndefined();
    expect(options.cache).toBe('no-store');
    expect(options.signal).toBe(controller.signal);
    expect(result).toEqual({ pdfs: [{ pdfId: 'a' }], lastModified });
  });

  test('sends If-Modified-Since and re-reads the getter on every iteration', async () => {
    let value = 'value-1';
    const getLastModified = jest.fn(() => value);
    global.fetch
      .mockResolvedValueOnce(makeResponse({ status: 304 }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: { pdfs: [] } }));
    const controller = new AbortController();

    const promise = getPdfDisplayList(getLastModified, controller.signal);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers['If-Modified-Since']).toBe('value-1');

    value = 'value-2';
    await jest.advanceTimersByTimeAsync(pollIntervalMs());
    await promise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].headers['If-Modified-Since']).toBe('value-2');
  });

  test('a 304 waits pollIntervalMs() then refetches; the 200 resolves', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ status: 304 }))
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          lastModified: 'Fri, 12 Jun 2026 09:00:00 GMT',
          body: { pdfs: [{ pdfId: 'b' }] },
        })
      );
    const controller = new AbortController();

    const promise = getPdfDisplayList(() => null, controller.signal);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(pollIntervalMs());
    const result = await promise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      pdfs: [{ pdfId: 'b' }],
      lastModified: 'Fri, 12 Jun 2026 09:00:00 GMT',
    });
  });

  test('aborting during the 30 s wait rejects with AbortError and stops fetching', async () => {
    global.fetch.mockResolvedValue(makeResponse({ status: 304 }));
    const controller = new AbortController();

    const promise = getPdfDisplayList(() => null, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    controller.abort();
    await rejection;

    await jest.advanceTimersByTimeAsync(pollIntervalMs() * 2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a 200 body with success: false rejects with the body error', async () => {
    global.fetch.mockResolvedValue(
      makeResponse({ status: 200, body: { success: false, error: 'nope' } })
    );
    const controller = new AbortController();

    await expect(getPdfDisplayList(() => null, controller.signal)).rejects.toThrow('nope');
  });

  test('a non-200/304 status rejects with an error mentioning the status', async () => {
    global.fetch.mockResolvedValue(makeResponse({ status: 500 }));
    const controller = new AbortController();

    await expect(getPdfDisplayList(() => null, controller.signal)).rejects.toThrow(
      'Failed to load PDF list (status 500)'
    );
  });

  test('omits X-Access-Code when no access code is stored', async () => {
    localStorage.clear();
    global.fetch.mockResolvedValue(
      makeResponse({ status: 200, body: { pdfs: [] } })
    );
    const controller = new AbortController();

    await getPdfDisplayList(() => null, controller.signal);

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Access-Code']).toBeUndefined();
  });

});

describe('sleep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('resolves after the given time', async () => {
    const promise = sleep(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects immediately with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('rejects with AbortError when aborted mid-wait', async () => {
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejection;
  });
});
