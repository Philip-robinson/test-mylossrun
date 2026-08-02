/** @jest-environment node */

import zlib from 'node:zlib';

// Configuration is mocked, never asserted: the helper only needs a base URL, and
// the poll interval/timeout arrive as arguments so each caller supplies its own.
jest.mock('config', () => ({ baseUrl: () => 'https://api.example.com' }));

const { decodeBody, readStatusObject, pollStatus } = require('./status_poll');

describe('status_poll', () => {
  // Small values keep the suite fast without fake timers.
  const options = { intervalMs: 1, timeoutMs: 200 };

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  function jsonResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => Buffer.from(JSON.stringify(obj), 'utf-8'),
    };
  }

  function gzipResponse(obj, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf-8')),
    };
  }

  describe('decodeBody', () => {
    it('returns plain text unchanged', () => {
      expect(decodeBody(Buffer.from('{"a":1}', 'utf-8'))).toBe('{"a":1}');
    });

    it('gunzips a body carrying the gzip magic number', () => {
      expect(decodeBody(zlib.gzipSync(Buffer.from('{"a":1}', 'utf-8')))).toBe('{"a":1}');
    });
  });

  describe('readStatusObject', () => {
    it('returns an INLINE envelope as-is without a second fetch', async () => {
      const envelope = { presentationType: 'INLINE', status: 'READY', data: [1] };

      expect(await readStatusObject(jsonResponse(envelope))).toEqual(envelope);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws when the BY_URL presigned fetch is not ok', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, 403));

      await expect(
        readStatusObject(jsonResponse({ presentationType: 'BY_URL', url: 'https://api.example.com/o' }))
      ).rejects.toThrow('Status BY_URL fetch failed: HTTP 403');
    });
  });

  describe('pollStatus', () => {
    it('returns the data of an immediately READY status', async () => {
      global.fetch.mockResolvedValueOnce(
        jsonResponse({ presentationType: 'INLINE', status: 'READY', data: [{ name: 'A' }] })
      );

      await expect(pollStatus('id-1', 'code-1', options)).resolves.toEqual([{ name: 'A' }]);

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

      await expect(pollStatus('id-2', 'code-1', options)).resolves.toEqual([{ name: 'B' }]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws the worker message when the status reaches ERROR', async () => {
      global.fetch.mockResolvedValueOnce(
        jsonResponse({ status: 'ERROR', error: 'worker exploded' })
      );

      await expect(pollStatus('id-3', 'code-1', options)).rejects.toThrow('worker exploded');
    });

    it('tolerates a single transient poll failure and succeeds on the next poll', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'gateway hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [{ name: 'C' }] }));

      await expect(pollStatus('id-4', 'code-1', options)).resolves.toEqual([{ name: 'C' }]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('aborts on a second consecutive poll failure', async () => {
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
        .mockResolvedValueOnce(jsonResponse({ error: 'boom again' }, 500));

      await expect(pollStatus('id-5', 'code-1', options)).rejects.toThrow(
        'Status poll failed: HTTP 500'
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('clears the error budget on a good read, so two blips either side of a success survive', async () => {
      // The case that tells a CONSECUTIVE budget from a lifetime one: the second failure comes
      // after a poll that read cleanly, so it must be tolerated rather than abort the run.
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ error: 'gateway hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'PROCESSING' }))
        .mockResolvedValueOnce(jsonResponse({ error: 'another hiccup' }, 503))
        .mockResolvedValueOnce(jsonResponse({ status: 'READY', data: [{ name: 'F' }] }));

      await expect(pollStatus('id-9', 'code-1', options)).resolves.toEqual([{ name: 'F' }]);
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('follows a BY_URL envelope to the presigned object', async () => {
      const presignedUrl = 'https://api.example.com/cache/obj';
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ presentationType: 'BY_URL', url: presignedUrl }))
        .mockResolvedValueOnce(
          jsonResponse({ presentationType: 'INLINE', status: 'READY', data: [{ name: 'D' }] })
        );

      await expect(pollStatus('id-6', 'code-1', options)).resolves.toEqual([{ name: 'D' }]);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        presignedUrl,
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    it('gunzips a gzip-compressed status body', async () => {
      global.fetch.mockResolvedValueOnce(
        gzipResponse({ status: 'READY', data: [{ name: 'E' }] })
      );

      await expect(pollStatus('id-7', 'code-1', options)).resolves.toEqual([{ name: 'E' }]);
    });

    it('times out while the status stays PROCESSING', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ status: 'PROCESSING' }));

      await expect(pollStatus('id-8', 'code-1', { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(
        'Timed out polling status id-8'
      );
    });
  });
});
