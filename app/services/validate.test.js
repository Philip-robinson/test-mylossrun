import { validate } from './validate';

describe('validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn();
  });

  function mockResponse({ ok = true, status = 200, body = {} } = {}) {
    return {
      ok,
      status,
      json: jest.fn().mockResolvedValue(body),
    };
  }

  it('POSTs /api/validate-access-code with the right headers and body', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { valid: true } }));

    await validate('CODE123', 'user@example.com');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/validate-access-code');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.headers).not.toHaveProperty('X-Access-Code');
    expect(JSON.parse(options.body)).toEqual({
      access_code: 'CODE123',
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
    global.fetch.mockResolvedValue(
      mockResponse({ ok: false, status: 500, body: {} })
    );

    await expect(validate('CODE', 'user@example.com')).rejects.toThrow();
  });

  it('throws on a network error', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    await expect(validate('CODE', 'user@example.com')).rejects.toThrow();
  });
});
