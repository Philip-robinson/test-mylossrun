// Pure, dependency-free helpers for the staged grid editor's Layers panel, its
// table-stepping and the zoom/scale selector. No React, no config import: any value that would come
// from a named constant is accepted as an argument, so these stay trivially
// unit-testable and free of import cycles.

// Rendered width in px for a zoom percentage relative to a base width.
export const scalePercentToWidthPx = (percent, baseWidthPx) =>
  Math.round((baseWidthPx * percent) / 100);

// Step to the next (+1) or previous (-1) option in the ordered `options` array,
// clamped at the ends (returns `current` when already at an end or not found).
export const stepScale = (options, current, direction) => {
  const index = options.indexOf(current);
  if (index === -1) {
    return current;
  }
  const target = index + direction;
  if (target < 0 || target >= options.length) {
    return current;
  }
  return options[target];
};

// A stable string projection of a table's merged cells: one
// `row,column,rowSpan,columnSpan` entry per cell that spans more than a single
// grid square, sorted so cell ordering within `cells` is irrelevant. `text` and
// `confidence` are deliberately excluded — a recalculation writes those two
// fields back into `cells`, and including them would make every re-read look
// like a fresh Special-Areas edit.
const cellSpanProjection = (table) =>
  (table?.cells ?? [])
    .filter((cell) => (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1)
    .map(
      (cell) =>
        `${cell.row},${cell.column},${cell.rowSpan ?? 1},${cell.columnSpan ?? 1}`,
    )
    .sort()
    .join('|');

// True when the data OWNED by `layerKey` differs between the pre-edit (`before`) and
// post-edit (`after`) table snapshots. Read by the host to decide whether a special-area
// edit needs the page's cells re-read. Colours are page-scoped (not per-table), so this
// always returns false for the 'colours' key.
export const layerDataChanged = (layerKey, before, after) => {
  if (!before || !after) return false;
  const j = (v) => JSON.stringify(v ?? null);
  switch (layerKey) {
    case 'border':
      return j(before.bounds) !== j(after.bounds);
    case 'rows':
      return j(before.rowHeights) !== j(after.rowHeights);
    case 'columns':
      return j(before.columnWidths) !== j(after.columnWidths);
    case 'special':
      return (
        j(before.title) !== j(after.title) ||
        (before.headerCount ?? 0) !== (after.headerCount ?? 0) ||
        j(before.sectionTitles) !== j(after.sectionTitles) ||
        j(before.footer) !== j(after.footer) ||
        cellSpanProjection(before) !== cellSpanProjection(after)
      );
    default:
      return false;
  }
};

// Counts shown against each Layers row. Border/Colours are page-scoped; Rows,
// Columns and Special Cells are scoped to the selected table.
export const layerCounts = ({
  selectedTable,
  samePageTables,
  pageColouredAreas,
}) => ({
  border: samePageTables?.length ?? 0,
  rows: selectedTable?.rowHeights?.length ?? 0,
  columns: selectedTable?.columnWidths?.length ?? 0,
  specialCells:
    (selectedTable?.headerCount > 0 ? 1 : 0) +
    (selectedTable?.title ? 1 : 0) +
    (selectedTable?.sectionTitles?.length ?? 0),
  colours: pageColouredAreas?.length ?? 0,
});

// One page's non-deleted tables in ascending tableInPage order. A null/absent tableInPage
// sorts as 0 and ties keep document order, so the walk is deterministic whatever the
// metadata carries.
export const orderedPageTables = (samePageTables) =>
  (samePageTables ?? [])
    .map((table, index) => ({ table, index }))
    .sort(
      (a, b) =>
        (a.table.tableInPage ?? 0) - (b.table.tableInPage ?? 0) ||
        a.index - b.index,
    )
    .map(({ table }) => table);

// The table one step from `currentTableId` in that order — `direction` 1 for the next, -1
// for the previous — or null at that end of the page (or when the id is not in the list).
// The ends are where the page runs out: the caller moves to another page there, and the
// document's own ends wrap, so nothing wraps within a page.
const stepTableOnPage = (samePageTables, currentTableId, direction) => {
  const ordered = orderedPageTables(samePageTables);
  const position = ordered.findIndex(
    (table) => table.tableId === currentTableId,
  );
  if (position === -1) return null;
  const target = position + direction;
  if (target < 0 || target >= ordered.length) return null;
  return ordered[target];
};

// The next table after `currentTableId`, or null when it is the last one on the page.
export const nextTableOnPage = (samePageTables, currentTableId) =>
  stepTableOnPage(samePageTables, currentTableId, 1);

// The table before `currentTableId`, or null when it is the first one on the page.
export const prevTableOnPage = (samePageTables, currentTableId) =>
  stepTableOnPage(samePageTables, currentTableId, -1);

// The distinct, non-null section-title `columnName` values used across every table
// of the whole PDF, in first-seen order. Feeds the "Column name" combo's option list
// (the same name may be reused for the same purpose on any table/page).
export const collectColumnNames = (tables) => {
  const seen = [];
  const set = new Set();
  (tables ?? []).forEach((t) => {
    (t.sectionTitles ?? []).forEach((s) => {
      if (s.columnName && !set.has(s.columnName)) {
        set.add(s.columnName);
        seen.push(s.columnName);
      }
    });
  });
  return seen;
};
