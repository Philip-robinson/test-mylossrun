import { canDownloadOriginal, canExportDocument } from 'components/documentRowMenuUtils';

describe('documentRowMenuUtils', () => {
  const downloadable = ['LOADED', 'READY_FOR_REVIEW', 'VALIDATING', 'EXTRACTION_IN_PROGRESS', 'COMPLETED'];
  const exportable = ['READY_FOR_REVIEW', 'VALIDATING', 'EXTRACTION_IN_PROGRESS', 'COMPLETED'];

  describe('canDownloadOriginal', () => {
    it.each(['ALLOCATED', 'INITIALISED', 'ERROR'])('is false for %s', (status) => {
      expect(canDownloadOriginal({ status }, downloadable)).toBe(false);
    });

    it.each(downloadable)('is true for %s', (status) => {
      expect(canDownloadOriginal({ status }, downloadable)).toBe(true);
    });
  });

  describe('canExportDocument', () => {
    it.each(['ALLOCATED', 'INITIALISED', 'LOADED', 'ERROR'])('is false for %s', (status) => {
      expect(canExportDocument({ status, tableCount: 2 }, exportable)).toBe(false);
    });

    it.each(exportable)('is true for %s with tables, an unknown count or no count', (status) => {
      expect(canExportDocument({ status, tableCount: 2 }, exportable)).toBe(true);
      expect(canExportDocument({ status, tableCount: null }, exportable)).toBe(true);
      expect(canExportDocument({ status }, exportable)).toBe(true);
    });

    it('is false for an exportable status with no tables', () => {
      expect(canExportDocument({ status: 'COMPLETED', tableCount: 0 }, exportable)).toBe(false);
    });
  });
});
