import { authHeaders } from './authHeaders';

export async function getImage(pdfId, pageNumber, width) {
  const response = await fetch('/api/get-image', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, page: pageNumber, width }),
  });
  if (!response.ok) {
    throw new Error(`getImage failed: ${response.status}`);
  }
  return response.json();
}

export async function getTableImages(pdfId, width, tableImages) {
  const response = await fetch('/api/get-table-images', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, width, tableImages }),
  });
  if (!response.ok) {
    throw new Error(`getTableImages failed: ${response.status}`);
  }
  return response.json();
}

// One cell of one page, rendered twice: `rawImage` is the untouched crop, `processedImage`
// has its coloured areas grey-scaled, its ruling lines and margin whitened, and is trimmed
// back to the ink. `bounds` is a single page-fraction rectangle — unlike getTableImages,
// which nests one per entry of a list.
export async function getCellImages(pdfId, page, width, bounds) {
  const response = await fetch('/api/get-cell-images', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, page, width, bounds }),
  });
  if (!response.ok) {
    throw new Error(`getCellImages failed: ${response.status}`);
  }
  return response.json();
}

export async function getThumbnails(pdfId, width) {
  const response = await fetch('/api/get-thumbnails', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, width }),
  });
  if (!response.ok) {
    throw new Error(`getThumbnails failed: ${response.status}`);
  }
  return response.json();
}

export async function getMetadata(pdfId) {
  const response = await fetch(`/api/metadata/${encodeURIComponent(pdfId)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`getMetadata failed: ${response.status}`);
  }
  return response.json();
}

export async function findTables(pdfId, pages, mechanism = null) {
  const response = await fetch('/api/find-tables', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, pages, mechanism }),
  });
  if (!response.ok) {
    throw new Error(`findTables failed: ${response.status}`);
  }
  return response.json();
}

// Probe a single page for its table grid lines. Synchronous: the proxy forwards the
// POST and returns the FindGridLinesResponse ({ tables: [...] }) directly — no long-poll.
// `colouredAreas` is the page's coloured-area hints (fractions + #RRGGBB).
// `tables` is an optional list of per-table hints — { name, tableInPage, left, top,
// width, height } in page fractions, each optionally carrying expectedColumns /
// expectedRows. They are passed straight through: this service neither builds nor
// validates them. Omitted (undefined) the key is not sent at all, so the body stays
// identical to the hint-free wire shape.
export async function findGridLines(pdfId, pdfPage, colouredAreas, tables = undefined) {
  const body = { pdfId, pdfPage, colouredAreas };
  if (tables !== undefined) body.tables = tables;
  const response = await fetch('/api/find-grid-lines', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`findGridLines failed: ${response.status}`);
  }
  return response.json();
}

// Read the text inside a page's already-known rectangles. Synchronous: the proxy
// forwards the POST and returns the CalculateCellsResponse ({ pdfPage, tables: [...] })
// directly — no long-poll. Unlike findGridLines this finds nothing: every rectangle it
// is given — the table bounds, each cell with its row/column, the optional title and the
// optional specials — is taken as correct and only its text and confidence come back.
// `colouredAreas` is the page's coloured-area hints (fractions + #RRGGBB); `tables` is
// passed straight through, this service neither builds nor validates it.
export async function calculateCells(pdfId, pdfPage, colouredAreas, tables) {
  const response = await fetch('/api/calculate-cells', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pdfId, pdfPage, colouredAreas, tables }),
  });
  if (!response.ok) {
    throw new Error(`calculateCells failed: ${response.status}`);
  }
  return response.json();
}

// Persist the table list and, optionally, per-page coloured areas. `colouredAreas`
// is a list of { pdfPage, colouredAreas } matching the backend PutTableListRequest;
// omitted (undefined) it is not sent and page coloured areas are left untouched.
export async function saveTables(pdfId, tables, colouredAreas = undefined) {
  const body = { tables };
  if (colouredAreas !== undefined) body.colouredAreas = colouredAreas;
  const response = await fetch(`/api/metadata/${encodeURIComponent(pdfId)}/tables`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`saveTables failed: ${response.status}`);
  }
  return response.json();
}

// Build the single flat table produced by merging a linked group. `tableId` must be a
// top-level (root) table — a linked group is reachable only through its root. The proxy
// dispatches the asynchronous worker and long-polls the status file, so this call
// returns only once the merged table is ready. The parsed body ({ table }) is returned
// as-is; the caller reads `.table`.
export async function extractTable(pdfId, tableId) {
  const response = await fetch(
    `/api/extract/${encodeURIComponent(pdfId)}/${encodeURIComponent(tableId)}`,
    {
      method: 'GET',
      headers: authHeaders(),
    }
  );
  if (!response.ok) {
    throw new Error(`extractTable failed: ${response.status}`);
  }
  return response.json();
}

// Build the reviewed table as an XLSX file. Synchronous: the proxy forwards the POST and
// returns the response directly — no long-poll. `body` is the amalgamated table
// ({ name, title, cells, headerCount }) plus pdfId, rootTableId and originalFilename.
// Returns { downloadUrl, key }.
export async function tableToExcel(body) {
  const response = await fetch('/api/to-excel', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`tableToExcel failed: ${response.status}`);
  }
  return response.json();
}
