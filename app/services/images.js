import {
  getImagePath,
  getTableImagesPath,
  getCellImagesPath,
  getThumbnailsPath,
  metadataPath,
  findTablesPath,
  findGridLinesPath,
  calculateCellsPath,
  extractPath,
  toExcelPath,
  findTablesPollIntervalMs,
  findTablesPollTimeoutMs,
  extractPollIntervalMs,
  extractPollTimeoutMs,
} from 'config';
import { authHeaders } from './authHeaders';
import { backendUrl, readEnvelopeData } from './backend';
import { pollStatus } from './statusPoll';

// One page rendered to a PNG. `imageStyle` picks the rendering: 'RAW' (or omitted) is the
// page as the PDF draws it, 'PROCESSED' has its coloured areas flattened to black on
// white. Omitted, the key is not sent at all, so the body keeps its original wire shape.
export async function getImage(pdfId, pageNumber, width, imageStyle = undefined) {
  const body = { pdfId, page: pageNumber, width };
  if (imageStyle !== undefined) body.imageStyle = imageStyle;
  const response = await fetch(backendUrl(getImagePath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`getImage failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

export async function getTableImages(pdfId, width, tableImages) {
  const response = await fetch(backendUrl(getTableImagesPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, width, tableImages }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`getTableImages failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

// One rectangle of one page as a single image, `rawImage`: the untouched crop of exactly
// the requested rectangle. `bounds` is a single page-fraction rectangle — unlike
// getTableImages, which nests one per entry of a list.
export async function getCellImages(pdfId, page, width, bounds) {
  const response = await fetch(backendUrl(getCellImagesPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, page, width, bounds }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`getCellImages failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

export async function getThumbnails(pdfId, width) {
  const response = await fetch(backendUrl(getThumbnailsPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, width }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`getThumbnails failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

export async function getMetadata(pdfId) {
  const response = await fetch(backendUrl(`${metadataPath()}/${encodeURIComponent(pdfId)}`), {
    method: 'GET',
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`getMetadata failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

// Find the tables on the given pages. The back end dispatches one asynchronous worker run
// per status id it returns; each is long-polled here in turn and their table lists are
// concatenated into a single { tables }.
export async function findTables(pdfId, pages, mechanism = null) {
  const response = await fetch(backendUrl(findTablesPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, pages, mechanism }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`findTables failed: ${response.status}`);
  }
  const dispatch = await readEnvelopeData(response);
  const statusIds = dispatch.statusIds || [];
  const pollOptions = {
    intervalMs: findTablesPollIntervalMs(),
    timeoutMs: findTablesPollTimeoutMs(),
  };
  let tables = [];
  for (const id of statusIds) {
    const data = await pollStatus(id, pollOptions);
    tables = tables.concat(data);
  }
  return { tables };
}

// Probe a single page for its table grid lines. Synchronous: the back end answers the
// POST with the FindGridLinesResponse ({ tables: [...] }) directly — no long-poll.
// `colouredAreas` is the page's coloured-area hints (fractions + #RRGGBB).
// `tables` is an optional list of per-table hints — { name, tableInPage, left, top,
// width, height } in page fractions, each optionally carrying expectedColumns /
// expectedRows. They are passed straight through: this service neither builds nor
// validates them. Omitted (undefined) the key is not sent at all, so the body stays
// identical to the hint-free wire shape.
export async function findGridLines(pdfId, pdfPage, colouredAreas, tables = undefined) {
  const body = { pdfId, pdfPage, colouredAreas };
  if (tables !== undefined) body.tables = tables;
  const response = await fetch(backendUrl(findGridLinesPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`findGridLines failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

// Read the text inside a page's already-known rectangles. Synchronous: the back end
// answers the POST with the CalculateCellsResponse ({ pdfPage, tables: [...] })
// directly — no long-poll. Unlike findGridLines this finds nothing: every rectangle it
// is given — the table bounds, each cell with its row/column, the optional title and the
// optional specials — is taken as correct and only its text and confidence come back.
// `colouredAreas` is the page's coloured-area hints (fractions + #RRGGBB); `tables` is
// passed straight through, this service neither builds nor validates it.
export async function calculateCells(pdfId, pdfPage, colouredAreas, tables) {
  const response = await fetch(backendUrl(calculateCellsPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, pdfPage, colouredAreas, tables }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`calculateCells failed: ${response.status}`);
  }
  return readEnvelopeData(response);
}

// Persist the table list and, optionally, per-page coloured areas. `colouredAreas`
// is a list of { pdfPage, colouredAreas } matching the backend PutTableListRequest;
// omitted (undefined) it is not sent and page coloured areas are left untouched.
// The back end answers with an empty body, which resolves to {}.
export async function saveTables(pdfId, tables, colouredAreas = undefined) {
  const body = { tables };
  if (colouredAreas !== undefined) body.colouredAreas = colouredAreas;
  const response = await fetch(
    backendUrl(`${metadataPath()}/${encodeURIComponent(pdfId)}/tables`),
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    throw new Error(`saveTables failed: ${response.status}`);
  }
  return readEnvelopeData(response, { tolerateEmpty: true });
}

// Build the tables produced by merging a linked group. `tableId` must be a top-level
// (root) table — a linked group is reachable only through its root. The back end
// dispatches the asynchronous worker and returns its status id; this call long-polls
// that status and returns only once the merge is ready. The READY data ({ tables }) is
// returned as-is; the caller reads `.tables`, which holds one entry per section where the
// group was split and one entry otherwise.
export async function extractTable(pdfId, tableId) {
  const response = await fetch(
    backendUrl(`${extractPath()}/${encodeURIComponent(pdfId)}/${encodeURIComponent(tableId)}`),
    {
      method: 'GET',
      headers: authHeaders(),
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    throw new Error(`extractTable failed: ${response.status}`);
  }
  const dispatch = await readEnvelopeData(response);
  const statusIds = dispatch.statusIds;
  if (!statusIds || statusIds.length === 0) {
    throw new Error('Extract dispatch returned no status id');
  }
  return pollStatus(statusIds[0], {
    intervalMs: extractPollIntervalMs(),
    timeoutMs: extractPollTimeoutMs(),
  });
}

// Build the document's tables as one XLSX file. Synchronous: the back end builds the
// workbook, stores it and answers the POST with a presigned `downloadUrl` — no long-poll.
// `body` is { pdfId, rootTableIds, filename } and carries no table content: the back end
// rebuilds every named table from the stored metadata, so the document must have been
// saved first.
// The workbook is then fetched from the presigned URL here and returned as a Blob, rather
// than the browser navigating to the URL: a navigation cannot be awaited and cancels any
// requests the page still has in flight, whereas a fetched Blob is saved with an ordinary
// `download` anchor.
export async function tableToExcel(body) {
  const response = await fetch(backendUrl(toExcelPath()), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`tableToExcel failed: ${response.status}`);
  }
  const { downloadUrl } = await readEnvelopeData(response);
  const workbook = await fetch(downloadUrl, { cache: 'no-store' });
  if (!workbook.ok) {
    throw new Error(`Workbook download failed: ${workbook.status}`);
  }
  return workbook.blob();
}
