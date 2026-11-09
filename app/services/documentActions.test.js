import { saveBlob, excelFilename } from 'components/pdfTableViewer/exportUtils';
import { downloadOriginalPdf, exportDocumentWorkbook } from './documentActions';

jest.mock('components/pdfTableViewer/exportUtils', () => ({
  ...jest.requireActual('components/pdfTableViewer/exportUtils'),
  saveBlob: jest.fn(),
}));

const API_URL = 'https://api.example.com';

describe('documentActions service', () => {
  const pdfBlob = { kind: 'pdf blob' };
  const workbookBlob = { kind: 'workbook blob' };
  let previousBaseUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    previousBaseUrl = process.env.MYLOSSRUN_BASE_URL;
    process.env.MYLOSSRUN_BASE_URL = API_URL;
    localStorage.setItem('access_code', 'code-1');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    localStorage.clear();
    if (previousBaseUrl === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = previousBaseUrl;
    }
  });

  function reply({ ok = true, status = 200, blob = null, body = null } = {}) {
    return { ok, status, blob: async () => blob, text: async () => JSON.stringify(body) };
  }

  describe('downloadOriginalPdf', () => {
    const originalUrl = `${API_URL}/mylossrun/original-pdf/a%20b`;
    const downloadUrl = 'https://bucket.example.com/original';

    function mockRoutes({ original = reply({ body: { downloadUrl } }), file = reply({ blob: pdfBlob }) } = {}) {
      global.fetch.mockImplementation(async (url) => (url === downloadUrl ? file : original));
    }

    it('fetches the presigned URL for the encoded original and saves its blob under the document name', async () => {
      mockRoutes();

      await downloadOriginalPdf({ pdfId: 'a b', name: 'losses.pdf' });

      expect(global.fetch).toHaveBeenNthCalledWith(1, originalUrl, {
        method: 'GET',
        headers: { 'X-Access-Code': 'code-1' },
        cache: 'no-store',
      });
      expect(global.fetch).toHaveBeenNthCalledWith(2, downloadUrl, { cache: 'no-store' });
      expect(saveBlob).toHaveBeenCalledWith(pdfBlob, 'losses.pdf');
    });

    it('rejects on a non-OK back-end response and saves nothing', async () => {
      mockRoutes({ original: reply({ ok: false, status: 404 }) });

      await expect(downloadOriginalPdf({ pdfId: 'a b', name: 'losses.pdf' })).rejects.toThrow(
        'downloadOriginalPdf failed: 404'
      );
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it('rejects on a non-OK download and saves nothing', async () => {
      mockRoutes({ file: reply({ ok: false, status: 403 }) });

      await expect(downloadOriginalPdf({ pdfId: 'a b', name: 'losses.pdf' })).rejects.toThrow(
        'Original PDF download failed: 403'
      );
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });

  describe('exportDocumentWorkbook', () => {
    const metadataUrl = `${API_URL}/mylossrun/metadata/p1`;
    const toExcelUrl = `${API_URL}/mylossrun/to-excel`;
    const workbookUrl = 'https://bucket.example.com/workbook';
    const metadata = {
      name: 'losses.pdf',
      tables: [
        { tableId: 't-1' },
        { tableId: 't-2', deleted: true },
        { tableId: 't-3' },
      ],
    };

    function mockRoutes({
      meta = metadata,
      excel = reply({ body: { downloadUrl: workbookUrl } }),
    } = {}) {
      global.fetch.mockImplementation(async (url) => {
        if (url === metadataUrl) return reply({ body: meta });
        if (url === toExcelUrl) return excel;
        if (url === workbookUrl) return reply({ blob: workbookBlob });
        throw new Error(`unexpected fetch: ${url}`);
      });
    }

    function toExcelCalls() {
      return global.fetch.mock.calls.filter(([url]) => url === toExcelUrl);
    }

    it('exports the live top-level tables and saves the workbook', async () => {
      mockRoutes();

      await exportDocumentWorkbook({ pdfId: 'p1', name: 'losses.pdf' });

      expect(global.fetch.mock.calls[0][0]).toBe(metadataUrl);
      const [[, options]] = toExcelCalls();
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        pdfId: 'p1',
        rootTableIds: ['t-1', 't-3'],
        filename: 'losses.xlsx',
      });
      expect(excelFilename(metadata.name)).toBe('losses.xlsx');
      expect(saveBlob).toHaveBeenCalledWith(workbookBlob, 'losses.xlsx');
    });

    it.each([
      ['empty', []],
      ['all deleted', [{ tableId: 't-1', deleted: true }]],
    ])('rejects when the tables are %s and makes no export request', async (_label, tables) => {
      mockRoutes({ meta: { ...metadata, tables } });

      await expect(exportDocumentWorkbook({ pdfId: 'p1', name: 'losses.pdf' })).rejects.toThrow(
        'This document has no tables to export'
      );
      expect(toExcelCalls()).toHaveLength(0);
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it('rejects on a non-OK export and saves nothing', async () => {
      mockRoutes({ excel: reply({ ok: false, status: 502 }) });

      await expect(exportDocumentWorkbook({ pdfId: 'p1', name: 'losses.pdf' })).rejects.toThrow();
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });
});
