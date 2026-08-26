import {
  cellBounds,
  columnBounds,
  columnIndexAtFraction,
  rowBounds,
  rowIndexAtFraction,
  rowNearestCentre,
} from 'components/pdfTableViewer/gridToolUtils';

// A table occupying the middle of the page: left 0.1 width 0.4, top 0.2 height 0.3.
// Three rows of 0.1 each and two columns of 0.2 each, so every band edge is exact.
const TABLE = {
  bounds: { left: 0.1, top: 0.2, width: 0.4, height: 0.3 },
  rowHeights: [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }],
  columnWidths: [{ value: 0.2 }, { value: 0.2 }],
};

describe('rowIndexAtFraction', () => {
  it('finds the first, a middle and the last row band', () => {
    expect(rowIndexAtFraction(TABLE, { fx: 0.2, fy: 0.25 })).toBe(0);
    expect(rowIndexAtFraction(TABLE, { fx: 0.2, fy: 0.35 })).toBe(1);
    expect(rowIndexAtFraction(TABLE, { fx: 0.2, fy: 0.45 })).toBe(2);
  });

  it('returns null outside the table on either axis', () => {
    expect(rowIndexAtFraction(TABLE, { fx: 0.2, fy: 0.1 })).toBeNull();
    expect(rowIndexAtFraction(TABLE, { fx: 0.2, fy: 0.9 })).toBeNull();
    expect(rowIndexAtFraction(TABLE, { fx: 0.9, fy: 0.25 })).toBeNull();
  });

  it('returns null for a table with no rows', () => {
    expect(
      rowIndexAtFraction({ ...TABLE, rowHeights: [] }, { fx: 0.2, fy: 0.25 })
    ).toBeNull();
  });
});

describe('columnIndexAtFraction', () => {
  it('finds the first and the last column band', () => {
    expect(columnIndexAtFraction(TABLE, { fx: 0.2, fy: 0.25 })).toBe(0);
    expect(columnIndexAtFraction(TABLE, { fx: 0.45, fy: 0.25 })).toBe(1);
  });

  it('returns null outside the table on either axis', () => {
    expect(columnIndexAtFraction(TABLE, { fx: 0.05, fy: 0.25 })).toBeNull();
    expect(columnIndexAtFraction(TABLE, { fx: 0.6, fy: 0.25 })).toBeNull();
    expect(columnIndexAtFraction(TABLE, { fx: 0.2, fy: 0.9 })).toBeNull();
  });
});

describe('rowBounds', () => {
  it('spans the table width at the row band', () => {
    expect(rowBounds(TABLE, 1)).toEqual({
      left: 0.1,
      top: 0.30000000000000004,
      width: 0.4,
      height: 0.1,
    });
  });

  it('returns null for an out-of-range index', () => {
    expect(rowBounds(TABLE, -1)).toBeNull();
    expect(rowBounds(TABLE, 3)).toBeNull();
  });
});

describe('columnBounds', () => {
  it('spans the table height at the column band', () => {
    expect(columnBounds(TABLE, 1)).toEqual({
      left: 0.30000000000000004,
      top: 0.2,
      width: 0.2,
      height: 0.3,
    });
  });

  it('returns null for an out-of-range index', () => {
    expect(columnBounds(TABLE, -1)).toBeNull();
    expect(columnBounds(TABLE, 2)).toBeNull();
  });
});

describe('cellBounds', () => {
  it('is the intersection of the row band and the column band', () => {
    expect(cellBounds(TABLE, 1, 1)).toEqual({
      left: 0.30000000000000004,
      top: 0.30000000000000004,
      width: 0.2,
      height: 0.1,
    });
  });

  it('starts the first cell at the table origin', () => {
    expect(cellBounds(TABLE, 0, 0)).toEqual({
      left: 0.1,
      top: 0.2,
      width: 0.2,
      height: 0.1,
    });
  });

  it('returns null for an out-of-range row or column', () => {
    expect(cellBounds(TABLE, 3, 0)).toBeNull();
    expect(cellBounds(TABLE, -1, 0)).toBeNull();
    expect(cellBounds(TABLE, 0, 2)).toBeNull();
    expect(cellBounds(TABLE, 0, -1)).toBeNull();
  });
});

describe('rowNearestCentre', () => {
  it('takes the row containing the rectangle vertical centre', () => {
    expect(
      rowNearestCentre(TABLE, { left: 0.1, top: 0.32, width: 0.2, height: 0.04 })
    ).toBe(1);
  });

  it('clamps to the first row when the centre is above the table', () => {
    expect(
      rowNearestCentre(TABLE, { left: 0.1, top: 0.0, width: 0.2, height: 0.05 })
    ).toBe(0);
  });

  it('clamps to the last row when the centre is below the table', () => {
    expect(
      rowNearestCentre(TABLE, { left: 0.1, top: 0.8, width: 0.2, height: 0.1 })
    ).toBe(2);
  });

  it('returns null for a table with no rows', () => {
    expect(
      rowNearestCentre({ ...TABLE, rowHeights: [] }, { left: 0, top: 0, width: 1, height: 1 })
    ).toBeNull();
  });
});
