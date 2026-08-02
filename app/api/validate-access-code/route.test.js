/** @jest-environment node */

jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

describe('POST /api/validate-access-code', () => {
  let POST;

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({ POST } = require('./route'));
  });

  const makeRequest = (body) => ({ json: async () => body });

  test('returns 400 when access_code is missing and does not call fetch', async () => {
    const response = await POST(makeRequest({ email: 'a@b.com' }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ success: false, error: 'Access code is required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('trims access_code and sends email trimmed', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, token: 'abc' }),
    });

    const response = await POST(
      makeRequest({ access_code: '  CODE123  ', email: '  user@example.com  ' })
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/mylossrun/validate');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(
      JSON.stringify({ access_code: 'CODE123', email: 'user@example.com' })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ success: true, token: 'abc' });
  });

  test('email becomes null when falsy', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, token: 'abc' }),
    });

    await POST(makeRequest({ access_code: 'CODE123' }));

    const [, options] = global.fetch.mock.calls[0];
    expect(options.body).toBe(
      JSON.stringify({ access_code: 'CODE123', email: null })
    );
  });

  test('does not send an X-Access-Code header', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, token: 'abc' }),
    });

    await POST(makeRequest({ access_code: 'CODE123' }));

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.headers['X-Access-Code']).toBeUndefined();
  });

  test('returns 500 when upstream is not ok', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    });

    const response = await POST(makeRequest({ access_code: 'CODE123' }));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(typeof data.error).toBe('string');
  });
});
