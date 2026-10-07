import {
  addCutLine,
  clampCutPosition,
  effectiveCuts,
  isLastInLinkGroup,
  moveCutLine,
  removeCutLine,
  splitTableAtCuts,
  tableInPageAt,
} from 'components/pdfTableViewer/tableCutUtils';
import {
  overlapArea,
  pageTableName,
  sumValues,
} from 'components/pdfTableViewer/tableSupportUtils';

const MIN = 0.001;
const BOUNDS = { left: 0.1, top: 0.2, width: 0.4, height: 0.3 };

const makeCells = () => {
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      cells.push({
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        text: `r${row}c${column}`,
        confidence: 90,
        bounds: {
          left: 0.1 + column * 0.2,
          top: 0.2 + row * 0.1,
          width: 0.2,
          height: 0.1,
        },
      });
    }
  }
  return cells;
};

const makeTable = (overrides = {}) => ({
  tableId: 'orig',
  name: 'Page 1 Table 1',
  pdfPage: 0,
  tableInPage: 0,
  title: { text: 'Losses' },
  headerCount: 2,
  next: null,
  grid: { saved: true },
  confirmationStage: 'confirmed',
  extractionMechanism: 'LINES',
  confidence: 80,
  splitBottomRow: false,
  bounds: { ...BOUNDS },
  columnWidths: [
    { value: 0.2, confidence: 100 },
    { value: 0.2, confidence: 100 },
  ],
  rowHeights: [
    { value: 0.1, confidence: 100 },
    { value: 0.1, confidence: 100 },
    { value: 0.1, confidence: 100 },
  ],
  cells: makeCells(),
  footer: { row: 2, column: 0 },
  sectionTitles: [{ tableRow: 2, data: 'Section' }],
  ...overrides,
});

const idFactory = () => {
  let n = 0;
  return jest.fn(() => {
    n += 1;
    return `n${n}`;
  });
};

const cellAtIndex = (table, row, column) =>
  table.cells.find((c) => c.row === row && c.column === column);

describe('clampCutPosition', () => {
  it('leaves a position inside the table unchanged', () => {
    expect(clampCutPosition(0.35, BOUNDS, MIN)).toBe(0.35);
  });

  it('clamps above the table to one minFraction below the top', () => {
    expect(clampCutPosition(0.05, BOUNDS, MIN)).toBeCloseTo(0.201, 10);
  });

  it('clamps below the table to one minFraction above the bottom', () => {
    expect(clampCutPosition(0.9, BOUNDS, MIN)).toBeCloseTo(0.499, 10);
  });
});

describe('cut line list edits', () => {
  it('addCutLine returns a new ascending array', () => {
    const lines = [0.3, 0.45];
    const result = addCutLine(lines, 0.35);
    expect(result).toEqual([0.3, 0.35, 0.45]);
    expect(lines).toEqual([0.3, 0.45]);
  });

  it('moveCutLine replaces a line and keeps the array ascending', () => {
    const lines = [0.3, 0.35, 0.45];
    const result = moveCutLine(lines, 0, 0.4);
    expect(result).toEqual([0.35, 0.4, 0.45]);
    expect(lines).toEqual([0.3, 0.35, 0.45]);
  });

  it('removeCutLine drops the indexed line', () => {
    const lines = [0.3, 0.35, 0.45];
    const result = removeCutLine(lines, 1);
    expect(result).toEqual([0.3, 0.45]);
    expect(lines).toEqual([0.3, 0.35, 0.45]);
  });
});

describe('effectiveCuts', () => {
  it('drops edge, near-edge and near-duplicate lines and sorts the rest', () => {
    const lines = [0.45, 0.2, 0.2005, 0.35, 0.3505, 0.4995, 0.5, 0.3];
    expect(effectiveCuts(BOUNDS, lines, MIN)).toEqual([0.3, 0.35, 0.45]);
  });

  it('returns an empty array for no lines', () => {
    expect(effectiveCuts(BOUNDS, [], MIN)).toEqual([]);
  });
});

describe('tableInPageAt', () => {
  const at = (id, top, tableInPage, extra = {}) => ({
    tableId: id,
    pdfPage: 0,
    tableInPage,
    bounds: { left: 0.1, top, width: 0.2, height: 0.05 },
    ...extra,
  });

  it('gives the mean between the tables above and below', () => {
    const tables = [at('a', 0.1, 0), at('b', 0.5, 1)];
    expect(tableInPageAt(tables, 0, 0.3)).toBe(0.5);
  });

  it('gives below - 1 above every table', () => {
    expect(tableInPageAt([at('a', 0.5, 3)], 0, 0.1)).toBe(2);
  });

  it('gives above + 1 below every table', () => {
    expect(tableInPageAt([at('a', 0.1, 3)], 0, 0.5)).toBe(4);
  });

  it('gives 0 with no table on the page', () => {
    expect(tableInPageAt([at('a', 0.1, 3, { pdfPage: 1 })], 0, 0.5)).toBe(0);
  });

  it('counts a table held in a next map', () => {
    const nested = at('n', 0.5, 2);
    const root = at('r', 0.1, 0, { next: { n: nested } });
    expect(tableInPageAt([root], 0, 0.3)).toBe(1);
  });
});

describe('splitTableAtCuts unchanged results', () => {
  it('returns the list by reference for no lines', () => {
    const tables = [makeTable()];
    expect(splitTableAtCuts(tables, 'orig', [], MIN, idFactory())).toBe(tables);
  });

  it('returns the list by reference when every line is dropped', () => {
    const tables = [makeTable()];
    expect(
      splitTableAtCuts(tables, 'orig', [0.2, 0.5, 0.2005], MIN, idFactory())
    ).toBe(tables);
  });

  it('returns the list by reference for an unknown id', () => {
    const tables = [makeTable()];
    expect(splitTableAtCuts(tables, 'missing', [0.35], MIN, idFactory())).toBe(
      tables
    );
  });

  it('returns the list by reference for a joined table that is not last in its group', () => {
    const joined = makeTable({ tableId: 'joined', pdfPage: 1, tableInPage: 0 });
    const later = makeTable({ tableId: 'later', pdfPage: 1, tableInPage: 1 });
    const tables = [makeTable({ next: { joined, later } })];
    expect(splitTableAtCuts(tables, 'joined', [0.35], MIN, idFactory())).toBe(
      tables
    );
  });

  it('returns the list by reference for the root of a linked group', () => {
    const joined = makeTable({ tableId: 'joined', pdfPage: 1 });
    const tables = [makeTable({ next: { joined } })];
    expect(splitTableAtCuts(tables, 'orig', [0.35], MIN, idFactory())).toBe(
      tables
    );
  });
});

describe('isLastInLinkGroup', () => {
  const first = { tableId: 'm1', pdfPage: 1, tableInPage: 0 };
  const second = { tableId: 'm2', pdfPage: 1, tableInPage: 1 };
  const third = { tableId: 'm3', pdfPage: 2, tableInPage: 0 };
  const root = {
    tableId: 'root',
    pdfPage: 0,
    tableInPage: 0,
    next: { m3: third, m1: first, m2: second },
  };
  const loose = { tableId: 'loose', pdfPage: 3, tableInPage: 0, next: null };
  const tables = [root, loose];

  it('is true for the member no other member of its group comes after', () => {
    expect(isLastInLinkGroup(tables, 'm3')).toBe(true);
  });

  it('is false for a member another member comes after', () => {
    expect(isLastInLinkGroup(tables, 'm1')).toBe(false);
    expect(isLastInLinkGroup(tables, 'm2')).toBe(false);
  });

  it('is false for a root, a table in no group and an unknown id', () => {
    expect(isLastInLinkGroup(tables, 'root')).toBe(false);
    expect(isLastInLinkGroup(tables, 'loose')).toBe(false);
    expect(isLastInLinkGroup(tables, 'missing')).toBe(false);
  });

  it('is true for the only member of a group', () => {
    expect(isLastInLinkGroup([{ ...root, next: { m1: first } }], 'm1')).toBe(true);
  });
});

describe('splitTableAtCuts on the last table in a linked group', () => {
  const first = {
    tableId: 'm1',
    name: 'Page 2 Table 1',
    pdfPage: 1,
    tableInPage: 0,
    bounds: { left: 0.1, top: 0.0, width: 0.4, height: 0.1 },
  };
  const member = makeTable({
    tableId: 'm2',
    name: 'Page 2 Table 2',
    pdfPage: 1,
    tableInPage: 1,
  });
  delete member.grid;
  const grid = [['root'], ['m1'], ['m2']];
  const root = {
    tableId: 'root',
    name: 'Page 1 Table 1',
    pdfPage: 0,
    tableInPage: 0,
    bounds: { left: 0, top: 0.05, width: 0.1, height: 0.1 },
    next: { m1: first, m2: member },
    grid,
  };
  const samePageEarlier = {
    tableId: 'p0',
    pdfPage: 0,
    tableInPage: 1,
    bounds: { left: 0, top: 0.5, width: 0.1, height: 0.1 },
  };
  const below = {
    tableId: 'below',
    name: 'Page 2 Table 3',
    pdfPage: 1,
    tableInPage: 2,
    bounds: { left: 0, top: 0.8, width: 0.1, height: 0.1 },
  };
  const nextPage = {
    tableId: 'np',
    pdfPage: 2,
    tableInPage: 0,
    bounds: { left: 0, top: 0.1, width: 0.1, height: 0.1 },
  };
  const tables = [root, samePageEarlier, below, nextPage];
  const result = splitTableAtCuts(tables, 'm2', [0.35, 0.45], MIN, idFactory());

  it('keeps the top piece in the root next map under the same id', () => {
    const newRoot = result.find((t) => t.tableId === 'root');
    expect(Object.keys(newRoot.next).sort()).toEqual(['m1', 'm2']);
    expect(newRoot.next.m1).toBe(first);
    const top = newRoot.next.m2;
    expect(top.tableId).toBe('m2');
    expect(top.name).toBe(member.name);
    expect(top.bounds.top).toBe(member.bounds.top);
    expect(top.bounds.height).toBeCloseTo(0.15, 10);
  });

  it('leaves the root grid unchanged', () => {
    expect(result.find((t) => t.tableId === 'root').grid).toBe(grid);
  });

  it('places the new pieces at the top level in document order', () => {
    expect(result.map((t) => t.tableId)).toEqual([
      'root',
      'p0',
      'n1',
      'n2',
      'below',
      'np',
    ]);
    expect(result[1]).toBe(samePageEarlier);
    expect(result[4]).toBe(below);
    expect(result[5]).toBe(nextPage);
  });

  it('gives each new piece a fresh name and a rank between its neighbours', () => {
    const [p1, p2] = [result[2], result[3]];
    expect(p1.next).toBeNull();
    expect(p2.next).toBeNull();
    expect(p1.name).toBe(pageTableName(1, 3));
    expect(p2.name).toBe(pageTableName(1, 4));
    expect(p1.tableInPage).toBeGreaterThan(member.tableInPage);
    expect(p2.tableInPage).toBeGreaterThan(p1.tableInPage);
    expect(p2.tableInPage).toBeLessThan(below.tableInPage);
  });

  it('keeps splitBottomRow on the bottom piece only', () => {
    const withSplit = splitTableAtCuts(
      [
        {
          ...root,
          next: { m1: first, m2: { ...member, splitBottomRow: true } },
        },
      ],
      'm2',
      [0.35],
      MIN,
      idFactory()
    );
    expect(withSplit[0].next.m2.splitBottomRow).toBe(false);
    expect(withSplit[1].splitBottomRow).toBe(true);
  });
});

describe.each([
  ['one cut', [0.35], 2],
  ['two cuts', [0.45, 0.35], 3],
])('splitTableAtCuts with %s', (_label, lines, count) => {
  const before = {
    tableId: 'before',
    pdfPage: 0,
    tableInPage: -1,
    bounds: { left: 0, top: 0.05, width: 0.1, height: 0.1 },
  };
  const after = {
    tableId: 'after',
    pdfPage: 0,
    tableInPage: 1,
    bounds: { left: 0, top: 0.7, width: 0.1, height: 0.1 },
  };
  const original = makeTable();
  const tables = [before, original, after];
  const newId = idFactory();
  const result = splitTableAtCuts(tables, 'orig', lines, MIN, newId);
  const pieces = result.slice(1, 1 + count);

  it('places the pieces after the top piece with the neighbours untouched', () => {
    expect(result).toHaveLength(2 + count);
    expect(result[0]).toBe(before);
    expect(result[result.length - 1]).toBe(after);
    const tops = pieces.map((p) => p.bounds.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it('keeps the original identity on the top piece only', () => {
    const [top, ...rest] = pieces;
    expect(top.tableId).toBe('orig');
    expect(top.name).toBe(original.name);
    expect(top.title).toBe(original.title);
    expect(top.tableInPage).toBe(original.tableInPage);
    expect(top.grid).toBe(original.grid);
    expect(top.confirmationStage).toBe(original.confirmationStage);
    const ids = rest.map((p) => p.tableId);
    expect(new Set(ids).size).toBe(rest.length);
    expect(ids).not.toContain('orig');
    const names = rest.map((p) => p.name);
    expect(new Set([...names, original.name]).size).toBe(count);
    names.forEach((n, i) => expect(n).toBe(pageTableName(0, 3 + i)));
    const ranks = pieces.map((p) => p.tableInPage);
    expect(new Set([...ranks, before.tableInPage, after.tableInPage]).size).toBe(
      count + 2
    );
    rest.forEach((p) => {
      expect(p.title).toBeNull();
      expect(p.headerCount).toBe(0);
      expect(p.next).toBeNull();
      expect(p.confirmationStage).toBeNull();
      expect('grid' in p).toBe(false);
      expect(p.extractionMechanism).toBe(original.extractionMechanism);
      expect(p.confidence).toBe(original.confidence);
    });
  });

  it('clamps the top piece header count to its rows', () => {
    expect(pieces[0].headerCount).toBe(
      Math.min(original.headerCount, pieces[0].rowHeights.length)
    );
  });

  it('keeps the columns and makes neighbours abut exactly', () => {
    pieces.forEach((p) => {
      expect(p.bounds.left).toBe(original.bounds.left);
      expect(p.bounds.width).toBe(original.bounds.width);
      expect(p.columnWidths).toEqual(original.columnWidths);
    });
    const total = pieces.reduce((acc, p) => acc + p.bounds.height, 0);
    expect(total).toBeCloseTo(0.3, 10);
    for (let i = 1; i < pieces.length; i += 1) {
      const upper = pieces[i - 1];
      expect(pieces[i].bounds.top).toBe(upper.bounds.top + sumValues(upper.rowHeights));
      expect(overlapArea(upper.bounds, pieces[i].bounds)).toBe(0);
    }
  });

  it('keeps row 0 cells and zeroes the cut row 1 cells', () => {
    const top = pieces[0];
    expect(cellAtIndex(top, 0, 0)).toMatchObject({ text: 'r0c0', confidence: 90 });
    expect(cellAtIndex(top, 0, 1)).toMatchObject({ text: 'r0c1', confidence: 90 });
    expect(cellAtIndex(top, 1, 0).confidence).toBe(0);
    expect(cellAtIndex(pieces[1], 0, 0).confidence).toBe(0);
    expect(cellAtIndex(pieces[1], 0, 1).confidence).toBe(0);
  });

  it('moves the footer and section title with row 2 into the bottom piece', () => {
    const bottom = pieces[pieces.length - 1];
    const lastRow = bottom.rowHeights.length - 1;
    expect(bottom.footer).toEqual({ row: lastRow, column: 0 });
    expect(bottom.sectionTitles).toEqual([{ tableRow: lastRow, data: 'Section' }]);
    expect(pieces[0].footer).toBeNull();
    expect(pieces[0].sectionTitles).toEqual([]);
  });

  it('leaves the input list and original unmodified', () => {
    expect(tables).toEqual([before, makeTable(), after]);
  });
});

describe('splitTableAtCuts splitBottomRow', () => {
  it('keeps splitBottomRow on the bottom piece only', () => {
    const tables = [makeTable({ splitBottomRow: true })];
    const result = splitTableAtCuts(tables, 'orig', [0.35, 0.45], MIN, idFactory());
    expect(result.map((p) => p.splitBottomRow)).toEqual([false, false, true]);
  });
});

describe('splitTableAtCuts on a row crossed by a cut', () => {
  it('keeps the footer and section title on the lowest piece holding the row', () => {
    const tables = [makeTable()];
    const result = splitTableAtCuts(tables, 'orig', [0.35, 0.45], MIN, idFactory());
    const [top, middle, bottom] = result;
    expect(top.footer).toBeNull();
    expect(top.sectionTitles).toEqual([]);
    expect(middle.footer).toBeNull();
    expect(middle.sectionTitles).toEqual([]);
    expect(bottom.footer).toEqual({ row: 0, column: 0 });
    expect(bottom.sectionTitles).toEqual([{ tableRow: 0, data: 'Section' }]);
  });

  it('keeps a crossed row section title and footer on the lower piece only', () => {
    const tables = [
      makeTable({
        footer: { row: 1, column: 0 },
        sectionTitles: [{ tableRow: 1, data: 'Section' }],
      }),
    ];
    const [top, bottom] = splitTableAtCuts(tables, 'orig', [0.35], MIN, idFactory());
    expect(top.footer).toBeNull();
    expect(top.sectionTitles).toEqual([]);
    expect(bottom.footer).toEqual({ row: 0, column: 0 });
    expect(bottom.sectionTitles).toEqual([{ tableRow: 0, data: 'Section' }]);
  });
});
