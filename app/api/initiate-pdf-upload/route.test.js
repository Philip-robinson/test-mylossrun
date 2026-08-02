/** @jest-environment node */

const crypto = require('crypto');

jest.mock('common/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const FILE_BYTES = '%PDF-1.4';
const EXPECTED_HASH = crypto.createHash('sha256').update(Buffer.from(FILE_BYTES)).digest('base64');

const PRESIGNED_URL = 'https://api.example.com/s3-presigned-put';
const PDF_ID = 'pdf-123';

function buildRequest({ withFile = true, withAccessCode = true, withPdfId = true } = {}) {
  const formData = new FormData();
  if (withFile) {
    formData.append('file', new File([FILE_BYTES], 'a.pdf', { type: 'application/pdf' }));
  }
  if (withPdfId) {
    formData.append('pdfId', PDF_ID);
  }
  const headers = withAccessCode ? { 'X-Access-Code': 'code-1' } : {};
  return new Request('http://localhost/api/initiate-pdf-upload', {
    method: 'POST',
    headers,
    body: formData,
  });
}

describe('POST /api/initiate-pdf-upload', () => {
  let POST;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    global.fetch = jest.fn();
    logger = require('common/logger');
    logger.error.mockClear();
    ({ POST } = require('./route'));
  });

  it('returns 401 when the X-Access-Code header is missing and does not call fetch', async () => {
    const response = await POST(buildRequest({ withAccessCode: false }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Access code required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided and does not call fetch', async () => {
    const response = await POST(buildRequest({ withFile: false }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'File is required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('happy path: hashes server-side, initiates, PUTs to S3, returns only the pdfId', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ presignedUploadUrl: PRESIGNED_URL, pdfId: PDF_ID }) }) // initiate-pdf-upload
      .mockResolvedValueOnce({ ok: true, text: async () => '' }); // S3 presigned PUT

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, pdfId: PDF_ID });
    expect(body.presignedUploadUrl).toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [initiateUrl, initiateOptions] = global.fetch.mock.calls[0];
    expect(initiateUrl).toBe('https://api.example.com/mylossrun/initiate-pdf-upload');
    expect(initiateOptions.method).toBe('POST');
    expect(initiateOptions.headers['X-Access-Code']).toBe('code-1');
    expect(initiateOptions.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(initiateOptions.body)).toEqual({ pdfId: PDF_ID, name: 'a.pdf', hash: EXPECTED_HASH });

    const [putUrl, putOptions] = global.fetch.mock.calls[1];
    expect(putUrl).toBe(PRESIGNED_URL);
    expect(putOptions.method).toBe('PUT');
    expect(putOptions.headers['Content-Type']).toBe('application/pdf');
    expect(Buffer.from(putOptions.body).toString()).toBe(FILE_BYTES);
  });

  it('returns 500 and logs when initiate-pdf-upload is non-ok, and makes no S3 PUT', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'nope' });

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Initiate PDF upload failed: 500 nope' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns 500 and logs when the S3 PUT is non-ok', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ presignedUploadUrl: PRESIGNED_URL, pdfId: PDF_ID }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'denied' });

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'S3 upload failed: 403 denied' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });
});
