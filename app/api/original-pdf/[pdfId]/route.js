import { NextResponse } from 'next/server';
import { baseUrl, originalPdfPath, pdfContentType } from 'config';
import {
  errorResponse,
  logRequest,
  readEnvelopeData,
  requireAccessCode,
} from '../../_lib/api_support';

// The back end returns a presigned GET for the uploaded PDF; as with to-excel, the route
// consumes it here and returns the bytes, so the browser gets a same-origin response.
export async function GET(request, { params }) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const { pdfId } = await params;
    const upstream = await fetch(
      `${baseUrl()}${originalPdfPath()}/${encodeURIComponent(pdfId)}`,
      { method: 'GET', headers: { 'X-Access-Code': guard }, cache: 'no-store' }
    );
    const data = await readEnvelopeData(upstream);
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    const file = await fetch(data.downloadUrl, { cache: 'no-store' });
    if (!file.ok) {
      throw new Error(`Original PDF download failed: ${file.status}`);
    }
    // Streamed rather than buffered, because an original may be up to 50 MB.
    return new NextResponse(file.body, {
      status: 200,
      headers: { 'Content-Type': pdfContentType() },
    });
  } catch (error) {
    return errorResponse('Original PDF', error);
  }
}
