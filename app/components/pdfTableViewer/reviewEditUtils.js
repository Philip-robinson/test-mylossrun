// Pure, dependency-free helpers for editing a cell of the extraction review
// screen: discriminating the kinds of amalgamated cell, following a cell's
// source reference back to the table and value it came from in the locally held
// document metadata, applying a correction immutably to both that metadata and
// the displayed grid, and placing the edit dialog clear of the cell it edits.
// No React, no DOM, no config import: sizes and viewport arrive as arguments so
// the component owns the measuring and these stay trivially unit-testable.

// True when `cell` carries a section title's value rather than an ordinary
// cell's. Discrimination is structural - an AmalgamatedCell never carries
// `sectionTitleIndex` and an AmalgamatedSectionTitle always does - and tests
// presence rather than truthiness so that index 0 counts. The loose `!=` is
// deliberate: it covers null and undefined and nothing else, so a missing cell
// (short-circuited to undefined by the optional chain) and a null or absent
// index all read false, while 0 reads true.
export const isSectionTitleCell = (cell) => cell?.sectionTitleIndex != null;

// True when `cell` refers to a table's title rather than to a position in its
// grid. The title is not part of the merged grid, so it carries no row or
// column and is marked explicitly. Structural, like isSectionTitleCell.
export const isTitleCell = (cell) => cell?.titleRef === true;

// A stable string identifying the source a cell refers to, used as the image
// cache key and to find the sibling positions that share one source. A blank or
// absent table id means the position has no source at all, and so no key.
export const cellSourceKey = (cell) => {
  if (!cell?.tableId) return null;
  if (isTitleCell(cell)) return `${cell.tableId}:t`;
  return isSectionTitleCell(cell)
    ? `${cell.tableId}:s:${cell.sectionTitleIndex}`
    : `${cell.tableId}:c:${cell.row}:${cell.column}`;
};

// The metadata table a cell came from, or null. `tables` is the editor's flat
// list of PDFTable-shaped objects; only the reviewed root and the tables linked
// to it through `next` are candidates, so an unrelated table of the same list is
// never returned.
export const findSourceTable = (tables, reviewedTableId, cell) => {
  if (!cell?.tableId) return null;
  const root = (tables ?? []).find((t) => t.tableId === reviewedTableId);
  if (!root) return null;
  if (root.tableId === cell.tableId) return root;
  return (
    Object.values(root.next ?? {}).find((t) => t.tableId === cell.tableId) ??
    null
  );
};

// The object within `sourceTable` that holds the editable text and confidence,
// or null when the source no longer holds one. A title reference resolves to the
// table's own title; a section title's value lives in its `data`; an ordinary
// cell is found by its own row and column, which the cell list need not be
// ordered by.
export const findSourceValue = (sourceTable, cell) => {
  if (!sourceTable || !cell) return null;
  if (isTitleCell(cell)) return sourceTable.title ?? null;
  if (isSectionTitleCell(cell)) {
    return sourceTable.sectionTitles?.[cell.sectionTitleIndex]?.data ?? null;
  }
  return (
    (sourceTable.cells ?? []).find(
      (c) => c.row === cell.row && c.column === cell.column,
    ) ?? null
  );
};

// A copy of `sourceTable` with just the edited value replaced.
const tableWithEdit = (sourceTable, cell, text, confidence) => {
  if (isTitleCell(cell)) {
    return {
      ...sourceTable,
      title: { ...sourceTable.title, text, confidence },
    };
  }
  if (isSectionTitleCell(cell)) {
    return {
      ...sourceTable,
      sectionTitles: sourceTable.sectionTitles.map((sectionTitle, index) =>
        index === cell.sectionTitleIndex
          ? { ...sectionTitle, data: { ...sectionTitle.data, text, confidence } }
          : sectionTitle,
      ),
    };
  }
  return {
    ...sourceTable,
    cells: sourceTable.cells.map((c) =>
      c.row === cell.row && c.column === cell.column
        ? { ...c, text, confidence }
        : c,
    ),
  };
};

// The next table list with the cell's source value replaced, or null when the
// source table or the source value cannot be found - a table deleted since the
// extraction, say. Nothing is mutated and nothing off the path to the edit is
// copied, so untouched tables come back as the same references.
export const applyEditToTables = (
  tables,
  reviewedTableId,
  cell,
  text,
  confidence,
) => {
  const sourceTable = findSourceTable(tables, reviewedTableId, cell);
  if (!sourceTable) return null;
  if (!findSourceValue(sourceTable, cell)) return null;
  const editedTable = tableWithEdit(sourceTable, cell, text, confidence);
  return tables.map((table) => {
    if (table.tableId !== reviewedTableId) return table;
    if (table === sourceTable) return editedTable;
    return {
      ...table,
      next: { ...table.next, [sourceTable.tableId]: editedTable },
    };
  });
};

// The next grid rows with every position sharing the edited cell's source
// updated. For an ordinary cell that is one position; a section title's value is
// legitimately repeated down many rows and all of them must move together. Rows
// holding no match come back as the same references.
export const applyEditToGrid = (rows, cell, text, confidence) => {
  const key = cellSourceKey(cell);
  if (key === null) return rows;
  return rows.map((row) => {
    if (!row.some((c) => cellSourceKey(c) === key)) return row;
    return row.map((c) =>
      cellSourceKey(c) === key ? { ...c, text, confidence } : c,
    );
  });
};

// The next section-title heading for one merged table with the correction applied, or
// the same reference when that heading is not what was edited. The heading is drawn
// above the grid rather than in it - the placeholder column it came from is dropped
// from the grid - so a section-title correction has to reach it separately from
// applyEditToGrid. Each tab of a split carries its own heading, so the source key is
// what decides which of them moves.
export const applyEditToSectionTitle = (
  sectionTitle,
  cell,
  text,
  confidence,
) => {
  const key = cellSourceKey(cell);
  if (key === null) return sectionTitle;
  if (!sectionTitle || cellSourceKey(sectionTitle) !== key) return sectionTitle;
  return { ...sectionTitle, text, confidence };
};

// True when two getBoundingClientRect-shaped rectangles describe the same box.
// Compared member by member because a fresh measurement is a NEW object every time,
// so identity says nothing; this is what lets a caller re-measure after every paint
// and set state only when the box has actually moved.
export const sameRect = (a, b) =>
  a === b ||
  (a != null &&
    b != null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.right === b.right &&
    a.bottom === b.bottom);

// Hold `value` within [min, max], with `min` winning when the range is empty -
// which is what keeps a dialog larger than the viewport pinned at 0 rather than
// pushed off the near edge.
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

// Where to put the edit dialog so that it never covers the cell being edited,
// which now holds the field the correction is typed into. Pure arithmetic on a
// getBoundingClientRect-shaped `cellRect`, a { width, height } `dialogSize` and a
// { width, height } `viewport`.
//
// The dialog is bottom-aligned with the cell and put BESIDE it: its bottom right
// corner on the cell's bottom left corner when there is room to the left,
// otherwise its bottom left corner on the cell's bottom right corner. A cell too
// high on the screen for the dialog to reach up from its bottom edge - and one
// too low for the dialog to hang below it - is answered by moving the dialog until
// it fits, which is what the top clamp does.
//
// A wide element - the review screen's title and section fields span almost the
// whole editor - leaves room for the dialog on neither side. It then goes BELOW
// the element, left edges aligned: still clear of the field the correction is
// typed into, which pinning it to the nearest side edge was not.
export const dialogPlacement = (cellRect, dialogSize, viewport) => {
  const beside = clamp(
    cellRect.bottom - dialogSize.height,
    0,
    viewport.height - dialogSize.height,
  );
  const left = cellRect.left - dialogSize.width;
  if (left >= 0) return { left, top: beside, placement: 'left' };
  if (cellRect.right + dialogSize.width <= viewport.width) {
    return { left: cellRect.right, top: beside, placement: 'right' };
  }
  return {
    left: clamp(cellRect.left, 0, viewport.width - dialogSize.width),
    top: clamp(cellRect.bottom, 0, viewport.height - dialogSize.height),
    placement: 'below',
  };
};

// Where a dialog being dragged has got to: where it was when the drag started, moved
// by however far the pointer has moved since. `origin` is
// { left, top, pointerX, pointerY } captured at pointer-down; `pointer` is { x, y }
// now. The result is clamped to the viewport, so a dialog can never be dragged out of
// reach - and, the clamp's lower bound winning an empty range, one bigger than the
// viewport pins to the near edge rather than escaping past the far one.
export const draggedPosition = (origin, pointer, dialogSize, viewport) => ({
  left: clamp(
    origin.left + (pointer.x - origin.pointerX),
    0,
    viewport.width - dialogSize.width,
  ),
  top: clamp(
    origin.top + (pointer.y - origin.pointerY),
    0,
    viewport.height - dialogSize.height,
  ),
});
