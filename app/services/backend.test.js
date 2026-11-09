import { backendUrl, readEnvelopeData } from './backend';

describe('backend', () => {
  const dummyBaseUrl = 'https://api.example.com';
  const fixture = { success: true, image: 'data:image/png;base64,abc' };
  let previousBaseUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    previousBaseUrl = process.env.MYLOSSRUN_BASE_URL;
    process.env.MYLOSSRUN_BASE_URL = dummyBaseUrl;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = previousBaseUrl;
    }
  });

  function textResponse(text, { ok = true, status = 200 } = {}) {
    return { ok, status, text: async () => text };
  }

  function bodyResponse(body, options) {
    return textResponse(JSON.stringify(body), options);
  }

  const inline = (data) => ({ presentationType: 'INLINE', data });

  describe('backendUrl', () => {
    it('prefixes the path with the base URL', () => {
      expect(backendUrl('/mylossrun/get-image')).toBe(
        'https://api.example.com/mylossrun/get-image'
      );
    });
  });

  describe('readEnvelopeData', () => {
    it('returns .data for an INLINE envelope without fetching', async () => {
      const data = await readEnvelopeData(bodyResponse(inline(fixture)));

      expect(data).toEqual(fixture);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('follows a BY_URL envelope once and returns the stored envelope data', async () => {
      const cacheUrl = 'https://api.example.com/cache/abc123.json.gz';
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      const data = await readEnvelopeData(
        bodyResponse({ presentationType: 'BY_URL', url: cacheUrl })
      );

      expect(data).toEqual(fixture);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(cacheUrl, { cache: 'no-store' });
    });

    it('returns an un-enveloped body unchanged', async () => {
      const data = await readEnvelopeData(bodyResponse({ valid: true }));

      expect(data).toEqual({ valid: true });
    });

    it('returns {} for an empty body when tolerateEmpty is set', async () => {
      const data = await readEnvelopeData(textResponse(''), { tolerateEmpty: true });

      expect(data).toEqual({});
    });

    it('rejects on an empty body without tolerateEmpty', async () => {
      await expect(readEnvelopeData(textResponse(''))).rejects.toThrow();
    });
  });
});
