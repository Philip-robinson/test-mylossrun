import { upload, finishUpload } from './upload';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => {
  const fn = jest.fn();
  fn.error = jest.fn();
  fn.success = jest.fn();
  return { __esModule: true, default: fn };
});

// Let any fired-and-forgotten background promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('upload service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  function makeFile() {
    return new File(['pdf-bytes'], 'loss-run.pdf', { type: 'application/pdf' });
  }

  function okJson(body) {
    return { ok: true, status: 200, json: async () => body };
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
    expect(url).toBe('/api/allocate-pdf-id');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Access-Code']).toBe('test-code');
    expect(JSON.parse(opts.body)).toEqual({ name: 'loss-run.pdf' });
  });

  it('backgrounds initiate (with the pdfId) then start-processing', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ pdfId: 'pdf-123' })) // allocate
      .mockResolvedValueOnce(okJson({ success: true, pdfId: 'pdf-123' })) // initiate
      .mockResolvedValueOnce(okJson({ success: true })); // start

    await upload(makeFile());
    await flush();

    expect(fetch).toHaveBeenCalledTimes(3);

    const [initUrl, initOpts] = fetch.mock.calls[1];
    expect(initUrl).toBe('/api/initiate-pdf-upload');
    expect(initOpts.method).toBe('POST');
    expect(initOpts.body).toBeInstanceOf(FormData);
    expect(initOpts.body.get('file')).toBeInstanceOf(File);
    expect(initOpts.body.get('pdfId')).toBe('pdf-123');
    // multipart: browser sets the boundary, so no explicit Content-Type.
    expect(initOpts.headers['Content-Type']).toBeUndefined();

    const [startUrl, startOpts] = fetch.mock.calls[2];
    expect(startUrl).toBe('/api/start-pdf-processing');
    expect(startOpts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(startOpts.body)).toEqual({ pdfId: 'pdf-123' });
  });

  it('throws when allocate-pdf-id is non-ok and does no background work', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await expect(upload(makeFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when allocate returns no pdfId', async () => {
    fetch.mockResolvedValueOnce(okJson({}));

    await expect(upload(makeFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a background failure via a toast (upload still resolves)', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ pdfId: 'pdf-123' })) // allocate
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); // initiate fails

    const result = await upload(makeFile());
    expect(result).toEqual({ success: true, pdfId: 'pdf-123' });

    await flush();
    expect(toast.error).toHaveBeenCalled();
  });

  describe('finishUpload', () => {
    it('sends initiate with the pdfId then start-processing', async () => {
      fetch
        .mockResolvedValueOnce(okJson({ success: true, pdfId: 'pdf-9' }))
        .mockResolvedValueOnce(okJson({ success: true }));

      await finishUpload(makeFile(), 'pdf-9');

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][1].body.get('pdfId')).toBe('pdf-9');
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ pdfId: 'pdf-9' });
    });

    it('throws when start-pdf-processing is non-ok', async () => {
      fetch
        .mockResolvedValueOnce(okJson({ success: true, pdfId: 'pdf-9' }))
        .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });

      await expect(finishUpload(makeFile(), 'pdf-9')).rejects.toThrow();
    });
  });
});
