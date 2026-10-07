// Whether a document's original PDF may be downloaded from the document list.
export function canDownloadOriginal(pdf, downloadableStatuses) {
  return downloadableStatuses.includes(pdf.status);
}

// Whether a document may be exported from the document list. An unknown table count does
// not disable it; only a known count of zero does.
export function canExportDocument(pdf, exportable) {
  return exportable.includes(pdf.status) && pdf.tableCount !== 0;
}
