import { NextResponse } from 'next/server';
import { baseUrl } from 'config';
import { logRequest, requireAccessCode, errorResponse, readEnvelopeData } from '../../_lib/api_support';

// Single display-list entry for one pdfId. Dynamic {pdfId} route (like metadata/[pdfId])
// that also forwards If-Modified-Since and passes 304 / Last-Modified through (like
// pdf-display-list), so a fast per-row poll stays cheap.
export async function GET(request, { params }) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const { pdfId } = await params;
    const headers = { 'X-Access-Code': guard };
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;
    const response = await fetch(`${baseUrl()}/mylossrun/pdf-display-entry/${encodeURIComponent(pdfId)}`, {
      headers,
      cache: 'no-store',
    });
    const lastModified = response.headers.get('Last-Modified');
    if (response.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: lastModified ? { 'Last-Modified': lastModified } : {},
      });
    }
    const data = await readEnvelopeData(response);
    return NextResponse.json(data, {
      status: response.status,
      headers: lastModified ? { 'Last-Modified': lastModified } : {},
    });
  } catch (error) {
    return errorResponse('PDF display entry fetch error', error);
  }
}
