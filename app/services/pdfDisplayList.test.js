import { pdfDisplayList, getPdfDisplayList, sleep } from './pdfDisplayList';
import { pollIntervalMs } from 'config';

const dummyBaseUrl = 'https://api.example.com';
const listUrl = `${dummyBaseUrl}/mylossrun/pdf-display-list`;

let previousBaseUrl;

function useDummyBaseUrl() {
  beforeEach(() => {
    previousBaseUrl = process.env.MYLOSSRUN_BASE_URL;
    process.env.MYLOSSRUN_BASE_URL = dummyBaseUrl;
  });

  afterEach(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = previousBaseUrl;
    }
  });
}

describe('pdfDisplayList service', () => {
  useDummyBaseUrl();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  function mockOk(body) {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });
  }

  it('GETs the back end pdf-display-list with the access code header and no body', async () => {
    mockOk({ pdfs: [{ id: 'pdf-123' }, { id: 'pdf-456' }] });

    const result = await pdfDisplayList();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(listUrl);
    expect(options.method).toBe('GET');
    expect(options.headers['X-Access-Code']).toBe('test-code');
    expect(options.cache).toBe('no-store');
    expect(options.body).toBeUndefined();
    expect(result).toEqual({ pdfs: [{ id: 'pdf-123' }, { id: 'pdf-456' }] });
  });

  it('unwraps an INLINE envelope', async () => {
    mockOk({ presentationType: 'INLINE', data: { pdfs: [{ id: 'pdf-789' }] } });

    const result = await pdfDisplayList();

    expect(result).toEqual({ pdfs: [{ id: 'pdf-789' }] });
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
    });

    await expect(pdfDisplayList()).rejects.toThrow();
  });
});

function makeResponse({ status = 200, lastModified = null, body = { pdfs: [] } } = {}) {
  return {
    status,
    headers: { get: (name) => (name === 'Last-Modified' ? lastModified : null) },
    text: async () => JSON.stringify(body),
  };
}

describe('getPdfDisplayList', () => {
  useDummyBaseUrl();

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
    expect(url).toBe(listUrl);
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

  test('a 200 INLINE envelope is unwrapped', async () => {
    global.fetch.mockResolvedValue(
      makeResponse({
        status: 200,
        lastModified: 'lm',
        body: { presentationType: 'INLINE', data: { pdfs: [{ pdfId: 'c' }] } },
      })
    );
    const controller = new AbortController();

    const result = await getPdfDisplayList(() => null, controller.signal);

    expect(result).toEqual({ pdfs: [{ pdfId: 'c' }], lastModified: 'lm' });
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
