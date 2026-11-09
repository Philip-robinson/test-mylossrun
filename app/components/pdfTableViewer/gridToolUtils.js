// Pure geometry for the grid tool-bar's tools: which row or column a click landed in, the
// page-fraction bounds of a whole row, column or cell, following staggered grid lines, and
// what an armed line tool does to each orientation of line.
// Everything here works in page fractions, the space the metadata stores, and nothing
// mutates its argument.

import {
  cumulative,
  gridSquareAtFraction,
  gridSquareBounds,
} from 'components/pdfTableViewer/tableSupportUtils';

// The axis entry values of a table, as plain numbers.
const axisValues = (table, axisKey) =>
  (table?.[axisKey] ?? []).map((entry) => entry.value);

const inRange = (index, length) => index != null && index >= 0 && index < length;

// The bounding box of grid squares (r, c) for every pair the two index lists give.
const squaresBox = (table, rows, columns) => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  rows.forEach((r) =>
    columns.forEach((c) => {
      const sq = gridSquareBounds(table, r, c);
      left = Math.min(left, sq.left);
      top = Math.min(top, sq.top);
      right = Math.max(right, sq.left + sq.width);
      bottom = Math.max(bottom, sq.top + sq.height);
    })
  );
  return { left, top, width: right - left, height: bottom - top };
};

const indices = (n) => Array.from({ length: n }, (_, i) => i);

// The 0-based index of the nominal band containing `offset` along an axis starting at
// `start`, or null when the axis is empty. The last band takes anything past its far edge.
const bandIndex = (values, start, offset) => {
  if (values.length === 0) return null;
  const offsets = cumulative(values);
  for (let i = 0; i < values.length; i += 1) {
    if (offset <= start + offsets[i]) return i;
  }
  return values.length - 1;
};

// The row of the grid square (gridSquareAtFraction) holding the page fraction, or null.
export const rowIndexAtFraction = (table, frac) => {
  if (!table || !frac) return null;
  return gridSquareAtFraction(table, frac)?.row ?? null;
};

// The column of the grid square (gridSquareAtFraction) holding the page fraction, or null.
export const columnIndexAtFraction = (table, frac) => {
  if (!table || !frac) return null;
  return gridSquareAtFraction(table, frac)?.column ?? null;
};

// The page-fraction rectangle of one whole row: the bounding box of its effective grid
// squares. Null for an index the table does not have, or when the other axis is empty.
export const rowBounds = (table, rowIndex) => {
  const values = axisValues(table, 'rowHeights');
  if (!inRange(rowIndex, values.length)) return null;
  const columns = axisValues(table, 'columnWidths').length;
  if (!columns) return null;
  return squaresBox(table, [rowIndex], indices(columns));
};

// The page-fraction rectangle of one whole column: the bounding box of its effective grid
// squares. Null for an index the table does not have, or when the other axis is empty.
export const columnBounds = (table, columnIndex) => {
  const values = axisValues(table, 'columnWidths');
  if (!inRange(columnIndex, values.length)) return null;
  const rows = axisValues(table, 'rowHeights').length;
  if (!rows) return null;
  return squaresBox(table, indices(rows), [columnIndex]);
};

// The page-fraction rectangle of one cell: its grid square (gridSquareBounds). Null when
// either index is one the table does not have.
export const cellBounds = (table, rowIndex, columnIndex) => {
  if (!inRange(rowIndex, axisValues(table, 'rowHeights').length)) return null;
  if (!inRange(columnIndex, axisValues(table, 'columnWidths').length)) return null;
  return gridSquareBounds(table, rowIndex, columnIndex);
};

// The 0-based row whose nominal band holds the vertical centre of `rect`, clamped to the
// first row when that centre is above the table and to the last when it is below. Null
// when the table has no rows.
export const rowNearestCentre = (table, rect) => {
  const values = axisValues(table, 'rowHeights');
  if (values.length === 0 || !rect) return null;
  const centre = rect.top + rect.height / 2;
  if (centre <= table.bounds.top) return 0;
  if (centre >= table.bounds.top + table.bounds.height) return values.length - 1;
  return bandIndex(values, table.bounds.top, centre);
};

// What an armed line tool does to the lines of one orientation ('row' for horizontal,
// 'column' for vertical): 'line', 'split' or 'join', or null when it acts on none.
const LINE_INTERACTIONS = {
  rows: { row: 'line' },
  rowSplit: { row: 'split' },
  rowJoin: { row: 'join' },
  columns: { column: 'line' },
  columnSplit: { column: 'split' },
  columnJoin: { column: 'join' },
};

export const lineInteraction = (tool, orientation) =>
  LINE_INTERACTIONS[tool]?.[orientation] ?? null;
