import { NextResponse } from 'next/server';
import * as logger from 'common/logger';
import { baseUrl, findTablesPollIntervalMs, findTablesPollTimeoutMs } from 'config';
import { requireAccessCode } from '../_lib/api_support';
import { decodeBody, pollStatus } from '../_lib/status_poll';

export async function POST(request) {
  logger.info(`${request.method} ${request.url}`);
  try {
    const guard = requireAccessCode(request);
    if (guard instanceof NextResponse) return guard;

    const body = await request.json();
    const response = await fetch(`${baseUrl()}/mylossrun/find-tables`, {
      method: 'POST',
      headers: { 'X-Access-Code': guard, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    const initial = JSON.parse(decodeBody(await response.arrayBuffer()));
    const statusIds = initial.statusIds || [];

    const pollOptions = {
      intervalMs: findTablesPollIntervalMs(),
      timeoutMs: findTablesPollTimeoutMs(),
    };
    let tables = [];
    for (const id of statusIds) {
      const data = await pollStatus(id, guard, pollOptions);
      tables = tables.concat(data);
    }
    return NextResponse.json({ tables }, { status: 200 });
  } catch (error) {
    logger.error(`Find tables: ${error}`);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
