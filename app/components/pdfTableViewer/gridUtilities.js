// Pure helper functions for the "Link tables" join feature: ordering/matching
// primitives, grid reconstruction / auto-population, save-table assembly, and the
// drag-drop placement rules. Extracted from TableLinkageEditor (the Grid Editor panel)
// so they can be shared without importing that component (e.g. `hasSavedGrid` is used
// by the page editor). All helpers are pure and must never mutate their inputs — the sole
// documented exception is `autoPopulateGrid`, which mutates the working candidate
// array the caller hands it (callers pass a copy).

// ---------------------------------------------------------------------------
// Ordering / matching primitives
// ---------------------------------------------------------------------------

export const orderKey = (t) => [t.pdfPage, t.tableInPage ?? 0];

export const comesAfter = (t, ref) =>
  t.pdfPage > ref.pdfPage ||
  (t.pdfPage === ref.pdfPage && (t.tableInPage ?? 0) > (ref.tableInPage ?? 0));

export const sortByOrder = (list) =>
  list.slice().sort((a, b) => {
    if (a.pdfPage !== b.pdfPage) return a.pdfPage - b.pdfPage;
    return (a.tableInPage ?? 0) - (b.tableInPage ?? 0);
  });

export const numCols = (t) => (t.columnWidths ?? []).length;

export const numRows = (t) => (t.rowHeights ?? []).length;

export const hdr = (t) => t.headerCount ?? 0;

export const nonHeaderRows = (t) => numRows(t) - hdr(t);

export const cellText = (t) => {
  const lookup = new Map();
  (t.cells ?? []).forEach((cell) => {
    lookup.set(`${cell.row},${cell.column}`, cell.text ?? '');
  });
  return (r, c) => lookup.get(`${r},${c}`) ?? '';
};

export const headersMatch = (a, b) => {
  if (hdr(a) !== hdr(b)) return false;
  const getA = cellText(a);
  const getB = cellText(b);
  const rows = hdr(a);
  const cols = numCols(a);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (getA(r, c) !== getB(r, c)) return false;
    }
  }
  return true;
};

// ---------------------------------------------------------------------------
// hasSavedGrid
// ---------------------------------------------------------------------------

export const hasSavedGrid = (root) => {
  const g = root.grid;
  if (g == null) return false;
  if (g.length === 0) return false;
  if (g.length === 1 && g[0].length === 1) return false;
  return true;
};

// True when `table` has been amalgamated into a grid of tables: either it holds the saved
// grid itself, or it carries linked tables under `next`. Written as a check of both fields
// because a table can be given links before the grid is laid out.
export const isAmalgamated = (table) =>
  Boolean(table) &&
  (hasSavedGrid(table) || Object.keys(table.next ?? {}).length > 0);

// ---------------------------------------------------------------------------
// reconstructGrid
// ---------------------------------------------------------------------------

export const reconstructGrid = (root) => {
  const src = root.grid ?? [];
  const maxLen = src.reduce((m, row) => Math.max(m, row.length), 0);
  return src.map((row, r) => {
    const out = [];
    for (let c = 0; c < maxLen; c += 1) {
      const value = row[c];
      if (r === 0 && c === 0) {
        out.push(root);
      } else if (value == null || value === '') {
        out.push(null);
      } else {
        out.push(root.next?.[value] ?? null);
      }
    }
    return out;
  });
};

// ---------------------------------------------------------------------------
// autoPopulateGrid
// ---------------------------------------------------------------------------

// NOTE: `candidateList` is a *working copy* owned by the caller; this function
// removes matched tables from it in place and returns whatever is left as
// `remaining`. Callers pass a copy (e.g. `list.slice()`).
export const autoPopulateGrid = (root, candidateList) => {
  // --- Column 0: the vertical spine below Root ---
  const spine = [];
  let noHeaderMode = false;
  for (let i = 0; i < candidateList.length; ) {
    const t = candidateList[i];
    // Header-stop rule: once a no-header table has been placed on the spine, a
    // table WITH a header terminates the spine.
    if (noHeaderMode && hdr(t) > 0) break;
    const hdrOk = hdr(t) === hdr(root) || hdr(t) === 0;
    const colsOk = numCols(t) === numCols(root);
    const headerValsOk =
      hdr(t) > 0 ? hdr(t) === hdr(root) && headersMatch(t, root) : true;
    if (comesAfter(t, root) && hdrOk && colsOk && headerValsOk) {
      spine.push(t);
      if (hdr(t) === 0) noHeaderMode = true;
      candidateList.splice(i, 1);
    } else {
      i += 1;
    }
  }

  const R = 1 + spine.length;
  const grid = [[root]];
  spine.forEach((t) => grid.push([t]));

  // --- Columns 1, 2, 3, ... : horizontal continuations ---
  let j = 1;
  let keepGoing = true;
  while (keepGoing) {
    let placedInColumn = 0;
    for (let row = 0; row < R; row += 1) {
      const left = grid[row][j - 1] ?? null;
      if (left == null) break; // stop this column

      const top = grid[0][j] ?? null;
      const above = row > 0 ? grid[row - 1][j] ?? null : null;

      let foundIndex = -1;
      for (let k = 0; k < candidateList.length; k += 1) {
        const t = candidateList[k];
        if (!comesAfter(t, left)) continue;
        if (numRows(t) !== numRows(left)) continue;
        if (hdr(t) !== hdr(left)) continue;
        if (row > 0) {
          if (!comesAfter(t, above)) continue; // comes after the table above
          if (numCols(t) !== numCols(above)) continue;
          if (hdr(t) > 0) {
            if (hdr(t) !== hdr(top)) continue;
            if (!headersMatch(t, top)) continue;
          }
        }
        foundIndex = k;
        break;
      }

      if (foundIndex === -1) break; // stop this column (leave holes below)
      grid[row][j] = candidateList[foundIndex];
      candidateList.splice(foundIndex, 1);
      placedInColumn += 1;
    }

    if (placedInColumn === 0) {
      keepGoing = false;
    } else {
      j += 1;
    }
  }

  // --- Make rectangular: pad every row with null up to the max column count ---
  const maxCols = grid.reduce((m, row) => Math.max(m, row.length), 0);
  const rect = grid.map((row) => {
    const copy = row.slice();
    while (copy.length < maxCols) copy.push(null);
    return copy;
  });

  return { grid: rect, remaining: candidateList };
};

// ---------------------------------------------------------------------------
// buildInitialState
// ---------------------------------------------------------------------------

// The panel's whole pool is the root's own `next` map: membership of a group is decided by
// the linking flow, and this panel only decides where its members sit. A table below the root
// in the document that was never linked to it is not a candidate and is never drawn in.
export const linkedMembers = (root) =>
  sortByOrder(Object.values(root?.next ?? {}));

// Every member of `next` that the grid holds. A group is ready to extract only when that is
// all of them; a root with no links has nothing outstanding and is ready by default.
export const allLinkedPlaced = (root, grid) => {
  const ids = Object.keys(root?.next ?? {});
  if (ids.length === 0) return true;
  const placed = new Set();
  (grid ?? []).forEach((row) =>
    (row ?? []).forEach((cell) => {
      if (cell) placed.add(cell.tableId);
    }),
  );
  return ids.every((id) => placed.has(id));
};

export const buildInitialState = (root) => {
  const members = linkedMembers(root);
  if (hasSavedGrid(root)) {
    const grid = reconstructGrid(root);
    const placed = new Set();
    grid.forEach((row) =>
      row.forEach((cell) => {
        if (cell) placed.add(cell.tableId);
      }),
    );
    return { grid, select: members.filter((t) => !placed.has(t.tableId)) };
  }

  const { grid, remaining } = autoPopulateGrid(root, members.slice());
  return { grid, select: remaining };
};

// ---------------------------------------------------------------------------
// buildSaveTables
// ---------------------------------------------------------------------------

// Drop any fully-empty (all-null) row and any fully-empty column, returning a new
// rectangular grid. Row 0 and column 0 always contain Root at (0,0), so they are
// never removed and (0,0) stays Root. Order is otherwise preserved.
export const compactGrid = (grid) => {
  const rows = grid.filter((row) => row.some((cell) => cell != null));
  const width = rows.reduce((m, row) => Math.max(m, row.length), 0);
  const keepCol = [];
  for (let c = 0; c < width; c += 1) {
    keepCol[c] = rows.some((row) => (row[c] ?? null) != null);
  }
  return rows.map((row) => {
    const out = [];
    for (let c = 0; c < width; c += 1) {
      if (keepCol[c]) out.push(row[c] ?? null);
    }
    return out;
  });
};

// Return a new grid that always carries a trailing empty column and a trailing
// empty row, so the UI always exposes drop targets to the right of, and below,
// the placed tables. Root stays at (0,0). Built on compactGrid so it is
// effectively idempotent: pre-existing trailing empties are trimmed first, then
// exactly one empty column and one empty row are re-added.
export const padForDisplay = (grid) => {
  const compact = compactGrid(grid); // trims fully-empty rows/cols, keeps (0,0)
  const width = compact.reduce((m, row) => Math.max(m, row.length), 0);
  const withCol = compact.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push(null);
    copy.push(null); // trailing empty column
    return copy;
  });
  const trailingRow = new Array(width + 1).fill(null);
  return [...withCol, trailingRow];
};

// Write the laid-out grid onto the root. `next` is NEVER touched: which tables belong to a
// group is settled by the linking flow, and this panel only decides where they sit. A member
// dragged out of the grid therefore leaves the layout, not the group.
export const buildSaveTables = (root, grid, tables) => {
  const compact = compactGrid(grid);
  const placed = [];
  compact.forEach((rowArr, r) => {
    rowArr.forEach((cell, c) => {
      if (r === 0 && c === 0) return;
      if (cell != null) placed.push(cell);
    });
  });

  const newGrid = compact.map((rowArr, r) =>
    rowArr.map((cell, c) => {
      if (r === 0 && c === 0) return root.tableId;
      if (cell == null) return '';
      return cell.tableId;
    }),
  );

  // Root alone in the grid is not a 1x1 layout, it is NO layout: the root is saved with a
  // null grid. Storing a degenerate grid instead would make it read as laid out everywhere
  // that tests for a saved grid — tableSizeLabel would append "1 × 1 Tables", and the
  // extraction would treat it as a one-table group.
  const laidOut = placed.length > 0;

  return (tables ?? []).map((t) =>
    t.tableId === root.tableId ? { ...t, grid: laidOut ? newGrid : null } : t,
  );
};

// ---------------------------------------------------------------------------
// insertSorted
// ---------------------------------------------------------------------------

export const insertSorted = (list, t) => sortByOrder([...list, t]);

// ---------------------------------------------------------------------------
// canDropSelectToGrid
// ---------------------------------------------------------------------------

// Whether two tables may sit side by side in a row: they must yield the same number of body
// rows, so the joined row comes out square. Header counts are deliberately NOT compared —
// a continuation that repeats the header, or drops it, is still the same row of data, and
// a manual drop is a deliberate placement rather than a guess. autoPopulateGrid is stricter
// (it matches header counts and header text too) because it is choosing for the user; these
// rules only say whether what the user chose can be laid out.
const sameBodyRows = (a, b) => nonHeaderRows(a) === nonHeaderRows(b);

export const canDropSelectToGrid = (dragged, grid, r, c) => {
  if (grid[r]?.[c] !== null) return false; // target must be an empty (null) cell
  if (c === 0) {
    // First-column (spine) drop: the dragged table need only carry the Root table's column
    // count, so that it stacks below Root squarely. Whatever sits to its right does not bear
    // on it — the drop names the spine, and the spine is where it goes. (0,0) itself is
    // always Root, hence never empty.
    const root = grid[0]?.[0] ?? null;
    if (root == null) return false;
    return numCols(dragged) === numCols(root);
  }
  const left = grid[r][c - 1];
  if (left == null) return false;
  if (!sameBodyRows(dragged, left)) return false;
  if (r > 0) {
    const above = grid[r - 1]?.[c] ?? null;
    if (above == null) return false;
    if (numCols(dragged) !== numCols(above)) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// moveGridCellToSelect / moveSelectToGridCell
// ---------------------------------------------------------------------------

export const moveGridCellToSelect = (grid, select, r, c) => {
  const cell = grid[r][c];
  const newGrid = grid.map((rowArr) => rowArr.slice());
  newGrid[r][c] = null;
  return { grid: newGrid, select: insertSorted(select, cell) };
};

export const moveSelectToGridCell = (grid, select, tableId, r, c) => {
  const dragged = select.find((t) => t.tableId === tableId);
  if (!dragged) return null;
  if (!canDropSelectToGrid(dragged, grid, r, c)) return null;
  const newGrid = grid.map((rowArr) => rowArr.slice());
  newGrid[r][c] = dragged;
  const newSelect = select.filter((t) => t.tableId !== tableId);
  return { grid: newGrid, select: newSelect };
};

// ---------------------------------------------------------------------------
// automatic drop placement
// ---------------------------------------------------------------------------

// The spine row index (grid row 1..) where `dragged` belongs by document order
// when that means splicing a NEW row before an existing spine table: the first
// column-0 table (skipping spine gaps) that comes after `dragged`. null when no
// spine table comes after it — appending is covered by the trailing padded
// row's empty column-0 cell, so no splice is needed.
export const orderedSpineInsertIndex = (dragged, grid) => {
  for (let r = 1; r < grid.length; r += 1) {
    const t = grid[r]?.[0] ?? null;
    if (t != null && comesAfter(t, dragged)) return r;
  }
  return null;
};

// Splice a new spine row at index r containing `dragged` in column 0, padded
// with nulls to the grid's width. Returns { grid, select } or null when the
// dragged table is missing from select or its column count does not match Root
// (spine rows must match Root's columns, as canDropSelectToGrid requires).
export const insertSpineRow = (grid, select, tableId, r) => {
  const dragged = select.find((t) => t.tableId === tableId);
  if (!dragged) return null;
  const root = grid[0]?.[0] ?? null;
  if (root == null || numCols(dragged) !== numCols(root)) return null;
  const width = grid.reduce((m, row) => Math.max(m, row.length), 0);
  const newRow = [dragged, ...new Array(Math.max(0, width - 1)).fill(null)];
  const newGrid = [
    ...grid.slice(0, r).map((row) => row.slice()),
    newRow,
    ...grid.slice(r).map((row) => row.slice()),
  ];
  return { grid: newGrid, select: select.filter((t) => t.tableId !== tableId) };
};

// Every placement for dropping `dragged` on the grid: the ordered spine splice (when one
// applies) followed by every empty cell that canDropSelectToGrid accepts — the trailing
// padded row/column included, so a new bottom row is always reachable. The caller picks the
// candidate nearest the pointer; listing the splice first makes it win exact ties.
//
// `column` confines the list to one grid column, which is what a drop passes: the column the
// table was dropped on is part of the instruction, so a table dropped on the spine is placed
// on the spine or not at all, never slid sideways into a continuation column. A splice opens
// a new spine row, so it belongs to column 0. Omit `column` for every placement anywhere.
export const dropCandidates = (dragged, grid, column = null) => {
  const inColumn = (c) => column == null || c === column;
  const out = [];
  const root = grid[0]?.[0] ?? null;
  if (inColumn(0) && root != null && numCols(dragged) === numCols(root)) {
    const r = orderedSpineInsertIndex(dragged, grid);
    if (r != null) out.push({ kind: 'newRow', r });
  }
  grid.forEach((rowArr, r) =>
    rowArr.forEach((cell, c) => {
      if (inColumn(c) && cell === null && canDropSelectToGrid(dragged, grid, r, c)) {
        out.push({ kind: 'cell', r, c });
      }
    }),
  );
  return out;
};

// ---------------------------------------------------------------------------
// drop explanations
// ---------------------------------------------------------------------------

// "1 column" / "3 columns" — the counts these messages quote are the placement rules'
// own terms, so they are always spelled out rather than left as bare numbers.
const quantity = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The nearest table above (r, 0), which a spine drop continues. Never null in a grid that
// has a Root, since Root itself sits at (0, 0).
const spinePredecessor = (grid, r) => {
  for (let i = r - 1; i >= 0; i -= 1) {
    const t = grid[i]?.[0] ?? null;
    if (t != null) return t;
  }
  return null;
};

// Every empty cell in `column` that a drop could have landed in — one that has a table to
// its left, and (below row 0) a table above it. A cell with neither is not open to any
// table at all, so nothing about the dragged table explains its refusal.
const openCellsInColumn = (grid, column) => {
  const out = [];
  grid.forEach((rowArr, r) => {
    if ((rowArr?.[column] ?? null) != null) return;
    const left = rowArr?.[column - 1] ?? null;
    if (left == null) return;
    const above = r > 0 ? grid[r - 1]?.[column] ?? null : null;
    if (r > 0 && above == null) return;
    out.push({ left, above });
  });
  return out;
};

// Why `dragged` landed where `placement` (a dropCandidates entry) puts it, phrased against
// the grid as it stood BEFORE the placement — the rule that admitted the cell, named with
// the neighbouring tables it was tested against, so the user can see the layout's logic
// rather than watch a table jump to a cell they did not aim at.
export const dropPlacementReason = (dragged, grid, placement) => {
  const root = grid[0]?.[0] ?? null;
  const rootColumns = quantity(numCols(root ?? dragged), 'column');
  if (placement.kind === 'newRow') {
    const below = grid[placement.r]?.[0] ?? null;
    return `${dragged.name} placed on a new row above ${below?.name}: it has ${root?.name}'s ${rootColumns} and comes before ${below?.name} in the document.`;
  }
  const { r, c } = placement;
  if (c === 0) {
    const above = spinePredecessor(grid, r);
    return `${dragged.name} placed below ${above?.name} in the first column: it has ${root?.name}'s ${rootColumns}.`;
  }
  const left = grid[r]?.[c - 1] ?? null;
  const above = r > 0 ? grid[r - 1]?.[c] ?? null : null;
  const columns = above
    ? ` and the ${quantity(numCols(dragged), 'column')} of ${above.name} above it`
    : '';
  return `${dragged.name} placed to the right of ${left?.name}: it has the same ${quantity(nonHeaderRows(dragged), 'body row')} as ${left?.name}${columns}.`;
};

// Why no cell in `column` would take `dragged` — for a drop that dropCandidates returned
// nothing for. The reason is given for the column dropped ON, not for the grid at large: a
// table refused there may well have a home elsewhere, and saying so is the whole point of
// keeping the drop in the column the user aimed at.
export const dropRejectionReason = (dragged, grid, column) => {
  const root = grid[0]?.[0] ?? null;
  if (root == null) return 'the grid has no Root table to place it against';
  if (column === 0) {
    return numCols(dragged) === numCols(root)
      ? 'the first column has no empty cell to take it'
      : `it has ${quantity(numCols(dragged), 'column')} where ${root.name} has ${numCols(root)}, so it cannot join the first column`;
  }
  const open = openCellsInColumn(grid, column);
  if (open.length === 0) {
    return 'no cell in that column is open beside a placed table';
  }
  // One reason per open cell, deduplicated: a column whose cells were refused for different
  // reasons has more than one thing to correct, and naming only the first would send the
  // user back for a second refusal.
  const reasons = new Set(
    open.map(({ left, above }) =>
      above && numCols(dragged) !== numCols(above)
        ? `it has ${quantity(numCols(dragged), 'column')} where ${above.name} above it has ${numCols(above)}`
        : `it has ${quantity(nonHeaderRows(dragged), 'body row')} where ${left.name} beside it has ${nonHeaderRows(left)}`,
    ),
  );
  return [...reasons].join(', and ');
};
