import { saveBlob, excelFilename } from 'components/pdfTableViewer/exportUtils';
import { downloadOriginalPdf, exportDocumentWorkbook } from './documentActions';

jest.mock('components/pdfTableViewer/exportUtils', () => ({
  ...jest.requireActual('components/pdfTableViewer/exportUtils'),
  saveBlob: jest.fn(),
}));

describe('documentActions service', () => {
  const pdfBlob = { kind: 'pdf blob' };
  const workbookBlob = { kind: 'workbook blob' };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('access_code', 'code-1');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function reply({ ok = true, status = 200, blob = null, body = null } = {}) {
    return { ok, status, blob: async () => blob, json: async () => body };
  }

  describe('downloadOriginalPdf', () => {
    it('fetches the encoded original and saves it under the document name', async () => {
      global.fetch.mockResolvedValue(reply({ blob: pdfBlob }));

      await downloadOriginalPdf({ pdfId: 'a b', name: 'losses.pdf' });

      expect(global.fetch).toHaveBeenCalledWith('/api/original-pdf/a%20b', {
        method: 'GET',
        headers: { 'X-Access-Code': 'code-1' },
      });
      expect(saveBlob).toHaveBeenCalledWith(pdfBlob, 'losses.pdf');
    });

    it('rejects on a non-OK response and saves nothing', async () => {
      global.fetch.mockResolvedValue(reply({ ok: false, status: 404 }));

      await expect(downloadOriginalPdf({ pdfId: 'p1', name: 'losses.pdf' })).rejects.toThrow(
        'downloadOriginalPdf failed: 404'
      );
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });

  describe('exportDocumentWorkbook', () => {
    const metadata = {
      name: 'losses.pdf',
      tables: [
        { tableId: 't-1' },
        { tableId: 't-2', deleted: true },
        { tableId: 't-3' },
      ],
    };

    function mockRoutes({ meta = metadata, excel = reply({ blob: workbookBlob }) } = {}) {
      global.fetch.mockImplementation(async (url) =>
        url === '/api/to-excel' ? excel : reply({ body: meta })
      );
    }

    function toExcelCalls() {
      return global.fetch.mock.calls.filter(([url]) => url === '/api/to-excel');
    }

    it('exports the live top-level tables and saves the workbook', async () => {
      mockRoutes();

      await exportDocumentWorkbook({ pdfId: 'p1', name: 'losses.pdf' });

      expect(global.fetch.mock.calls[0][0]).toBe('/api/metadata/p1');
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
