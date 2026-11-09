import { upload, finishUpload } from './upload';
import { sha256Base64 } from './fileHash';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => {
  const fn = jest.fn();
  fn.error = jest.fn();
  fn.success = jest.fn();
  return { __esModule: true, default: fn };
});

jest.mock('./fileHash', () => ({ sha256Base64: jest.fn().mockResolvedValue('hash-b64') }));

// Let any fired-and-forgotten background promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const dummyBaseUrl = 'https://api.example.com';
const presignedUploadUrl = 'https://s3.example.com/upload?signature=abc';

describe('upload service', () => {
  let previousBaseUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    previousBaseUrl = process.env.MYLOSSRUN_BASE_URL;
    process.env.MYLOSSRUN_BASE_URL = dummyBaseUrl;
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = previousBaseUrl;
    }
  });

  function makeFile() {
    return new File(['pdf-bytes'], 'loss-run.pdf', { type: 'application/pdf' });
  }

  function okJson(body) {
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }

  function okPut() {
    return { ok: true, status: 200 };
  }

  function notOk(status) {
    return { ok: false, status };
  }

  it('allocates an id from the filename and resolves with it immediately', async () => {
    // allocate resolves; initiate is pending (never resolves) — upload must still return.
    fetch
      .mockResolvedValueOnce(okJson({ pdfId: 'pdf-123' }))
      .mockImplementationOnce(() => new Promise(() => {}));

    const result = await upload(makeFile());

    expect(result).toEqual({ success: true, pdfId: 'pdf-123' });

    // First call is allocate-pdf-id with just the filename as JSON.
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/mylossrun/allocate-pdf-id');
    expect(opts.method).toBe('POST');
    expect(opts.cache).toBe('no-store');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Access-Code']).toBe('test-code');
    expect(JSON.parse(opts.body)).toEqual({ name: 'loss-run.pdf' });
  });

  it('backgrounds initiate, the S3 PUT, then start-processing', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ pdfId: 'pdf-123' })) // allocate
      .mockResolvedValueOnce(okJson({ presignedUploadUrl, pdfId: 'pdf-123' })) // initiate
      .mockResolvedValueOnce(okPut()) // S3 PUT
      .mockResolvedValueOnce(okJson({ success: true })); // start

    const file = makeFile();
    await upload(file);
    await flush();

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sha256Base64).toHaveBeenCalledWith(file);

    const [initUrl, initOpts] = fetch.mock.calls[1];
    expect(initUrl).toBe('https://api.example.com/mylossrun/initiate-pdf-upload');
    expect(initOpts.method).toBe('POST');
    expect(initOpts.cache).toBe('no-store');
    expect(initOpts.headers['Content-Type']).toBe('application/json');
    expect(initOpts.headers['X-Access-Code']).toBe('test-code');
    expect(JSON.parse(initOpts.body)).toEqual({
      pdfId: 'pdf-123',
      name: 'loss-run.pdf',
      hash: 'hash-b64',
    });

    const [putUrl, putOpts] = fetch.mock.calls[2];
    expect(putUrl).toBe(presignedUploadUrl);
    expect(putOpts.method).toBe('PUT');
    expect(putOpts.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(putOpts.body).toBe(file);

    const [startUrl, startOpts] = fetch.mock.calls[3];
    expect(startUrl).toBe('https://api.example.com/mylossrun/start-pdf-processing');
    expect(startOpts.method).toBe('POST');
    expect(startOpts.cache).toBe('no-store');
    expect(startOpts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(startOpts.body)).toEqual({ pdfId: 'pdf-123' });
  });

  it('throws when allocate-pdf-id is non-ok and does no background work', async () => {
    fetch.mockResolvedValueOnce(notOk(500));

    await expect(upload(makeFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sha256Base64).not.toHaveBeenCalled();
  });

  it('throws when allocate returns no pdfId', async () => {
    fetch.mockResolvedValueOnce(okJson({}));

    await expect(upload(makeFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sha256Base64).not.toHaveBeenCalled();
  });

  it('surfaces a background failure via a toast (upload still resolves)', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ pdfId: 'pdf-123' })) // allocate
      .mockResolvedValueOnce(notOk(500)); // initiate fails

    const result = await upload(makeFile());
    expect(result).toEqual({ success: true, pdfId: 'pdf-123' });

    await flush();
    expect(toast.error).toHaveBeenCalledWith('initiate-pdf-upload failed with status 500');
  });

  describe('finishUpload', () => {
    it('sends initiate with the pdfId, the PUT, then start-processing', async () => {
      fetch
        .mockResolvedValueOnce(okJson({ presignedUploadUrl, pdfId: 'pdf-9' }))
        .mockResolvedValueOnce(okPut())
        .mockResolvedValueOnce(okJson({ success: true }));

      await finishUpload(makeFile(), 'pdf-9');

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(JSON.parse(fetch.mock.calls[0][1].body).pdfId).toBe('pdf-9');
      expect(fetch.mock.calls[1][0]).toBe(presignedUploadUrl);
      expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ pdfId: 'pdf-9' });
    });

    it('throws when initiate-pdf-upload is non-ok', async () => {
      fetch.mockResolvedValueOnce(notOk(500));

      await expect(finishUpload(makeFile(), 'pdf-9')).rejects.toThrow(
        'initiate-pdf-upload failed with status 500',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('throws when initiate-pdf-upload returns no presignedUploadUrl', async () => {
      fetch.mockResolvedValueOnce(okJson({ pdfId: 'pdf-9' }));

      await expect(finishUpload(makeFile(), 'pdf-9')).rejects.toThrow(
        'initiate-pdf-upload returned no upload URL',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('throws when the S3 PUT is non-ok and does not start processing', async () => {
      fetch
        .mockResolvedValueOnce(okJson({ presignedUploadUrl, pdfId: 'pdf-9' }))
        .mockResolvedValueOnce(notOk(403));

      await expect(finishUpload(makeFile(), 'pdf-9')).rejects.toThrow(
        'S3 upload failed with status 403',
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws when start-pdf-processing is non-ok', async () => {
      fetch
        .mockResolvedValueOnce(okJson({ presignedUploadUrl, pdfId: 'pdf-9' }))
        .mockResolvedValueOnce(okPut())
        .mockResolvedValueOnce(notOk(502));

      await expect(finishUpload(makeFile(), 'pdf-9')).rejects.toThrow(
        'start-pdf-processing failed with status 502',
      );
    });
  });
});
