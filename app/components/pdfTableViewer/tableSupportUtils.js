// Pure table-editing support utilities shared across the PDF table viewer
// (geometry, cell reconcile/hint builders, overlay conversion, boundary/divider
// resize maths). No React or DOM: every function is pure and operates on plain
// table data. Extracted from PDFEditTableStructure so both the host editor and
// PageImageWithOverlay (and the page editor) can share them without a cycle.

import {
  highConfidence,
  lowConfidence,
  reviewEditedCellConfidence,
  unknownExtractionMechanism,
} from 'config';
import {
  comesAfter,
  hasSavedGrid,
  isAmalgamated,
  singleColumnGrid,
  sortByOrder,
} from 'components/pdfTableViewer/gridUtilities';
import { collectColumnNames } from 'components/pdfTableViewer/layerUtils';
import { newUUID } from 'common/utils';

// Float tolerance for comparing two drawn grid squares in page-fraction space. Axis sums
// drift by tiny amounts on every edit, so an exact comparison would report a square as
// having moved when nothing about it changed.
const GRID_SQUARE_EPS = 1e-6;

// Inclusive running totals, e.g. [5,6,7] -> [5,11,18].
export const cumulative = (arr) =>
  (arr ?? []).reduce((acc, v) => {
    acc.push((acc.length ? acc[acc.length - 1] : 0) + v);
    return acc;
  }, []);

// Absolute page-fraction bounds of drawn grid square (r, c) for a table, derived ONLY
// from the table's bounds and its columnWidths/rowHeights (never from cell.bounds). The
// square's left/top are the table origin plus the cumulative sizes of the preceding
// columns/rows; its width/height are that column's/row's size (0 when out of range).
export function gridSquareBounds(table, r, c) {
  const colWidths = (table.columnWidths ?? []).map((v) => v.value);
  const rowHeights = (table.rowHeights ?? []).map((v) => v.value);
  const colOffsets = cumulative(colWidths);
  const rowOffsets = cumulative(rowHeights);
  const left = table.bounds.left + (c > 0 ? colOffsets[c - 1] : 0);
  const top = table.bounds.top + (r > 0 ? rowOffsets[r - 1] : 0);
  return {
    left,
    top,
    width: colWidths[c] ?? 0,
    height: rowHeights[r] ?? 0,
  };
}

// Absolute page-fraction bounds spanning the leading `count` grid squares of row `r` — the
// data area a new section title is given, drawn across the left of its row rather than left to
// the user to rubber-band. Clamped to the columns the table actually has, so a single-column
// table gets one square rather than an area running off its right edge, and never narrower
// than one square. Null when the table has no columns to span, there being no area to draw.
export function leadingSquaresBounds(table, r, count) {
  const columns = (table.columnWidths ?? []).length;
  if (columns === 0) return null;
  const span = Math.max(1, Math.min(count, columns));
  const first = gridSquareBounds(table, r, 0);
  const last = gridSquareBounds(table, r, span - 1);
  return {
    left: first.left,
    top: first.top,
    width: last.left + last.width - first.left,
    height: first.height,
  };
}

// The cell in table.cells anchored at grid square (r, c), or undefined. Cells are a flat,
// sparse, non-1:1 list: a spanning cell is matched ONLY at its top-left (row/column), and
// many squares legitimately have no cell. Tolerates a missing cells array.
export function cellAt(table, r, c) {
  return (table.cells ?? []).find(
    (cell) => cell.row === r && cell.column === c
  );
}

// A fresh default cell for the grid square (r, c) with the given absolute page-fraction
// `bounds`: empty text, confidence 0 (renders red until re-OCR'd), span 1, header false
// (per-cell header is a back-end concern). The single shape used everywhere a new cell is
// materialised (fillGridCells, reconcileCells' NEW lines, and manual table creation).
export function makeDefaultCell(row, column, bounds) {
  return {
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    bounds,
    text: '',
    confidence: 0,
    header: false,
  };
}

// Ensure every drawn grid square maps to a cell. The backend cells list is sparse — typed
// cells are dropped and a spanning cell covers several squares from a single entry — so any
// grid square not already covered gets a fresh default cell: empty text, confidence 0 (so
// it renders red until re-OCR'd), span 1, header false, bounds = the grid square. A square
// is "covered" when an existing cell spans over it (its top-left plus row/column span).
// Returns the same table unchanged when there is nothing to add.
export function fillGridCells(table) {
  const R = (table.rowHeights ?? []).length;
  const C = (table.columnWidths ?? []).length;
  const covered = new Set();
  for (const cell of table.cells ?? []) {
    const rs = cell.rowSpan ?? 1;
    const cs = cell.columnSpan ?? 1;
    for (let r = cell.row; r < cell.row + rs; r += 1) {
      for (let c = cell.column; c < cell.column + cs; c += 1) {
        covered.add(`${r},${c}`);
      }
    }
  }
  const added = [];
  for (let r = 0; r < R; r += 1) {
    for (let c = 0; c < C; c += 1) {
      if (!covered.has(`${r},${c}`)) {
        added.push(makeDefaultCell(r, c, gridSquareBounds(table, r, c)));
      }
    }
  }
  return added.length
    ? { ...table, cells: [...(table.cells ?? []), ...added] }
    : table;
}

// ---- merged cells: grid-square hit testing, span limits and span edits -------------------
//
// A MERGED cell is an entry in table.cells whose rowSpan or columnSpan exceeds 1; a table may
// have several, and the editor keeps at most one SELECTED, identified by its anchor
// { row, column }. These pure helpers are the whole of the merge arithmetic so the editor
// component only has to wire them to clicks and buttons.

// The grid square a page-fraction point { fx, fy } lands in, as { row, column }, or null when
// the point lies outside table.bounds or the table has no axes to divide. The square is found
// by walking the cumulative axis offsets relative to bounds.left/bounds.top and taking the
// first offset the relative coordinate does not exceed; a point exactly on the far edge (where
// float drift can put the relative coordinate a hair past the last offset) clamps to the last
// column/row. Same arithmetic as the row-only sectionRowBandAt in StagedPageGridEditor.
export function gridSquareAtFraction(table, frac) {
  const cols = (table.columnWidths ?? []).map((v) => v.value);
  const rows = (table.rowHeights ?? []).map((v) => v.value);
  if (!cols.length || !rows.length) return null;
  const b = table.bounds;
  if (!b) return null;
  if (
    frac.fx < b.left ||
    frac.fx > b.left + b.width ||
    frac.fy < b.top ||
    frac.fy > b.top + b.height
  ) {
    return null;
  }
  const index = (values, relative) => {
    const offsets = cumulative(values);
    for (let i = 0; i < offsets.length; i += 1) {
      if (relative <= offsets[i]) return i;
    }
    return offsets.length - 1; // on the far edge: clamp to the last line
  };
  return {
    row: index(rows, frac.fy - b.top),
    column: index(cols, frac.fx - b.left),
  };
}

// The table's merged cells — the entries spanning more than one square in either direction —
// in cells-array order. Tolerates a missing cells array.
export function mergedCells(table) {
  return (table.cells ?? []).filter(
    (cell) => (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1
  );
}

// The merged cell whose spanned block CONTAINS grid square (row, column), or null. Unlike
// cellAt (top-left only) this matches anywhere inside the block, so a click on a covered
// square selects the merged cell that visually owns it.
export function mergedCellCovering(table, row, column) {
  return (
    mergedCells(table).find(
      (cell) =>
        row >= cell.row &&
        row < cell.row + (cell.rowSpan ?? 1) &&
        column >= cell.column &&
        column < cell.column + (cell.columnSpan ?? 1)
    ) ?? null
  );
}

// Which of the four span edits are available for the selected cell `cellRef`
// ({ row, column } | null), as { canExtendColumn, canReduceColumn, canExtendRow,
// canReduceRow }. All false when nothing is selected or the ref resolves to no cell. A span
// may grow while its block stays inside the grid (maximum columnSpan is C - column, maximum
// rowSpan is R - row) and may shrink while it is above 1.
export function mergedCellLimits(table, cellRef) {
  const none = {
    canExtendColumn: false,
    canReduceColumn: false,
    canExtendRow: false,
    canReduceRow: false,
  };
  if (!cellRef) return none;
  const cell = cellAt(table, cellRef.row, cellRef.column);
  if (!cell) return none;
  const C = (table.columnWidths ?? []).length;
  const R = (table.rowHeights ?? []).length;
  const columnSpan = cell.columnSpan ?? 1;
  const rowSpan = cell.rowSpan ?? 1;
  return {
    canExtendColumn: cell.column + columnSpan < C,
    canReduceColumn: columnSpan > 1,
    canExtendRow: cell.row + rowSpan < R,
    canReduceRow: rowSpan > 1,
  };
}

// A NEW table with the cell anchored at (row, column) carrying `spans`
// ({ rowSpan?, columnSpan? } — an omitted key leaves that span alone), each clamped into
// [1, remaining grid]. A square with no cell yet gets a fresh default cell (bounds from
// gridSquareBounds) appended. Nothing is mutated.
//
// The cell's confidence is reset to 0, which is essential rather than cosmetic: the page-exit
// recalculation re-reads ONLY the cells selectLowConfidenceCells returns (confidence null or
// below lowConfidence()), and recalcCellBounds sums the SPANNED columnWidths/rowHeights, so a
// zeroed merged cell is re-read across its whole block. Without the reset a newly-merged cell
// would keep the text read from its original single square and the merge would never reach the
// extracted text. A reduction zeroes it too, because the region changed.
//
// Cells the widened span now covers are deliberately NOT deleted: cellAt matches top-left
// only so a covered entry is inert in the UI, mergeCalcCellsResponse matches by exact
// (row, column) so it is inert in a recalculation, and fillGridCells would recreate it on the
// next load anyway. Deleting them would make a span REDUCTION destructive — the covered
// cells' text could not come back. The saved cells list may therefore hold entries for squares
// a spanning cell covers, the same tolerance fillGridCells documents.
export function withCellSpan(table, row, column, spans) {
  const C = (table.columnWidths ?? []).length;
  const R = (table.rowHeights ?? []).length;
  const existing = cellAt(table, row, column);
  const base =
    existing ?? makeDefaultCell(row, column, gridSquareBounds(table, row, column));
  const clamp = (value, max) => Math.max(1, Math.min(value, max));
  const updated = {
    ...base,
    rowSpan: clamp(spans?.rowSpan ?? base.rowSpan ?? 1, R - row),
    columnSpan: clamp(spans?.columnSpan ?? base.columnSpan ?? 1, C - column),
    confidence: 0,
  };
  const cells = existing
    ? (table.cells ?? []).map((cell) => (cell === existing ? updated : cell))
    : [...(table.cells ?? []), updated];
  return { ...table, cells };
}

// The span to apply when the user merges a not-yet-merged square at (row, column):
// { columnSpan: 2 } when there is a column to the right, else { rowSpan: 2 } when there is a
// row below, else null (the bottom-right square, with nothing to merge into). The row fallback
// matters — a columnSpan of 2 on a last-column cell would push past the grid edge, and since
// Extend/Reduce are enabled only for a MERGED cell the user would be left with a selected but
// unmerged cell that cannot be extended either way. The fallback keeps the invariant that a
// successful merge always produces a merged cell.
export function mergeTargetSpan(table, row, column) {
  const C = (table.columnWidths ?? []).length;
  const R = (table.rowHeights ?? []).length;
  if (column + 1 < C) return { columnSpan: 2 };
  if (row + 1 < R) return { rowSpan: 2 };
  return null;
}

// A stable string projection of a table's spans, used to detect that a merge happened: each
// merged cell as `row,column,rowSpan,columnSpan`, sorted lexicographically so the cells-array
// order does not matter, joined. Span-1 cells contribute nothing (an unmerged table's
// signature is ''). Text and confidence are deliberately EXCLUDED: a recalculation writes
// those two fields back, so including them would classify every re-read as a fresh edit.
export function cellSpanSignature(table) {
  return mergedCells(table)
    .map(
      (cell) =>
        `${cell.row},${cell.column},${cell.rowSpan ?? 1},${cell.columnSpan ?? 1}`
    )
    .sort()
    .join('|');
}

// The tables a root holds in `next` with no grid laid out for them, in document order.
// Empty for a table with no links, and for one whose group has a saved grid, which is
// described by its grid size instead.
export function additionalTables(t) {
  if (!t || hasSavedGrid(t)) return [];
  return sortByOrder(Object.values(t.next ?? {}));
}

// The size lines for a left-column table entry, as { sizeLine, tablesLine } — an object
// rather than one newline-joined string so the function stays purely arithmetic and the
// caller decides how the two lines are laid out.
//
// `sizeLine` is "RR Rows, CC Columns" and describes the data the table yields. A plain
// table's base counts are its own rowHeights/columnWidths lengths. A table carrying a
// saved link grid describes the joined result instead: columns summed across the tables
// in grid row 0 (the Root, always grid position (0,0), included) and rows summed down
// grid column 0 with each linked table's header rows excluded (they repeat the Root's)
// but the Root's own header rows kept. Grid entries that resolve to no table (empty
// string, or an id missing from `next`) contribute nothing.
//
// Two sub-title adjustments then apply. RR drops every sub-title row of every table that
// contributed rows (a sub-title row is never a data row, whether or not it is flagged for
// deletion at final-extract time), clamped at 0. CC adds the distinct non-null
// `columnName`s across the table and every table reachable through its `next` map, since
// each named sub-title supplies a column of the joined result.
//
// `tablesLine` is the grid's own dimensions as "A × B Tables" for a table with a saved link
// grid, "Additional tables N" for a root holding links with no grid laid out for them, and
// null for a table with neither.
export function tableSizeLabel(t) {
  // Sub-title rows within a table's own row range — the same guard the editor's
  // renderSectionTitles applies before drawing one.
  const subTitleRows = (table) =>
    (table.sectionTitles ?? []).filter(
      (s) => s.tableRow >= 0 && s.tableRow < (table.rowHeights ?? []).length
    ).length;

  const namedColumns = collectColumnNames([
    t,
    ...linkedTablesWithParents([t]).map((x) => x.table),
  ]).length;

  const grid = t.grid;
  let baseColumns = 0;
  let baseRows = 0;
  let subTitles = 0;
  let tablesLine = null;

  if (!hasSavedGrid(t)) {
    baseColumns = (t.columnWidths ?? []).length;
    baseRows = (t.rowHeights ?? []).length;
    subTitles = subTitleRows(t);
    // No grid size to report, so the line states how many tables the group holds.
    const extra = additionalTables(t).length;
    if (extra > 0) tablesLine = `Additional tables ${extra}`;
  } else {
    const resolve = (r, c) => {
      if (r === 0 && c === 0) return t; // (0,0) is always the Root table itself
      const id = grid[r]?.[c];
      return id ? t.next?.[id] ?? null : null;
    };
    (grid[0] ?? []).forEach((_, c) => {
      const table = resolve(0, c);
      if (table) baseColumns += (table.columnWidths ?? []).length;
    });
    grid.forEach((_, r) => {
      const table = resolve(r, 0);
      if (!table) return;
      const all = (table.rowHeights ?? []).length;
      baseRows += r === 0 ? all : Math.max(0, all - (table.headerCount ?? 0));
      subTitles += subTitleRows(table);
    });
    const gridColumns = grid.reduce((m, row) => Math.max(m, row.length), 0);
    tablesLine = `${gridColumns} × ${grid.length} Tables`;
  }

  const rows = Math.max(0, baseRows - subTitles);
  const columns = baseColumns + namedColumns;
  return { sizeLine: `${rows} Rows, ${columns} Columns`, tablesLine };
}

// Every table nested inside another table's `next` map (a saved link grid removes the
// linked tables from the top-level metadata list), each paired with the name of the
// table it is linked under. Recurses in case a linked table itself carries a grid.
export function linkedTablesWithParents(tables) {
  const out = [];
  const collect = (parent) => {
    Object.values(parent.next ?? {}).forEach((child) => {
      out.push({ table: child, parentName: parent.name ?? parent.tableId });
      collect(child);
    });
  };
  (tables ?? []).forEach(collect);
  return out;
}

// Every non-deleted table on `page`, taken from the top-level list AND from every table's
// `next` map. Returns the metadata tables by REFERENCE and undecorated: callers commit
// these objects back into the document, so nothing display-related may be attached to them.
export function tablesOnPage(tables, page) {
  const all = tables ?? [];
  return [
    ...all,
    ...linkedTablesWithParents(all).map(({ table }) => table),
  ].filter((t) => t.pdfPage === page && !t.deleted);
}

// Apply `fn` to EVERY table in the list, at the top level and at any depth inside a `next`
// map, returning the rebuilt top-level list. Identity is preserved wherever nothing
// changed — an untouched table, and an untouched root, come back by reference, and the very
// same list is returned when `fn` changed nothing anywhere — so callers can still test
// "did anything change?" by reference. Children are visited first, so a parent reaches `fn`
// already carrying its transformed `next` map and one pass suffices.
export function mapAllTables(tables, fn) {
  const list = tables ?? [];
  let changed = false;
  const out = list.map((table) => {
    const kids = table.next ? Object.entries(table.next) : null;
    let withKids = table;
    if (kids && kids.length) {
      let kidsChanged = false;
      const nextMap = {};
      kids.forEach(([key, child]) => {
        const mapped = mapAllTables([child], fn)[0];
        if (mapped !== child) kidsChanged = true;
        nextMap[key] = mapped;
      });
      if (kidsChanged) withKids = { ...table, next: nextMap };
    }
    const mapped = fn(withKids);
    if (mapped !== table) changed = true;
    return mapped;
  });
  return changed ? out : list;
}

// A table's part in a merge, as reported by mergeRolesByTableId.
export const MERGE_ROLE_JOINED = 'joined';
export const MERGE_ROLE_ROOT = 'root';

// Each merged table's role, keyed by tableId: MERGE_ROLE_JOINED for a table held in some
// table's `next` map, MERGE_ROLE_ROOT for a top-level table that holds links or a saved
// grid. A table in neither category has no key, so a consumer reads a missing key as
// "not part of a merge". Takes the whole document's top-level list, because a joined
// table's root may sit on another page.
export function mergeRolesByTableId(tables) {
  const roles = {};
  (tables ?? []).forEach((t) => {
    if (isAmalgamated(t)) roles[t.tableId] = MERGE_ROLE_ROOT;
  });
  // Written second so a linked table carrying its own links comes out joined, not root.
  linkedTablesWithParents(tables).forEach(({ table }) => {
    roles[table.tableId] = MERGE_ROLE_JOINED;
  });
  return roles;
}

// Every table in `list`, at the top level and inside every `next` map.
const allTablesDeep = (list) => [
  ...(list ?? []),
  ...linkedTablesWithParents(list).map(({ table }) => table),
];

// Whether the SET of tables differs between two top-level lists: which table ids exist, and
// whether each is soft-deleted. Geometry, names, cells and every other field are ignored.
export function tableSetChanged(before, after) {
  const project = (list) => {
    const map = new Map();
    allTablesDeep(list).forEach((t) => map.set(t.tableId, Boolean(t.deleted)));
    return map;
  };
  const a = project(before);
  const b = project(after);
  if (a.size !== b.size) return true;
  for (const [id, deleted] of a) {
    if (!b.has(id) || b.get(id) !== deleted) return true;
  }
  return false;
}

// The four states a table's Link label can be in.
export const LINK_LABEL_END_LINKING = 'endLinking';
export const LINK_LABEL_ROOT = 'root';
export const LINK_LABEL_JOINED = 'joined';
export const LINK_LABEL_PLAIN = 'plain';

// A table's Link label: its state and the text to draw. `roles` is a mergeRolesByTableId
// map, `parents` a linkedTablesWithParents list, and `linkingRootId` the table rooting an
// open linking session, or null. The session wins over the role, so the root of a group
// being added to reads "End Linking" rather than "Linked".
export function linkLabelText(table, roles, parents, linkingRootId) {
  const id = table?.tableId;
  if (id != null && id === linkingRootId) {
    return { state: LINK_LABEL_END_LINKING, text: 'End Linking' };
  }
  const role = (roles ?? {})[id];
  if (role === MERGE_ROLE_JOINED) {
    const entry = (parents ?? []).find((e) => e.table.tableId === id);
    return {
      state: LINK_LABEL_JOINED,
      text: `Linked to ${entry?.parentName ?? id}`,
    };
  }
  if (role === MERGE_ROLE_ROOT) {
    return { state: LINK_LABEL_ROOT, text: 'Linked' };
  }
  return { state: LINK_LABEL_PLAIN, text: 'Selected' };
}

// Whether `table` may join the linked group rooted at `root`: it must not be the root, must
// be in no group already, and must come after the root in document order.
export function canJoinLinkGroup(table, root, roles) {
  if (!table || !root) return false;
  if (table.tableId === root.tableId) return false;
  if ((roles ?? {})[table.tableId]) return false;
  return comesAfter(table, root);
}

// Take one table back out of the linked group rooted at `rootId` and return it to the
// top-level list, placed in document order among the tables already there rather than
// appended, so the Document Overview still reads down the document.
//
// The root's saved grid is REBUILT whole, not patched: it was laid out over a membership that
// no longer holds, and a grid still naming the table that just left would keep it in the
// extraction. The rebuild is the same single column the join writes, over the members that
// remain, so the group the extraction walks still holds all of them. `next` and the grid both
// go to null once the last member leaves, so the root stops reading as amalgamated.
//
// Only a DIRECT member is removable: `rootId` must name a top-level table and `tableId` a key
// of its own `next` map. Anything else — an unknown id, a member of another group, a table
// nested deeper — returns the list unchanged BY REFERENCE, so the caller can test for it.
export function removeFromLinkGroup(tables, rootId, tableId) {
  const list = tables ?? [];
  const root = list.find((t) => t.tableId === rootId);
  const removed = root?.next?.[tableId];
  if (!removed) return list;

  const rest = Object.fromEntries(
    Object.entries(root.next).filter(([id]) => id !== tableId)
  );
  const withoutMember = list.map((t) =>
    t.tableId === rootId
      ? {
          ...t,
          next: Object.keys(rest).length > 0 ? rest : null,
          grid: singleColumnGrid(t, Object.values(rest)),
        }
      : t
  );

  const at = withoutMember.findIndex((t) => comesAfter(t, removed));
  return at === -1
    ? [...withoutMember, removed]
    : [...withoutMember.slice(0, at), removed, ...withoutMember.slice(at)];
}

// The table carrying `tableId`, looked for at the top level and then inside each table's
// `next` map — a saved link grid removes the joined tables from the top-level list, so a
// selected id need not name one of them. Null when nothing carries the id.
export function findTableById(tables, tableId) {
  if (tableId == null) return null;
  for (const table of tables ?? []) {
    if (table.tableId === tableId) return table;
    const found = findTableById(Object.values(table.next ?? {}), tableId);
    if (found) return found;
  }
  return null;
}

// Replace the table carrying `tableId` with `newTable`, wherever it sits: at the top level,
// or inside another table's `next` map. Rebuilding the owning table's `next` (rather than
// only mapping the top level) is what keeps an edit to a joined table from being dropped —
// a saved link grid removes those tables from the top-level list. The list is returned
// unchanged, by reference, when no table anywhere carries the id.
export function replaceTableById(tables, tableId, newTable) {
  const list = tables ?? [];
  let found = false;
  const out = list.map((t) => {
    if (found) return t;
    if (t.tableId === tableId) {
      found = true;
      return newTable;
    }
    const children = Object.values(t.next ?? {});
    if (children.length === 0) return t;
    const replaced = replaceTableById(children, tableId, newTable);
    // Identity, not equality: the recursion hands back the very array it was given when
    // the id is not in that branch.
    if (replaced === children) return t;
    found = true;
    return {
      ...t,
      next: Object.fromEntries(replaced.map((child) => [child.tableId, child])),
    };
  });
  return found ? out : list;
}

// Enforce the I1/I2 geometry invariant on a table: bounds.width/height must equal the sum
// of the columnWidths/rowHeights values. The grid is drawn by tiling those per-axis sizes
// from bounds.left/top, so an inconsistent width/height leaves the drawn table outline and
// its grid disagreeing. Every in-app edit already recomputes bounds from the axis sums
// (resizeBoundary/moveDivider keep I1/I2 exact), but backend metadata can arrive with a
// width/height that differs from the sums. Without normalising on load, the FIRST boundary
// drag that derives an edge from bounds — a left/top shrink sets newLeft/newTop to
// (far edge - sum), i.e. (bounds.left + bounds.width) - sum(newAxis) — shifts EVERY grid
// square by that discrepancy, so reconcileCells sees every square move and needlessly
// zeroes every cell's confidence. Returns the same table when it is already consistent (or
// has no axis to sum). Bounds are treated as authoritative for left/top only; width/height
// follow the axis, matching the rest of the module.
export function normaliseTableBounds(table) {
  const b = table.bounds;
  if (!b) return table;
  const cols = table.columnWidths ?? [];
  const rows = table.rowHeights ?? [];
  const width = cols.length ? sumValues(cols) : b.width;
  const height = rows.length ? sumValues(rows) : b.height;
  if (b.width === width && b.height === height) return table;
  return { ...table, bounds: { ...b, width, height } };
}

// Build the single find-tables hint for a Calculate run on a border-only (1×1) table.
// `name` and `tableInPage` are REQUIRED so the finder can reflect them back and the
// front-end can locate the produced table; the table's bounds become the search rectangle.
// `rows`/`cols` are the two OPTIONAL numeric fields as raw strings ('' when left blank):
// each is included only when the user actually entered a value, coerced to a Number.
// `colouredAreas` is the OPTIONAL page coloured-area hint list. There is no page-level
// coloured-areas field on the find-tables request (FindTablesRequest/FindTablesPageRequest
// have none — only FindTableHintRequest.coloured_areas, which is per-hint), so the page's
// areas ride on each hint. Omitted entirely when absent or empty, keeping the three-argument
// call byte-identical to before.
export function buildCalcHint(table, rows, cols, colouredAreas) {
  return {
    name: table.name,
    tableInPage: table.tableInPage,
    left: table.bounds.left,
    top: table.bounds.top,
    width: table.bounds.width,
    height: table.bounds.height,
    ...(rows !== '' && rows != null ? { expectedRows: Number(rows) } : {}),
    ...(cols !== '' && cols != null ? { expectedColumns: Number(cols) } : {}),
    ...((colouredAreas ?? []).length ? { colouredAreas } : {}),
  };
}

// Choose which returned table a Calculate response applies to. The finder normally returns
// exactly one; if it returns several, match the one the hint was reflected onto (same
// tableInPage + pdfPage), otherwise fall back to the first. Returns null when nothing was
// returned (the caller then leaves the border table unchanged).
export function pickCalcResultTable(menuTable, tables) {
  const list = tables ?? [];
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return (
    list.find(
      (t) =>
        t.tableInPage === menuTable.tableInPage &&
        t.pdfPage === menuTable.pdfPage
    ) ?? list[0]
  );
}

// Build the replacement table for a Calculate / Recalculate result. This is a MERGE, not an
// overwrite: it adopts the finder's geometry and content (bounds, axes, cells, title,
// headerCount, sectionTitles, footer, confidence) but KEEPS the fields the editor is the
// definitive source for, then runs the result through the SAME normalisation the metadata
// loader applies (normaliseTableBounds then fillGridCells) so the I1/I2 invariant holds and
// every drawn grid square has a cell.
//
// The kept fields are the ones the finder has no concept of:
//   tableId / pdfPage      — this table's identity in the editor's list.
//   confirmationStage      — how far the user has taken it through the Layers. The finder
//                            never sets it, so adopting the result would reset the user's
//                            progress — and Save would then persist that reset.
//   deleted                — the soft-delete marker, an editor concept only. A default the
//                            finder sends is not authoritative and could resurrect a table.
//   next                   — the linked/joined-table map, set in the Grid Editor panel.
// `name` and `tableInPage` are deliberately NOT kept: both finders reflect the hint's values
// back onto their results by design, so those legitimately round-trip.
export function buildCalcReplacement(menuTable, resultTable) {
  return fillGridCells(
    normaliseTableBounds({
      ...resultTable,
      tableId: menuTable.tableId,
      pdfPage: menuTable.pdfPage,
      confirmationStage: menuTable.confirmationStage,
      deleted: menuTable.deleted,
      next: menuTable.next,
    })
  );
}

// The cells of `prevTable` that survive having its geometry replaced by `geometry`
// ({ bounds, columnWidths, rowHeights }) from a find-grid-lines response.
//
// A cell anchored OUTSIDE the new grid is dropped: its row/column no longer indexes an axis
// entry, so it describes a square that does not exist. The fillGridCells pass that follows
// materialises whatever the drop leaves uncovered.
//
// Every other cell is carried over under the SAME rule reconcileCells applies to an axis
// edit — compare the drawn grid square at the cell's (row, column) before and after:
//
// * square unchanged: keep the cell exactly as it is, tighter OCR bounds and confidence
//   included. Nothing about the region it was read from has moved.
// * square moved or resized: adopt the new square as the cell's bounds and zero its
//   confidence. The text is kept, because discarding real extracted text is not this
//   merge's job — but it is now a claim about a different piece of the page, so it has to
//   read as one: confidence 0 renders the cell red and puts it in the next re-read.
//
// Adopting the new square is not cosmetic. `cell.bounds` is the rectangle
// buildCalcCellsRequestTable sends as the region to READ and the rectangle the review
// screen crops, so a cell left sitting on its old square makes the next Calculate read the
// wrong strip of the page. When a re-detected grid gains or loses a row at the top, every
// retained cell is off by one and Calculate silently copies each row's text into the row
// below it, leaving the table's last row never read at all.
export function retainMergedCells(prevTable, geometry) {
  const R = (geometry.rowHeights ?? []).length;
  const C = (geometry.columnWidths ?? []).length;
  return (prevTable.cells ?? [])
    .filter((cell) => cell.row < R && cell.column < C)
    .map((cell) => {
      // recalcCellBounds rather than gridSquareBounds: it sums the spanned axis entries,
      // so a rowSpan/columnSpan > 1 cell is compared and re-seated across its whole block
      // rather than against its top-left square alone.
      const before = recalcCellBounds(prevTable, cell);
      const after = recalcCellBounds(geometry, cell);
      if (!boundsDiffer(before, after, GRID_SQUARE_EPS)) return cell;
      return { ...cell, bounds: after, confidence: 0 };
    });
}

// The display name for a table at `index` on `page`. Both arguments are 0-based and both
// are shown 1-based. The one form for every table name the editor creates.
export function pageTableName(page, index) {
  return `Page ${page + 1} Table ${index + 1}`;
}

// Merge a find-grid-lines response into the full metadata tables list. The response carries
// only the current `page`'s tables, each ({ bounds, columnWidths, rowHeights }) describing the
// detected grid for one table.
//
// The candidate pool is THE PAGE, not the top-level list: a table joined into another
// table's group lives in its root's `next` map, and it is a table of the page like any other.
//
// Matching is by BOUNDS OVERLAP, not `tableInPage` (which is an unreliable positional index):
// for each returned table the same-page, non-soft-deleted table with the LARGEST overlap area
// has its bounds/columnWidths/rowHeights replaced WHERE IT LIVES (id, name, title, stage and
// group membership are kept, and so are its cells — re-seated onto the new grid by
// retainMergedCells, which drops the ones the new grid has no square for). The other
// non-soft-deleted tables the returned table also overlaps are spurious duplicates and are
// HARD-deleted, but only at the top level — see the guard below. This is distinct from the
// soft `deleted` flag, which records a deliberate manual deselection and is therefore never
// matched, resurrected, or hard-deleted here. A returned table that overlaps nothing on the
// page is APPENDED.
//
// `tableInPage` is then re-derived for the page's live tables — nested ones included — by
// ordering on bounds.top (with bounds.left as the tie-break). Finally the idempotent
// normaliseTableBounds + fillGridCells passes run over every top-level table and over any
// nested table this merge changed, so the I1/I2 geometry invariant holds and every drawn
// grid square has a cell.
export function mergeFindGridLines(tables, page, responseTables) {
  let list = [...(tables ?? [])];
  // Which ids sit on the TOP-LEVEL list. A joined member is not among them, and that is what
  // gates the hard-delete below. Ids never move between levels here, so one capture holds.
  const topLevelIds = new Set(list.map((t) => t.tableId));
  const claimed = new Set(); // tableIds already matched to a returned table
  const toDelete = new Set(); // tableIds to hard-remove (spurious overlappers)
  const touched = new Set(); // tableIds this merge changed, matched or appended
  const appended = [];

  for (const returned of responseTables ?? []) {
    const geometry = {
      bounds: returned.bounds,
      columnWidths: returned.columnWidths,
      rowHeights: returned.rowHeights,
    };
    const overlappers = tablesOnPage(list, page).filter(
      (t) =>
        !claimed.has(t.tableId) &&
        !toDelete.has(t.tableId) &&
        overlapArea(t.bounds, returned.bounds) > 0
    );
    if (overlappers.length === 0) {
      // Nothing on the page accounts for this grid. The way that happens in practice is a
      // detector split: one hinted rectangle spanning two stacked tables comes back as two,
      // the upper half claims the hinted table, and the fragment below — which carries no
      // hint identity — lands here. It is a real table, so it is built like one the user
      // drew rather than as a shell. `name` is never '': every fallback that would supply
      // one tests for absence, and an empty string is present, so '' is nameless for ever.
      appended.push({
        tableId: newUUID(),
        name: pageTableName(page, tablesOnPage(list, page).length + appended.length),
        next: null,
        pdfPage: page,
        tableInPage: 0, // re-derived below
        headerCount: 0,
        confidence: 100,
        title: null,
        sectionTitles: null,
        footer: null,
        cells: [], // filled for the detected grid by the closing pass
        extractionMechanism: unknownExtractionMechanism(),
        confirmationStage: null,
        ...geometry,
      });
      continue;
    }
    const match = overlappers.reduce((best, t) =>
      overlapArea(t.bounds, returned.bounds) > overlapArea(best.bounds, returned.bounds)
        ? t
        : best
    );
    claimed.add(match.tableId);
    touched.add(match.tableId);
    // replaceTableById, not a top-level map: it descends into the owning root's `next` when
    // the match is nested, so a member is updated inside its group rather than lost.
    list = replaceTableById(list, match.tableId, {
      ...match,
      ...geometry,
      cells: retainMergedCells(match, geometry),
    });
    for (const o of overlappers) {
      // A joined member is never pulled out of its group by a re-detection. Only a top-level
      // neighbour can be a spurious duplicate: a left-behind duplicate is visible and
      // removable, a dissolved group is neither.
      if (o.tableId !== match.tableId && topLevelIds.has(o.tableId)) toDelete.add(o.tableId);
    }
  }

  let result = list.filter((t) => !toDelete.has(t.tableId)).concat(appended);
  for (const table of appended) touched.add(table.tableId);
  const resultTopLevelIds = new Set(result.map((t) => t.tableId));

  // Re-derive tableInPage for this page's live tables by position (top, then left), nested
  // tables included: the position is used as an identity key elsewhere, so two tables on one
  // page must never share one.
  const ranked = tablesOnPage(result, page)
    .slice()
    .sort(
      (a, b) =>
        (a.bounds?.top ?? 0) - (b.bounds?.top ?? 0) ||
        (a.bounds?.left ?? 0) - (b.bounds?.left ?? 0)
    );
  const rankById = new Map(ranked.map((t, i) => [t.tableId, i]));
  result = mapAllTables(result, (t) =>
    rankById.has(t.tableId) && t.tableInPage !== rankById.get(t.tableId)
      ? { ...t, tableInPage: rankById.get(t.tableId) }
      : t
  );

  // Every top-level table as before, plus any nested table this merge changed. Not wider:
  // repairing members nobody edited is not this function's job.
  return mapAllTables(result, (t) =>
    resultTopLevelIds.has(t.tableId) || touched.has(t.tableId)
      ? fillGridCells(normaliseTableBounds(t))
      : t
  );
}

// Structural equality for a PDFBoundedText-shaped title (bounds + text + confidence), or null.
// Used by the backgrounded recalc write-back to tell a genuine title change from a no-op and to
// detect that the user has re-edited the title since the recalc launched.
export function titlesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ab = a.bounds ?? {};
  const bb = b.bounds ?? {};
  return (
    a.text === b.text &&
    a.confidence === b.confidence &&
    ab.left === bb.left &&
    ab.top === bb.top &&
    ab.width === bb.width &&
    ab.height === bb.height
  );
}

// The low-confidence (RED) cells of a table: those with confidence == null or below
// lowConfidence() (50). This is the SAME predicate confidenceColour uses to paint a cell
// red — the orange band (< highConfidence(), 70) is deliberately EXCLUDED, because
// Recalculate only re-reads the cells the UI marks red. Tolerates a missing cells array.
export function selectLowConfidenceCells(cells) {
  return (cells ?? []).filter(
    (cell) => cell.confidence == null || cell.confidence < lowConfidence()
  );
}

// The find-tables request bounds for a Recalculate cell, derived from the GRID LINES (via
// gridSquareBounds) and never from cell.bounds (the tighter OCR text box). The top-left is
// the drawn grid square at the cell's (row, column); the width/height SUM the spanned
// columnWidths/rowHeights so a rowSpan/columnSpan > 1 cell covers its whole spanned block.
export function recalcCellBounds(table, cell) {
  const { left, top } = gridSquareBounds(table, cell.row, cell.column);
  const colWidths = (table.columnWidths ?? []).map((v) => v.value);
  const rowHeights = (table.rowHeights ?? []).map((v) => v.value);
  const columnSpan = cell.columnSpan ?? 1;
  const rowSpan = cell.rowSpan ?? 1;
  const width = colWidths
    .slice(cell.column, cell.column + columnSpan)
    .reduce((acc, v) => acc + v, 0);
  const height = rowHeights
    .slice(cell.row, cell.row + rowSpan)
    .reduce((acc, v) => acc + v, 0);
  return { left, top, width, height };
}

// Build the single find-tables hint for a Recalculate run on a multi-cell table. Like
// buildCalcHint, `name` and `tableInPage` are REQUIRED (reflected back so the merge can
// locate the target) and the table's bounds are the search rectangle. Instead of expected
// counts the hint carries a `cells` array — one entry per selected RED cell, echoing its
// row/column/span and carrying the GRID-LINE region bounds (recalcCellBounds).
//
// Three OPTIONAL extras, each omitted entirely when not supplied so the two-argument call
// stays byte-identical to before: `colouredAreas` (the page's coloured-area hints, which ride
// on each hint because the find-tables request has no page-level field — see buildCalcHint);
// and `expectedColumns`/`expectedRows`, raw strings ('' when left blank) included only when
// the user entered a value, coerced with Number — the same rule buildCalcHint applies.
export function buildRecalcHint(
  table,
  cells,
  colouredAreas,
  expectedColumns,
  expectedRows
) {
  return {
    name: table.name,
    tableInPage: table.tableInPage,
    left: table.bounds.left,
    top: table.bounds.top,
    width: table.bounds.width,
    height: table.bounds.height,
    cells: (cells ?? []).map((cell) => ({
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      columnSpan: cell.columnSpan ?? 1,
      bounds: recalcCellBounds(table, cell),
    })),
    ...((colouredAreas ?? []).length ? { colouredAreas } : {}),
    ...(expectedColumns !== '' && expectedColumns != null
      ? { expectedColumns: Number(expectedColumns) }
      : {}),
    ...(expectedRows !== '' && expectedRows != null
      ? { expectedRows: Number(expectedRows) }
      : {}),
  };
}

// Merge a Recalculate response back into a table. Only the returned cells (a cell-only
// re-read of the selected RED cells) are merged, matched by (row, column): each returned
// cell REPLACES its counterpart wholesale (its freshly-read text, confidence, bounds and
// span). EVERY other cell and ALL table geometry (bounds, columnWidths, rowHeights) is
// preserved unchanged — untouched cells and the geometry are kept by reference. A returned
// cell with no counterpart (defensive; should not happen) is appended.
export function mergeRecalcCells(table, returnedCells) {
  const byKey = new Map(
    (returnedCells ?? []).map((cell) => [`${cell.row},${cell.column}`, cell])
  );
  const cells = (table.cells ?? []).map((cell) => {
    const key = `${cell.row},${cell.column}`;
    const replacement = byKey.get(key);
    if (replacement) byKey.delete(key);
    return replacement ?? cell;
  });
  for (const leftover of byKey.values()) cells.push(leftover);
  return { ...table, cells };
}

// Detect a shortfall in a find-tables (Recalculate) response versus what was requested,
// returning a user-facing warning string or null. The finder is best-effort: it can fail
// to detect a whole requested table, or some of a table's requested cells. That surfaces
// as (a) fewer tables returned than hints sent, or (b) a returned table carrying fewer
// cells than its hint requested. Returned tables are matched to their hint by the reflected
// (name, tableInPage). "Some tables not detected" takes precedence over "Some cells not
// detected". Only cell-bearing hints contribute a cell check. Currently one table is
// requested at a time, but this generalises to several requested at once.
export function recalcShortfallMessage(requestedHints, returnedTables) {
  const requested = requestedHints ?? [];
  const returned = returnedTables ?? [];
  if (returned.length < requested.length) return 'Some tables not detected';
  for (const hint of requested) {
    const requestedCells = (hint.cells ?? []).length;
    if (requestedCells === 0) continue;
    const table = returned.find(
      (t) => t.name === hint.name && t.tableInPage === hint.tableInPage
    );
    if (!table) return 'Some tables not detected';
    if ((table.cells ?? []).length < requestedCells) {
      return 'Some cells not detected';
    }
  }
  return null;
}

// ---- calculate-cells: request building, specials ordering and text merging ---------------
//
// calculate-cells is a text READ, not a detection: every rectangle handed to it is taken as
// correct, and the response carries text and confidence only — no bounds, no axes. So the
// request builder below and the merge that follows it are a matched pair, and the specials
// order is the contract between them.

// The four page-fraction fields of a rectangle, stripped of anything else a metadata
// BoundingRectangle carries (the per-edge border widths). The request DTOs are plain
// Rectangles, so sending the extras would be noise.
const plainRect = (bounds) => ({
  left: bounds.left,
  top: bounds.top,
  width: bounds.width,
  height: bounds.height,
});

// The ordered special areas of a table, and the SINGLE source of that order: the request
// builder emits them in this order and the merge reads the response's positional `specials`
// back through the same list, so neither side re-derives it. Each entry pairs the rectangle
// to send with where it came from:
//   { kind: 'sectionTitle', index, bounds } — index into the table's sectionTitles array;
//   { kind: 'footer', index: null, bounds }  — the table's footer.
// Section titles come first, in array order, and a section title with no `data` area has no
// rectangle to read so it contributes nothing at all (it must not occupy a slot). The footer
// is last, and only when the table has one.
export function specialAreaEntries(table) {
  const entries = [];
  (table.sectionTitles ?? []).forEach((section, index) => {
    if (!section?.data?.bounds) return;
    entries.push({
      kind: 'sectionTitle',
      index,
      bounds: plainRect(section.data.bounds),
    });
  });
  if (table.footer?.bounds) {
    entries.push({ kind: 'footer', index: null, bounds: plainRect(table.footer.bounds) });
  }
  return entries;
}

// Build the calculate-cells request table for ONE metadata table: the table's own rectangle
// (the DTO inherits Rectangle, so left/top/width/height sit at the top level), its
// tableInPage so the response can be matched back, and one entry per cell carrying that
// cell's OWN rectangle plus its row/column. The per-cell rectangles *are* the grid — there
// are deliberately no columnWidths/rowHeights, because the endpoint moves nothing.
//
// The optional `title` and `specials` keys are omitted entirely when the table has nothing
// for them, so a plain table's request stays minimal.
export function buildCalcCellsRequestTable(table) {
  const specials = specialAreaEntries(table);
  return {
    ...plainRect(table.bounds),
    tableInPage: table.tableInPage,
    cells: (table.cells ?? []).map((cell) => ({
      ...plainRect(cell.bounds),
      row: cell.row,
      column: cell.column,
    })),
    ...(table.title?.bounds ? { title: plainRect(table.title.bounds) } : {}),
    ...(specials.length ? { specials: specials.map((s) => s.bounds) } : {}),
  };
}

// Apply a calculate-cells response table to its metadata table, writing back TEXT ONLY:
//   - each returned cell replaces its counterpart's `text`/`confidence`, matched by
//     (row, column); every other cell field — bounds, spans, header — and ALL of the table's
//     geometry is kept, as is any cell the response did not mention. A returned cell matching
//     no local cell is dropped (defensive: the request listed the cells, so it cannot happen);
//   - a returned `title` updates the title's text/confidence and keeps its existing bounds;
//   - returned `specials` map POSITIONALLY onto specialAreaEntries(table) — the same order the
//     request was built from — updating each section title's `data` or the footer, bounds kept.
// Nothing else changes: no bounds, no axes, no confirmationStage, no name.
// Whether a reading was entered by hand and so outranks a fresh read of the same
// rectangle. A correction is recorded at reviewEditedCellConfidence(), which is what
// `_is_low` already reads to keep the next extraction off that region; the page-exit
// re-read has to honour the same mark or it silently retypes what the user just fixed.
//
// Moving a rectangle is not a case this has to allow for: an edit that moves a cell zeroes
// its confidence (zeroConfidenceInRects), so a moved cell is no longer at the manual mark
// and is re-read exactly as it should be. What this protects is the other case — a
// structural edit elsewhere on the page dragging every cell of the table through a re-read
// it did not need.
const manuallyEntered = (reading) =>
  reading?.confidence === reviewEditedCellConfidence();

export function mergeCalcCellsResponse(table, responseTable) {
  const byKey = new Map(
    (responseTable?.cells ?? []).map((cell) => [`${cell.row},${cell.column}`, cell])
  );
  const cells = (table.cells ?? []).map((cell) => {
    if (manuallyEntered(cell)) return cell;
    const read = byKey.get(`${cell.row},${cell.column}`);
    return read ? { ...cell, text: read.text, confidence: read.confidence } : cell;
  });

  const merged = { ...table, cells };

  if (responseTable?.title && table.title && !manuallyEntered(table.title)) {
    merged.title = {
      ...table.title,
      text: responseTable.title.text,
      confidence: responseTable.title.confidence,
    };
  }

  const returnedSpecials = responseTable?.specials;
  if (returnedSpecials?.length) {
    const entries = specialAreaEntries(table);
    // Positional: specials[i] answers entries[i]. Section-title writes are collected into a
    // copy of the array so several of them land together.
    let sectionTitles = table.sectionTitles;
    returnedSpecials.forEach((read, i) => {
      const entry = entries[i];
      if (!entry || !read) return;
      if (entry.kind === 'footer') {
        if (manuallyEntered(table.footer)) return;
        merged.footer = {
          ...table.footer,
          text: read.text,
          confidence: read.confidence,
        };
        return;
      }
      if (manuallyEntered((table.sectionTitles ?? [])[entry.index]?.data)) return;
      sectionTitles = (sectionTitles ?? []).map((section, index) =>
        index === entry.index
          ? {
              ...section,
              data: {
                ...section.data,
                text: read.text,
                confidence: read.confidence,
              },
            }
          : section
      );
    });
    if (sectionTitles !== table.sectionTitles) merged.sectionTitles = sectionTitles;
  }

  return merged;
}

// Sentinel in a row/column index map marking a NEW axis line (one with no old index
// behind it). reconcileCells creates a fresh cell for every grid square on a NEW line.
export const NEW = Symbol('new-axis-line');

// Index map for an UNCHANGED axis of length n: new index i <- old index i.
export const identityMap = (n) => Array.from({ length: n }, (_, i) => i);

// Index map for splitEntry(arr, i) where the EXISTING content keeps the near (top/left)
// half and the inserted NEW line is the far (bottom/right) half. Used by "Add Above"/
// "Add Left" (and the bottom/right boundary adds), where the clicked line is the far edge
// of the split row/column, so the new empty line lands adjacent to it on the far side:
// new 0..i <- old 0..i; new i+1 is the NEW line; new > i+1 <- old (index - 1).
export const splitMap = (len, i) => {
  const map = [];
  for (let j = 0; j <= i; j += 1) map.push(j);
  map.push(NEW);
  for (let j = i + 2; j <= len; j += 1) map.push(j - 1);
  return map;
};

// Index map for splitEntry(arr, i) where the inserted NEW line is the near (top/left) half
// and the existing content is pushed to the far (bottom/right) half. Used by "Add Below"/
// "Add Right" (and the top/left boundary adds), where the clicked line is the near edge of
// the split row/column: the new empty line must land immediately adjacent to that line and
// the existing content slides away. new 0..i-1 <- old 0..i-1; new i is the NEW line;
// new >= i+1 <- old (index - 1). Length grows by one.
export const splitMapBelow = (len, i) => {
  const map = [];
  for (let j = 0; j < i; j += 1) map.push(j);
  map.push(NEW);
  for (let j = i; j < len; j += 1) map.push(j);
  return map;
};

// Index map for mergeCells(arr, k) (delete a divider, 1-based k): old k is removed; the
// merged survivor at new k-1 keeps old k-1; new >= k <- old (index + 1). Shrinks by one.
export const mergeMap = (len, k) => {
  const map = [];
  for (let j = 0; j < k - 1; j += 1) map.push(j);
  map.push(k - 1);
  for (let j = k; j < len - 1; j += 1) map.push(j + 1);
  return map;
};

// True when two fraction-space rectangles differ on any edge/size by more than eps. The
// tolerance matters: axis sums drift by tiny floating amounts on every edit, so without
// it a kept cell's recomputed bounds would spuriously differ and needlessly zero its
// confidence. A missing rectangle counts as differing.
export const boundsDiffer = (a, b, eps) =>
  !a ||
  !b ||
  Math.abs(a.left - b.left) > eps ||
  Math.abs(a.top - b.top) > eps ||
  Math.abs(a.width - b.width) > eps ||
  Math.abs(a.height - b.height) > eps;

// Rebuild a table's flat `cells` list so it stays consistent with a structurally-changed
// grid. rowMap/colMap are index transforms for the changed axis (identityMap for the
// unchanged one): each maps a NEW index to an OLD index or the NEW sentinel, and any old
// index absent from the values is treated as REMOVED. newColumnWidths/newRowHeights/
// newBounds describe the new grid (bounds.left/top may have shifted on a boundary resize).
// Steps: (1) drop cells anchored on a removed line; (2) re-index survivors; (3) create a
// default cell for every square on each NEW line; (4)/(5) for each span-1 survivor compare
// the DRAWN GRID SQUARE it occupies before and after the edit — if that square moved or
// resized (beyond a float epsilon) adopt the new square as the cell's bounds and zero its
// confidence, otherwise leave the cell (its OCR bounds and confidence) untouched. New cells
// already start at confidence 0.
// Invert one axis index map (an array of new -> old, with NEW marking an inserted line)
// into an old -> new lookup. An old index missing from the result is a line the edit
// removed, so whatever was anchored on it has nowhere to go.
export const axisOldToNew = (map) => {
  const lookup = new Map();
  (map ?? []).forEach((old, nw) => {
    if (old !== NEW) lookup.set(old, nw);
  });
  return lookup;
};

export function reconcileCells(
  prevTable,
  newColumnWidths,
  newRowHeights,
  rowMap,
  colMap,
  newBounds
) {
  const EPS = GRID_SQUARE_EPS;
  const geom = {
    bounds: newBounds,
    columnWidths: newColumnWidths,
    rowHeights: newRowHeights,
  };
  const R = (newRowHeights ?? []).length;
  const C = (newColumnWidths ?? []).length;

  // old index -> new index, for re-indexing survivors and detecting removed lines.
  const oldRowToNew = axisOldToNew(rowMap);
  const oldColToNew = axisOldToNew(colMap);

  const result = [];

  // (1)+(2)+(4)+(5): carry over surviving cells, re-indexed with recomputed bounds.
  for (const cell of prevTable.cells ?? []) {
    // (1) drop a cell anchored on a removed row or column line.
    if (!oldRowToNew.has(cell.row) || !oldColToNew.has(cell.column)) continue;
    const row = oldRowToNew.get(cell.row);
    const column = oldColToNew.get(cell.column);
    // Spanning-cell limitation (this iteration): a pre-existing cell with rowSpan or
    // columnSpan > 1 is re-indexed but its span and bounds are left UNCHANGED — no
    // multi-square geometry recompute. Only span-1 cells get their bounds refreshed.
    const spanning = (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1;
    if (spanning) {
      result.push({ ...cell, row, column });
      continue;
    }
    // (4)+(5): a cell's confidence is invalidated only when the DRAWN GRID SQUARE it
    // occupies actually moves or resizes. Compare the square in the OLD grid (at the
    // cell's old row/column) against the square in the NEW grid (at its new row/column).
    // NOT against cell.bounds: that is the tighter OCR text box, which never equals the
    // grid square, so comparing against it would zero EVERY cell on the first edit even
    // when its square is untouched.
    const oldSquare = gridSquareBounds(prevTable, cell.row, cell.column);
    const newSquare = gridSquareBounds(geom, row, column);
    if (boundsDiffer(oldSquare, newSquare, EPS)) {
      // Square changed -> it will be re-OCR'd: adopt the new square and reset confidence.
      result.push({ ...cell, row, column, bounds: newSquare, confidence: 0 });
    } else {
      // Square unchanged -> keep the cell exactly as-is (OCR bounds and confidence).
      result.push({ ...cell, row, column });
    }
  }

  // (3) a fresh default cell for every square on each NEW axis line: a new column c spans
  // grid rows 0..R-1; a new row r spans grid columns 0..C-1. New cells are span 1 with
  // confidence 0 (red), empty text, and header false (per-cell header is a back-end
  // concern). Occupancy is tracked in a Set (O(1) per check) rather than scanning `result`,
  // so filling a large grid stays linear; the guard is defensive against a new row and
  // column intersecting.
  const occupiedKeys = new Set(result.map((x) => `${x.row},${x.column}`));
  const addCell = (r, c) => {
    const key = `${r},${c}`;
    if (occupiedKeys.has(key)) return;
    occupiedKeys.add(key);
    result.push(makeDefaultCell(r, c, gridSquareBounds(geom, r, c)));
  };
  colMap.forEach((old, c) => {
    if (old !== NEW) return;
    for (let r = 0; r < R; r += 1) addCell(r, c);
  });
  rowMap.forEach((old, r) => {
    if (old !== NEW) return;
    for (let c = 0; c < C; c += 1) addCell(r, c);
  });

  return result;
}

// Reconcile the cells of an axis-only structural edit and return the table to commit. The
// three edit gestures (menu add/merge, internal-divider drag release, boundary drag
// release) share this: only one axis (`axisKey`) changes to `newAxis`, mapped by `axisMap`
// (new -> old index, with the NEW sentinel for inserted lines); the other axis is identity.
// `prevTable` supplies the PRE-EDIT geometry reconcileCells compares each cell's grid square
// against (so only squares that actually moved reset confidence) and the cells to carry
// over; `base` supplies the non-axis fields the commit keeps (the same table for a menu
// edit, the final interim dragged table for a drag release). `newBounds` is the committed
// bounds (unchanged except a boundary resize that shifts left/top).
export function reconcileAxisEdit(prevTable, base, axisKey, newAxis, axisMap, newBounds) {
  const vertical = axisKey === 'columnWidths';
  const newColumnWidths = vertical ? newAxis : prevTable.columnWidths ?? [];
  const newRowHeights = vertical ? prevTable.rowHeights ?? [] : newAxis;
  const colMap = vertical
    ? axisMap
    : identityMap((prevTable.columnWidths ?? []).length);
  const rowMap = vertical
    ? identityMap((prevTable.rowHeights ?? []).length)
    : axisMap;
  const cells = reconcileCells(
    prevTable,
    newColumnWidths,
    newRowHeights,
    rowMap,
    colMap,
    newBounds
  );
  const merged = { ...base, [axisKey]: newAxis, bounds: newBounds, cells };

  // Cells are re-indexed by reconcileCells, but two other fields address rows by INDEX and
  // must move with their band or they end up marking the wrong row: a sub-title row
  // (sectionTitles[].tableRow) and the footer (footer.row/.column).
  //
  // Unmapped, the marker does move visibly — renderSectionTitles draws the dotted band from
  // tableRow — but only for the selected table in the Special Cells layer, so it is easily
  // missed. The damage lands at extract time, where an unrecognised sub-title row is emitted
  // as a data row (blank, because a sub-title's text lives in `data` and its own cells were
  // never read) while a genuine data row is dropped in its place.
  //
  // An entry whose line the edit removed has nothing left to mark, so it goes: a sub-title is
  // filtered out and the footer becomes null, mirroring how reconcileCells drops a cell
  // anchored on a removed line.
  const oldRowToNew = axisOldToNew(rowMap);
  const oldColToNew = axisOldToNew(colMap);
  if (base.sectionTitles) {
    merged.sectionTitles = base.sectionTitles
      .filter((section) => oldRowToNew.has(section.tableRow))
      .map((section) => ({
        ...section,
        tableRow: oldRowToNew.get(section.tableRow),
      }));
  }
  if (base.footer) {
    const row = oldRowToNew.get(base.footer.row);
    const column = oldColToNew.get(base.footer.column);
    merged.footer =
      row === undefined || column === undefined
        ? null
        : { ...base.footer, row, column };
  }
  return merged;
}

// Map a cell confidence (0–100 percent, or null/undefined) to a marker colour using the
// config thresholds. null/undefined is treated as below low. below low -> red; below high
// -> orange; otherwise green.
export function confidenceColour(confidence) {
  if (confidence == null || confidence < lowConfidence()) return 'red';
  if (confidence < highConfidence()) return 'orange';
  return 'green';
}

// Semantic band keyword -> the CSS custom property that paints it. The keyword stays the
// public/test-facing value (data-colour); the var is what actually gets styled so the
// three colours live in one place (globals.css).
export const CONFIDENCE_COLOUR_VARS = {
  red: 'var(--low-confidence)',
  orange: 'var(--medium-confidence)',
  green: 'var(--high-confidence)',
};

// Choose where to place the hovered-cell text box so the cell itself stays visible.
// All values are screen px in the image-overlay coordinate space (origin top-left,
// extent 0..container.width × 0..container.height). Preference order: directly BELOW the
// cell if the box fits within the container, otherwise to the RIGHT of the cell, otherwise
// ABOVE. `cell` = { left, top, width, height }; `overlay`/`container` = { width, height }.
// The result is clamped so the box never spills outside the container on the cross axis.
// Returns { left, top, placement } with placement one of 'below' | 'right' | 'above'.
// When `mouseX` (overlay-local screen px) is supplied AND the box would sit directly
// BELOW the cell — where it can fall under the pointer — the box is shifted left so its
// right edge ends 10px short of the mouse x (then re-clamped). `right`/`above` boxes sit
// beside/above the pointer already, so they are left untouched.
export function chooseCellTextPlacement(cell, overlay, container, mouseX) {
  const belowTop = cell.top + cell.height;
  const rightLeft = cell.left + cell.width;
  let placement;
  let left;
  let top;
  if (belowTop + overlay.height <= container.height) {
    placement = 'below';
    left = cell.left;
    top = belowTop;
  } else if (rightLeft + overlay.width <= container.width) {
    placement = 'right';
    left = rightLeft;
    top = cell.top;
  } else {
    placement = 'above';
    left = cell.left;
    top = cell.top - overlay.height;
  }
  // A below-placed box can sit under the pointer; move it so its right edge ends 10px
  // short of the mouse x. left = (right edge) - width = (mouseX - 10) - overlay.width.
  if (placement === 'below' && mouseX != null) {
    left = mouseX - 10 - overlay.width;
  }
  // Keep the box inside the container (a below/above box may still overflow the right
  // edge; a right box may overflow the bottom). Never push the origin negative.
  left = Math.max(0, Math.min(left, container.width - overlay.width));
  top = Math.max(0, Math.min(top, container.height - overlay.height));
  return { left, top, placement };
}

// Convert a PDFValue axis (fractional cell sizes) into whole-pixel sizes whose running
// totals track the ROUNDED CUMULATIVE offset rather than accumulating per-cell rounding.
// Rounding each cell size independently and summing drifts by up to ~0.5px per cell, so on
// a tall (40+ row) or wide table the last grid line ends many pixels past the border while
// the exact-fraction confidence squares stay put. Anchoring each size to the rounded
// cumulative offset keeps every divider within <1px of its true position — and the final
// offset lands exactly on round(total * scale), matching the table's outer border.
export function pixelCellSizes(values, scale) {
  const sizes = [];
  let acc = 0;
  let prevOffset = 0;
  for (const v of values ?? []) {
    acc += v.value;
    const offset = Math.round(acc * scale);
    sizes.push(offset - prevOffset);
    prevOffset = offset;
  }
  return sizes;
}

// Convert metadata PDFTable objects (fractional coordinates, nested bounds, PDFValue
// arrays, per-document) into the flat pixel-space shape the centre overlay draws.
// Filters to the displayed page, multiplies horizontal quantities by pixelWidth and
// vertical by pixelHeight. Cell sizes come from pixelCellSizes so their cumulative sums
// (which position the internal grid dividers) never drift from the true offsets.
export function metadataTablesToOverlay(tables, page, pixelWidth, pixelHeight) {
  return (tables ?? [])
    .filter((t) => t.pdfPage === page)
    .map((t) => ({
      tableId: t.tableId,
      name: t.name,
      left: Math.round(t.bounds.left * pixelWidth),
      top: Math.round(t.bounds.top * pixelHeight),
      width: Math.round(t.bounds.width * pixelWidth),
      height: Math.round(t.bounds.height * pixelHeight),
      columnWidths: pixelCellSizes(t.columnWidths, pixelWidth),
      rowHeights: pixelCellSizes(t.rowHeights, pixelHeight),
      // Locked tables are display-only; lockedMessage is the hover-label suffix
      // explaining why (linked into a grid, or the root of one).
      locked: t.locked ?? false,
      lockedMessage: t.lockedMessage ?? null,
    }));
}

// Convert ONE metadata PDFTable (page fractions) into the viewBox-pixel shape
// PageImageWithOverlay draws for a right-column thumbnail: whole-pixel bounds, plain
// pixel-number columnWidths/rowHeights (the PDFValue confidences are dropped — thumbnails
// no longer draw confidence-derived detail), and the identity fields carried through for the
// hover label and selection. The two axes scale INDEPENDENTLY (x by pixelWidth, y by
// pixelHeight) because the overlay SVG is drawn with preserveAspectRatio="none", so the
// thumbnail's aspect ratio need not match the page's. Cell sizes go through pixelCellSizes so
// their cumulative sums — which position the drawn dividers — never drift from the true
// offsets. A missing or zero pixel dimension collapses that axis to 0 rather than yielding
// NaN (thumbnails are rendered before their pane has been measured).
export function metadataTableToThumbnailOverlay(table, pixelWidth, pixelHeight) {
  const w = Number(pixelWidth) || 0;
  const h = Number(pixelHeight) || 0;
  const bounds = table.bounds ?? {};
  return {
    tableId: table.tableId,
    name: table.name,
    left: Math.round((bounds.left ?? 0) * w),
    top: Math.round((bounds.top ?? 0) * h),
    width: Math.round((bounds.width ?? 0) * w),
    height: Math.round((bounds.height ?? 0) * h),
    columnWidths: pixelCellSizes(table.columnWidths, w),
    rowHeights: pixelCellSizes(table.rowHeights, h),
  };
}

// Area of the intersection of rectangles a and b in fraction space; 0 when disjoint or
// edge-touching. a/b are {left, top, width, height}.
export const overlapArea = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

// True when rectangles a and b overlap in fraction space. Edge-touching is NOT an
// overlap (strict inequalities). a/b are {left, top, width, height}.
export const overlaps = (a, b) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

// True when two coloured areas are the same area: same rectangle AND same colours. A colour
// pick that leaves the rectangle alone still changes how the area flattens, so it counts as a
// change like any other.
const sameColouredArea = (a, b) =>
  a.left === b.left &&
  a.top === b.top &&
  a.width === b.width &&
  a.height === b.height &&
  a.foreground === b.foreground &&
  a.background === b.background;

// The rectangles a coloured-area edit changed, as absolute page fractions.
//
// Matched by value rather than by list position, so one rule covers every kind of edit: an
// area present before and not after contributes the rectangle it used to cover, an area
// present after and not before contributes the rectangle it now covers, and an area that
// merely moved or resized is both — it stops covering what it did and starts covering what it
// does, and the cells under either are affected. Position matching cannot do this, because
// deleting an area shifts every later index.
//
// Duplicate rectangles are collapsed, so a colour pick that leaves the rectangle where it was
// yields that one rectangle rather than two copies of it.
export function changedColouredAreaRects(previousAreas, nextAreas) {
  const before = previousAreas ?? [];
  const after = nextAreas ?? [];
  const gone = before.filter((a) => !after.some((b) => sameColouredArea(a, b)));
  const arrived = after.filter((a) => !before.some((b) => sameColouredArea(a, b)));
  const rects = [];
  const seen = new Set();
  [...gone, ...arrived].forEach(({ left, top, width, height }) => {
    const key = `${left},${top},${width},${height}`;
    if (seen.has(key)) return;
    seen.add(key);
    rects.push({ left, top, width, height });
  });
  return rects;
}

// Every readable value of `page`'s tables that impinges on any of `rects`, marked
// confidence 0: its cells, its title and each of its section titles' values.
//
// A coloured area decides how its region is flattened before the page is read, so a value the
// change touched can no longer be trusted to hold what was OCR'd from it. Zero is the value a
// freshly materialised cell carries (see makeDefaultCell), so it renders red and reads as
// awaiting re-OCR.
//
// The title and the section titles are covered for the same reason the cells are, and they
// have to be named separately because they are not cells: a coloured area drawn over a title
// would otherwise leave a stale reading sitting at its old confidence, which is worse than a
// flagged one — it is wrong and nothing says so. Both count towards Ready for Export
// (lowConfidenceValues in exportReadinessUtils), and both are re-read by the same
// calculate-cells call the cells are.
//
// Identity is preserved throughout — an untouched value, table and list come back by
// reference — so a caller can test "did anything change?" by reference, and a table gains no
// key it did not already have. Walked with mapAllTables so a table joined under another
// table's grid is reached too.
export function zeroConfidenceInRects(tables, page, rects) {
  if (!(rects ?? []).length) return tables ?? [];
  return mapAllTables(tables, (table) => {
    if (table.pdfPage !== page || table.deleted) return table;
    let changed = false;
    const invalidate = (value) => {
      if (!value?.bounds || value.confidence === 0) return value;
      if (!rects.some((rect) => overlaps(value.bounds, rect))) return value;
      changed = true;
      return { ...value, confidence: 0 };
    };
    const next = { ...table };
    if (table.cells) next.cells = table.cells.map(invalidate);
    if (table.title) next.title = invalidate(table.title);
    if (table.sectionTitles) {
      next.sectionTitles = table.sectionTitles.map((sectionTitle) => {
        const data = invalidate(sectionTitle?.data);
        return data === sectionTitle?.data
          ? sectionTitle
          : { ...sectionTitle, data };
      });
    }
    return changed ? next : table;
  });
}

// The confidences one table's readable values carry, keyed so a value can be matched to its
// counterpart across an edit: each cell by its grid position, the title, and each section
// title by the row it names.
const confidenceByValueKey = (table) => {
  const found = new Map();
  (table?.cells ?? []).forEach((cell) => {
    found.set(`cell:${cell.row},${cell.column}`, cell.confidence);
  });
  if (table?.title) found.set('title', table.title.confidence);
  (table?.sectionTitles ?? []).forEach((sectionTitle) => {
    if (sectionTitle?.data) {
      found.set(`section:${sectionTitle.tableRow}`, sectionTitle.data.confidence);
    }
  });
  return found;
};

// True when a readable value of `after` sits at confidence 0 where its counterpart in
// `before` did not. A value the edit left alone, and one already at zero, both compare equal;
// a value with no counterpart (a cell materialised into a new grid square) is not a loss.
const lostConfidence = (before, after) => {
  if (!before) return false;
  const was = confidenceByValueKey(before);
  for (const [key, confidence] of confidenceByValueKey(after)) {
    if (confidence === 0 && (was.get(key) ?? 0) > 0) return true;
  }
  return false;
};

// Every table — top-level or joined member — that lost confidence in one of its readable
// values between the pre-edit `before` snapshot and the post-edit `after` one. This is what
// zeroConfidenceInRects leaves behind, and it is the signal that those values owe a re-read:
// they still hold the text of the flattening that has just been replaced.
//
// Members are walked as well as their root because a member's edit arrives as a change to the
// root, so comparing roots alone would miss it — and a member sits on its own page, so it is
// its own re-read target.
export function tablesWithLostConfidence(before, after) {
  const found = [];
  if (!after.deleted && lostConfidence(before, after)) found.push(after);
  const beforeMembers = before?.next ?? {};
  for (const [id, member] of Object.entries(after.next ?? {})) {
    if (!member.deleted && lostConfidence(beforeMembers[id], member)) {
      found.push(member);
    }
  }
  return found;
}

// Sum of a PDFValue array's `.value` fields (0 for an empty array).
export const sumValues = (arr) => (arr ?? []).reduce((acc, v) => acc + v.value, 0);

// Human-readable per-page table count for the right-column page headings.
export const tableCountLabel = (n) => {
  if (n === 0) return 'No tables';
  if (n === 1) return '1 table';
  return `${n} tables`;
};

// Clamp the dragged edge's absolute target `p` (a page fraction) before any grow/shrink
// maths. First to the page bounds [0,1] for the moving edge, then — only when growing
// toward them — to one pixel-fraction short of the nearest same-page table whose
// perpendicular span overlaps the dragged table. Shrinking (moving inward) is never
// blocked by another table. `t` is the dragged table's metadata; `others` the remaining
// same-page metadata tables. Returns the clamped `p`.
export function clampBoundaryTarget(kind, p, t, others, minX, minY) {
  const { left, top, width, height } = t.bounds;
  const R = left + width;
  const B = top + height;

  // Page bounds (I3): left/top edges cannot go below 0; right/bottom above 1.
  if (kind === 'boundary-left' || kind === 'boundary-top') {
    p = Math.max(0, p);
  } else {
    p = Math.min(1, p);
  }

  // ≥1px gap to other same-page tables, only while growing toward them and only for
  // tables whose perpendicular span overlaps the dragged table's.
  const xAxis = kind === 'boundary-left' || kind === 'boundary-right';
  const spanOverlaps = (o) =>
    xAxis
      ? o.bounds.top < top + height && o.bounds.top + o.bounds.height > top
      : o.bounds.left < left + width && o.bounds.left + o.bounds.width > left;

  for (const o of others) {
    if (!spanOverlaps(o)) continue;
    const oL = o.bounds.left;
    const oR = o.bounds.left + o.bounds.width;
    const oT = o.bounds.top;
    const oB = o.bounds.top + o.bounds.height;
    if (kind === 'boundary-right' && oL >= R) {
      p = Math.min(p, oL - minX); // growing right toward o
    } else if (kind === 'boundary-left' && oR <= left) {
      p = Math.max(p, oR + minX); // growing left toward o
    } else if (kind === 'boundary-bottom' && oT >= B) {
      p = Math.min(p, oT - minY); // growing down toward o
    } else if (kind === 'boundary-top' && oB <= top) {
      p = Math.max(p, oB + minY); // growing up toward o
    }
  }
  return p;
}

// Consume `shrink` (> 0) from a cell array, deleting cells that reach 0 as the boundary
// cascades, and clamping the final surviving cell to `min` rather than deleting it.
// `fromBack` consumes columnWidths[last] first (a right/bottom edge); otherwise the
// front (a left/top edge). Returns a NEW array (immutable), preserving each surviving
// cell's confidence.
export function cascadeShrink(cells, shrink, fromBack, min) {
  let arr = cells.slice();
  const idx = () => (fromBack ? arr.length - 1 : 0);
  while (shrink > 0 && arr.length > 1) {
    const cell = arr[idx()];
    if (shrink < cell.value) {
      arr = arr.map((c, i) =>
        i === idx() ? { ...c, value: cell.value - shrink } : c
      );
      shrink = 0;
    } else {
      shrink -= cell.value;
      arr = fromBack ? arr.slice(0, -1) : arr.slice(1);
    }
  }
  // Only one cell left (or the shrink was absorbed above): clamp it to the 1px minimum.
  if (shrink > 0 && arr.length === 1) {
    const remaining = Math.max(min, arr[0].value - shrink);
    arr = [{ ...arr[0], value: remaining }];
  }
  return arr;
}

// Build the new metadata table for a boundary drag. `p` is the dragged edge's absolute
// target in fraction space, already clamped (page bounds + 1px gap). Grows the adjacent
// edge cell when the edge moves outward; shrinks with cascade-delete (protecting the
// final cell at the 1px minimum) when it moves inward. bounds.width/height are recomputed
// from the cell sums so I1/I2 stay exact; the opposite edge stays fixed. Every array and
// the bounds object are freshly built (immutable).
export function resizeBoundary(kind, p, t, minX, minY) {
  const { left, top, width, height } = t.bounds;
  const L = left;
  const R = left + width;
  const T = top;
  const B = top + height;
  const cols = t.columnWidths ?? [];
  const rows = t.rowHeights ?? [];

  let columnWidths = cols.map((c) => ({ ...c }));
  let rowHeights = rows.map((c) => ({ ...c }));
  let newLeft = left;
  let newTop = top;

  if (kind === 'boundary-right') {
    if (p >= R) {
      const grow = p - R;
      const n = columnWidths.length;
      columnWidths = columnWidths.map((c, i) =>
        i === n - 1 ? { ...c, value: c.value + grow } : c
      );
    } else {
      columnWidths = cascadeShrink(columnWidths, R - p, true, minX);
    }
    // left fixed
  } else if (kind === 'boundary-left') {
    if (p <= L) {
      const grow = L - p;
      columnWidths = columnWidths.map((c, i) =>
        i === 0 ? { ...c, value: c.value + grow } : c
      );
      newLeft = p; // right edge fixed by growing column 0 leftward
    } else {
      columnWidths = cascadeShrink(columnWidths, p - L, false, minX);
      newLeft = R - sumValues(columnWidths); // keep right edge R fixed
    }
  } else if (kind === 'boundary-bottom') {
    if (p >= B) {
      const grow = p - B;
      const m = rowHeights.length;
      rowHeights = rowHeights.map((c, i) =>
        i === m - 1 ? { ...c, value: c.value + grow } : c
      );
    } else {
      rowHeights = cascadeShrink(rowHeights, B - p, true, minY);
    }
    // top fixed
  } else if (kind === 'boundary-top') {
    if (p <= T) {
      const grow = T - p;
      rowHeights = rowHeights.map((c, i) =>
        i === 0 ? { ...c, value: c.value + grow } : c
      );
      newTop = p; // bottom edge fixed by growing row 0 upward
    } else {
      rowHeights = cascadeShrink(rowHeights, p - T, false, minY);
      newTop = B - sumValues(rowHeights); // keep bottom edge B fixed
    }
  }

  // Recompute width/height from the cell sums so I1/I2 are exact.
  return {
    ...t,
    bounds: {
      left: newLeft,
      top: newTop,
      width: sumValues(columnWidths),
      height: sumValues(rowHeights),
    },
    columnWidths,
    rowHeights,
  };
}

// Move an internal grid divider on one axis, in FRACTION space, keeping bounds fixed.
// `cells` is the axis's PDFValue array; `k` the 1-based divider index (the cumulative
// offset between cell k-1 and k); `p` the divider's clamped absolute target (a page
// fraction); `origin` the axis start (bounds.left / bounds.top). The dragged divider's
// offset moves to `target`; the axis's far edge (offsets[n-1] == total width) is NEVER
// moved so I1/I2 hold. Every OTHER internal divider stays where it is UNLESS the dragged
// divider has swept past it, in which case that divider is pulled to `target` too — its
// in-between cell(s) collapse to 0 (removed on release, step 4). With no crossing this
// reduces to the two immediate neighbours changing equal-and-opposite. Because the far
// edge is fixed and `target` is clamped inside the span, sum(new values) is unchanged.
// Returns a NEW array of NEW cell objects, preserving confidence and order.
export function moveDivider(cells, k, p, origin) {
  const target = p - origin; // offset of the dragged divider from the axis start
  const offsets = cumulative(cells.map((c) => c.value));
  const last = offsets.length - 1; // the far edge; never moved
  const newOffsets = offsets.map((o, i) => {
    if (i === last) return o; // far edge fixed -> total unchanged (I1/I2)
    if (i < k - 1) return Math.min(o, target); // dragged left past this divider -> pull it in
    if (i > k - 1) return Math.max(o, target); // dragged right past this divider -> push it out
    return target; // the dragged divider
  });
  return cells.map((c, i) => {
    const prev = i === 0 ? 0 : newOffsets[i - 1];
    const value = Math.max(0, newOffsets[i] - prev);
    return { ...c, value };
  });
}

// Release cleanup for an internal-line drag: drop every cell whose value is <= epsilon
// (a squeezed 0), but never empty the axis — if cleanup would remove them all, keep the
// single largest cell. A removed 0-cell contributes 0 to the cumulative sum, so removal
// shifts no divider and I1/I2 are preserved. Returns a NEW array (immutable).
export function cleanupAxis(cells, epsilon) {
  const kept = cells.filter((c) => c.value > epsilon);
  if (kept.length > 0) return kept.map((c) => ({ ...c }));
  // Everything is at/below epsilon: protect the axis by keeping the largest single cell.
  let best = cells[0];
  for (const c of cells) if (c.value > best.value) best = c;
  return [{ ...best }];
}

// Split one PDFValue array's entry at index i into two halves of the entry's value,
// each copying the original entry's non-value fields (notably confidence). The two
// halves occupy the old cell's span, so the axis SUM (hence bounds) is unchanged.
export function splitEntry(arr, i) {
  const half = { ...arr[i], value: arr[i].value / 2 };
  return [...arr.slice(0, i), half, { ...half }, ...arr.slice(i + 1)];
}

// Split one PDFValue array's entry at index i into two entries whose values are `firstValue`
// and the remainder, each copying the original entry's non-value fields. Used where the
// split point is chosen by the user rather than taken as the middle — a grid line added
// under the pointer. The two parts occupy the old cell's span, so the axis SUM (hence
// bounds) is unchanged. `firstValue` is clamped into the entry, so a split at or beyond
// either edge is impossible.
export function splitEntryAt(arr, i, firstValue) {
  const total = arr[i].value;
  const first = Math.min(Math.max(firstValue, 0), total);
  return [
    ...arr.slice(0, i),
    { ...arr[i], value: first },
    { ...arr[i], value: total - first },
    ...arr.slice(i + 1),
  ];
}

// Merge divider k (1-based): fold cell k's value into the near cell k-1 and drop cell k.
// The axis SUM is unchanged (bounds preserved). The surviving entry keeps cell k-1's
// non-value fields. Returns a NEW array (immutable).
export function mergeCells(arr, k) {
  const merged = { ...arr[k - 1], value: arr[k - 1].value + arr[k].value };
  return [...arr.slice(0, k - 1), merged, ...arr.slice(k + 1)];
}

// How far a point lies OUTSIDE a table's area (its bounding rectangle), in the
// same coordinate space: zero when the point is inside the rectangle, otherwise
// the Euclidean distance to the nearest point on the rectangle. The internal grid
// lines are irrelevant — hovering is about the defined area, not the dividers.
export function distanceOutsideTable(px, py, t) {
  const dx = Math.max(t.left - px, 0, px - (t.left + t.width));
  const dy = Math.max(t.top - py, 0, py - (t.top + t.height));
  return Math.hypot(dx, dy);
}
