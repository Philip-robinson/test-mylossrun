import { validate } from './validate';

describe('validate', () => {
  const dummyBaseUrl = 'https://api.example.com';
  let previousBaseUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn();
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

  function mockResponse({ ok = true, status = 200, body = {} } = {}) {
    return {
      ok,
      status,
      text: async () => JSON.stringify(body),
    };
  }

  it('POSTs the back end validate endpoint with the right headers, cache and body', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { valid: true } }));

    await validate('CODE123', 'user@example.com');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/mylossrun/validate');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.cache).toBe('no-store');
    expect(JSON.parse(options.body)).toEqual({
      access_code: 'CODE123',
      email: 'user@example.com',
    });
  });

  it('trims the access code and email', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { valid: true } }));

    await validate('  CODE  ', '  user@example.com  ');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      access_code: 'CODE',
      email: 'user@example.com',
    });
  });

  it('sends email: null when called with no email', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { valid: true } }));

    await validate('CODE');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      access_code: 'CODE',
      email: null,
    });
  });

  it('sends email: null when called with an empty email', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { valid: true } }));

    await validate('CODE', '');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      access_code: 'CODE',
      email: null,
    });
  });

  it('rejects an empty access code without fetching', async () => {
    await expect(validate('')).rejects.toThrow('Access code is required');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the parsed body on success', async () => {
    global.fetch.mockResolvedValue(
      mockResponse({ body: { success: true, valid: true } })
    );

    const result = await validate('CODE', 'user@example.com');

    expect(result).toEqual({ success: true, valid: true });
  });

  it('returns the parsed body even on logical failure ({ valid: false })', async () => {
    global.fetch.mockResolvedValue(
      mockResponse({ body: { valid: false } })
    );

    const result = await validate('BADCODE', 'user@example.com');

    expect(result).toEqual({ valid: false });
  });

  it('throws on a non-ok HTTP response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(validate('CODE', 'user@example.com')).rejects.toThrow(
      'validate-access-code request failed (500)'
    );
  });

  it('throws on a network error', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    await expect(validate('CODE', 'user@example.com')).rejects.toThrow();
  });
});
