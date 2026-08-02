import {
  getImage,
  getThumbnails,
  getMetadata,
  saveTables,
  getTableImages,
  getCellImages,
  findTables,
  findGridLines,
  calculateCells,
  extractTable,
  tableToExcel,
} from './images';

describe('images service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_code', 'test-code');
    global.fetch = jest.fn();
  });

  function mockOk(json) {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(json),
    });
  }

  describe('getImage', () => {
    it('POSTs to /api/get-image with access code header and { pdfId, page, width }', async () => {
      mockOk({ success: true, image: 'data:image/png;base64,abc' });

      const result = await getImage('pdf-123', 2, 850);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/get-image');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({ pdfId: 'pdf-123', page: 2, width: 850 });
      expect(result).toEqual({ success: true, image: 'data:image/png;base64,abc' });
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ success: true });

      await getImage('pdf-123', 1, 850);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(getImage('pdf-123', 1, 850)).rejects.toThrow();
    });
  });

  describe('getThumbnails', () => {
    it('POSTs to /api/get-thumbnails with access code header and { pdfId, width }', async () => {
      mockOk({ success: true, thumbnails: [] });

      const result = await getThumbnails('pdf-123', 800);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/get-thumbnails');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({ pdfId: 'pdf-123', width: 800 });
      expect(result).toEqual({ success: true, thumbnails: [] });
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ success: true });

      await getThumbnails('pdf-123', 800);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(getThumbnails('pdf-123', 800)).rejects.toThrow();
    });
  });

  describe('getMetadata', () => {
    it('GETs /api/metadata/<id> with access code header and returns parsed JSON', async () => {
      const metadata = {
        pdfId: 'pdf-123',
        tables: [{ tableId: 't1', name: 'Table 1', pdfPage: 1, bounds: {}, cells: [] }],
      };
      mockOk(metadata);

      const result = await getMetadata('pdf-123');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/metadata/pdf-123');
      expect(options.method).toBe('GET');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(result).toEqual(metadata);
    });

    it('encodes the pdfId in the URL', async () => {
      mockOk({ tables: [] });

      await getMetadata('pdf 1/2');

      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/metadata/pdf%201%2F2');
    });

    it('throws on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: jest.fn(),
      });

      await expect(getMetadata('pdf-123')).rejects.toThrow();
    });
  });

  describe('saveTables', () => {
    it('PUTs /api/metadata/<id>/tables with full table objects and returns parsed JSON', async () => {
      const tables = [
        {
          tableId: 't1',
          name: 'Renamed',
          pdfPage: 1,
          bounds: { x: 0, y: 0, width: 100, height: 50 },
          cells: [{ row: 0, col: 0 }],
          columnWidths: [50, 50],
          rowHeights: [25, 25],
        },
      ];
      mockOk({ success: true, tables });

      const result = await saveTables('pdf-123', tables);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/metadata/pdf-123/tables');
      expect(options.method).toBe('PUT');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({ tables });
      expect(result).toEqual({ success: true, tables });
    });

    it('encodes the pdfId in the URL', async () => {
      mockOk({ success: true });

      await saveTables('pdf 1/2', []);

      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/metadata/pdf%201%2F2/tables');
    });

    it('includes colouredAreas in the body when provided', async () => {
      mockOk({ success: true });
      const colouredAreas = [
        {
          pdfPage: 0,
          colouredAreas: [
            {
              left: 0.1,
              top: 0.1,
              width: 0.2,
              height: 0.1,
              foreground: '#000000',
              background: '#ffff00',
            },
          ],
        },
      ];

      await saveTables('pdf-123', [], colouredAreas);

      const [, options] = global.fetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ tables: [], colouredAreas });
    });

    it('omits colouredAreas from the body when not provided', async () => {
      mockOk({ success: true });

      await saveTables('pdf-123', []);

      const [, options] = global.fetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ tables: [] });
      expect('colouredAreas' in JSON.parse(options.body)).toBe(false);
    });

    it('throws on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(saveTables('pdf-123', [])).rejects.toThrow();
    });
  });

  describe('getTableImages', () => {
    it('POSTs to /api/get-table-images with access code header and { pdfId, width, tableImages }', async () => {
      const tableImages = [
        { page: 0, tableId: 't-1', bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 } },
      ];
      mockOk({ images: { 't-1': 'abc' } });

      const result = await getTableImages('pdf-123', 150, tableImages);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/get-table-images');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({ pdfId: 'pdf-123', width: 150, tableImages });
      expect(result).toEqual({ images: { 't-1': 'abc' } });
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ images: {} });

      await getTableImages('pdf-123', 150, []);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(getTableImages('pdf-123', 150, [])).rejects.toThrow();
    });
  });

  describe('getCellImages', () => {
    const bounds = { left: 0.1, top: 0.2, width: 0.15, height: 0.03 };

    it('POSTs to /api/get-cell-images with access code header and { pdfId, page, width, bounds }', async () => {
      mockOk({ rawImage: 'raw-b64', processedImage: 'processed-b64' });

      const result = await getCellImages('pdf-123', 2, 600, bounds);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/get-cell-images');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({
        pdfId: 'pdf-123',
        page: 2,
        width: 600,
        bounds,
      });
      expect(result).toEqual({ rawImage: 'raw-b64', processedImage: 'processed-b64' });
    });

    // The cell is located by its page and its box alone — no table is ever looked up, so
    // a tableId must not appear on the wire.
    it('sends no keys beyond pdfId, page, width and bounds', async () => {
      mockOk({ rawImage: 'raw-b64', processedImage: 'processed-b64' });

      await getCellImages('pdf-123', 0, 600, bounds);

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(Object.keys(body)).toEqual(['pdfId', 'page', 'width', 'bounds']);
      expect('tableId' in body).toBe(false);
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ rawImage: 'raw-b64', processedImage: 'processed-b64' });

      await getCellImages('pdf-123', 0, 600, bounds);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: jest.fn(),
      });

      await expect(getCellImages('pdf-123', 0, 600, bounds)).rejects.toThrow(
        'getCellImages failed: 404'
      );
    });
  });

  describe('findTables', () => {
    it('POSTs to /api/find-tables with access code header and { pdfId, pages, mechanism: null }', async () => {
      const pages = [{ pdfPage: 1, tables: [{ bounds: { x: 0, y: 0, width: 100, height: 50 } }] }];
      mockOk({ tables: [{ tableId: 't1' }] });

      const result = await findTables('pdf-123', pages);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/find-tables');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({ pdfId: 'pdf-123', pages, mechanism: null });
      expect(result).toEqual({ tables: [{ tableId: 't1' }] });
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(findTables('pdf-123', [])).rejects.toThrow('findTables failed: 500');
    });
  });

  describe('findGridLines', () => {
    it('POSTs to /api/find-grid-lines with access code header and { pdfId, pdfPage, colouredAreas }', async () => {
      const colouredAreas = [
        {
          left: 0.1,
          top: 0.1,
          width: 0.2,
          height: 0.2,
          foreground: '#000000',
          background: '#ffff00',
        },
      ];
      mockOk({ tables: [{ tableInPage: 0 }] });

      const result = await findGridLines('pdf-123', 2, colouredAreas);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/find-grid-lines');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({
        pdfId: 'pdf-123',
        pdfPage: 2,
        colouredAreas,
      });
      expect(result).toEqual({ tables: [{ tableInPage: 0 }] });
    });

    // Called with only three arguments the wire shape must be byte-identical to the
    // pre-hint version — an explicit `tables: undefined` would still serialise the key
    // away, but `in` is checked so a future `tables: null` default cannot creep in.
    it('omits the tables key entirely when no hint list is supplied', async () => {
      mockOk({ tables: [] });

      await findGridLines('pdf-123', 2, []);

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect('tables' in body).toBe(false);
      expect(body).toEqual({ pdfId: 'pdf-123', pdfPage: 2, colouredAreas: [] });
    });

    it('passes a supplied hint list through as the tables key, untouched', async () => {
      const hints = [
        {
          name: 'Table 1',
          tableInPage: 0,
          left: 0.1,
          top: 0.2,
          width: 0.5,
          height: 0.4,
          expectedColumns: 6,
          expectedRows: 12,
        },
        {
          name: 'Table 2',
          tableInPage: 1,
          left: 0.1,
          top: 0.7,
          width: 0.5,
          height: 0.2,
        },
      ];
      mockOk({ tables: [] });

      await findGridLines('pdf-123', 2, [], hints);

      const [, options] = global.fetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        pdfId: 'pdf-123',
        pdfPage: 2,
        colouredAreas: [],
        tables: hints,
      });
    });

    // Collapsing an empty hint list to "no hints" is the caller's decision, not ours.
    it('sends tables: [] when an empty hint list is supplied', async () => {
      mockOk({ tables: [] });

      await findGridLines('pdf-123', 2, [], []);

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect('tables' in body).toBe(true);
      expect(body.tables).toEqual([]);
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ tables: [] });

      await findGridLines('pdf-123', 0, []);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(findGridLines('pdf-123', 0, [])).rejects.toThrow(
        'findGridLines failed: 500'
      );
    });
  });

  describe('calculateCells', () => {
    const colouredAreas = [
      {
        left: 0.1,
        top: 0.1,
        width: 0.2,
        height: 0.2,
        foreground: '#000000',
        background: '#ffff00',
      },
    ];

    it('POSTs to /api/calculate-cells with access code header and { pdfId, pdfPage, colouredAreas, tables }', async () => {
      const tables = [
        {
          tableInPage: 0,
          left: 0.1,
          top: 0.2,
          width: 0.5,
          height: 0.4,
          cells: [{ left: 0.1, top: 0.2, width: 0.25, height: 0.1, row: 0, column: 0 }],
        },
      ];
      mockOk({ pdfPage: 2, tables: [{ tableInPage: 0, cells: [] }] });

      const result = await calculateCells('pdf-123', 2, colouredAreas, tables);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/calculate-cells');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual({
        pdfId: 'pdf-123',
        pdfPage: 2,
        colouredAreas,
        tables,
      });
      expect(result).toEqual({ pdfPage: 2, tables: [{ tableInPage: 0, cells: [] }] });
    });

    // Every rectangle handed to this service is already known-correct, so the body must
    // be exactly what the caller passed — bounds, per-cell row/column, title and specials
    // all forwarded verbatim with nothing derived, reordered or dropped.
    it('passes table rectangles, cell row/column, the title rectangle and specials through untouched', async () => {
      const tables = [
        {
          tableInPage: 0,
          left: 0.1,
          top: 0.2,
          width: 0.5,
          height: 0.4,
          cells: [
            { left: 0.1, top: 0.2, width: 0.25, height: 0.1, row: 0, column: 0 },
            { left: 0.35, top: 0.2, width: 0.25, height: 0.1, row: 0, column: 1 },
            { left: 0.1, top: 0.3, width: 0.25, height: 0.1, row: 1, column: 0 },
          ],
          title: { left: 0.1, top: 0.15, width: 0.5, height: 0.04 },
          specials: [
            { left: 0.1, top: 0.55, width: 0.5, height: 0.05 },
            { left: 0.1, top: 0.61, width: 0.5, height: 0.03 },
          ],
        },
        {
          tableInPage: 1,
          left: 0.1,
          top: 0.7,
          width: 0.5,
          height: 0.2,
          cells: [{ left: 0.1, top: 0.7, width: 0.5, height: 0.2, row: 0, column: 0 }],
        },
      ];
      mockOk({ pdfPage: 3, tables: [] });

      await calculateCells('pdf-123', 3, colouredAreas, tables);

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.tables).toEqual(tables);
      expect(Object.keys(body)).toEqual(['pdfId', 'pdfPage', 'colouredAreas', 'tables']);
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ pdfPage: 0, tables: [] });

      await calculateCells('pdf-123', 0, [], []);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(calculateCells('pdf-123', 0, [], [])).rejects.toThrow(
        'calculateCells failed: 500'
      );
    });
  });

  describe('extractTable', () => {
    it('GETs /api/extract/<pdfId>/<tableId> with access code header and returns parsed JSON', async () => {
      const body = {
        table: {
          columns: 9,
          rows: 7,
          cells: [{ row: 0, column: 0, text: 'A', confidence: 99 }],
        },
      };
      mockOk(body);

      const result = await extractTable('pdf-123', 't-1');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/extract/pdf-123/t-1');
      expect(options.method).toBe('GET');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(result).toEqual(body);
    });

    it('encodes the pdfId and tableId in the URL', async () => {
      mockOk({ table: {} });

      await extractTable('pdf 1/2', 't 3/4');

      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/extract/pdf%201%2F2/t%203%2F4');
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ table: {} });

      await extractTable('pdf-123', 't-1');

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(extractTable('pdf-123', 't-1')).rejects.toThrow('extractTable failed: 500');
    });
  });

  describe('tableToExcel', () => {
    const body = {
      pdfId: 'pdf-123',
      rootTableId: 't-1',
      originalFilename: 'losses.pdf',
      name: 'Table 1',
      title: {
        tableId: 't-1',
        text: 'Losses',
        confidence: 88,
        bounds: { left: 0.1, top: 0.15, width: 0.5, height: 0.04 },
      },
      headerCount: 1,
      cells: [
        [{ tableId: 't-1', row: 0, column: 0, text: 'Claim', confidence: 92 }],
        [{ tableId: 't-1', row: 1, column: 0, text: '1,000', confidence: 71 }],
      ],
    };

    it('POSTs the body to /api/to-excel with access code header and JSON content type', async () => {
      mockOk({ downloadUrl: 'https://api.example.com/download/abc', key: 'exports/abc.xlsx' });

      const result = await tableToExcel(body);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/to-excel');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Access-Code']).toBe('test-code');
      expect(JSON.parse(options.body)).toEqual(body);
      expect(result).toEqual({
        downloadUrl: 'https://api.example.com/download/abc',
        key: 'exports/abc.xlsx',
      });
    });

    it('omits X-Access-Code when localStorage is empty', async () => {
      localStorage.clear();
      mockOk({ downloadUrl: 'https://api.example.com/download/abc', key: 'exports/abc.xlsx' });

      await tableToExcel(body);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['X-Access-Code']).toBeUndefined();
    });

    it('throws Error with status on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      await expect(tableToExcel(body)).rejects.toThrow('tableToExcel failed: 500');
    });
  });
});
