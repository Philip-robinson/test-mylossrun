import { NextResponse } from 'next/server';
import { baseUrl } from 'config';
import { logRequest, requireAccessCode, errorResponse, readEnvelopeData } from '../_lib/api_support';

export async function GET(request) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const headers = { 'X-Access-Code': guard };
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;
    const response = await fetch(`${baseUrl()}/mylossrun/pdf-display-list`, {
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
    return lastModified
      ? NextResponse.json(data, { headers: { 'Last-Modified': lastModified } })
      : NextResponse.json(data);
  } catch (error) {
    return errorResponse('PDF display list fetch error', error);
  }
}
