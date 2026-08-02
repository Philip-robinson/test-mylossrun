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

// Hold `value` within [min, max], with `min` winning when the range is empty -
// which is what keeps a dialog larger than the viewport pinned at 0 rather than
// pushed off the near edge.
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

// Where to put the edit dialog so that it never covers the cell being edited:
// above it when there is room, else to its left, else to its right, else below
// it. Pure arithmetic on a getBoundingClientRect-shaped `cellRect`, a
// { width, height } `dialogSize`, a { width, height } `viewport` and an optional
// { x, y } `pointer`.
//
// The right is fit-checked rather than taken as an unconditional last resort:
// a WIDE element - the review screen's title spans almost the whole editor -
// leaves room on neither side, and an unchecked right opened the dialog off the
// screen. Below is the true last resort, and it always fits somewhere because
// the left is free to move.
export const dialogPlacement = (cellRect, dialogSize, viewport, pointer) => {
  const above = cellRect.top - dialogSize.height;
  if (above >= 0) {
    return {
      left: clamp(cellRect.left, 0, viewport.width - dialogSize.width),
      top: above,
      placement: 'above',
    };
  }
  const top = clamp(cellRect.top, 0, viewport.height - dialogSize.height);
  const left = cellRect.left - dialogSize.width;
  if (left >= 0) return { left, top, placement: 'left' };
  if (cellRect.right + dialogSize.width <= viewport.width) {
    return { left: cellRect.right, top, placement: 'right' };
  }
  // Below the element, with the pointer choosing the side: to its left while that
  // stays on screen, otherwise to its right. Without a pointer - confirm-and-next
  // reopens the dialog with no click behind it - it aligns with the element itself.
  const belowTop = clamp(cellRect.bottom, 0, viewport.height - dialogSize.height);
  const leftOfPointer = pointer == null ? null : pointer.x - dialogSize.width;
  const belowLeft =
    leftOfPointer === null
      ? cellRect.left
      : leftOfPointer >= 0
        ? leftOfPointer
        : pointer.x;
  return {
    left: clamp(belowLeft, 0, viewport.width - dialogSize.width),
    top: belowTop,
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
