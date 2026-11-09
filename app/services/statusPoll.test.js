import { readStatusObject, pollStatus } from './statusPoll';

describe('statusPoll', () => {
  const dummyBaseUrl = 'https://api.example.com';
  // Small values keep the suite fast without fake timers.
  const options = { intervalMs: 1, timeoutMs: 200 };
  let previousBaseUrl;

  beforeEach(() => {
    previousBaseUrl = process.env.MYLOSSRUN_BASE_URL;
    process.env.MYLOSSRUN_BASE_URL = dummyBaseUrl;
    global.fetch = jest.fn();
    localStorage.setItem('access_code', 'code-1');
  });

  afterEach(() => {
    localStorage.clear();
    if (previousBaseUrl === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = previousBaseUrl;
    }
  });

  function jsonResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(obj),
    };
  }

  describe('readStatusObject', () => {
    it('returns an INLINE status object as it stands without a second fetch', async () => {
      const envelope = { presentationType: 'INLINE', status: 'READY', data: [1] };

      expect(await readStatusObject(jsonResponse(envelope))).toEqual(envelope);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('pollStatus', () => {
    it('resolves with the data of an immediately READY status', async () => {
      global.fetch.mockResolvedValueOnce(
        jsonResponse({ presentationType: 'INLINE', status: 'READY', data: [{ name: 'A' }] })
      );

      await expect(pollStatus('id-1', options)).resolves.toEqual([{ name: 'A' }]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://api.example.com/mylossrun/status/id-1',
        expect.objectContaining({ headers: { 'X-Access-Code': 'code-1' }, cache: 'no-store' })
      );
    });

    it('polls again while PROCESSING and resolves on READY', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING' }))
        .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [{ name: 'B' }] }));

      await expect(pollStatus('id-2', options)).resolves.toEqual([{ name: 'B' }]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects with the worker message when the status reaches ERROR', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ERROR', error: 'worker exploded' }));

      await expect(pollStatus('id-3', options)).rejects.toThrow('worker exploded');
    });

    it('tolerates a single non-OK poll and resolves on the next READY', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'gateway hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [{ name: 'C' }] }));

      await expect(pollStatus('id-4', options)).resolves.toEqual([{ name: 'C' }]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects on a second consecutive non-OK poll', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
        .mockResolvedValueOnce(jsonResponse({ error: 'boom again' }, 500));

      await expect(pollStatus('id-5', options)).rejects.toThrow('Status poll failed: HTTP 500');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('clears the failure count on a clean read, so failure, success, failure, READY resolves', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'gateway hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING' }))
        .mockResolvedValueOnce(jsonResponse({ error: 'another hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [{ name: 'F' }] }));

      await expect(pollStatus('id-9', options)).resolves.toEqual([{ name: 'F' }]);
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('follows a BY_URL status to its presigned object', async () => {
      const presignedUrl = 'https://api.example.com/cache/obj';
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ presentationType: 'BY_URL', url: presignedUrl }))
        .mockResolvedValueOnce(
          jsonResponse({ presentationType: 'INLINE', status: 'READY', data: [{ name: 'D' }] })
        );

      await expect(pollStatus('id-6', options)).resolves.toEqual([{ name: 'D' }]);
      expect(global.fetch).toHaveBeenNthCalledWith(2, presignedUrl, { cache: 'no-store' });
    });

    it('counts a failed BY_URL presigned fetch as a poll failure', async () => {
      const presignedUrl = 'https://api.example.com/cache/obj';
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ presentationType: 'BY_URL', url: presignedUrl }))
        .mockResolvedValueOnce(jsonResponse({}, 403))
        .mockResolvedValueOnce(jsonResponse({ presentationType: 'BY_URL', url: presignedUrl }))
        .mockResolvedValueOnce(jsonResponse({}, 403));

      await expect(pollStatus('id-10', options)).rejects.toThrow(
        'Status BY_URL fetch failed: HTTP 403'
      );
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('times out while the status stays PROCESSING', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ status: 'PROCESSING' }));

      await expect(pollStatus('id-8', { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(
        'Timed out polling status id-8'
      );
    });
  });
});
