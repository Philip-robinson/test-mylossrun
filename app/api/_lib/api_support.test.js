/** @jest-environment node */

// 'common/logger' is a webpack alias (next.config.js) not visible to Jest's
// resolver, so mock it virtually.
jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }), { virtual: true });

const { gzipSync } = require('node:zlib');

describe('api_support helper', () => {
  let requireAccessCode;
  let proxyJsonPost;
  let proxyJsonGet;
  let proxyJsonPut;
  let readEnvelopeData;
  let logRequest;
  let errorResponse;
  let logger;
  let NextResponse;

  const sentBody = { pdfId: '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a', page: 2 };
  const fixture = { success: true, image: 'data:image/png;base64,abc' };

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    ({
      requireAccessCode,
      proxyJsonPost,
      proxyJsonGet,
      proxyJsonPut,
      readEnvelopeData,
      logRequest,
      errorResponse,
    } = require('./api_support'));
    ({ NextResponse } = require('next/server'));
    logger = require('common/logger');
  });

  function makeRequest({
    headers = { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
    body = sentBody,
  } = {}) {
    return new Request('http://localhost/api/get-image', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function makeGetRequest({
    headers = { 'X-Access-Code': 'code-1' },
  } = {}) {
    return new Request('http://localhost/api/metadata', { method: 'GET', headers });
  }

  function makePutRequest({
    headers = { 'X-Access-Code': 'code-1', 'Content-Type': 'application/json' },
    body = sentBody,
  } = {}) {
    return new Request('http://localhost/api/metadata', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
  }

  // readEnvelopeData reads response.arrayBuffer(), so upstream mocks must expose
  // arrayBuffer(), not json()/text().
  function bodyResponse(obj, { status = 200 } = {}) {
    const text = obj === undefined ? '' : JSON.stringify(obj);
    return { status, arrayBuffer: async () => Buffer.from(text, 'utf-8') };
  }

  function gzipResponse(obj, { status = 200 } = {}) {
    return {
      status,
      arrayBuffer: async () => gzipSync(Buffer.from(JSON.stringify(obj), 'utf-8')),
    };
  }

  const inline = (data) => ({ presentationType: 'INLINE', data });

  describe('logRequest', () => {
    it('logs the request method and url via logger.info', () => {
      logRequest({ method: 'POST', url: 'http://localhost/api/get-image' });

      expect(logger.info).toHaveBeenCalledWith('POST http://localhost/api/get-image');
    });
  });

  describe('errorResponse', () => {
    it('logs the labelled error and returns a 500 with the error message', async () => {
      const response = errorResponse('Get image', new Error('boom'));

      expect(logger.error).toHaveBeenCalled();
      expect(response).toBeInstanceOf(NextResponse);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ success: false, error: 'boom' });
    });
  });

  describe('requireAccessCode', () => {
    it('returns the access-code string when present', () => {
      const result = requireAccessCode(makeRequest());
      expect(result).toBe('code-1');
    });

    it('returns a 401 NextResponse when the header is absent', async () => {
      const result = requireAccessCode(
        makeRequest({ headers: { 'Content-Type': 'application/json' } })
      );
      expect(result).toBeInstanceOf(NextResponse);
      expect(result.status).toBe(401);
      const body = await result.json();
      expect(body).toEqual({ success: false, error: 'Access code required' });
    });
  });

  describe('readEnvelopeData', () => {
    it('returns .data for an INLINE envelope', async () => {
      const response = bodyResponse(inline(fixture));

      const data = await readEnvelopeData(response);

      expect(data).toEqual(fixture);
    });

    it('follows a BY_URL envelope to its cache object and returns the inner .data', async () => {
      const cacheUrl = 'https://api.example.com/cache/abc123.json.gz';
      const response = bodyResponse({ presentationType: 'BY_URL', url: cacheUrl });
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      const data = await readEnvelopeData(response);

      expect(data).toEqual(fixture);
      expect(global.fetch).toHaveBeenCalledWith(
        cacheUrl,
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    it('gunzips a gzip-compressed body before parsing and unwrapping', async () => {
      const response = gzipResponse(inline(fixture));

      const data = await readEnvelopeData(response);

      expect(data).toEqual(fixture);
    });

    it('parses an already-decoded (plain JSON text) body without double-decoding', async () => {
      const response = bodyResponse(inline(fixture));

      const data = await readEnvelopeData(response);

      expect(data).toEqual(fixture);
    });

    it('passes a non-enveloped body through unchanged (backward compatible)', async () => {
      const plain = { success: true, foo: 'bar' };
      const response = bodyResponse(plain);

      const data = await readEnvelopeData(response);

      expect(data).toEqual(plain);
    });

    it('returns {} for an empty body when tolerateEmpty is set', async () => {
      const response = bodyResponse(undefined);

      const data = await readEnvelopeData(response, { tolerateEmpty: true });

      expect(data).toEqual({});
    });
  });

  describe('proxyJsonPost', () => {
    it('forwards the parsed body and X-Access-Code header to the upstream fetch', async () => {
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      await proxyJsonPost(makeRequest(), '/mylossrun/get-image', 'Get image');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/mylossrun/get-image',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Code': 'code-1' },
          body: JSON.stringify(sentBody),
          cache: 'no-store',
        })
      );
    });

    it('returns the upstream JSON body and status unchanged', async () => {
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      const response = await proxyJsonPost(makeRequest(), '/mylossrun/get-image', 'Get image');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(fixture);
    });

    it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
      const response = await proxyJsonPost(
        makeRequest({ headers: { 'Content-Type': 'application/json' } }),
        '/mylossrun/get-image',
        'Get image'
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ success: false, error: 'Access code required' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('propagates the upstream HTTP status', async () => {
      global.fetch.mockResolvedValue(
        bodyResponse({ success: false, error: 'not found' }, { status: 404 })
      );

      const response = await proxyJsonPost(makeRequest(), '/mylossrun/get-image', 'Get image');

      expect(response.status).toBe(404);
    });

    it('returns 500 with the error message when fetch rejects', async () => {
      global.fetch.mockRejectedValue(new Error('boom'));

      const response = await proxyJsonPost(makeRequest(), '/mylossrun/get-image', 'Get image');
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'boom' });
    });
  });

  describe('proxyJsonGet', () => {
    it('forwards a GET with the X-Access-Code header and cache: no-store', async () => {
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      await proxyJsonGet(makeGetRequest(), '/mylossrun/metadata', 'Get metadata');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/mylossrun/metadata',
        expect.objectContaining({
          method: 'GET',
          headers: { 'X-Access-Code': 'code-1' },
          cache: 'no-store',
        })
      );
    });

    it('returns the upstream JSON body and status unchanged', async () => {
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      const response = await proxyJsonGet(makeGetRequest(), '/mylossrun/metadata', 'Get metadata');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(fixture);
    });

    it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
      const response = await proxyJsonGet(
        makeGetRequest({ headers: {} }),
        '/mylossrun/metadata',
        'Get metadata'
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ success: false, error: 'Access code required' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 500 with the error message when fetch rejects', async () => {
      global.fetch.mockRejectedValue(new Error('boom'));

      const response = await proxyJsonGet(makeGetRequest(), '/mylossrun/metadata', 'Get metadata');
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'boom' });
    });
  });

  describe('proxyJsonPut', () => {
    it('forwards a PUT with Content-Type, X-Access-Code and the stringified body', async () => {
      global.fetch.mockResolvedValue(bodyResponse(undefined));

      await proxyJsonPut(makePutRequest(), '/mylossrun/metadata', 'Put metadata');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/mylossrun/metadata',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Access-Code': 'code-1' },
          body: JSON.stringify(sentBody),
          cache: 'no-store',
        })
      );
    });

    it('tolerates an empty 200 upstream body and returns {} with status 200', async () => {
      global.fetch.mockResolvedValue(bodyResponse(undefined));

      const response = await proxyJsonPut(makePutRequest(), '/mylossrun/metadata', 'Put metadata');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({});
    });

    it('returns a non-empty upstream JSON body and status unchanged', async () => {
      global.fetch.mockResolvedValue(bodyResponse(inline(fixture)));

      const response = await proxyJsonPut(makePutRequest(), '/mylossrun/metadata', 'Put metadata');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(fixture);
    });

    it('returns 401 and does not call fetch when X-Access-Code is missing', async () => {
      const response = await proxyJsonPut(
        makePutRequest({ headers: { 'Content-Type': 'application/json' } }),
        '/mylossrun/metadata',
        'Put metadata'
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ success: false, error: 'Access code required' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 500 with the error message when fetch rejects', async () => {
      global.fetch.mockRejectedValue(new Error('boom'));

      const response = await proxyJsonPut(makePutRequest(), '/mylossrun/metadata', 'Put metadata');
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'boom' });
    });
  });
});
