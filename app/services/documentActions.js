import { excelFilename, exportableTableIds, saveBlob } from 'components/pdfTableViewer/exportUtils';
import { originalPdfPath } from 'config';
import { authHeaders } from './authHeaders';
import { backendUrl, readEnvelopeData } from './backend';
import { getMetadata, tableToExcel } from './images';

// Fetch the document's uploaded PDF from its presigned URL and save it under the document's name.
export async function downloadOriginalPdf(pdf) {
  const response = await fetch(backendUrl(`${originalPdfPath()}/${encodeURIComponent(pdf.pdfId)}`), {
    method: 'GET',
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`downloadOriginalPdf failed: ${response.status}`);
  }
  const { downloadUrl } = await readEnvelopeData(response);
  const file = await fetch(downloadUrl, { cache: 'no-store' });
  if (!file.ok) {
    throw new Error(`Original PDF download failed: ${file.status}`);
  }
  saveBlob(await file.blob(), pdf.name);
}

// The editor's export without its save: builds one workbook of the document's live tables
// from stored metadata. It re-runs the back end's to-excel, so it marks the document COMPLETED.
export async function exportDocumentWorkbook(pdf) {
  const metadata = await getMetadata(pdf.pdfId);
  const rootTableIds = exportableTableIds(metadata.tables);
  if (rootTableIds.length === 0) {
    throw new Error('This document has no tables to export');
  }
  const filename = excelFilename(metadata.name);
  const workbook = await tableToExcel({ pdfId: pdf.pdfId, rootTableIds, filename });
  saveBlob(workbook, filename);
}
