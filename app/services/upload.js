import toast from 'react-hot-toast';
import { authHeaders } from './authHeaders';

// Allocate a pdf_id from the filename alone and return it immediately, so the
// caller can show a row at once. The actual upload (initiate -> S3 PUT ->
// start-processing) runs in the background; it can no longer reject this
// already-resolved promise, so a background failure is surfaced via a toast
// (the row simply stays ALLOCATED and the caller's watch times out).
export async function upload(file) {
  const allocateResponse = await fetch('/api/allocate-pdf-id', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: file.name }),
  });
  if (!allocateResponse.ok) {
    throw new Error(`allocate-pdf-id failed with status ${allocateResponse.status}`);
  }
  const allocateData = await allocateResponse.json();
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

// The rest of the upload, run in the background. Unchanged from the old flow
// except that the pre-allocated pdfId is passed to /api/initiate-pdf-upload.
// Exported for testing; throws on any step failure so upload()'s .catch toasts it.
export async function finishUpload(file, pdfId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('pdfId', pdfId);

  const initiateResponse = await fetch('/api/initiate-pdf-upload', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!initiateResponse.ok) {
    throw new Error(`initiate-pdf-upload failed with status ${initiateResponse.status}`);
  }
  const initiateData = await initiateResponse.json();
  if (!initiateData || initiateData.success === false) {
    throw new Error('initiate-pdf-upload returned success: false');
  }

  const startResponse = await fetch('/api/start-pdf-processing', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId }),
  });
  if (!startResponse.ok) {
    throw new Error(`start-pdf-processing failed with status ${startResponse.status}`);
  }
}
