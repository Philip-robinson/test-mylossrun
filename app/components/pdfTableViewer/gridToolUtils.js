// Pure geometry for the grid tool-bar's tools: which row or column band a click landed
// in, and the page-fraction bounds of a whole row or column. Everything here works in
// page fractions, the space the metadata stores, and nothing mutates its argument.

import { cumulative } from 'components/pdfTableViewer/tableSupportUtils';

// The axis entry values of a table, as plain numbers.
const axisValues = (table, axisKey) =>
  (table?.[axisKey] ?? []).map((entry) => entry.value);

// True when the page fraction {fx, fy} lies within the table's bounds.
const insideTable = (table, frac) => {
  const b = table?.bounds;
  if (!b || !frac) return false;
  return (
    frac.fx >= b.left &&
    frac.fx <= b.left + b.width &&
    frac.fy >= b.top &&
    frac.fy <= b.top + b.height
  );
};

// The 0-based index of the band containing `offset` along an axis starting at `start`,
// or null when the axis is empty. The last band takes anything past its far edge, so a
// click exactly on the table's far border belongs to the final row/column.
const bandIndex = (values, start, offset) => {
  if (values.length === 0) return null;
  const offsets = cumulative(values);
  for (let i = 0; i < values.length; i += 1) {
    if (offset <= start + offsets[i]) return i;
  }
  return values.length - 1;
};

// The 0-based row of the table containing the page fraction, or null when the point is
// outside the table's bounds or the table has no rows.
export const rowIndexAtFraction = (table, frac) => {
  if (!insideTable(table, frac)) return null;
  return bandIndex(axisValues(table, 'rowHeights'), table.bounds.top, frac.fy);
};

// The 0-based column of the table containing the page fraction, or null when the point
// is outside the table's bounds or the table has no columns.
export const columnIndexAtFraction = (table, frac) => {
  if (!insideTable(table, frac)) return null;
  return bandIndex(
    axisValues(table, 'columnWidths'),
    table.bounds.left,
    frac.fx
  );
};

// The page-fraction rectangle of one whole row: the table's full width at that row's
// band. Null for an index the table does not have.
export const rowBounds = (table, rowIndex) => {
  const values = axisValues(table, 'rowHeights');
  if (rowIndex == null || rowIndex < 0 || rowIndex >= values.length) return null;
  const offsets = cumulative(values);
  const top = table.bounds.top + (rowIndex === 0 ? 0 : offsets[rowIndex - 1]);
  return {
    left: table.bounds.left,
    top,
    width: table.bounds.width,
    height: values[rowIndex],
  };
};

// The page-fraction rectangle of one whole column: the table's full height at that
// column's band. Null for an index the table does not have.
export const columnBounds = (table, columnIndex) => {
  const values = axisValues(table, 'columnWidths');
  if (columnIndex == null || columnIndex < 0 || columnIndex >= values.length) {
    return null;
  }
  const offsets = cumulative(values);
  const left =
    table.bounds.left + (columnIndex === 0 ? 0 : offsets[columnIndex - 1]);
  return {
    left,
    top: table.bounds.top,
    width: values[columnIndex],
    height: table.bounds.height,
  };
};

// The 0-based row whose band holds the vertical centre of `rect`, clamped to the first
// row when that centre is above the table and to the last when it is below. Null when
// the table has no rows.
export const rowNearestCentre = (table, rect) => {
  const values = axisValues(table, 'rowHeights');
  if (values.length === 0 || !rect) return null;
  const centre = rect.top + rect.height / 2;
  if (centre <= table.bounds.top) return 0;
  if (centre >= table.bounds.top + table.bounds.height) return values.length - 1;
  return bandIndex(values, table.bounds.top, centre);
};
