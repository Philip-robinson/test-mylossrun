import { NextResponse } from 'next/server';
import { baseUrl, extractPollIntervalMs, extractPollTimeoutMs } from 'config';
import { errorResponse, logRequest, requireAccessCode } from '../../../_lib/api_support';
import { decodeBody, pollStatus } from '../../../_lib/status_poll';

// Proxy for the asynchronous table-extraction worker: dispatch
// GET /mylossrun/extract/{pdfId}/{tableId}, which allocates a single status id,
// then long-poll that status until it is terminal. The merged tables travel as
// the READY envelope's `data`, which is already an object with a single `tables`
// key — mirroring find-tables' shape — so it is returned as it stands.
export async function GET(request, { params }) {
  logRequest(request);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;

    const { pdfId, tableId } = await params;
    const url = `${baseUrl()}/mylossrun/extract/${encodeURIComponent(pdfId)}/${encodeURIComponent(
      tableId
    )}`;
    const response = await fetch(url, {
      headers: { 'X-Access-Code': guard },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Extract dispatch failed: HTTP ${response.status}`);
    }

    const initial = JSON.parse(decodeBody(await response.arrayBuffer()));
    const statusIds = initial.statusIds || [];
    if (statusIds.length === 0) {
      throw new Error('Extract dispatch returned no status id');
    }

    const tables = await pollStatus(statusIds[0], guard, {
      intervalMs: extractPollIntervalMs(),
      timeoutMs: extractPollTimeoutMs(),
    });
    return NextResponse.json(tables, { status: 200 });
  } catch (error) {
    return errorResponse('Extract table', error);
  }
}
