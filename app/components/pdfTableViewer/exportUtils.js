// Handing an exported workbook to the user.

import { excelFileSuffix } from 'config';

// Name the workbook is offered under: the uploaded document's name with its extension
// replaced. Mirrors the back end, which names both the stored object and the sheet from the
// same stem. A name with no extension, or a dotfile, keeps what it has and gains the suffix.
export function excelFilename(originalFilename) {
  const name = originalFilename ?? '';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${excelFileSuffix()}`;
}

// Save a Blob to the user's downloads under `filename`.
//
// The URL is revoked in the same tick as the click, which is safe here and was not when the
// href pointed at S3: a blob URL addresses bytes the page already holds, so the click starts
// no request that revoking could cancel. The anchor is put in the document because Firefox
// will not act on the click of a detached one.
export function saveBlob(blob, filename) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(anchor.href);
  }
}
