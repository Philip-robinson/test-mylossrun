import { NextResponse } from 'next/server';
import { baseUrl, excelContentType, toExcelPath } from 'config';
import {
  errorResponse,
  logRequest,
  readEnvelopeData,
  requireAccessCode,
} from '../_lib/api_support';

// to-excel is synchronous: the back end builds the workbook, stores it and returns a
// presigned GET for it directly rather than a status id.
//
// The presigned URL is consumed HERE rather than handed to the browser, exactly as the PDF
// upload consumes its presigned PUT (see ../initiate-pdf-upload/route.js). The browser used
// to visit the URL itself, which — being another origin — could only be a navigation:
// nothing the page could await, and one that cancelled whatever requests the page still had
// in flight. So the route fetches the workbook and returns the BYTES, leaving the browser a
// same-origin response it can read into memory and save with an ordinary `download` anchor.
//
// No `Content-Disposition` is forwarded: the download name comes from the `download`
// attribute the browser now honours, so the header would have nothing to add.
export async function POST(request) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;
    const upstream = await fetch(`${baseUrl()}${toExcelPath()}`, {
      method: 'POST',
      headers: { 'X-Access-Code': guard, 'Content-Type': 'application/json' },
      body: JSON.stringify(await request.json()),
      cache: 'no-store',
    });
    const data = await readEnvelopeData(upstream);
    // A failed build is reported as the upstream JSON and status, as every other proxy
    // does — there is no workbook to fetch.
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    const workbook = await fetch(data.downloadUrl, { cache: 'no-store' });
    if (!workbook.ok) {
      throw new Error(`Workbook download failed: ${workbook.status}`);
    }
    return new NextResponse(await workbook.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': excelContentType() },
    });
  } catch (error) {
    return errorResponse('To excel', error);
  }
}
