import crypto from 'crypto';
import { NextResponse } from 'next/server';
import * as logger from 'common/logger';
import { baseUrl } from 'config';
import { logRequest, requireAccessCode, errorResponse } from '../_lib/api_support';

export async function POST(request) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const accessCode = guard;

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 });
    }
    // The pdfId was minted up front by /api/allocate-pdf-id; initiate attaches this
    // upload to that ALLOCATED record rather than minting a new id.
    const pdfId = formData.get('pdfId');

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('base64');

    // 1. Initiate the upload — flips the ALLOCATED record to INITIALISED and returns a presigned PUT URL
    const initiateResponse = await fetch(`${baseUrl()}/mylossrun/initiate-pdf-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': accessCode,
      },
      body: JSON.stringify({ pdfId, name: file.name, hash }),
    });
    if (!initiateResponse.ok) {
      const errorText = await initiateResponse.text();
      throw new Error(`Initiate PDF upload failed: ${initiateResponse.status} ${errorText}`);
    }
    // The backend echoes the same pdfId we sent; reuse the form value below.
    const { presignedUploadUrl } = await initiateResponse.json();

    // 2. Upload the original PDF to S3 via the presigned PUT URL — server-side, route holds the buffer
    logger.info(`Outbound request: PUT ${presignedUploadUrl}`);
    const s3Response = await fetch(presignedUploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: buffer,
    });
    if (!s3Response.ok) {
      const errorText = await s3Response.text();
      throw new Error(`S3 upload failed: ${s3Response.status} ${errorText}`);
    }

    // Return ONLY the pdfId — the presigned URL is consumed internally and never returned to the browser
    return NextResponse.json({ success: true, pdfId });
  } catch (error) {
    return errorResponse('Initiate PDF upload error', error);
  }
}
