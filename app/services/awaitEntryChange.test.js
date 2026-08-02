import { awaitEntryChange } from './awaitEntryChange';
import { entryPollIntervalMs, awaitEntryTimeoutMs } from 'config';

function makeResponse({ status = 200, lastModified = null, body = {} } = {}) {
  return {
    status,
    headers: { get: (name) => (name === 'Last-Modified' ? lastModified : null) },
    json: async () => body,
  };
}

describe('awaitEntryChange', () => {
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

  test('first call sends no If-Modified-Since and returns the entry + Last-Modified', async () => {
    const lastModified = 'Thu, 11 Jun 2026 14:31:22 GMT';
    global.fetch.mockResolvedValue(
      makeResponse({ status: 200, lastModified, body: { pdfId: 'p1', status: 'ALLOCATED' } })
    );

    const result = await awaitEntryChange(() => null, 'p1');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/pdf-display-entry/p1');
    expect(options.headers['X-Access-Code']).toBe('test-code');
    expect(options.headers['If-Modified-Since']).toBeUndefined();
    expect(options.cache).toBe('no-store');
    expect(result).toEqual({ entry: { pdfId: 'p1', status: 'ALLOCATED' }, lastModified });
  });

  test('a 304 waits entryPollIntervalMs() then refetches; the 200 resolves with the change', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ status: 304 }))
      .mockResolvedValueOnce(
        makeResponse({ status: 200, lastModified: 'later', body: { pdfId: 'p1', status: 'LOADED' } })
      );

    const promise = awaitEntryChange(() => 'prev-lm', 'p1');
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // First iteration sends the stored timestamp so the backend can 304.
    expect(global.fetch.mock.calls[0][1].headers['If-Modified-Since']).toBe('prev-lm');

    await jest.advanceTimersByTimeAsync(entryPollIntervalMs());
    const result = await promise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ entry: { pdfId: 'p1', status: 'LOADED' }, lastModified: 'later' });
  });

  test('returns null after the timeout when nothing changes', async () => {
    global.fetch.mockResolvedValue(makeResponse({ status: 304 }));

    const promise = awaitEntryChange(() => 'lm', 'p1');
    const expectation = expect(promise).resolves.toBeNull();

    // Drive the whole 1-minute budget of 304 waits.
    await jest.advanceTimersByTimeAsync(awaitEntryTimeoutMs());
    await expectation;

    expect(global.fetch).toHaveBeenCalledTimes(awaitEntryTimeoutMs() / entryPollIntervalMs());
  });

  test('throws on a non-200/304 status', async () => {
    global.fetch.mockResolvedValue(makeResponse({ status: 500 }));

    await expect(awaitEntryChange(() => null, 'p1')).rejects.toThrow(
      'Failed to load PDF entry (status 500)'
    );
  });

  test('aborting during the wait rejects with AbortError and stops fetching', async () => {
    global.fetch.mockResolvedValue(makeResponse({ status: 304 }));
    const controller = new AbortController();

    const promise = awaitEntryChange(() => 'lm', 'p1', controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    controller.abort();
    await rejection;

    await jest.advanceTimersByTimeAsync(entryPollIntervalMs() * 2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
