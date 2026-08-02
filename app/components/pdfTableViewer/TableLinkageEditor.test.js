import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TableLinkageEditor from 'components/pdfTableViewer/TableLinkageEditor';
import {
  orderKey,
  comesAfter,
  sortByOrder,
  numCols,
  numRows,
  hdr,
  nonHeaderRows,
  cellText,
  headersMatch,
  candidates,
  hasSavedGrid,
  isAmalgamated,
  reconstructGrid,
  autoPopulateGrid,
  buildInitialState,
  buildSaveTables,
  padForDisplay,
  insertSorted,
  canDropSelectToGrid,
  moveGridCellToSelect,
  moveSelectToGridCell,
  orderedSpineInsertIndex,
  insertSpineRow,
  dropCandidates,
} from 'components/pdfTableViewer/gridUtilities';
import { getTableImages } from 'services/images';
import {
  confirmedTableStage,
  linkTableCellWidth,
  readyTableStage,
} from 'config';

jest.mock('services/images', () => ({ getTableImages: jest.fn() }));

// Config is mocked (rather than read directly) so no assertion here can ever depend
// on a configured value: the real values pass through, and `readyTableStage` is
// overridden with a sentinel so the Ready test asserts the mock, not the constant.
jest.mock('config', () => {
  const actual = jest.requireActual('config');
  return { __esModule: true, ...actual, readyTableStage: () => 99 };
});

jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  return { __esModule: true, default: toast };
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Only the *lengths* of columnWidths / rowHeights matter, so build PDFValue-shaped
// entries of the requested length. `cells` is passed straight through.
const mkTable = ({
  tableId,
  pdfPage = 0,
  tableInPage = 0,
  headerCount = 0,
  cols = 1,
  rows = 1,
  cells = [],
  next = null,
  grid = null,
  deleted = false,
  name = null,
}) => ({
  tableId,
  name,
  pdfPage,
  tableInPage,
  headerCount,
  columnWidths: Array.from({ length: cols }, () => ({ value: 1, confidence: 1 })),
  rowHeights: Array.from({ length: rows }, () => ({ value: 1, confidence: 1 })),
  cells,
  next,
  grid,
  deleted,
});

// Build header cells from a 2-D array of texts (row-major).
const hdrCells = (textRows) =>
  textRows.flatMap((cols, r) =>
    cols.map((text, c) => ({
      row: r,
      column: c,
      rowSpan: 1,
      columnSpan: 1,
      text,
      header: true,
    })),
  );

// ---------------------------------------------------------------------------
// orderKey / comesAfter
// ---------------------------------------------------------------------------

describe('orderKey', () => {
  it('returns [pdfPage, tableInPage]', () => {
    expect(orderKey(mkTable({ tableId: 'a', pdfPage: 2, tableInPage: 3 }))).toEqual([2, 3]);
  });

  it('defaults tableInPage to 0 when missing', () => {
    const t = mkTable({ tableId: 'a', pdfPage: 5 });
    delete t.tableInPage;
    expect(orderKey(t)).toEqual([5, 0]);
  });
});

describe('comesAfter', () => {
  const ref = mkTable({ tableId: 'ref', pdfPage: 1, tableInPage: 1 });

  it('true when on a later page', () => {
    expect(comesAfter(mkTable({ tableId: 't', pdfPage: 2, tableInPage: 0 }), ref)).toBe(true);
  });

  it('false when on an earlier page', () => {
    expect(comesAfter(mkTable({ tableId: 't', pdfPage: 0, tableInPage: 9 }), ref)).toBe(false);
  });

  it('true when same page but later tableInPage', () => {
    expect(comesAfter(mkTable({ tableId: 't', pdfPage: 1, tableInPage: 2 }), ref)).toBe(true);
  });

  it('false when same page and same tableInPage', () => {
    expect(comesAfter(mkTable({ tableId: 't', pdfPage: 1, tableInPage: 1 }), ref)).toBe(false);
  });

  it('treats missing tableInPage as 0', () => {
    const ref0 = mkTable({ tableId: 'r', pdfPage: 1 });
    delete ref0.tableInPage;
    const t = mkTable({ tableId: 't', pdfPage: 1, tableInPage: 0.5 });
    expect(comesAfter(t, ref0)).toBe(true);
    const same = mkTable({ tableId: 't2', pdfPage: 1 });
    delete same.tableInPage;
    expect(comesAfter(same, ref0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sortByOrder
// ---------------------------------------------------------------------------

describe('sortByOrder', () => {
  it('sorts ascending by (pdfPage, tableInPage)', () => {
    const input = [
      mkTable({ tableId: 'c', pdfPage: 2, tableInPage: 0 }),
      mkTable({ tableId: 'a', pdfPage: 0, tableInPage: 1 }),
      mkTable({ tableId: 'b', pdfPage: 0, tableInPage: 2 }),
    ];
    expect(sortByOrder(input).map((t) => t.tableId)).toEqual(['a', 'b', 'c']);
  });

  it('is stable for equal keys', () => {
    const input = [
      mkTable({ tableId: 'x', pdfPage: 1, tableInPage: 0 }),
      mkTable({ tableId: 'y', pdfPage: 1, tableInPage: 0 }),
      mkTable({ tableId: 'z', pdfPage: 1, tableInPage: 0 }),
    ];
    expect(sortByOrder(input).map((t) => t.tableId)).toEqual(['x', 'y', 'z']);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = [
      mkTable({ tableId: 'b', pdfPage: 1 }),
      mkTable({ tableId: 'a', pdfPage: 0 }),
    ];
    const before = input.map((t) => t.tableId);
    const out = sortByOrder(input);
    expect(out).not.toBe(input);
    expect(input.map((t) => t.tableId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// size / header primitives
// ---------------------------------------------------------------------------

describe('size primitives', () => {
  it('numCols / numRows count from columnWidths / rowHeights', () => {
    const t = mkTable({ tableId: 't', cols: 3, rows: 5 });
    expect(numCols(t)).toBe(3);
    expect(numRows(t)).toBe(5);
  });

  it('numCols / numRows default to 0 when the arrays are missing', () => {
    expect(numCols({})).toBe(0);
    expect(numRows({})).toBe(0);
  });

  it('hdr defaults to 0', () => {
    expect(hdr(mkTable({ tableId: 't', headerCount: 2 }))).toBe(2);
    expect(hdr({})).toBe(0);
  });

  it('nonHeaderRows subtracts the header rows', () => {
    expect(nonHeaderRows(mkTable({ tableId: 't', rows: 5, headerCount: 2 }))).toBe(3);
  });
});

describe('cellText', () => {
  it('looks up by row,column and treats null / missing as empty string', () => {
    const t = mkTable({
      tableId: 't',
      cells: [
        { row: 0, column: 0, text: 'A' },
        { row: 0, column: 1, text: null },
        { row: 1, column: 0, text: 'B' },
      ],
    });
    const get = cellText(t);
    expect(get(0, 0)).toBe('A');
    expect(get(0, 1)).toBe('');
    expect(get(1, 0)).toBe('B');
    expect(get(9, 9)).toBe('');
  });
});

describe('headersMatch', () => {
  it('true when header counts and header values match', () => {
    const a = mkTable({ tableId: 'a', cols: 2, headerCount: 1, cells: hdrCells([['A', 'B']]) });
    const b = mkTable({ tableId: 'b', cols: 2, headerCount: 1, cells: hdrCells([['A', 'B']]) });
    expect(headersMatch(a, b)).toBe(true);
  });

  it('false when a header value differs', () => {
    const a = mkTable({ tableId: 'a', cols: 2, headerCount: 1, cells: hdrCells([['A', 'B']]) });
    const b = mkTable({ tableId: 'b', cols: 2, headerCount: 1, cells: hdrCells([['A', 'X']]) });
    expect(headersMatch(a, b)).toBe(false);
  });

  it('false when header counts differ', () => {
    const a = mkTable({ tableId: 'a', cols: 2, headerCount: 1, cells: hdrCells([['A', 'B']]) });
    const b = mkTable({
      tableId: 'b',
      cols: 2,
      headerCount: 2,
      cells: hdrCells([['A', 'B'], ['A', 'B']]),
    });
    expect(headersMatch(a, b)).toBe(false);
  });

  it('true trivially when both have zero header rows', () => {
    const a = mkTable({ tableId: 'a', cols: 3, headerCount: 0 });
    const b = mkTable({ tableId: 'b', cols: 3, headerCount: 0 });
    expect(headersMatch(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

describe('candidates', () => {
  it('excludes deleted, root itself and tables not after root; sorted', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 1, tableInPage: 0 });
    const before = mkTable({ tableId: 'before', pdfPage: 0 });
    const del = mkTable({ tableId: 'del', pdfPage: 2, deleted: true });
    const after1 = mkTable({ tableId: 'after1', pdfPage: 3, tableInPage: 0 });
    const after2 = mkTable({ tableId: 'after2', pdfPage: 2, tableInPage: 1 });
    const tables = [after1, root, before, del, after2];
    expect(candidates(root, tables).map((t) => t.tableId)).toEqual(['after2', 'after1']);
  });
});

// ---------------------------------------------------------------------------
// hasSavedGrid
// ---------------------------------------------------------------------------

describe('hasSavedGrid', () => {
  it('false when grid is null', () => {
    expect(hasSavedGrid(mkTable({ tableId: 'r', grid: null }))).toBe(false);
  });

  it('false when grid is empty', () => {
    expect(hasSavedGrid(mkTable({ tableId: 'r', grid: [] }))).toBe(false);
  });

  it('false for the degenerate single cell', () => {
    expect(hasSavedGrid(mkTable({ tableId: 'r', grid: [['r']] }))).toBe(false);
  });

  it('true for a multi-column grid', () => {
    expect(hasSavedGrid(mkTable({ tableId: 'r', grid: [['r', 'b']] }))).toBe(true);
  });

  it('true for a multi-row grid', () => {
    expect(hasSavedGrid(mkTable({ tableId: 'r', grid: [['r'], ['b']] }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAmalgamated — the grid OR the links, so a table counts from the moment it
// is joined to another, whether or not the grid has been laid out yet.
// ---------------------------------------------------------------------------

describe('isAmalgamated', () => {
  it('false for a null table', () => {
    expect(isAmalgamated(null)).toBe(false);
  });

  it('false for a table with neither grid nor links', () => {
    expect(isAmalgamated(mkTable({ tableId: 'r' }))).toBe(false);
  });

  it('false for the degenerate single-cell grid with no links', () => {
    expect(isAmalgamated(mkTable({ tableId: 'r', grid: [['r']] }))).toBe(false);
  });

  it('true for a saved grid', () => {
    expect(isAmalgamated(mkTable({ tableId: 'r', grid: [['r', 'b']] }))).toBe(
      true,
    );
  });

  it('true for linked tables under next, with no grid yet', () => {
    const linked = mkTable({ tableId: 'b' });
    expect(isAmalgamated(mkTable({ tableId: 'r', next: { b: linked } }))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// reconstructGrid
// ---------------------------------------------------------------------------

describe('reconstructGrid', () => {
  it('rebuilds from grid + next, empty cell -> null, missing id -> null, (0,0) is root, rectangular', () => {
    const tableB = mkTable({ tableId: 'b' });
    const tableC = mkTable({ tableId: 'c' });
    const root = mkTable({
      tableId: 'root',
      next: { b: tableB, c: tableC },
      grid: [
        ['root', 'b'],
        ['', 'missing'],
        ['c'],
      ],
    });
    const grid = reconstructGrid(root);
    expect(grid[0][0]).toBe(root);
    expect(grid[0][1]).toBe(tableB);
    expect(grid[1][0]).toBeNull();
    expect(grid[1][1]).toBeNull(); // 'missing' not in next
    expect(grid[2][0]).toBe(tableC);
    expect(grid[2][1]).toBeNull(); // padded to rectangular
    grid.forEach((row) => expect(row).toHaveLength(2));
  });
});

// ---------------------------------------------------------------------------
// autoPopulateGrid
// ---------------------------------------------------------------------------

describe('autoPopulateGrid', () => {
  it('(a) vertical-only split: a spine below root, no extra columns', () => {
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      headerCount: 1,
      cols: 3,
      rows: 4,
      cells: hdrCells([['A', 'B', 'C']]),
    });
    // spine members match header count/values and column count; distinct row counts so
    // they cannot act as horizontal continuations of root (numRows !== root's).
    const s1 = mkTable({
      tableId: 's1',
      pdfPage: 1,
      headerCount: 1,
      cols: 3,
      rows: 5,
      cells: hdrCells([['A', 'B', 'C']]),
    });
    const s2 = mkTable({
      tableId: 's2',
      pdfPage: 2,
      headerCount: 1,
      cols: 3,
      rows: 2,
      cells: hdrCells([['A', 'B', 'C']]),
    });
    const { grid, remaining } = autoPopulateGrid(root, [s1, s2]);
    expect(grid.map((row) => row.map((c) => (c ? c.tableId : null)))).toEqual([
      ['root'],
      ['s1'],
      ['s2'],
    ]);
    expect(remaining).toEqual([]);
  });

  it('(b) horizontal-only split: root plus continuations across one row', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    // different column counts so they are not spine matches, but same row count -> horizontal
    const c1 = mkTable({ tableId: 'c1', pdfPage: 1, headerCount: 0, cols: 4, rows: 3 });
    const c2 = mkTable({ tableId: 'c2', pdfPage: 2, headerCount: 0, cols: 5, rows: 3 });
    const { grid, remaining } = autoPopulateGrid(root, [c1, c2]);
    expect(grid.map((row) => row.map((c) => (c ? c.tableId : null)))).toEqual([
      ['root', 'c1', 'c2'],
    ]);
    expect(remaining).toEqual([]);
  });

  it('(c) full 2x2 tile', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    const a = mkTable({ tableId: 'a', pdfPage: 1, headerCount: 0, cols: 2, rows: 5 }); // spine
    const b = mkTable({ tableId: 'b', pdfPage: 2, headerCount: 0, cols: 4, rows: 3 }); // right of root
    const c = mkTable({ tableId: 'c', pdfPage: 3, headerCount: 0, cols: 4, rows: 5 }); // right of a
    const { grid, remaining } = autoPopulateGrid(root, [a, b, c]);
    expect(grid.map((row) => row.map((x) => (x ? x.tableId : null)))).toEqual([
      ['root', 'b'],
      ['a', 'c'],
    ]);
    expect(remaining).toEqual([]);
  });

  it('(d) header-count mismatch keeps a table out of the grid (into remaining)', () => {
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      headerCount: 1,
      cols: 2,
      rows: 3,
      cells: hdrCells([['A', 'B']]),
    });
    const bad = mkTable({
      tableId: 'bad',
      pdfPage: 1,
      headerCount: 2,
      cols: 2,
      rows: 3,
      cells: hdrCells([['A', 'B'], ['A', 'B']]),
    });
    const { grid, remaining } = autoPopulateGrid(root, [bad]);
    expect(grid.map((row) => row.map((x) => (x ? x.tableId : null)))).toEqual([['root']]);
    expect(remaining.map((t) => t.tableId)).toEqual(['bad']);
  });

  it('(e) a column stops early when no candidate matches a lower row', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    const a = mkTable({ tableId: 'a', pdfPage: 1, headerCount: 0, cols: 2, rows: 5 }); // spine
    const b = mkTable({ tableId: 'b', pdfPage: 2, headerCount: 0, cols: 4, rows: 3 }); // right of root
    const leftover = mkTable({ tableId: 'x', pdfPage: 3, headerCount: 0, cols: 9, rows: 99 });
    const { grid, remaining } = autoPopulateGrid(root, [a, b, leftover]);
    expect(grid.map((row) => row.map((x) => (x ? x.tableId : null)))).toEqual([
      ['root', 'b'],
      ['a', null],
    ]);
    expect(remaining.map((t) => t.tableId)).toEqual(['x']);
  });

  it('does not mutate the caller array when a copy is passed', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, cols: 2, rows: 3 });
    const a = mkTable({ tableId: 'a', pdfPage: 1, cols: 2, rows: 5 });
    const list = [a];
    autoPopulateGrid(root, list.slice());
    expect(list.map((t) => t.tableId)).toEqual(['a']);
  });

  it('(A1) spine stops at the first header table once a no-header table is placed', () => {
    // Root has a header. h1 matches it (spine); n1 has no header (spine, and
    // switches the spine to no-header mode); h2 has a header again so the spine
    // must stop before it. h2 also has a distinct row count so it cannot be
    // placed as a horizontal continuation of root either -> it lands in remaining.
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      headerCount: 1,
      cols: 2,
      rows: 3,
      cells: hdrCells([['A', 'B']]),
    });
    const h1 = mkTable({
      tableId: 'h1',
      pdfPage: 1,
      headerCount: 1,
      cols: 2,
      rows: 5,
      cells: hdrCells([['A', 'B']]),
    });
    const n1 = mkTable({ tableId: 'n1', pdfPage: 2, headerCount: 0, cols: 2, rows: 5 });
    const h2 = mkTable({
      tableId: 'h2',
      pdfPage: 3,
      headerCount: 1,
      cols: 2,
      rows: 9,
      cells: hdrCells([['A', 'B']]),
    });
    const { grid, remaining } = autoPopulateGrid(root, [h1, n1, h2]);
    expect(grid.map((row) => row.map((c) => (c ? c.tableId : null)))).toEqual([
      ['root'],
      ['h1'],
      ['n1'],
    ]);
    expect(remaining.map((t) => t.tableId)).toEqual(['h2']);
  });

  it('(A1) a no-header table appearing after a header table is excluded from the spine', () => {
    // Root has no header. n1 (no header) goes on the spine and switches to
    // no-header mode; h has a header so the spine stops before it; n2 (no header)
    // therefore never reaches the spine. h and n2 have distinct row counts so
    // neither can be placed as a horizontal continuation of root -> both remain.
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    const n1 = mkTable({ tableId: 'n1', pdfPage: 1, headerCount: 0, cols: 2, rows: 5 });
    const h = mkTable({
      tableId: 'h',
      pdfPage: 2,
      headerCount: 1,
      cols: 2,
      rows: 7,
      cells: hdrCells([['A', 'B']]),
    });
    const n2 = mkTable({ tableId: 'n2', pdfPage: 3, headerCount: 0, cols: 2, rows: 9 });
    const { grid, remaining } = autoPopulateGrid(root, [n1, h, n2]);
    expect(grid.map((row) => row.map((c) => (c ? c.tableId : null)))).toEqual([
      ['root'],
      ['n1'],
    ]);
    expect(remaining.map((t) => t.tableId)).toContain('n2');
  });

  it('(A2) rejects a column candidate that does not come after the cell above', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    const a = mkTable({ tableId: 'a', pdfPage: 1, headerCount: 0, cols: 2, rows: 5 }); // spine
    const b = mkTable({ tableId: 'b', pdfPage: 2, headerCount: 0, cols: 4, rows: 3 }); // (0,1)
    // Comes after `a` (its left) but BEFORE `b` (the cell above (1,1)); must be rejected.
    const c = mkTable({
      tableId: 'c',
      pdfPage: 1,
      tableInPage: 1,
      headerCount: 0,
      cols: 4,
      rows: 5,
    });
    // Passed in reading order (as buildInitialState does): a(1,0), c(1,1), b(2,0).
    const { grid, remaining } = autoPopulateGrid(root, [a, c, b]);
    expect(grid.map((row) => row.map((x) => (x ? x.tableId : null)))).toEqual([
      ['root', 'b'],
      ['a', null],
    ]);
    expect(remaining.map((t) => t.tableId)).toEqual(['c']);
  });
});

// ---------------------------------------------------------------------------
// buildInitialState
// ---------------------------------------------------------------------------

describe('buildInitialState', () => {
  it('reconstructs when a saved grid exists and excludes placed ids from select', () => {
    const tableB = mkTable({ tableId: 'b', pdfPage: 1 });
    const other = mkTable({ tableId: 'o', pdfPage: 2 });
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      next: { b: tableB },
      grid: [['root', 'b']],
    });
    const tables = [root, tableB, other];
    const { grid, select } = buildInitialState(root, tables);
    expect(grid[0][0]).toBe(root);
    expect(grid[0][1]).toBe(tableB);
    // 'b' is placed in the grid, so select holds only 'o'
    expect(select.map((t) => t.tableId)).toEqual(['o']);
  });

  it('auto-populates when there is no saved grid', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, headerCount: 0, cols: 2, rows: 3 });
    const a = mkTable({ tableId: 'a', pdfPage: 1, headerCount: 0, cols: 2, rows: 5 }); // spine
    const leftover = mkTable({ tableId: 'x', pdfPage: 2, headerCount: 0, cols: 9, rows: 9 });
    const tables = [root, a, leftover];
    const { grid, select } = buildInitialState(root, tables);
    expect(grid.map((row) => row.map((c) => (c ? c.tableId : null)))).toEqual([['root'], ['a']]);
    expect(select.map((t) => t.tableId)).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// buildSaveTables
// ---------------------------------------------------------------------------

describe('buildSaveTables', () => {
  it('builds newGrid/newNext, drops nested tables and appends pruned-back tables', () => {
    const oldNested = mkTable({ tableId: 'old', pdfPage: 5 });
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      next: { old: oldNested },
      grid: [['root']],
    });
    const b = mkTable({ tableId: 'b', pdfPage: 1 });
    const c = mkTable({ tableId: 'c', pdfPage: 2 });
    const d = mkTable({ tableId: 'd', pdfPage: 3 });
    const tables = [root, b, c, d];
    const grid = [
      [root, b],
      [c, null],
    ];
    const result = buildSaveTables(root, grid, tables);

    const newRoot = result.find((t) => t.tableId === 'root');
    expect(newRoot.grid).toEqual([
      ['root', 'b'],
      ['c', ''],
    ]);
    expect(Object.keys(newRoot.next).sort()).toEqual(['b', 'c']);
    expect(newRoot.next.b).toBe(b);
    expect(newRoot.next.c).toBe(c);

    const ids = result.map((t) => t.tableId);
    expect(ids).not.toContain('b'); // now nested
    expect(ids).not.toContain('c'); // now nested
    expect(ids).toContain('d'); // untouched
    expect(ids).toContain('old'); // pruned back into the list
  });

  it('removes a fully-empty row on save', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, grid: [['root']] });
    const b = mkTable({ tableId: 'b', pdfPage: 1 });
    const tables = [root, b];
    const grid = [
      [root, b],
      [null, null], // fully-empty row -> removed
    ];
    const newRoot = buildSaveTables(root, grid, tables).find(
      (t) => t.tableId === 'root',
    );
    expect(newRoot.grid).toEqual([['root', 'b']]);
    expect(Object.keys(newRoot.next).sort()).toEqual(['b']);
  });

  it('removes a fully-empty column on save', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0, grid: [['root']] });
    const b = mkTable({ tableId: 'b', pdfPage: 1 });
    const c = mkTable({ tableId: 'c', pdfPage: 2 });
    const tables = [root, b, c];
    const grid = [
      [root, null, c],
      [b, null, null], // middle column fully empty -> removed
    ];
    const newRoot = buildSaveTables(root, grid, tables).find(
      (t) => t.tableId === 'root',
    );
    expect(newRoot.grid).toEqual([
      ['root', 'c'],
      ['b', ''],
    ]);
    expect(Object.keys(newRoot.next).sort()).toEqual(['b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// padForDisplay
// ---------------------------------------------------------------------------

describe('padForDisplay', () => {
  const ids = (grid) => grid.map((row) => row.map((c) => (c ? c.tableId : null)));

  it('adds a trailing empty column and a trailing empty row to a lone root', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0 });
    const out = padForDisplay([[root]]);
    expect(ids(out)).toEqual([
      ['root', null],
      [null, null],
    ]);
    expect(out[0][0]).toBe(root);
  });

  it('adds one trailing column and one trailing row to a filled 2x2 grid', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0 });
    const a = mkTable({ tableId: 'a', pdfPage: 1 });
    const b = mkTable({ tableId: 'b', pdfPage: 2 });
    const c = mkTable({ tableId: 'c', pdfPage: 3 });
    const out = padForDisplay([
      [root, b],
      [a, c],
    ]);
    expect(ids(out)).toEqual([
      ['root', 'b', null],
      ['a', 'c', null],
      [null, null, null],
    ]);
  });

  it('is idempotent in shape (trailing empties are trimmed then re-added)', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0 });
    const b = mkTable({ tableId: 'b', pdfPage: 2 });
    const once = padForDisplay([[root, b]]);
    const twice = padForDisplay(once);
    expect(twice.length).toBe(once.length);
    expect(twice.map((row) => row.length)).toEqual(once.map((row) => row.length));
  });
});

// ---------------------------------------------------------------------------
// insertSorted
// ---------------------------------------------------------------------------

describe('insertSorted', () => {
  it('inserts at the correct sorted position and returns a new array', () => {
    const list = [
      mkTable({ tableId: 'a', pdfPage: 0 }),
      mkTable({ tableId: 'c', pdfPage: 2 }),
    ];
    const t = mkTable({ tableId: 'b', pdfPage: 1 });
    const out = insertSorted(list, t);
    expect(out.map((x) => x.tableId)).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(list);
    expect(list.map((x) => x.tableId)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// canDropSelectToGrid
// ---------------------------------------------------------------------------

describe('canDropSelectToGrid', () => {
  const left = mkTable({ tableId: 'left', cols: 2, rows: 4, headerCount: 1 }); // nonHeaderRows 3
  const above = mkTable({ tableId: 'above', cols: 3, rows: 2 });
  const dragged = mkTable({ tableId: 'd', cols: 3, rows: 4, headerCount: 1 }); // nonHeaderRows 3

  it('accepts a valid row-0 drop (row count matches left)', () => {
    const grid = [[left, null]];
    expect(canDropSelectToGrid(dragged, grid, 0, 1)).toBe(true);
  });

  it('accepts a valid r>0 drop (column count matches the cell above)', () => {
    const grid = [
      [mkTable({ tableId: 'r00', cols: 2, rows: 4 }), above],
      [left, null],
    ];
    // dragged nonHeaderRows must match left; numCols(dragged) must match above (3)
    expect(canDropSelectToGrid(dragged, grid, 1, 1)).toBe(true);
  });

  it('rejects when the target cell is non-empty', () => {
    const grid = [[left, mkTable({ tableId: 'occupied' })]];
    expect(canDropSelectToGrid(dragged, grid, 0, 1)).toBe(false);
  });

  it('rejects a drop onto the Root cell (0,0)', () => {
    const root = mkTable({ tableId: 'root', cols: 3, rows: 4 });
    const grid = [[root]];
    expect(canDropSelectToGrid(dragged, grid, 0, 0)).toBe(false);
  });

  it('accepts a first-column drop when cols match Root and the row count matches the right neighbour', () => {
    const root = mkTable({ tableId: 'root', cols: 3, rows: 4 });
    const right = mkTable({ tableId: 'right', cols: 5, rows: 4, headerCount: 1 }); // nonHeaderRows 3
    const grid = [
      [root, mkTable({ tableId: 'topright', cols: 5, rows: 2 })],
      [null, right],
    ];
    // dragged: cols 3 === root, nonHeaderRows 3 === right (rows 4, hdr 1)
    expect(canDropSelectToGrid(dragged, grid, 1, 0)).toBe(true);
  });

  it('accepts a first-column drop when there is no table to the right (only cols must match Root)', () => {
    const root = mkTable({ tableId: 'root', cols: 3, rows: 4 });
    const grid = [
      [root, null],
      [null, null],
    ];
    expect(canDropSelectToGrid(dragged, grid, 1, 0)).toBe(true);
  });

  it('rejects a first-column drop when the column count differs from Root', () => {
    const root = mkTable({ tableId: 'root', cols: 2, rows: 4 }); // dragged has cols 3
    const grid = [
      [root, null],
      [null, null],
    ];
    expect(canDropSelectToGrid(dragged, grid, 1, 0)).toBe(false);
  });

  it('rejects a first-column drop when the row count conflicts with the right neighbour', () => {
    const root = mkTable({ tableId: 'root', cols: 3, rows: 4 });
    const right = mkTable({ tableId: 'right', cols: 5, rows: 9, headerCount: 1 }); // nonHeaderRows 8
    const grid = [
      [root, mkTable({ tableId: 'topright', cols: 5, rows: 2 })],
      [null, right],
    ];
    // dragged nonHeaderRows 3 !== right nonHeaderRows 8
    expect(canDropSelectToGrid(dragged, grid, 1, 0)).toBe(false);
  });

  it('rejects when the non-header row count differs', () => {
    const grid = [[left, null]];
    const wrong = mkTable({ tableId: 'w', cols: 3, rows: 6, headerCount: 1 }); // nonHeaderRows 5
    expect(canDropSelectToGrid(wrong, grid, 0, 1)).toBe(false);
  });

  it('rejects when r>0 and the cell above is null', () => {
    const grid = [
      [mkTable({ tableId: 'r00', cols: 2, rows: 4 }), null],
      [left, null],
    ];
    expect(canDropSelectToGrid(dragged, grid, 1, 1)).toBe(false);
  });

  it('rejects when r>0 and the column count of the cell above differs', () => {
    const wrongAbove = mkTable({ tableId: 'above2', cols: 9, rows: 2 });
    const grid = [
      [mkTable({ tableId: 'r00', cols: 2, rows: 4 }), wrongAbove],
      [left, null],
    ];
    expect(canDropSelectToGrid(dragged, grid, 1, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveGridCellToSelect / moveSelectToGridCell
// ---------------------------------------------------------------------------

describe('moveGridCellToSelect', () => {
  it('blanks the grid cell and inserts the table into select (sorted), without mutating inputs', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0 });
    const b = mkTable({ tableId: 'b', pdfPage: 2 });
    const grid = [[root, b]];
    const selA = mkTable({ tableId: 'a', pdfPage: 1 });
    const selC = mkTable({ tableId: 'c', pdfPage: 3 });
    const select = [selA, selC];

    const res = moveGridCellToSelect(grid, select, 0, 1);
    expect(res.grid[0][1]).toBeNull();
    expect(res.select.map((t) => t.tableId)).toEqual(['a', 'b', 'c']);
    // inputs unchanged
    expect(grid[0][1]).toBe(b);
    expect(select.map((t) => t.tableId)).toEqual(['a', 'c']);
  });
});

describe('moveSelectToGridCell', () => {
  it('places a valid table and removes it from select, without mutating inputs', () => {
    const left = mkTable({ tableId: 'left', cols: 2, rows: 4, headerCount: 1 });
    const grid = [[left, null]];
    const dragged = mkTable({ tableId: 'd', cols: 3, rows: 4, headerCount: 1 });
    const other = mkTable({ tableId: 'o', pdfPage: 9 });
    const select = [dragged, other];

    const res = moveSelectToGridCell(grid, select, 'd', 0, 1);
    expect(res).not.toBeNull();
    expect(res.grid[0][1]).toBe(dragged);
    expect(res.select.map((t) => t.tableId)).toEqual(['o']);
    // inputs unchanged
    expect(grid[0][1]).toBeNull();
    expect(select.map((t) => t.tableId)).toEqual(['d', 'o']);
  });

  it('returns null when the drop is invalid', () => {
    const left = mkTable({ tableId: 'left', cols: 2, rows: 4, headerCount: 1 });
    const grid = [[left, null]];
    const dragged = mkTable({ tableId: 'd', cols: 3, rows: 6, headerCount: 1 }); // row mismatch
    const res = moveSelectToGridCell(grid, [dragged], 'd', 0, 1);
    expect(res).toBeNull();
  });

  it('places a table into a first-column empty cell (new column-0 rule)', () => {
    const root = mkTable({ tableId: 'root', cols: 2, rows: 3 });
    const grid = [
      [root, null],
      [null, null],
    ];
    const dragged = mkTable({ tableId: 'd', cols: 2, rows: 5 });
    const res = moveSelectToGridCell(grid, [dragged], 'd', 1, 0);
    expect(res).not.toBeNull();
    expect(res.grid[1][0]).toBe(dragged);
    expect(res.select).toEqual([]);
  });

  it('returns null when the tableId is not in select', () => {
    const left = mkTable({ tableId: 'left', cols: 2, rows: 4 });
    const grid = [[left, null]];
    expect(moveSelectToGridCell(grid, [], 'missing', 0, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TableLinkageEditor component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// automatic drop placement
// ---------------------------------------------------------------------------

describe('orderedSpineInsertIndex', () => {
  const root = mkTable({ tableId: 'root', pdfPage: 0, cols: 2, rows: 3 });
  const a = mkTable({ tableId: 'a', pdfPage: 1, cols: 2, rows: 5 });
  const c = mkTable({ tableId: 'c', pdfPage: 3, cols: 2, rows: 5 });

  it('returns the index of the first spine table that comes after the dragged table', () => {
    const b = mkTable({ tableId: 'b', pdfPage: 2, cols: 2, rows: 5 });
    const grid = [
      [root, null],
      [a, null],
      [c, null],
      [null, null],
    ];
    expect(orderedSpineInsertIndex(b, grid)).toBe(2);
  });

  it('returns null when the dragged table belongs after every spine table', () => {
    const d = mkTable({ tableId: 'd', pdfPage: 4, cols: 2, rows: 5 });
    const grid = [
      [root, null],
      [a, null],
      [c, null],
      [null, null],
    ];
    expect(orderedSpineInsertIndex(d, grid)).toBe(null);
  });

  it('skips spine gaps (null column-0 entries)', () => {
    const x = mkTable({ tableId: 'x', pdfPage: 1, tableInPage: 1, cols: 3, rows: 5 });
    const b = mkTable({ tableId: 'b', pdfPage: 2, cols: 2, rows: 5 });
    const grid = [
      [root, null],
      [null, x],
      [c, null],
      [null, null],
    ];
    expect(orderedSpineInsertIndex(b, grid)).toBe(2);
  });
});

describe('insertSpineRow', () => {
  const root = mkTable({ tableId: 'root', pdfPage: 0, cols: 2, rows: 3 });
  const a = mkTable({ tableId: 'a', pdfPage: 1, cols: 2, rows: 5 });
  const b = mkTable({ tableId: 'b', pdfPage: 2, cols: 2, rows: 5 });

  it('splices a new padded row at r with the dragged table in column 0 and removes it from select', () => {
    const grid = [
      [root, null],
      [a, null],
      [null, null],
    ];
    const out = insertSpineRow(grid, [b], 'b', 1);
    expect(out.grid).toEqual([
      [root, null],
      [b, null],
      [a, null],
      [null, null],
    ]);
    expect(out.select).toEqual([]);
    expect(out.grid).not.toBe(grid); // immutable
  });

  it('returns null when the dragged table is missing or its columns do not match Root', () => {
    const grid = [
      [root, null],
      [a, null],
      [null, null],
    ];
    expect(insertSpineRow(grid, [b], 'nope', 1)).toBe(null);
    const wrong = mkTable({ tableId: 'w', pdfPage: 2, cols: 3, rows: 5 });
    expect(insertSpineRow(grid, [wrong], 'w', 1)).toBe(null);
  });
});

describe('dropCandidates', () => {
  const root = mkTable({ tableId: 'root', pdfPage: 0, cols: 2, rows: 3 });
  const a = mkTable({ tableId: 'a', pdfPage: 1, cols: 2, rows: 5 });
  const c = mkTable({ tableId: 'c', pdfPage: 3, cols: 2, rows: 5 });

  it('lists the ordered spine splice first, then every valid empty cell', () => {
    // rows differ from a/c so no horizontal-continuation cells qualify.
    const b = mkTable({ tableId: 'b', pdfPage: 2, cols: 2, rows: 4 });
    const grid = [
      [root, null],
      [a, null],
      [c, null],
      [null, null],
    ];
    expect(dropCandidates(b, grid)).toEqual([
      { kind: 'newRow', r: 2 },
      { kind: 'cell', r: 3, c: 0 }, // trailing padded spine cell
    ]);
  });

  it('offers only cell candidates when the dragged table is not spine-eligible', () => {
    // cols differ from Root (not spine-eligible); non-header rows match Root so the
    // cell to Root's right qualifies.
    const w = mkTable({ tableId: 'w', pdfPage: 2, cols: 3, rows: 3 });
    const grid = [
      [root, null],
      [a, null],
      [c, null],
      [null, null],
    ];
    expect(dropCandidates(w, grid)).toEqual([{ kind: 'cell', r: 0, c: 1 }]);
  });
});

describe('TableLinkageEditor component', () => {
  // mkTable does not build bounds; the component reads t.bounds for image requests.
  const withBounds = (t, i) => ({
    ...t,
    bounds: { left: 0.01 * i, top: 0.02, width: 0.03, height: 0.04 },
  });

  // Fixture that auto-populates: root over a spine `a`, with `x` left in select.
  const buildFixture = () => {
    const root = withBounds(
      mkTable({ tableId: 'root', name: 'Root', pdfPage: 0, cols: 2, rows: 3 }),
      1,
    );
    const a = withBounds(
      mkTable({ tableId: 'a', name: 'Alpha', pdfPage: 1, cols: 2, rows: 5 }),
      2,
    );
    const x = withBounds(
      mkTable({ tableId: 'x', name: 'Ex', pdfPage: 2, cols: 9, rows: 9 }),
      3,
    );
    return { root, a, x, tables: [root, a, x] };
  };

  beforeEach(() => {
    getTableImages.mockReset();
  });

  it('renders nothing when rootTable is undefined', () => {
    const { container } = render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={undefined}
        tables={[]}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('link-cancel')).toBeNull();
  });

  it('requests every displayed table image in a single batched call and renders them', async () => {
    const { root, a, x, tables } = buildFixture();
    getTableImages.mockResolvedValue({
      images: { root: 'AAA', a: 'BBB', x: 'CCC' },
    });

    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );

    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    const [pdfId, width, tableImages] = getTableImages.mock.calls[0];
    expect(pdfId).toBe('pdf-1');
    expect(width).toBe(linkTableCellWidth());
    expect(tableImages.map((e) => e.tableId).sort()).toEqual(['a', 'root', 'x']);
    const rootEntry = tableImages.find((e) => e.tableId === 'root');
    expect(rootEntry).toEqual({
      page: root.pdfPage,
      tableId: root.tableId,
      bounds: {
        left: root.bounds.left,
        top: root.bounds.top,
        width: root.bounds.width,
        height: root.bounds.height,
      },
    });

    // Images resolve and the cropped PNGs appear.
    await waitFor(() => {
      const imgs = document.querySelectorAll('img');
      expect(imgs.length).toBeGreaterThanOrEqual(3);
    });
    const srcs = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toContain('data:image/png;base64,AAA');
    expect(srcs).toContain('data:image/png;base64,BBB');
    expect(srcs).toContain('data:image/png;base64,CCC');
  });

  it('Cancel invokes onCancel and never onSave', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });
    const onCancel = jest.fn();
    const onSave = jest.fn();

    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('link-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Save invokes onSave with buildSaveTables for the current grid', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });
    const onSave = jest.fn();

    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('link-save'));
    expect(onSave).toHaveBeenCalledTimes(1);

    const { grid } = buildInitialState(root, tables);
    const expected = buildSaveTables(root, grid, tables);
    const actual = onSave.mock.calls[0][0];

    // Root entry now carries grid/next; nested table `a` removed from the list; `x` kept.
    const newRoot = actual.find((t) => t.tableId === 'root');
    expect(newRoot.grid).toEqual([['root'], ['a']]);
    expect(Object.keys(newRoot.next)).toEqual(['a']);
    const ids = actual.map((t) => t.tableId).sort();
    expect(ids).toEqual(expected.map((t) => t.tableId).sort());
    expect(ids).not.toContain('a');
    expect(ids).toContain('x');
    expect(ids).toContain('root');
  });

  it('renders inline as a panel, not as a dialog, with all three actions', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });

    const { container } = render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );

    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    // No dialog chrome, and the panels live inside the component's own container
    // rather than in a portal.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-testid="available-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="linked-panel"]')).not.toBeNull();
    expect(screen.getByTestId('link-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('link-save')).toBeInTheDocument();
    expect(screen.getByTestId('link-ready')).toBeInTheDocument();
  });

  it('Ready saves exactly what Save would, except the root is marked ready', async () => {
    const fixture = buildFixture();
    // Give the root and the untouched leftover table pre-existing stages, so the
    // test can show only the root's changes.
    const root = { ...fixture.root, confirmationStage: 2 };
    const x = { ...fixture.x, confirmationStage: 3 };
    const tables = [root, fixture.a, x];
    getTableImages.mockResolvedValue({ images: {} });
    const onSave = jest.fn();

    render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('link-ready'));
    expect(onSave).toHaveBeenCalledTimes(1);

    const { grid } = buildInitialState(root, tables);
    const expected = buildSaveTables(root, grid, tables).map((t) =>
      t.tableId === root.tableId
        ? { ...t, confirmationStage: readyTableStage() }
        : t,
    );
    const actual = onSave.mock.calls[0][0];
    expect(actual).toEqual(expected);

    const newRoot = actual.find((t) => t.tableId === 'root');
    expect(newRoot.confirmationStage).toBe(readyTableStage());
    expect(newRoot.grid).toEqual([['root'], ['a']]);
    // No other table's stage moved, and nothing was mutated in place.
    expect(actual.find((t) => t.tableId === 'x').confirmationStage).toBe(3);
    expect(root.confirmationStage).toBe(2);
    expect(x.confirmationStage).toBe(3);
  });

  // Fixture with no leftover candidate: root + a single spine table, so `select`
  // ends up empty after auto-population.
  const buildFullFixture = () => {
    const root = withBounds(
      mkTable({ tableId: 'root', name: 'Root', pdfPage: 0, cols: 2, rows: 3 }),
      1,
    );
    const a = withBounds(
      mkTable({ tableId: 'a', name: 'Alpha', pdfPage: 1, cols: 2, rows: 5 }),
      2,
    );
    return { root, a, tables: [root, a] };
  };

  it('renders the two panel titles', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });
    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalled());
    expect(screen.getByText('Available tables')).toBeInTheDocument();
    expect(screen.getByText('Linked tables')).toBeInTheDocument();
  });

  it('keeps a dashed drop placeholder in the Available panel when select is empty', async () => {
    const { root, tables } = buildFullFixture();
    getTableImages.mockResolvedValue({ images: {} });
    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalled());
    expect(screen.getByTestId('select-empty')).toBeInTheDocument();
  });

  it('always exposes at least one empty grid drop target even when fully tiled', async () => {
    const { root, tables } = buildFullFixture();
    getTableImages.mockResolvedValue({ images: {} });
    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalled());
    expect(screen.getAllByTestId('link-empty-cell').length).toBeGreaterThanOrEqual(1);
  });

  // Minimal HTML5 dataTransfer stand-in shared between dragStart and drop.
  const mkDataTransfer = () => {
    const store = {};
    return {
      setData: (k, v) => {
        store[k] = v;
      },
      getData: (k) => store[k],
    };
  };

  const gridCellIds = () =>
    [...screen.getByTestId('linked-grid').querySelectorAll('[data-testid="link-cell"]')].map(
      (el) => el.getAttribute('data-tableid'),
    );

  it('dropping anywhere on the grid auto-places the table in document order, opening a new row', async () => {
    // Saved grid root -> a -> c; b (between a and c by document order) left in select.
    // b's row count differs from a/c so no continuation cell qualifies: the ordered
    // spine splice is the placement.
    const root = withBounds(
      mkTable({
        tableId: 'root',
        name: 'Root',
        pdfPage: 0,
        cols: 2,
        rows: 3,
        grid: [['root'], ['a'], ['c']],
      }),
      1,
    );
    const a = withBounds(mkTable({ tableId: 'a', name: 'Alpha', pdfPage: 1, cols: 2, rows: 5 }), 2);
    const c = withBounds(mkTable({ tableId: 'c', name: 'Gamma', pdfPage: 3, cols: 2, rows: 5 }), 3);
    root.next = { a, c };
    const b = withBounds(mkTable({ tableId: 'b', name: 'Beta', pdfPage: 2, cols: 2, rows: 4 }), 4);
    getTableImages.mockResolvedValue({ images: {} });

    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={[root, b]}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalled());

    const selectColumn = screen.getByTestId('select-column');
    const dragged = selectColumn.querySelector('[data-tableid="b"]');
    expect(dragged).not.toBeNull();

    const dt = mkDataTransfer();
    fireEvent.dragStart(dragged, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('linked-grid'), { dataTransfer: dt, clientX: 0, clientY: 0 });

    // b landed between a and c on the spine, in a newly opened row.
    expect(gridCellIds()).toEqual(['root', 'a', 'b', 'c']);
    expect(selectColumn.querySelector('[data-tableid="b"]')).toBeNull();
  });

  it('a single-column grid accepts a drop anywhere on the panel and appends in order', async () => {
    const root = withBounds(
      mkTable({
        tableId: 'root',
        name: 'Root',
        pdfPage: 0,
        cols: 2,
        rows: 3,
        grid: [['root'], ['a']],
      }),
      1,
    );
    const a = withBounds(mkTable({ tableId: 'a', name: 'Alpha', pdfPage: 1, cols: 2, rows: 5 }), 2);
    root.next = { a };
    const b = withBounds(mkTable({ tableId: 'b', name: 'Beta', pdfPage: 2, cols: 2, rows: 4 }), 3);
    getTableImages.mockResolvedValue({ images: {} });

    render(
      <TableLinkageEditor
        pdfId="pdf-1"
        rootTable={root}
        tables={[root, b]}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalled());

    const dt = mkDataTransfer();
    fireEvent.dragStart(
      screen.getByTestId('select-column').querySelector('[data-tableid="b"]'),
      { dataTransfer: dt },
    );
    // Drop on the panel itself — no need to hit the small empty cell.
    fireEvent.drop(screen.getByTestId('linked-grid'), { dataTransfer: dt, clientX: 0, clientY: 0 });

    expect(gridCellIds()).toEqual(['root', 'a', 'b']);
  });

  // ---- Unlink -------------------------------------------------------------
  //
  // Unlink is a LOCAL edit, like a drag: it empties the grid so every linked table goes
  // back to Available tables and commits nothing, leaving Save/Ready to persist it and
  // Cancel to abandon it. The fixture auto-links 'a' onto the spine (same column count as
  // the root) and leaves 'x' available (9 columns, ineligible), so a correct Unlink ends
  // with BOTH in Available and Root alone in the grid.
  const panelIds = (container, panel) =>
    Array.from(
      container
        .querySelector(`[data-testid="${panel}"]`)
        .querySelectorAll('[data-testid="link-cell"]'),
    ).map((el) => el.getAttribute('data-tableid'));

  it('places Unlink at the far left of the action row, beside Cancel', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });

    const { container } = render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));

    const order = Array.from(container.querySelectorAll('button[data-testid]')).map(
      (el) => el.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'link-unlink',
      'link-cancel',
      'link-save',
      'link-ready',
    ]);
  });

  it('Unlink returns every linked table to Available and leaves Root alone in the grid', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });

    const { container } = render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={root}
        tables={tables}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));
    // Precondition: 'a' was auto-linked, 'x' was not.
    expect(panelIds(container, 'linked-panel')).toEqual(['root', 'a']);
    expect(panelIds(container, 'available-panel')).toEqual(['x']);

    fireEvent.click(screen.getByTestId('link-unlink'));

    expect(panelIds(container, 'linked-panel')).toEqual(['root']);
    // Document order, as the Available column always uses.
    expect(panelIds(container, 'available-panel')).toEqual(['a', 'x']);
  });

  it('Unlink commits nothing by itself, so Cancel abandons it', async () => {
    const { root, tables } = buildFixture();
    getTableImages.mockResolvedValue({ images: {} });
    const onSave = jest.fn();
    const onCancel = jest.fn();

    render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={root}
        tables={tables}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('link-unlink'));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('link-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Save after Unlink hands back a root with no grid and no next, and the children restored', async () => {
    const { root, a, x } = buildFixture();
    // A root that ALREADY has a saved link to 'a', so 'a' is nested and absent from the
    // top-level list — the state a real unlink has to undo.
    const linkedRoot = { ...root, grid: [['root'], ['a']], next: { a } };
    getTableImages.mockResolvedValue({ images: {} });
    const onSave = jest.fn();

    render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={linkedRoot}
        tables={[linkedRoot, x]}
        onCancel={jest.fn()}
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(getTableImages).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('link-unlink'));
    fireEvent.click(screen.getByTestId('link-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    const savedRoot = saved.find((t) => t.tableId === 'root');
    expect(savedRoot.grid).toBeNull();
    expect(savedRoot.next).toBeNull();
    // 'a' is back in the top-level list rather than nested under the root.
    expect(saved.map((t) => t.tableId).sort()).toEqual(['a', 'root', 'x']);
  });

  // ---- Unlink and the confirmation stage ----------------------------------
  //
  // A root at the ready stage is ready to be EXTRACTED as a linked group, so removing its
  // links takes that claim back and the stage returns to confirmed. It is a CAP, never a
  // set — a table whose layers were never confirmed must not be promoted by unlinking — and
  // it applies only when links were actually removed, so a save on a table that never had
  // any leaves its stage untouched. A subsequent Ready deliberately wins.
  const linkedFixture = (stage) => {
    const { root, a, x } = buildFixture();
    const linkedRoot = {
      ...root,
      confirmationStage: stage,
      grid: [['root'], ['a']],
      next: { a },
    };
    return { linkedRoot, tables: [linkedRoot, x] };
  };

  const renderForStage = (rootTable, tables, onSave) => {
    getTableImages.mockResolvedValue({ images: {} });
    render(
      <TableLinkageEditor
        pdfId={'pdf-1'}
        rootTable={rootTable}
        tables={tables}
        onCancel={jest.fn()}
        onSave={onSave}
      />,
    );
    return waitFor(() => expect(getTableImages).toHaveBeenCalled());
  };

  const savedRootFrom = (onSave) =>
    onSave.mock.calls[0][0].find((t) => t.tableId === 'root');

  it('Unlink then Save returns a ready root to the confirmed stage', async () => {
    const { linkedRoot, tables } = linkedFixture(readyTableStage());
    const onSave = jest.fn();
    await renderForStage(linkedRoot, tables, onSave);

    fireEvent.click(screen.getByTestId('link-unlink'));
    fireEvent.click(screen.getByTestId('link-save'));

    expect(savedRootFrom(onSave).confirmationStage).toBe(confirmedTableStage());
  });

  it('Unlink never promotes a root that was below the confirmed stage', async () => {
    const partway = confirmedTableStage() - 3;
    const { linkedRoot, tables } = linkedFixture(partway);
    const onSave = jest.fn();
    await renderForStage(linkedRoot, tables, onSave);

    fireEvent.click(screen.getByTestId('link-unlink'));
    fireEvent.click(screen.getByTestId('link-save'));

    expect(savedRootFrom(onSave).confirmationStage).toBe(partway);
  });

  it('Unlink leaves a root with no stage yet without one', async () => {
    const { linkedRoot, tables } = linkedFixture(null);
    const onSave = jest.fn();
    await renderForStage(linkedRoot, tables, onSave);

    fireEvent.click(screen.getByTestId('link-unlink'));
    fireEvent.click(screen.getByTestId('link-save'));

    expect(savedRootFrom(onSave).confirmationStage).toBeNull();
  });

  it('Ready after Unlink still marks the root ready', async () => {
    const { linkedRoot, tables } = linkedFixture(readyTableStage());
    const onSave = jest.fn();
    await renderForStage(linkedRoot, tables, onSave);

    fireEvent.click(screen.getByTestId('link-unlink'));
    fireEvent.click(screen.getByTestId('link-ready'));

    expect(savedRootFrom(onSave).confirmationStage).toBe(readyTableStage());
  });

  it('saving a root that never had links leaves its stage alone', async () => {
    // Marked ready from the left column, never linked: Save here must not demote it.
    const { root, x } = buildFixture();
    const readyRoot = { ...root, confirmationStage: readyTableStage() };
    const onSave = jest.fn();
    await renderForStage(readyRoot, [readyRoot, x], onSave);

    fireEvent.click(screen.getByTestId('link-save'));

    expect(savedRootFrom(onSave).confirmationStage).toBe(readyTableStage());
  });
});

// ---------------------------------------------------------------------------
// buildSaveTables — an emptied grid is a genuine unlink
// ---------------------------------------------------------------------------

describe('buildSaveTables with only Root left in the grid', () => {
  it('nulls grid and next rather than saving a degenerate 1x1 grid', () => {
    const nested = mkTable({ tableId: 'a', pdfPage: 1 });
    const root = mkTable({
      tableId: 'root',
      pdfPage: 0,
      grid: [['root'], ['a']],
      next: { a: nested },
    });
    const other = mkTable({ tableId: 'x', pdfPage: 2 });

    // The grid the panel holds after Unlink: Root alone, plus the trailing empties
    // padForDisplay always adds.
    const result = buildSaveTables(
      root,
      [
        [root, null],
        [null, null],
      ],
      [root, other],
    );

    const newRoot = result.find((t) => t.tableId === 'root');
    expect(newRoot.grid).toBeNull();
    expect(newRoot.next).toBeNull();
    // The previously nested table is handed back to the top-level list.
    expect(result.map((t) => t.tableId).sort()).toEqual(['a', 'root', 'x']);
  });

  it('still builds grid and next when a table remains linked', () => {
    const root = mkTable({ tableId: 'root', pdfPage: 0 });
    const b = mkTable({ tableId: 'b', pdfPage: 1 });

    const result = buildSaveTables(root, [[root], [b]], [root, b]);

    const newRoot = result.find((t) => t.tableId === 'root');
    expect(newRoot.grid).toEqual([['root'], ['b']]);
    expect(Object.keys(newRoot.next)).toEqual(['b']);
  });
});
