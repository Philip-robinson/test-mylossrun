import toast from 'react-hot-toast';
import {
  allocatePdfIdPath,
  initiatePdfUploadPath,
  pdfContentType,
  startPdfProcessingPath,
} from 'config';
import { authHeaders } from './authHeaders';
import { backendUrl, readEnvelopeData } from './backend';
import { sha256Base64 } from './fileHash';

// Allocate a pdf_id from the filename alone and return it immediately, so the
// caller can show a row at once. The rest of the upload (browser hash ->
// initiate -> browser S3 PUT -> start-processing) runs in the background; it
// can no longer reject this already-resolved promise, so a background failure
// is surfaced via a toast (the row simply stays ALLOCATED and the caller's
// watch times out).
export async function upload(file) {
  const allocateResponse = await fetch(backendUrl(allocatePdfIdPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: file.name }),
    cache: 'no-store',
  });
  if (!allocateResponse.ok) {
    throw new Error(`allocate-pdf-id failed with status ${allocateResponse.status}`);
  }
  const allocateData = await readEnvelopeData(allocateResponse);
  const pdfId = allocateData && allocateData.pdfId;
  if (!pdfId) {
    throw new Error('allocate-pdf-id did not return a pdfId');
  }

  // Fire and forget: do NOT await, so upload() returns the pdfId right away.
  finishUpload(file, pdfId).catch((error) => {
    toast.error((error && error.message) || 'Upload failed');
  });

  return { success: true, pdfId };
}

// The rest of the upload, run in the background: the browser hashes the file,
// initiates the upload against the pre-allocated pdfId, PUTs the file straight
// to S3 via the returned presigned URL, then starts processing.
// Exported for testing; throws on any step failure so upload()'s .catch toasts it.
export async function finishUpload(file, pdfId) {
  const hash = await sha256Base64(file);

  const initiateResponse = await fetch(backendUrl(initiatePdfUploadPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, name: file.name, hash }),
    cache: 'no-store',
  });
  if (!initiateResponse.ok) {
    throw new Error(`initiate-pdf-upload failed with status ${initiateResponse.status}`);
  }
  const initiateData = await readEnvelopeData(initiateResponse);
  const presignedUploadUrl = initiateData && initiateData.presignedUploadUrl;
  if (!presignedUploadUrl) {
    throw new Error('initiate-pdf-upload returned no upload URL');
  }

  // Only the signed content type: the URL is signed with it and must not carry the access code.
  const s3Response = await fetch(presignedUploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': pdfContentType() },
    body: file,
  });
  if (!s3Response.ok) {
    throw new Error(`S3 upload failed with status ${s3Response.status}`);
  }

  const startResponse = await fetch(backendUrl(startPdfProcessingPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId }),
    cache: 'no-store',
  });
  if (!startResponse.ok) {
    throw new Error(`start-pdf-processing failed with status ${startResponse.status}`);
  }
}
