import { reviewEditedCellConfidence } from 'config';
import {
  MERGE_ROLE_JOINED,
  MERGE_ROLE_ROOT,
  buildCalcCellsRequestTable,
  clampToUnitPage,
  buildCalcHint,
  buildRecalcHint,
  changedColouredAreaRects,
  zeroConfidenceInRects,
  cellSpanSignature,
  gridSquareAtFraction,
  gridSquareBounds,
  mergeCalcCellsResponse,
  mergeFindGridLines,
  mapAllTables,
  mergeMap,
  mergeRolesByTableId,
  mergeTargetSpan,
  mergedCellCovering,
  mergedCellLimits,
  mergedCells,
  metadataTableToThumbnailOverlay,
  overlapArea,
  findTableById,
  reconcileAxisEdit,
  replaceTableById,
  specialAreaEntries,
  splitEntryAt,
  splitMap,
  splitMapBelow,
  tableSizeLabel,
  tablesOnPage,
  tablesWithLostConfidence,
  titlesEqual,
  withCellSpan,
  leadingSquaresBounds,
  linkedTablesWithParents,
  additionalTables,
  tableSetChanged,
  linkLabelText,
  canJoinLinkGroup,
  removeFromLinkGroup,
  LINK_LABEL_END_LINKING,
  LINK_LABEL_ROOT,
  LINK_LABEL_JOINED,
  LINK_LABEL_PLAIN,
} from 'components/pdfTableViewer/tableSupportUtils';

// A metadata table whose bounds already equal its column/row sums, so the idempotent
// normaliseTableBounds pass leaves the geometry untouched and overlap/order assertions hold.
function tbl(id, page, left, top, w, h, extra = {}) {
  return {
    tableId: id,
    name: id,
    pdfPage: page,
    tableInPage: 0,
    bounds: { left, top, width: w, height: h },
    columnWidths: [{ value: w, confidence: 90 }],
    rowHeights: [{ value: h, confidence: 90 }],
    cells: [],
    title: null,
    ...extra,
  };
}

// A find-grid-lines response table. tableInPage is intentionally junk — it must NOT be used
// for matching any more.
function ret(left, top, w, h) {
  return {
    tableInPage: 99,
    bounds: { left, top, width: w, height: h },
    columnWidths: [{ value: w, confidence: 80 }],
    rowHeights: [{ value: h, confidence: 80 }],
  };
}

// A 2x2 metadata table for the hint builders: bounds equal the axis sums so the grid-line
// cell bounds the hints carry are exact.
const hintTable = {
  name: 'Table 1',
  tableInPage: 2,
  bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
  columnWidths: [
    { value: 0.15, confidence: 90 },
    { value: 0.15, confidence: 90 },
  ],
  rowHeights: [
    { value: 0.2, confidence: 90 },
    { value: 0.2, confidence: 90 },
  ],
};

// A page's coloured-area hints, in the ColouredAreaHint shape (fractions + #RRGGBB).
const areas = [
  {
    left: 0.11,
    top: 0.21,
    width: 0.05,
    height: 0.05,
    foreground: '#000000',
    background: '#ffff00',
  },
];

describe('overlapArea', () => {
  it('is the intersection area, or 0 when the rectangles are disjoint or edge-touching', () => {
    expect(
      overlapArea(
        { left: 0, top: 0, width: 0.4, height: 0.4 },
        { left: 0.2, top: 0.2, width: 0.4, height: 0.4 }
      )
    ).toBeCloseTo(0.2 * 0.2, 10);
    // Disjoint.
    expect(
      overlapArea(
        { left: 0, top: 0, width: 0.1, height: 0.1 },
        { left: 0.5, top: 0.5, width: 0.1, height: 0.1 }
      )
    ).toBe(0);
    // Edge-touching (zero-width intersection) is not an overlap.
    expect(
      overlapArea(
        { left: 0, top: 0, width: 0.1, height: 0.1 },
        { left: 0.1, top: 0, width: 0.1, height: 0.1 }
      )
    ).toBe(0);
  });
});

describe('titlesEqual', () => {
  const t = (text) => ({
    bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.05 },
    text,
    confidence: 80,
  });
  it('treats null/null as equal and null/value as unequal', () => {
    expect(titlesEqual(null, null)).toBe(true);
    expect(titlesEqual(null, t('x'))).toBe(false);
    expect(titlesEqual(t('x'), null)).toBe(false);
  });
  it('compares text, confidence and bounds', () => {
    expect(titlesEqual(t('x'), t('x'))).toBe(true);
    expect(titlesEqual(t('x'), t('y'))).toBe(false);
    expect(
      titlesEqual(t('x'), { ...t('x'), bounds: { left: 0.9, top: 0, width: 0.1, height: 0.1 } })
    ).toBe(false);
  });
});

describe('mergeFindGridLines — bounds-overlap matching', () => {
  it('replaces the geometry of the overlapping table, keeping its identity', () => {
    const tables = [tbl('A', 0, 0, 0, 0.2, 0.2)];
    const result = mergeFindGridLines(tables, 0, [ret(0.1, 0.1, 0.4, 0.4)]);
    expect(result).toHaveLength(1);
    const a = result.find((t) => t.tableId === 'A');
    expect(a).toBeDefined();
    expect(a.name).toBe('A');
    expect(a.bounds.left).toBeCloseTo(0.1, 10);
    expect(a.bounds.top).toBeCloseTo(0.1, 10);
    expect(a.bounds.width).toBeCloseTo(0.4, 10);
  });

  it('appends a returned table that overlaps no existing table', () => {
    const tables = [tbl('A', 0, 0, 0, 0.1, 0.1)];
    const result = mergeFindGridLines(tables, 0, [ret(0.5, 0.5, 0.2, 0.2)]);
    expect(result).toHaveLength(2);
    const added = result.find((t) => t.tableId !== 'A');
    expect(added.name).toBe('');
    expect(added.pdfPage).toBe(0);
    expect(added.bounds.left).toBeCloseTo(0.5, 10);
  });

  it('matches the biggest-overlap table and HARD-deletes the other overlapped tables', () => {
    // Returned rect [0..0.3]x[0..0.3] fully covers A (area 0.09) and clips B (area 0.05*0.3).
    const tables = [
      tbl('A', 0, 0, 0, 0.3, 0.3),
      tbl('B', 0, 0.25, 0, 0.1, 0.3),
    ];
    const result = mergeFindGridLines(tables, 0, [ret(0, 0, 0.3, 0.3)]);
    // B removed entirely (hard delete), only the matched A remains.
    expect(result.map((t) => t.tableId)).toEqual(['A']);
  });

  it('never matches or hard-deletes a soft-deleted table (soft delete = manual deselection)', () => {
    const tables = [
      tbl('A', 0, 0, 0, 0.3, 0.3, { deleted: true }),
      tbl('B', 0, 0, 0, 0.1, 0.1),
    ];
    const result = mergeFindGridLines(tables, 0, [ret(0, 0, 0.3, 0.3)]);
    // A (soft-deleted) is preserved untouched; B is the match (geometry replaced).
    const a = result.find((t) => t.tableId === 'A');
    expect(a).toBeDefined();
    expect(a.deleted).toBe(true);
    expect(a.bounds.width).toBeCloseTo(0.3, 10); // its own original geometry, not the returned one
    const b = result.find((t) => t.tableId === 'B');
    expect(b.bounds.width).toBeCloseTo(0.3, 10); // replaced with the returned geometry
  });

  it('appends when the only overlapped table is soft-deleted', () => {
    const tables = [tbl('A', 0, 0, 0, 0.2, 0.2, { deleted: true })];
    const result = mergeFindGridLines(tables, 0, [ret(0, 0, 0.2, 0.2)]);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.tableId === 'A').deleted).toBe(true);
    expect(result.find((t) => t.tableId !== 'A').name).toBe('');
  });

  it('re-derives tableInPage by bounds.top then bounds.left across the page live tables', () => {
    const tables = [
      tbl('A', 0, 0, 0.5, 0.1, 0.1, { tableInPage: 5 }), // lower on the page
      tbl('X', 1, 0, 0, 0.1, 0.1, { tableInPage: 3 }), // other page — untouched
    ];
    // Appended returned table sits at the top-left.
    const result = mergeFindGridLines(tables, 0, [ret(0, 0, 0.1, 0.1)]);
    const a = result.find((t) => t.tableId === 'A');
    const added = result.find((t) => t.tableId !== 'A' && t.pdfPage === 0);
    const x = result.find((t) => t.tableId === 'X');
    expect(added.tableInPage).toBe(0); // top 0
    expect(a.tableInPage).toBe(1); // top 0.5
    expect(x.tableInPage).toBe(3); // other page unchanged
  });

  it('breaks a tableInPage tie on bounds.left', () => {
    const tables = [
      tbl('R', 0, 0.5, 0, 0.1, 0.1),
      tbl('L', 0, 0.0, 0, 0.1, 0.1),
    ];
    const result = mergeFindGridLines(tables, 0, []); // no returned tables: pure re-index
    expect(result.find((t) => t.tableId === 'L').tableInPage).toBe(0);
    expect(result.find((t) => t.tableId === 'R').tableInPage).toBe(1);
  });
});

describe('mergeFindGridLines — cells left stale by the new grid', () => {
  // A find-grid-lines response table with a real interior grid: `cols`/`rows` are the axis
  // sizes, and the bounds are their sums so the normalise pass is a no-op.
  const retGrid = (left, top, cols, rows) => ({
    tableInPage: 99,
    bounds: {
      left,
      top,
      width: cols.reduce((a, v) => a + v, 0),
      height: rows.reduce((a, v) => a + v, 0),
    },
    columnWidths: cols.map((value) => ({ value, confidence: 80 })),
    rowHeights: rows.map((value) => ({ value, confidence: 80 })),
  });

  // The cell a freshly drawn manual border carries: one 1x1 cell covering the whole border.
  const placeholder = (bounds, extra = {}) => ({
    row: 0,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    bounds,
    text: '',
    confidence: 0,
    header: false,
    ...extra,
  });

  const border = { left: 0.1, top: 0.2, width: 0.3, height: 0.2 };

  it("re-seats a manual border's full-width placeholder onto its detected grid square", () => {
    const tables = [
      tbl('M', 0, 0.1, 0.2, 0.3, 0.2, { cells: [placeholder(border)] }),
    ];
    const result = mergeFindGridLines(tables, 0, [
      retGrid(0.1, 0.2, [0.1, 0.1, 0.1], [0.1, 0.1]),
    ]);
    const m = result.find((t) => t.tableId === 'M');
    expect(m.cells).toHaveLength(6); // every square of the 3x2 grid has a cell
    const a1 = m.cells.find((c) => c.row === 0 && c.column === 0);
    expect(a1.bounds.left).toBeCloseTo(0.1, 10);
    expect(a1.bounds.top).toBeCloseTo(0.2, 10);
    expect(a1.bounds.width).toBeCloseTo(0.1, 10); // the square, NOT the 0.3-wide border
    expect(a1.bounds.height).toBeCloseTo(0.1, 10);
  });

  // A cell that carries text is kept — discarding real extracted text is not this merge's
  // job — but it is re-seated onto its new square and its confidence is dropped, because
  // the text is now a claim about a different piece of the page.
  it('re-seats a cell that carries text, keeping the text and zeroing its confidence', () => {
    const tables = [
      tbl('T', 0, 0.1, 0.2, 0.3, 0.2, {
        cells: [placeholder(border, { text: 'Total', confidence: 90 })],
      }),
    ];
    const result = mergeFindGridLines(tables, 0, [
      retGrid(0.1, 0.2, [0.1, 0.1, 0.1], [0.1, 0.1]),
    ]);
    const a1 = result
      .find((t) => t.tableId === 'T')
      .cells.find((c) => c.row === 0 && c.column === 0);
    expect(a1.text).toBe('Total');
    expect(a1.confidence).toBe(0);
    expect(a1.bounds.width).toBeCloseTo(0.1, 10); // the square, NOT the 0.3-wide border
    expect(a1.bounds.height).toBeCloseTo(0.1, 10);
  });

  // The other half of the rule: a square that did not move leaves its cell completely
  // alone, tighter OCR box and confidence included. Without this a re-detect that changed
  // nothing would still redden every cell in the table.
  it('leaves a cell carrying text untouched when its square did not move', () => {
    const ocrBox = { left: 0.12, top: 0.22, width: 0.05, height: 0.03 };
    const tables = [
      tbl('U', 0, 0.1, 0.2, 0.3, 0.2, {
        cells: [placeholder(ocrBox, { text: 'Total', confidence: 90 })],
      }),
    ];
    const result = mergeFindGridLines(tables, 0, [retGrid(0.1, 0.2, [0.3], [0.2])]);
    const a1 = result
      .find((t) => t.tableId === 'U')
      .cells.find((c) => c.row === 0 && c.column === 0);
    expect(a1.confidence).toBe(90);
    expect(a1.bounds).toEqual(ocrBox);
  });

  // The reported failure. A re-detected grid that loses its top row leaves every retained
  // cell anchored one row BELOW the strip its bounds describe. cell.bounds is what
  // buildCalcCellsRequestTable sends as the region to read, so a cell left on its old
  // square made the next Calculate read the row above it — copying each row's text into
  // the row below and never reading the table's last row at all.
  it('re-seats every cell when the detected grid loses a row off the top', () => {
    const rows = [0.1, 0.1, 0.1];
    const cellsAt = (top) =>
      rows.map((_, row) =>
        placeholder(
          { left: 0.1, top: top + row * 0.1, width: 0.3, height: 0.1 },
          { row, text: `r${row}`, confidence: 90 }
        )
      );
    const tables = [
      tbl('G', 0, 0.1, 0.2, 0.3, 0.3, {
        columnWidths: [{ value: 0.3, confidence: 90 }],
        rowHeights: rows.map((value) => ({ value, confidence: 90 })),
        cells: cellsAt(0.2),
      }),
    ];
    // The same table with its top row gone: two rows, starting 0.1 lower.
    const result = mergeFindGridLines(tables, 0, [
      retGrid(0.1, 0.3, [0.3], [0.1, 0.1]),
    ]);
    const cells = result
      .find((t) => t.tableId === 'G')
      .cells.slice()
      .sort((a, b) => a.row - b.row);

    // Row 2 is outside the two-row grid and is gone; the survivors sit on their own
    // squares rather than one row above them.
    expect(cells.map((c) => c.row)).toEqual([0, 1]);
    expect(cells[0].bounds.top).toBeCloseTo(0.3, 10);
    expect(cells[1].bounds.top).toBeCloseTo(0.4, 10);
    // And they say so: what they hold was read from somewhere else.
    expect(cells.map((c) => c.confidence)).toEqual([0, 0]);
    expect(cells.map((c) => c.text)).toEqual(['r0', 'r1']);
  });

  it('keeps an empty cell whose grid square did not move', () => {
    const tables = [
      tbl('S', 0, 0.1, 0.2, 0.3, 0.2, {
        cells: [placeholder(border, { header: true })],
      }),
    ];
    const result = mergeFindGridLines(tables, 0, [retGrid(0.1, 0.2, [0.3], [0.2])]);
    const cells = result.find((t) => t.tableId === 'S').cells;
    expect(cells).toHaveLength(1);
    expect(cells[0].header).toBe(true); // the original cell, not a fresh default
  });

  it('drops a cell anchored outside the new grid', () => {
    const tables = [
      tbl('O', 0, 0.1, 0.2, 0.3, 0.2, {
        cells: [
          placeholder(border),
          placeholder(border, { row: 1, column: 1, header: true }),
        ],
      }),
    ];
    const result = mergeFindGridLines(tables, 0, [retGrid(0.1, 0.2, [0.3], [0.2])]);
    const cells = result.find((t) => t.tableId === 'O').cells;
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ row: 0, column: 0 });
  });
});

describe('buildCalcHint — optional coloured areas', () => {
  it('returns only the identity, bounds and expected counts when called with three arguments', () => {
    const hint = buildCalcHint(hintTable, '10', '2');
    expect(hint).toEqual({
      name: 'Table 1',
      tableInPage: 2,
      left: 0.1,
      top: 0.2,
      width: 0.3,
      height: 0.4,
      expectedRows: 10,
      expectedColumns: 2,
    });
    expect(hint).not.toHaveProperty('colouredAreas');
  });

  it('carries a non-empty coloured-areas list', () => {
    expect(buildCalcHint(hintTable, '', '', areas).colouredAreas).toEqual(areas);
  });

  it('omits colouredAreas for an empty list', () => {
    expect(buildCalcHint(hintTable, '', '', [])).not.toHaveProperty(
      'colouredAreas'
    );
    expect(buildCalcHint(hintTable, '', '', null)).not.toHaveProperty(
      'colouredAreas'
    );
  });
});

describe('buildRecalcHint — optional coloured areas and expected counts', () => {
  const redCell = { row: 1, column: 0, confidence: 0 };

  it('returns only the identity, bounds and cells when called with two arguments', () => {
    const hint = buildRecalcHint(hintTable, [redCell]);
    expect(hint).toEqual({
      name: 'Table 1',
      tableInPage: 2,
      left: 0.1,
      top: 0.2,
      width: 0.3,
      height: 0.4,
      cells: [
        {
          row: 1,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          bounds: { left: 0.1, top: 0.4, width: 0.15, height: 0.2 },
        },
      ],
    });
    expect(hint).not.toHaveProperty('colouredAreas');
    expect(hint).not.toHaveProperty('expectedColumns');
    expect(hint).not.toHaveProperty('expectedRows');
  });

  it('carries a non-empty coloured-areas list and omits the key for an empty one', () => {
    expect(buildRecalcHint(hintTable, [redCell], areas).colouredAreas).toEqual(
      areas
    );
    expect(buildRecalcHint(hintTable, [redCell], [])).not.toHaveProperty(
      'colouredAreas'
    );
  });

  it('carries expected counts as Numbers, omitting blank and nullish ones', () => {
    const both = buildRecalcHint(hintTable, [redCell], null, '3', '12');
    expect(both.expectedColumns).toBe(3);
    expect(both.expectedRows).toBe(12);
    const blank = buildRecalcHint(hintTable, [redCell], null, '', null);
    expect(blank).not.toHaveProperty('expectedColumns');
    expect(blank).not.toHaveProperty('expectedRows');
    // One supplied, the other blank.
    const colsOnly = buildRecalcHint(hintTable, [redCell], null, 4, '');
    expect(colsOnly.expectedColumns).toBe(4);
    expect(colsOnly).not.toHaveProperty('expectedRows');
  });
});

describe('metadataTableToThumbnailOverlay', () => {
  // A page-fraction metadata table: half the page wide and half its height, offset in
  // from the top-left, with two columns and one row.
  const metaTable = {
    tableId: 'id-1',
    name: 'Losses',
    bounds: { left: 0.1, top: 0.25, width: 0.5, height: 0.5 },
    columnWidths: [
      { value: 0.25, confidence: 90 },
      { value: 0.25, confidence: 10 },
    ],
    rowHeights: [{ value: 0.5, confidence: 70 }],
  };

  it('scales the X axis by the pixel width and the Y axis by the pixel height', () => {
    const t = metadataTableToThumbnailOverlay(metaTable, 200, 400);
    expect(t.left).toBe(20);
    expect(t.top).toBe(100);
    expect(t.width).toBe(100);
    expect(t.height).toBe(200);
  });

  it('maps the axis values to pixels and drops their confidences', () => {
    const t = metadataTableToThumbnailOverlay(metaTable, 200, 400);
    expect(t.columnWidths).toEqual([50, 50]);
    expect(t.rowHeights).toEqual([200]);
    // The thumbnails no longer draw confidence-derived detail.
    expect(t).not.toHaveProperty('rowConfidences');
  });

  it('carries the name and tableId through', () => {
    const t = metadataTableToThumbnailOverlay(metaTable, 200, 400);
    expect(t.name).toBe('Losses');
    expect(t.tableId).toBe('id-1');
  });

  it('produces no NaN for a zero or missing pixel dimension', () => {
    const zero = metadataTableToThumbnailOverlay(metaTable, 0, 0);
    const missing = metadataTableToThumbnailOverlay(metaTable);
    for (const t of [zero, missing]) {
      for (const v of [t.left, t.top, t.width, t.height]) {
        expect(Number.isNaN(v)).toBe(false);
      }
      for (const v of [...t.columnWidths, ...t.rowHeights]) {
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });

  it('tolerates absent columnWidths and rowHeights', () => {
    const t = metadataTableToThumbnailOverlay(
      { tableId: 'id-2', name: '', bounds: metaTable.bounds },
      200,
      400
    );
    expect(t.columnWidths).toEqual([]);
    expect(t.rowHeights).toEqual([]);
  });
});

// ---- calculate-cells: request builder, specials order and text merge ---------------------
//
// calculate-cells reads text only: every rectangle it is handed is taken as correct and the
// response carries no geometry. The request builder and the merge are therefore a matched
// pair, and the specials order is the contract between them.
describe('calculate-cells request/merge helpers', () => {
  const CELL_BOUNDS = {
    '0,0': { left: 0.1, top: 0.2, width: 0.15, height: 0.2 },
    '0,1': { left: 0.25, top: 0.2, width: 0.15, height: 0.2 },
    '1,0': { left: 0.1, top: 0.4, width: 0.15, height: 0.2 },
  };

  const cell = (row, column, text, confidence) => ({
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    bounds: CELL_BOUNDS[`${row},${column}`],
    text,
    confidence,
    header: false,
  });

  // A fully-furnished 2x2 metadata table: three cells (the fourth square deliberately has no
  // cell, as the sparse backend list allows), a title, two section-title rows — the second
  // WITHOUT a data area — and a footer.
  const calcTable = (extra = {}) => ({
    tableId: 'ct-1',
    name: 'Calc Table',
    pdfPage: 0,
    tableInPage: 1,
    confirmationStage: 3,
    bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    columnWidths: [
      { value: 0.15, confidence: 90 },
      { value: 0.15, confidence: 90 },
    ],
    rowHeights: [
      { value: 0.2, confidence: 90 },
      { value: 0.2, confidence: 90 },
    ],
    cells: [cell(0, 0, 'a', 20), cell(0, 1, 'b', 30), cell(1, 0, 'c', 40)],
    title: {
      bounds: { left: 0.1, top: 0.15, width: 0.3, height: 0.04 },
      text: 'Old Title',
      confidence: 33,
    },
    sectionTitles: [
      {
        tableRow: 1,
        delete: false,
        columnName: null,
        data: {
          bounds: { left: 0.1, top: 0.4, width: 0.3, height: 0.05 },
          text: 'Old Section',
          confidence: 11,
        },
      },
      { tableRow: 2, delete: false, columnName: null },
    ],
    footer: {
      row: 2,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      bounds: { left: 0.1, top: 0.6, width: 0.3, height: 0.05 },
      text: 'Old Footer',
      confidence: 7,
      header: false,
    },
    ...extra,
  });

  // The finders refuse a hint that strays outside the unit page at all, and a drag that
  // began a pixel off the image edge produces exactly that — a section-title area at
  // left = -0.0059 took down every calculate-cells call its page made.
  describe('clampToUnitPage', () => {
    it('leaves a rectangle already inside the page alone', () => {
      const bounds = { left: 0.1, top: 0.2, width: 0.3, height: 0.4 };
      expect(clampToUnitPage(bounds)).toEqual(bounds);
    });

    it('trims an overhanging edge and keeps the edge that is inside', () => {
      expect(
        clampToUnitPage({ left: -0.006, top: 0.18, width: 0.123, height: 0.04 })
      ).toEqual({
        left: 0,
        top: 0.18,
        // The right edge stood at 0.117 and stays there: only the overhang goes.
        width: 0.11699999999999999,
        height: 0.04,
      });
    });

    it('is exactly identity for a rectangle it does not have to trim', () => {
      // Not merely equal: the same numbers. Recomputing a width from its edges loses a few
      // ulps, and every rectangle the editor sends goes through here.
      const bounds = { left: 0.30000000000000004, top: 0.1, width: 0.3, height: 0.4 };
      expect(clampToUnitPage(bounds).width).toBe(0.3);
      expect(clampToUnitPage(bounds).left).toBe(0.30000000000000004);
    });

    it('trims an overhang past the far edge too', () => {
      expect(
        clampToUnitPage({ left: 0.9, top: 0.9, width: 0.3, height: 0.3 })
      ).toEqual({ left: 0.9, top: 0.9, width: 0.09999999999999998, height: 0.09999999999999998 });
    });

    it('gives a rectangle wholly outside the page no area', () => {
      // Nothing of it is on the page, so there is nothing to read; the finders refuse a
      // zero-area rectangle in turn, which is the right answer rather than a silent guess.
      const clamped = clampToUnitPage({ left: -0.5, top: -0.5, width: 0.2, height: 0.2 });
      expect(clamped.width).toBe(0);
      expect(clamped.height).toBe(0);
    });
  });

  describe('buildCalcCellsRequestTable', () => {
    it('trims a stored special area that strays off the page', () => {
      // The draw path trims new rectangles, but a document saved before it did carries one
      // for good: trimming on the way out is what stops it failing every call.
      const request = buildCalcCellsRequestTable(
        calcTable({
          sectionTitles: [
            {
              tableRow: 1,
              delete: false,
              columnName: null,
              data: {
                bounds: { left: -0.006, top: 0.4, width: 0.3, height: 0.05 },
                text: null,
                confidence: null,
              },
            },
          ],
        })
      );
      expect(request.specials[0].left).toBe(0);
      expect(request.specials[0].width).toBeCloseTo(0.294, 10);
    });

    it('emits the table bounds, tableInPage and one entry per cell with its own bounds', () => {
      const request = buildCalcCellsRequestTable(calcTable());
      expect(request.left).toBeCloseTo(0.1, 10);
      expect(request.top).toBeCloseTo(0.2, 10);
      expect(request.width).toBeCloseTo(0.3, 10);
      expect(request.height).toBeCloseTo(0.4, 10);
      expect(request.tableInPage).toBe(1);
      expect(request.cells).toEqual([
        { ...CELL_BOUNDS['0,0'], row: 0, column: 0 },
        { ...CELL_BOUNDS['0,1'], row: 0, column: 1 },
        { ...CELL_BOUNDS['1,0'], row: 1, column: 0 },
      ]);
      // The response has no geometry to give, so the request sends none of the axes.
      expect(request).not.toHaveProperty('columnWidths');
      expect(request).not.toHaveProperty('rowHeights');
    });

    it('includes the title rectangle only when the table has a title', () => {
      expect(buildCalcCellsRequestTable(calcTable()).title).toEqual({
        left: 0.1,
        top: 0.15,
        width: 0.3,
        height: 0.04,
      });
      expect(
        buildCalcCellsRequestTable(calcTable({ title: null }))
      ).not.toHaveProperty('title');
    });

    it('includes specials as section titles in array order then the footer, and omits the key when there are none', () => {
      const request = buildCalcCellsRequestTable(calcTable());
      expect(request.specials).toEqual([
        { left: 0.1, top: 0.4, width: 0.3, height: 0.05 },
        { left: 0.1, top: 0.6, width: 0.3, height: 0.05 },
      ]);
      const bare = buildCalcCellsRequestTable(
        calcTable({ sectionTitles: null, footer: null })
      );
      expect(bare).not.toHaveProperty('specials');
    });

    it('contributes no special for a section title with no data area', () => {
      const request = buildCalcCellsRequestTable(
        calcTable({
          sectionTitles: [{ tableRow: 2, delete: false, columnName: null }],
          footer: null,
        })
      );
      expect(request).not.toHaveProperty('specials');
    });
  });

  describe('specialAreaEntries', () => {
    it('is the single source of the specials order, tagging each entry with its source', () => {
      const entries = specialAreaEntries(calcTable());
      expect(entries).toEqual([
        {
          kind: 'sectionTitle',
          index: 0,
          bounds: { left: 0.1, top: 0.4, width: 0.3, height: 0.05 },
        },
        {
          kind: 'footer',
          index: null,
          bounds: { left: 0.1, top: 0.6, width: 0.3, height: 0.05 },
        },
      ]);
    });
  });

  describe('mergeCalcCellsResponse', () => {
    it('replaces cell text/confidence by (row, column) and leaves geometry, name and stage alone', () => {
      const table = calcTable();
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [
          { row: 0, column: 1, text: 'Fresh B', confidence: 95 },
          { row: 1, column: 0, text: 'Fresh C', confidence: 91 },
        ],
      });
      const at = (r, c) => merged.cells.find((x) => x.row === r && x.column === c);
      expect(at(0, 1).text).toBe('Fresh B');
      expect(at(0, 1).confidence).toBe(95);
      expect(at(1, 0).text).toBe('Fresh C');
      // Untouched cell keeps its own text, and every cell keeps its rectangle and spans.
      expect(at(0, 0).text).toBe('a');
      expect(at(0, 1).bounds).toEqual(CELL_BOUNDS['0,1']);
      expect(at(0, 1).rowSpan).toBe(1);
      expect(at(0, 1).header).toBe(false);
      // No geometry and none of the editor's own fields move.
      expect(merged.bounds).toEqual(table.bounds);
      expect(merged.columnWidths).toEqual(table.columnWidths);
      expect(merged.rowHeights).toEqual(table.rowHeights);
      expect(merged.name).toBe('Calc Table');
      expect(merged.confirmationStage).toBe(3);
    });

    // A manual correction is recorded at reviewEditedCellConfidence() so the next
    // extraction leaves that region alone; the page-exit re-read has to honour the same
    // mark. Moving a rectangle is not affected — that zeroes the cell's confidence
    // (zeroConfidenceInRects), which takes it off the mark and back into the re-read.
    it('leaves a manually corrected cell alone rather than retyping it from the read', () => {
      const table = calcTable();
      table.cells = [
        { ...table.cells[0], text: 'User typed', confidence: reviewEditedCellConfidence() },
        ...table.cells.slice(1),
      ];
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [
          { row: 0, column: 0, text: 'OCR text', confidence: 60 },
          { row: 0, column: 1, text: 'Fresh B', confidence: 95 },
        ],
      });
      const at = (r, c) => merged.cells.find((x) => x.row === r && x.column === c);
      expect(at(0, 0).text).toBe('User typed');
      expect(at(0, 0).confidence).toBe(reviewEditedCellConfidence());
      // Its neighbours are still re-read: the mark is per cell, not per table.
      expect(at(0, 1).text).toBe('Fresh B');
    });

    it('leaves a manually corrected title alone', () => {
      const table = calcTable();
      table.title = { ...table.title, text: 'User title', confidence: reviewEditedCellConfidence() };
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [],
        title: { text: 'Read Title', confidence: 88 },
      });
      expect(merged.title.text).toBe('User title');
    });

    it('leaves a manually corrected section title and footer alone', () => {
      const table = calcTable();
      table.sectionTitles = [
        { ...table.sectionTitles[0],
          data: { ...table.sectionTitles[0].data, text: 'User section', confidence: reviewEditedCellConfidence() } },
        ...table.sectionTitles.slice(1),
      ];
      table.footer = { ...table.footer, text: 'User footer', confidence: reviewEditedCellConfidence() };
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [],
        specials: [
          { text: 'Read Section', confidence: 71 },
          { text: 'Read Footer', confidence: 72 },
        ],
      });
      expect(merged.sectionTitles[0].data.text).toBe('User section');
      expect(merged.footer.text).toBe('User footer');
    });

    it('updates the title text and confidence but keeps its bounds', () => {
      const table = calcTable();
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [],
        title: { text: 'Read Title', confidence: 88 },
      });
      expect(merged.title.text).toBe('Read Title');
      expect(merged.title.confidence).toBe(88);
      expect(merged.title.bounds).toEqual(table.title.bounds);
    });

    it('maps specials positionally onto the section titles then the footer, keeping bounds', () => {
      const table = calcTable();
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [],
        specials: [
          { text: 'Read Section', confidence: 71 },
          { text: 'Read Footer', confidence: 64 },
        ],
      });
      expect(merged.sectionTitles[0].data.text).toBe('Read Section');
      expect(merged.sectionTitles[0].data.confidence).toBe(71);
      expect(merged.sectionTitles[0].data.bounds).toEqual(
        table.sectionTitles[0].data.bounds
      );
      // The data-less section title is untouched and still has no data.
      expect(merged.sectionTitles[1].data).toBeUndefined();
      expect(merged.footer.text).toBe('Read Footer');
      expect(merged.footer.confidence).toBe(64);
      expect(merged.footer.bounds).toEqual(table.footer.bounds);
    });

    it('changes nothing for a returned cell matching no local cell', () => {
      const table = calcTable();
      const merged = mergeCalcCellsResponse(table, {
        tableInPage: 1,
        cells: [{ row: 7, column: 7, text: 'Nowhere', confidence: 99 }],
      });
      expect(merged.cells).toHaveLength(3);
      expect(merged.cells.map((c) => c.text)).toEqual(['a', 'b', 'c']);
    });
  });
});

// ---- merged cells: grid-square hit testing, span limits and span edits -------------------
//
// A merged cell is a cells entry whose rowSpan or columnSpan exceeds 1, identified by its
// anchor (row, column). These helpers are the whole of the merge arithmetic: the editor only
// wires them to clicks and buttons.
describe('merged-cell helpers', () => {
  // A 3x3 table at (0.1, 0.2) whose squares are all 0.1 x 0.1, so bounds equal the axis sums
  // and every grid square's fraction range is exact.
  const spanTable = (cells = [], extra = {}) => ({
    tableId: 'st-1',
    name: 'Span Table',
    pdfPage: 0,
    tableInPage: 0,
    bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.3 },
    columnWidths: [
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
    ],
    rowHeights: [
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
    ],
    cells,
    ...extra,
  });

  // A cells entry at (row, column) with the given spans, plus whatever else a test needs.
  const spanCell = (row, column, rowSpan, columnSpan, extra = {}) => ({
    row,
    column,
    rowSpan,
    columnSpan,
    bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
    text: 'x',
    confidence: 90,
    header: false,
    ...extra,
  });

  describe('gridSquareAtFraction', () => {
    it('resolves a point inside the table to its grid square', () => {
      expect(gridSquareAtFraction(spanTable(), { fx: 0.25, fy: 0.35 })).toEqual({
        row: 1,
        column: 1,
      });
      expect(gridSquareAtFraction(spanTable(), { fx: 0.15, fy: 0.25 })).toEqual({
        row: 0,
        column: 0,
      });
    });

    it('is null for a point outside the table bounds on any side', () => {
      const t = spanTable();
      expect(gridSquareAtFraction(t, { fx: 0.05, fy: 0.35 })).toBeNull(); // left
      expect(gridSquareAtFraction(t, { fx: 0.45, fy: 0.35 })).toBeNull(); // right
      expect(gridSquareAtFraction(t, { fx: 0.25, fy: 0.15 })).toBeNull(); // above
      expect(gridSquareAtFraction(t, { fx: 0.25, fy: 0.55 })).toBeNull(); // below
    });

    it('clamps a point on the far edge to the last row and column', () => {
      expect(gridSquareAtFraction(spanTable(), { fx: 0.4, fy: 0.5 })).toEqual({
        row: 2,
        column: 2,
      });
    });

    it('is null for a table with no axes', () => {
      const bare = spanTable([], { columnWidths: [], rowHeights: [] });
      expect(gridSquareAtFraction(bare, { fx: 0.25, fy: 0.35 })).toBeNull();
    });
  });

  describe('mergedCells', () => {
    it('is the span-carrying cells in list order, excluding span-1 cells', () => {
      const rowSpanning = spanCell(0, 0, 2, 1);
      const colSpanning = spanCell(1, 1, 1, 2);
      const both = spanCell(2, 0, 2, 3);
      const plain = spanCell(0, 2, 1, 1);
      expect(
        mergedCells(spanTable([plain, rowSpanning, colSpanning, both]))
      ).toEqual([rowSpanning, colSpanning, both]);
    });

    it('is empty for a table with no cells array', () => {
      expect(mergedCells(spanTable([], { cells: undefined }))).toEqual([]);
    });
  });

  describe('mergedCellCovering', () => {
    it('matches at the anchor and at any square the block covers', () => {
      const merged = spanCell(0, 0, 2, 2);
      const t = spanTable([merged, spanCell(2, 2, 1, 1)]);
      expect(mergedCellCovering(t, 0, 0)).toBe(merged);
      expect(mergedCellCovering(t, 1, 1)).toBe(merged);
      expect(mergedCellCovering(t, 0, 1)).toBe(merged);
    });

    it('is null outside the spanned block and when nothing is merged', () => {
      const t = spanTable([spanCell(0, 0, 2, 2)]);
      expect(mergedCellCovering(t, 2, 2)).toBeNull();
      expect(mergedCellCovering(t, 0, 2)).toBeNull();
      expect(mergedCellCovering(spanTable([spanCell(0, 0, 1, 1)]), 0, 0)).toBeNull();
    });
  });

  describe('mergedCellLimits', () => {
    const allFalse = {
      canExtendColumn: false,
      canReduceColumn: false,
      canExtendRow: false,
      canReduceRow: false,
    };

    it('is all false for a null cellRef and for a ref matching no cell', () => {
      const t = spanTable([spanCell(0, 0, 1, 1)]);
      expect(mergedCellLimits(t, null)).toEqual(allFalse);
      expect(mergedCellLimits(t, { row: 2, column: 2 })).toEqual(allFalse);
    });

    it('allows extending and reducing both axes for a 2x2 span in the middle of the grid', () => {
      const t = spanTable([spanCell(0, 0, 2, 2)]);
      expect(mergedCellLimits(t, { row: 0, column: 0 })).toEqual({
        canExtendColumn: true,
        canReduceColumn: true,
        canExtendRow: true,
        canReduceRow: true,
      });
    });

    it('forbids extending past the right or bottom edge of the grid', () => {
      const t = spanTable([spanCell(0, 1, 3, 2), spanCell(1, 0, 2, 3)]);
      // Anchored at column 1 with columnSpan 2 -> reaches column 3 == C, and rowSpan 3 fills R.
      expect(mergedCellLimits(t, { row: 0, column: 1 })).toEqual({
        canExtendColumn: false,
        canReduceColumn: true,
        canExtendRow: false,
        canReduceRow: true,
      });
      // Anchored at row 1 with rowSpan 2 -> reaches row 3 == R, and columnSpan 3 fills C.
      expect(mergedCellLimits(t, { row: 1, column: 0 })).toEqual({
        canExtendColumn: false,
        canReduceColumn: true,
        canExtendRow: false,
        canReduceRow: true,
      });
    });

    it('forbids reducing a span that is already 1', () => {
      const t = spanTable([spanCell(0, 0, 1, 1)]);
      expect(mergedCellLimits(t, { row: 0, column: 0 })).toEqual({
        canExtendColumn: true,
        canReduceColumn: false,
        canExtendRow: true,
        canReduceRow: false,
      });
    });
  });

  describe('withCellSpan', () => {
    it('sets the requested spans on the cell already anchored there', () => {
      const t = spanTable([spanCell(0, 0, 1, 1), spanCell(1, 1, 1, 1)]);
      const next = withCellSpan(t, 1, 1, { rowSpan: 2, columnSpan: 2 });
      expect(next.cells).toHaveLength(2);
      const cell = next.cells.find((c) => c.row === 1 && c.column === 1);
      expect(cell.rowSpan).toBe(2);
      expect(cell.columnSpan).toBe(2);
    });

    it('creates the cell from the grid square when the square had none', () => {
      const t = spanTable([spanCell(0, 0, 1, 1)]);
      const next = withCellSpan(t, 1, 2, { columnSpan: 2 });
      expect(next.cells).toHaveLength(2);
      const cell = next.cells[1];
      expect(cell.row).toBe(1);
      expect(cell.column).toBe(2);
      expect(cell.bounds).toEqual(gridSquareBounds(t, 1, 2));
      expect(cell.text).toBe('');
    });

    it('clamps an over-large span to the remaining grid', () => {
      const t = spanTable([spanCell(1, 1, 1, 1)]);
      const next = withCellSpan(t, 1, 1, { rowSpan: 9, columnSpan: 9 });
      const cell = next.cells[0];
      // Anchored at (1, 1) in a 3x3 grid: at most 2 columns and 2 rows remain.
      expect(cell.columnSpan).toBe(2);
      expect(cell.rowSpan).toBe(2);
    });

    it('clamps a span below 1 up to 1', () => {
      const t = spanTable([spanCell(0, 0, 3, 3)]);
      const next = withCellSpan(t, 0, 0, { rowSpan: 0, columnSpan: -4 });
      expect(next.cells[0].rowSpan).toBe(1);
      expect(next.cells[0].columnSpan).toBe(1);
    });

    it('zeroes the cell confidence so the recalculation re-reads the whole block', () => {
      const t = spanTable([spanCell(0, 0, 1, 1, { confidence: 95 })]);
      expect(withCellSpan(t, 0, 0, { columnSpan: 2 }).cells[0].confidence).toBe(0);
    });

    it('leaves the unsupplied span as it was', () => {
      const t = spanTable([spanCell(0, 0, 2, 1)]);
      const next = withCellSpan(t, 0, 0, { columnSpan: 3 });
      expect(next.cells[0].rowSpan).toBe(2);
      expect(next.cells[0].columnSpan).toBe(3);
    });

    it('does not mutate the input table', () => {
      const t = spanTable([spanCell(0, 0, 1, 1, { confidence: 95 })]);
      const before = JSON.parse(JSON.stringify(t));
      const next = withCellSpan(t, 0, 0, { rowSpan: 2, columnSpan: 2 });
      expect(t).toEqual(before);
      expect(next).not.toBe(t);
      expect(next.cells).not.toBe(t.cells);
    });
  });

  describe('mergeTargetSpan', () => {
    it('prefers merging into the next column', () => {
      expect(mergeTargetSpan(spanTable(), 1, 1)).toEqual({ columnSpan: 2 });
    });

    it('falls back to the next row in the last column', () => {
      expect(mergeTargetSpan(spanTable(), 1, 2)).toEqual({ rowSpan: 2 });
    });

    it('is null in the bottom-right square, which has nothing to merge into', () => {
      expect(mergeTargetSpan(spanTable(), 2, 2)).toBeNull();
    });
  });

  describe('cellSpanSignature', () => {
    it('is empty for a table with no merged cells', () => {
      expect(cellSpanSignature(spanTable([spanCell(0, 0, 1, 1)]))).toBe('');
    });

    it('ignores text and confidence, which a recalculation writes back', () => {
      const a = spanTable([spanCell(0, 0, 2, 2, { text: 'a', confidence: 10 })]);
      const b = spanTable([spanCell(0, 0, 2, 2, { text: 'b', confidence: 99 })]);
      expect(cellSpanSignature(b)).toBe(cellSpanSignature(a));
    });

    it('changes when a span changes', () => {
      const a = spanTable([spanCell(0, 0, 2, 2)]);
      const b = spanTable([spanCell(0, 0, 2, 3)]);
      expect(cellSpanSignature(b)).not.toBe(cellSpanSignature(a));
    });

    it('is independent of the order the merges sit in the cells array', () => {
      const one = spanCell(0, 0, 2, 1);
      const two = spanCell(1, 1, 1, 2);
      expect(cellSpanSignature(spanTable([two, one]))).toBe(
        cellSpanSignature(spanTable([one, two]))
      );
    });
  });
});

// ---------------------------------------------------------------------------
// tableSizeLabel
// ---------------------------------------------------------------------------

describe('tableSizeLabel', () => {
  // A table with `columns` columnWidths and `rows` rowHeights; extras carry
  // sectionTitles / headerCount / grid / next as each case needs.
  const sizeTable = (columns, rows, extra = {}) => ({
    tableId: 'root',
    name: 'Root',
    columnWidths: Array.from({ length: columns }, () => ({
      value: 0.1,
      confidence: 90,
    })),
    rowHeights: Array.from({ length: rows }, () => ({
      value: 0.1,
      confidence: 90,
    })),
    cells: [],
    ...extra,
  });

  // A sub-title row: `tableRow` is 0-based within its table, `columnName` is the
  // column the title supplies a value for (null when it names no column).
  const subTitle = (tableRow, columnName = null, del = false) => ({
    tableRow,
    delete: del,
    columnName,
    data: {
      bounds: { left: 0, top: 0, width: 0.1, height: 0.05 },
      text: 'Region A',
      confidence: 90,
    },
  });

  it('reports rows first then columns, with no tables line, for a plain table', () => {
    expect(tableSizeLabel(sizeTable(3, 2))).toEqual({
      sizeLine: '2 Rows, 3 Columns',
      tablesLine: null,
    });
  });

  it('drops sub-title rows from the row count and adds their named columns', () => {
    const t = sizeTable(3, 6, {
      sectionTitles: [subTitle(1, 'Region'), subTitle(3)],
    });
    expect(tableSizeLabel(t)).toEqual({
      sizeLine: '4 Rows, 4 Columns',
      tablesLine: null,
    });
  });

  it('counts distinct column names only', () => {
    const t = sizeTable(3, 6, {
      sectionTitles: [subTitle(1, 'Region'), subTitle(3, 'Region')],
    });
    expect(tableSizeLabel(t)).toEqual({
      sizeLine: '4 Rows, 4 Columns',
      tablesLine: null,
    });
  });

  it('ignores a sub-title row whose tableRow is outside the table', () => {
    const t = sizeTable(3, 2, { sectionTitles: [subTitle(7)] });
    expect(tableSizeLabel(t)).toEqual({
      sizeLine: '2 Rows, 3 Columns',
      tablesLine: null,
    });
  });

  it('counts sub-title rows marked for deletion the same as ones that are kept', () => {
    const kept = sizeTable(3, 4, { sectionTitles: [subTitle(1, null, false)] });
    const dropped = sizeTable(3, 4, { sectionTitles: [subTitle(1, null, true)] });
    expect(tableSizeLabel(kept).sizeLine).toBe('3 Rows, 3 Columns');
    expect(tableSizeLabel(dropped).sizeLine).toBe('3 Rows, 3 Columns');
  });

  it('combines the joined size and the grid size for a saved link grid', () => {
    const linkedRight = sizeTable(2, 3, {
      tableId: 'c-1',
      name: 'Right',
      headerCount: 1,
      sectionTitles: [subTitle(1, 'Policy')],
    });
    const linkedBelow = sizeTable(2, 5, {
      tableId: 'c-2',
      name: 'Below',
      headerCount: 2,
      sectionTitles: [subTitle(3)],
    });
    const root = sizeTable(3, 4, {
      headerCount: 1,
      sectionTitles: [subTitle(2, 'Region')],
      grid: [
        ['root', 'c-1'],
        ['c-2', ''],
      ],
      next: { 'c-1': linkedRight, 'c-2': linkedBelow },
    });

    // Base columns 3 + 2 across grid row 0; base rows 4 (Root, headers kept) +
    // (5 - 2) down grid column 0 = 7, less the Root's and Below's one sub-title
    // row each; columns raised by the two distinct names Region and Policy.
    expect(tableSizeLabel(root)).toEqual({
      sizeLine: '5 Rows, 7 Columns',
      tablesLine: '2 × 2 Tables',
    });
  });

  it('contributes nothing for a grid id that is missing from next', () => {
    const root = sizeTable(3, 4, {
      grid: [
        ['root', 'gone'],
        ['', ''],
      ],
      next: {},
    });
    expect(tableSizeLabel(root)).toEqual({
      sizeLine: '4 Rows, 3 Columns',
      tablesLine: '2 × 2 Tables',
    });
  });
});

// ---------------------------------------------------------------------------
// reconcileAxisEdit — sub-title rows and the footer follow a row insert/delete
//
// A structural row edit re-indexes cells through the axis map, but a sub-title row is
// identified by `sectionTitles[].tableRow` and the footer by `footer.row`. Left unmapped,
// both point at the wrong band after a row is added or removed: the dotted marker shifts on
// screen (it is drawn from tableRow), and at extract time the real sub-title row is treated
// as an ordinary data row — which, because a sub-title's text lives in `data` rather than in
// the row's cells, produces a blank row — while a genuine data row is dropped in its place.
describe('reconcileAxisEdit re-indexes sub-title rows and the footer', () => {
  const axis = (n) => Array.from({ length: n }, () => ({ value: 1 / n, confidence: 90 }));

  // Four rows, one column; a sub-title on row 2 and a footer on row 3.
  function rowTable() {
    return {
      tableId: 'r',
      pdfPage: 0,
      bounds: { left: 0, top: 0, width: 1, height: 1 },
      columnWidths: axis(1),
      rowHeights: axis(4),
      headerCount: 1,
      cells: [0, 1, 2, 3].map((row) => ({
        row,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        bounds: { left: 0, top: row / 4, width: 1, height: 1 / 4 },
        text: `r${row}`,
        confidence: 90,
        header: row === 0,
      })),
      sectionTitles: [
        {
          tableRow: 2,
          delete: false,
          columnName: 'ST',
          data: {
            bounds: { left: 0, top: 0.5, width: 1, height: 0.25 },
            text: 'SECTION',
            confidence: 90,
          },
        },
      ],
      footer: {
        row: 3,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        bounds: { left: 0, top: 0.75, width: 1, height: 0.25 },
        text: 'total',
        confidence: 90,
        header: false,
      },
    };
  }

  // splitEntry(arr, 0) + splitMapBelow(len, 0) is "Add Row"/"Add Below" at the top: a new
  // empty row becomes row 0 and everything else slides down one.
  test('a row inserted above a sub-title row moves the sub-title down with its band', () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(5),
      splitMapBelow(4, 0),
      t.bounds
    );

    expect(next.sectionTitles).toHaveLength(1);
    expect(next.sectionTitles[0].tableRow).toBe(3);
    // Everything else about the entry is preserved.
    expect(next.sectionTitles[0].columnName).toBe('ST');
    expect(next.sectionTitles[0].data.text).toBe('SECTION');
    // The sub-title still sits on the row holding the text it was marked against.
    const moved = next.cells.find((c) => c.text === 'r2');
    expect(moved.row).toBe(next.sectionTitles[0].tableRow);
    // The footer follows its row too.
    expect(next.footer.row).toBe(4);
    expect(next.footer.text).toBe('total');
  });

  // splitMap(len, i) keeps old 0..i and inserts the new line at i+1.
  test('a row inserted below a sub-title row leaves it where it is', () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(5),
      splitMap(4, 2),
      t.bounds
    );

    expect(next.sectionTitles[0].tableRow).toBe(2);
    const same = next.cells.find((c) => c.text === 'r2');
    expect(same.row).toBe(2);
  });

  // mergeMap(len, k) deletes divider k: old row k disappears, old rows above it move up.
  test('deleting a row above a sub-title row moves the sub-title up', () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(3),
      mergeMap(4, 1),
      t.bounds
    );

    const kept = next.cells.find((c) => c.text === 'r2');
    expect(next.sectionTitles[0].tableRow).toBe(kept.row);
  });

  // mergeMap(4, 2) folds away old row 2 — the sub-title's own band — so the entry has
  // nothing left to mark. The footer, on old row 3, survives and moves up with its row.
  test('deleting the sub-title row itself drops the sub-title entry', () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(3),
      mergeMap(4, 2),
      t.bounds
    );

    expect(next.sectionTitles).toEqual([]);
    expect(next.footer.row).toBe(2);
  });

  // mergeMap(4, 3) folds away old row 3, where the footer sits: it has no band left either,
  // so it is cleared rather than left marking a row that is now someone else's data.
  test("deleting the footer's row clears the footer", () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(3),
      mergeMap(4, 3),
      t.bounds
    );

    expect(next.footer).toBeNull();
    expect(next.sectionTitles[0].tableRow).toBe(2);
  });

  test('a column edit leaves sub-title rows untouched and re-indexes the footer column', () => {
    const t = rowTable();
    const next = reconcileAxisEdit(
      t,
      t,
      'columnWidths',
      axis(2),
      splitMapBelow(1, 0),
      t.bounds
    );

    expect(next.sectionTitles[0].tableRow).toBe(2);
    expect(next.footer.row).toBe(3);
    expect(next.footer.column).toBe(1);
  });

  test('a table with no sub-titles or footer is unchanged in those fields', () => {
    const t = rowTable();
    delete t.sectionTitles;
    delete t.footer;
    const next = reconcileAxisEdit(
      t,
      t,
      'rowHeights',
      axis(5),
      splitMapBelow(4, 0),
      t.bounds
    );

    expect(next.sectionTitles).toBeUndefined();
    expect(next.footer).toBeUndefined();
  });
});

// A new section title's data area is drawn automatically across the left of its row, rather
// than left to the user to rubber-band.
describe('leadingSquaresBounds', () => {
  const table = {
    bounds: { left: 0.1, top: 0.2, width: 0.6, height: 0.3 },
    columnWidths: [{ value: 0.2 }, { value: 0.25 }, { value: 0.15 }],
    rowHeights: [{ value: 0.1 }, { value: 0.2 }],
  };

  // Page fractions accumulate floating-point noise, so the arithmetic is checked to a
  // tolerance rather than by exact equality.
  it('spans the leading two squares of the row', () => {
    const area = leadingSquaresBounds(table, 1, 2);
    expect(area.left).toBeCloseTo(0.1);
    expect(area.top).toBeCloseTo(0.3);
    expect(area.width).toBeCloseTo(0.45);
    expect(area.height).toBeCloseTo(0.2);
  });

  it('is one square wide on a single-column table', () => {
    const single = { ...table, columnWidths: [{ value: 0.2 }] };
    const area = leadingSquaresBounds(single, 0, 2);
    expect(area.left).toBeCloseTo(0.1);
    expect(area.top).toBeCloseTo(0.2);
    expect(area.width).toBeCloseTo(0.2);
    expect(area.height).toBeCloseTo(0.1);
  });

  it('never spans more columns than the table has', () => {
    const two = { ...table, columnWidths: [{ value: 0.2 }, { value: 0.25 }] };
    expect(leadingSquaresBounds(two, 0, 5).width).toBeCloseTo(0.45);
  });

  it('is at least one square wide however small the count', () => {
    expect(leadingSquaresBounds(table, 0, 0).width).toBeCloseTo(0.2);
  });

  it('returns null for a table with no columns', () => {
    expect(leadingSquaresBounds({ ...table, columnWidths: [] }, 0, 2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findTableById / replaceTableById — a table joined into a grid is off the
// top-level list, so both reading it and writing it back go through `next`.
// ---------------------------------------------------------------------------

const child = { tableId: 'c', name: 'Child', next: null };
const root = { tableId: 'r', name: 'Root', grid: [['r', 'c']], next: { c: child } };
const other = { tableId: 'o', name: 'Other', next: null };
const list = [root, other];

describe('findTableById', () => {
  it('finds a top-level table', () => {
    expect(findTableById(list, 'o')).toBe(other);
  });

  it('finds a table joined under a root', () => {
    expect(findTableById(list, 'c')).toBe(child);
  });

  it('finds a table joined two levels down', () => {
    const grandchild = { tableId: 'g', next: null };
    const deep = [{ ...root, next: { c: { ...child, next: { g: grandchild } } } }];
    expect(findTableById(deep, 'g')).toBe(grandchild);
  });

  it('returns null for an unknown id, a null id and a null list', () => {
    expect(findTableById(list, 'missing')).toBeNull();
    expect(findTableById(list, null)).toBeNull();
    expect(findTableById(null, 'c')).toBeNull();
  });
});

describe('replaceTableById', () => {

  it('replaces a top-level table', () => {
    const edited = { ...other, name: 'Renamed' };
    const out = replaceTableById(list, 'o', edited);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(edited);
    expect(out[0]).toBe(root);
  });

  it('replaces a joined table inside its root, leaving the root otherwise intact', () => {
    const edited = { ...child, name: 'Renamed' };
    const out = replaceTableById(list, 'c', edited);
    expect(out[0].next.c).toBe(edited);
    expect(out[0].tableId).toBe('r');
    expect(out[0].grid).toEqual([['r', 'c']]);
    // Only the owning root is rebuilt.
    expect(out[1]).toBe(other);
  });

  it('reaches a table joined two levels down', () => {
    const grandchild = { tableId: 'g', next: null };
    const middle = { ...child, next: { g: grandchild } };
    const deep = [{ ...root, next: { c: middle } }];
    const edited = { ...grandchild, name: 'Renamed' };
    expect(replaceTableById(deep, 'g', edited)[0].next.c.next.g).toBe(edited);
  });

  it('returns the very same list when no table carries the id', () => {
    expect(replaceTableById(list, 'missing', { tableId: 'missing' })).toBe(list);
  });

  it('treats a null list as empty', () => {
    expect(replaceTableById(null, 'c', child)).toEqual([]);
  });
});

describe('tablesOnPage', () => {
  // Only the fields the helper reads: the page, the soft-delete flag and the `next` map.
  const pageTable = (tableId, pdfPage, extra = {}) => ({
    tableId,
    pdfPage,
    next: null,
    ...extra,
  });

  it('returns a top-level table on the asked-for page', () => {
    const here = pageTable('here', 1);
    expect(tablesOnPage([here, pageTable('elsewhere', 2)], 1)).toEqual([here]);
  });

  it('returns a table nested in another table next map', () => {
    const child = pageTable('c', 1);
    const root = pageTable('r', 0, { next: { c: child } });
    expect(tablesOnPage([root], 1)).toEqual([child]);
  });

  it('returns a table nested two levels deep', () => {
    const grandchild = pageTable('g', 1);
    const child = pageTable('c', 0, { next: { g: grandchild } });
    const root = pageTable('r', 0, { next: { c: child } });
    expect(tablesOnPage([root], 1)).toEqual([grandchild]);
  });

  it('omits a soft-deleted top-level table', () => {
    const live = pageTable('live', 1);
    const gone = pageTable('gone', 1, { deleted: true });
    expect(tablesOnPage([live, gone], 1)).toEqual([live]);
  });

  it('omits a soft-deleted nested table', () => {
    const child = pageTable('c', 1, { deleted: true });
    const root = pageTable('r', 1, { next: { c: child } });
    expect(tablesOnPage([root], 1)).toEqual([root]);
  });

  it('returns a page tables whether they arrive top-level or through a next map', () => {
    const child = pageTable('c', 1);
    const root = pageTable('r', 1, { next: { c: child } });
    const plain = pageTable('p', 1);
    expect(tablesOnPage([root, plain], 1).map((t) => t.tableId)).toEqual([
      'r',
      'p',
      'c',
    ]);
  });

  it('returns the tables by reference, undecorated', () => {
    const child = pageTable('c', 1);
    const root = pageTable('r', 0, { next: { c: child } });
    expect(tablesOnPage([root], 1)[0]).toBe(child);
  });

  it('treats a null list as empty', () => {
    expect(tablesOnPage(null, 0)).toEqual([]);
  });

  it('treats an undefined list as empty', () => {
    expect(tablesOnPage(undefined, 0)).toEqual([]);
  });
});

describe('mergeRolesByTableId', () => {
  const roleTable = (tableId, extra = {}) => ({
    tableId,
    pdfPage: 0,
    next: null,
    ...extra,
  });

  it('maps a nested table to the joined role', () => {
    const child = roleTable('c');
    const root = roleTable('r', { next: { c: child } });
    expect(mergeRolesByTableId([root]).c).toBe(MERGE_ROLE_JOINED);
  });

  it('maps the top-level parent of a nested table to the root role', () => {
    const child = roleTable('c');
    const root = roleTable('r', { next: { c: child } });
    expect(mergeRolesByTableId([root]).r).toBe(MERGE_ROLE_ROOT);
  });

  it('maps a table carrying a saved grid but no next entries to the root role', () => {
    const gridded = roleTable('g', { grid: [['g', 'x']] });
    expect(mergeRolesByTableId([gridded]).g).toBe(MERGE_ROLE_ROOT);
  });

  it('gives a plain unmerged table no key at all', () => {
    expect(mergeRolesByTableId([roleTable('plain')])).not.toHaveProperty(
      'plain'
    );
  });

  it('maps a nested table that itself carries a next map to joined, not root', () => {
    const grandchild = roleTable('g');
    const child = roleTable('c', { next: { g: grandchild } });
    const root = roleTable('r', { next: { c: child } });
    expect(mergeRolesByTableId([root]).c).toBe(MERGE_ROLE_JOINED);
  });

  it('treats a null list as an empty map', () => {
    expect(mergeRolesByTableId(null)).toEqual({});
  });
});

describe('mapAllTables', () => {
  const t = (tableId, extra = {}) => ({ tableId, next: null, ...extra });

  it('applies the transform to a top-level table', () => {
    const out = mapAllTables([t('a')], (x) => ({ ...x, seen: true }));
    expect(out[0].seen).toBe(true);
  });

  it('applies the transform to a table inside a next map', () => {
    const root = t('r', { next: { c: t('c') } });
    const out = mapAllTables([root], (x) =>
      x.tableId === 'c' ? { ...x, seen: true } : x
    );
    expect(out[0].next.c.seen).toBe(true);
  });

  it('applies the transform two levels down', () => {
    const child = t('c', { next: { g: t('g') } });
    const root = t('r', { next: { c: child } });
    const out = mapAllTables([root], (x) =>
      x.tableId === 'g' ? { ...x, seen: true } : x
    );
    expect(out[0].next.c.next.g.seen).toBe(true);
  });

  it('keeps the root identity when nothing beneath it changed', () => {
    const root = t('r', { next: { c: t('c') } });
    const list = [root];
    expect(mapAllTables(list, (x) => x)[0]).toBe(root);
  });

  it('returns the very same list when nothing changed anywhere', () => {
    const list = [t('r', { next: { c: t('c') } }), t('o')];
    expect(mapAllTables(list, (x) => x)).toBe(list);
  });

  it('rebuilds the owning root when a nested table changes', () => {
    const root = t('r', { next: { c: t('c') } });
    const out = mapAllTables([root], (x) =>
      x.tableId === 'c' ? { ...x, seen: true } : x
    );
    expect(out[0]).not.toBe(root);
    // Only `next` is rebuilt; the root's own fields are carried across.
    expect(out[0].tableId).toBe('r');
  });

  it('leaves an unrelated sibling untouched by reference', () => {
    const other = t('o');
    const out = mapAllTables([t('a'), other], (x) =>
      x.tableId === 'a' ? { ...x, seen: true } : x
    );
    expect(out[1]).toBe(other);
  });

  it('treats a null list as empty', () => {
    expect(mapAllTables(null, (x) => x)).toEqual([]);
  });
});

describe('changedColouredAreaRects', () => {
  const area = (left, top, extra = {}) => ({
    left,
    top,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
    ...extra,
  });
  const rect = (left, top) => ({ left, top, width: 0.2, height: 0.2 });

  it('reports nothing when the list is unchanged', () => {
    expect(changedColouredAreaRects([area(0.1, 0.1)], [area(0.1, 0.1)])).toEqual([]);
  });

  it('reports the new rectangle of an added area', () => {
    expect(changedColouredAreaRects([], [area(0.1, 0.1)])).toEqual([rect(0.1, 0.1)]);
  });

  it('reports the old rectangle of a deleted area', () => {
    expect(changedColouredAreaRects([area(0.1, 0.1)], [])).toEqual([rect(0.1, 0.1)]);
  });

  it('reports BOTH rectangles when a boundary moves', () => {
    const changed = changedColouredAreaRects([area(0.1, 0.1)], [area(0.4, 0.1)]);
    expect(changed).toEqual([rect(0.1, 0.1), rect(0.4, 0.1)]);
  });

  it('reports the one rectangle when only the colours change', () => {
    const changed = changedColouredAreaRects(
      [area(0.1, 0.1)],
      [area(0.1, 0.1, { foreground: '#222222' })]
    );
    expect(changed).toEqual([rect(0.1, 0.1)]);
  });

  it('is not confused by the index shift a deletion causes', () => {
    // Deleting the FIRST of three moves the other two down an index. Matching by value sees
    // one area gone and nothing else changed; matching by position would report all three.
    const before = [area(0.1, 0.1), area(0.4, 0.1), area(0.7, 0.1)];
    const after = [area(0.4, 0.1), area(0.7, 0.1)];
    expect(changedColouredAreaRects(before, after)).toEqual([rect(0.1, 0.1)]);
  });

  it('treats null lists as empty', () => {
    expect(changedColouredAreaRects(null, null)).toEqual([]);
  });
});

describe('zeroConfidenceInRects', () => {
  const cell = (row, column, left, top, confidence) => ({
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    bounds: { left, top, width: 0.1, height: 0.1 },
    text: 'x',
    confidence,
    header: false,
  });
  const table = (id, page, cells, extra = {}) => ({
    tableId: id,
    pdfPage: page,
    bounds: { left: 0, top: 0, width: 1, height: 1 },
    cells,
    ...extra,
  });
  const RECT = [{ left: 0.1, top: 0.1, width: 0.2, height: 0.2 }];

  it('zeroes a cell that impinges on the rectangle', () => {
    const out = zeroConfidenceInRects([table('a', 0, [cell(0, 0, 0.15, 0.15, 90)])], 0, RECT);
    expect(out[0].cells[0].confidence).toBe(0);
  });

  it('leaves a cell clear of the rectangle alone, by reference', () => {
    const clear = cell(0, 0, 0.6, 0.6, 90);
    const list = [table('a', 0, [clear])];
    expect(zeroConfidenceInRects(list, 0, RECT)).toBe(list);
  });

  it('counts a partial overlap as impinging', () => {
    // The cell runs from 0.25 to 0.35; the rectangle ends at 0.3, so they share a sliver.
    const out = zeroConfidenceInRects([table('a', 0, [cell(0, 0, 0.25, 0.25, 90)])], 0, RECT);
    expect(out[0].cells[0].confidence).toBe(0);
  });

  it('does not count edge-touching as impinging', () => {
    // The cell starts exactly where the rectangle ends. Binary-exact fractions throughout, so
    // this is a true edge test: with 0.1/0.2 the sum drifts to 0.30000000000000004 and the
    // strict inequality in `overlaps` reads a touch as a sliver of overlap.
    const touching = cell(0, 0, 0.5, 0.25, 90);
    const list = [table('a', 0, [touching])];
    const exact = [{ left: 0.25, top: 0.25, width: 0.25, height: 0.25 }];
    expect(zeroConfidenceInRects(list, 0, exact)).toBe(list);
  });

  it('leaves tables on another page alone', () => {
    const list = [table('a', 1, [cell(0, 0, 0.15, 0.15, 90)])];
    expect(zeroConfidenceInRects(list, 0, RECT)).toBe(list);
  });

  it('leaves a soft-deleted table alone', () => {
    const list = [table('a', 0, [cell(0, 0, 0.15, 0.15, 90)], { deleted: true })];
    expect(zeroConfidenceInRects(list, 0, RECT)).toBe(list);
  });

  it('reaches a table joined under another table grid', () => {
    const joined = table('j', 0, [cell(0, 0, 0.15, 0.15, 90)]);
    const out = zeroConfidenceInRects(
      [table('r', 0, [], { next: { down: joined } })],
      0,
      RECT
    );
    expect(out[0].next.down.cells[0].confidence).toBe(0);
  });

  it('zeroes across every rectangle it is given', () => {
    const cells = [cell(0, 0, 0.15, 0.15, 90), cell(0, 1, 0.45, 0.15, 90)];
    const out = zeroConfidenceInRects([table('a', 0, cells)], 0, [
      ...RECT,
      { left: 0.4, top: 0.1, width: 0.2, height: 0.2 },
    ]);
    expect(out[0].cells.map((c) => c.confidence)).toEqual([0, 0]);
  });

  it('returns the list untouched when there is nothing to change', () => {
    const list = [table('a', 0, [cell(0, 0, 0.15, 0.15, 90)])];
    expect(zeroConfidenceInRects(list, 0, [])).toBe(list);
  });

  // The title and the section titles are read by the same call the cells are, and both count
  // towards Ready for Export. Leaving them at their old confidence under a recoloured area
  // leaves a reading that is stale AND unflagged.
  it('zeroes a title the rectangle covers', () => {
    const titled = table('a', 0, [], {
      title: { bounds: { left: 0.15, top: 0.15, width: 0.05, height: 0.02 }, text: 'T', confidence: 88 },
    });
    const out = zeroConfidenceInRects([titled], 0, RECT);
    expect(out[0].title.confidence).toBe(0);
    // The reading itself is kept: it is the confidence that says it can no longer be trusted.
    expect(out[0].title.text).toBe('T');
  });

  it('leaves a title clear of the rectangle alone, by reference', () => {
    const list = [
      table('a', 0, [], {
        title: { bounds: { left: 0.6, top: 0.6, width: 0.05, height: 0.02 }, text: 'T', confidence: 88 },
      }),
    ];
    expect(zeroConfidenceInRects(list, 0, RECT)).toBe(list);
  });

  it('zeroes a section title value the rectangle covers and leaves its siblings alone', () => {
    const section = (row, left, confidence) => ({
      tableRow: row,
      delete: false,
      columnName: null,
      data: { bounds: { left, top: 0.15, width: 0.05, height: 0.02 }, text: 'S', confidence },
    });
    const sectioned = table('a', 0, [], {
      sectionTitles: [section(1, 0.15, 88), section(2, 0.6, 88)],
    });
    const out = zeroConfidenceInRects([sectioned], 0, RECT);
    expect(out[0].sectionTitles[0].data.confidence).toBe(0);
    expect(out[0].sectionTitles[1]).toBe(sectioned.sectionTitles[1]);
  });

  it('gives a table no key it did not already have', () => {
    const out = zeroConfidenceInRects([table('a', 0, [cell(0, 0, 0.15, 0.15, 90)])], 0, RECT);
    expect(Object.keys(out[0])).not.toContain('title');
    expect(Object.keys(out[0])).not.toContain('sectionTitles');
  });
});

// The signal that a coloured-area edit has left values owing a re-read: zeroConfidenceInRects
// applies the invalidation, this spots it, and the host puts the named tables into the
// page-exit change set.
describe('tablesWithLostConfidence', () => {
  const cell = (row, column, confidence) => ({ row, column, text: 'x', confidence });
  const table = (id, cells, extra = {}) => ({ tableId: id, cells, ...extra });

  it('names a table whose cell dropped to zero', () => {
    const before = table('a', [cell(0, 0, 90)]);
    const after = table('a', [cell(0, 0, 0)]);
    expect(tablesWithLostConfidence(before, after)).toEqual([after]);
  });

  it('names a table whose title dropped to zero', () => {
    const before = table('a', [], { title: { text: 'T', confidence: 88 } });
    const after = table('a', [], { title: { text: 'T', confidence: 0 } });
    expect(tablesWithLostConfidence(before, after)).toEqual([after]);
  });

  it('names a table whose section title value dropped to zero', () => {
    const withConfidence = (confidence) => ({
      sectionTitles: [{ tableRow: 1, data: { text: 'S', confidence } }],
    });
    const before = table('a', [], withConfidence(88));
    const after = table('a', [], withConfidence(0));
    expect(tablesWithLostConfidence(before, after)).toEqual([after]);
  });

  it('names nothing when a value merely gained text', () => {
    const before = table('a', [cell(0, 0, 90)]);
    const after = table('a', [{ row: 0, column: 0, text: 'read', confidence: 95 }]);
    expect(tablesWithLostConfidence(before, after)).toEqual([]);
  });

  it('names nothing for a value that was already at zero', () => {
    const before = table('a', [cell(0, 0, 0)]);
    const after = table('a', [cell(0, 0, 0)]);
    expect(tablesWithLostConfidence(before, after)).toEqual([]);
  });

  // A cell materialised into a grid square that did not exist before has no counterpart to
  // have lost anything: fillGridCells seeds it at zero, and the grid edit that created it is
  // already in the change set on its own account.
  it('names nothing for a cell that has no counterpart before the edit', () => {
    const before = table('a', [cell(0, 0, 90)]);
    const after = table('a', [cell(0, 0, 90), cell(0, 1, 0)]);
    expect(tablesWithLostConfidence(before, after)).toEqual([]);
  });

  it('names nothing when there is no pre-edit snapshot at all', () => {
    expect(tablesWithLostConfidence(undefined, table('a', [cell(0, 0, 0)]))).toEqual([]);
  });

  it('names a joined member rather than its root, since the member is its own re-read target', () => {
    const member = (confidence) => table('m', [cell(0, 0, confidence)]);
    const before = table('r', [cell(0, 0, 90)], { next: { m: member(90) } });
    const after = table('r', [cell(0, 0, 90)], { next: { m: member(0) } });
    expect(tablesWithLostConfidence(before, after)).toEqual([after.next.m]);
  });

  it('skips a soft-deleted table and a soft-deleted member', () => {
    const before = table('r', [cell(0, 0, 90)], { next: { m: table('m', [cell(0, 0, 90)]) } });
    const after = table('r', [cell(0, 0, 0)], {
      deleted: true,
      next: { m: table('m', [cell(0, 0, 0)], { deleted: true }) },
    });
    expect(tablesWithLostConfidence(before, after)).toEqual([]);
  });
});

describe('splitEntryAt', () => {
  const arr = () => [
    { value: 0.2, confidence: 90 },
    { value: 0.6, confidence: 80 },
    { value: 0.2, confidence: 70 },
  ];

  it('splits the entry at the given value, keeping the axis sum', () => {
    const out = splitEntryAt(arr(), 1, 0.1);
    expect(out.map((e) => e.value)).toEqual([0.2, 0.1, 0.5, 0.2]);
    expect(out.reduce((t, e) => t + e.value, 0)).toBeCloseTo(1, 10);
  });

  it('copies the split entry non-value fields onto both parts', () => {
    const out = splitEntryAt(arr(), 1, 0.1);
    expect(out[1].confidence).toBe(80);
    expect(out[2].confidence).toBe(80);
  });

  it('clamps a split at or beyond the near edge', () => {
    expect(splitEntryAt(arr(), 1, -1).map((e) => e.value)).toEqual([
      0.2, 0, 0.6, 0.2,
    ]);
  });

  it('clamps a split at or beyond the far edge', () => {
    expect(splitEntryAt(arr(), 1, 2).map((e) => e.value)).toEqual([
      0.2, 0.6, 0, 0.2,
    ]);
  });

  it('leaves the other entries untouched', () => {
    const out = splitEntryAt(arr(), 0, 0.05);
    expect(out.slice(2)).toEqual([
      { value: 0.6, confidence: 80 },
      { value: 0.2, confidence: 70 },
    ]);
  });
});

// ---- tableSetChanged -----------------------------------------------------------------
// Answers "did the set of tables change?", not "did anything change?": ids and the deleted
// flag only, seen at the top level and inside every `next` map.

describe('tableSetChanged', () => {
  const a = () => tbl('a', 0, 0.1, 0.1, 0.2, 0.2);
  const b = () => tbl('b', 0, 0.5, 0.5, 0.2, 0.2);

  it('is false for two identical lists', () => {
    expect(tableSetChanged([a(), b()], [a(), b()])).toBe(false);
  });

  it('is true when a table is added at the top level', () => {
    expect(tableSetChanged([a()], [a(), b()])).toBe(true);
  });

  it('is true when a table is removed', () => {
    expect(tableSetChanged([a(), b()], [a()])).toBe(true);
  });

  it('is true when a table is soft-deleted', () => {
    expect(tableSetChanged([a(), b()], [a(), { ...b(), deleted: true }])).toBe(
      true
    );
  });

  it('is false when only geometry moved', () => {
    const moved = { ...b(), bounds: { left: 0.6, top: 0.6, width: 0.2, height: 0.2 } };
    expect(tableSetChanged([a(), b()], [a(), moved])).toBe(false);
  });

  it('is false when a table moves from the top level into a next map', () => {
    const joined = [{ ...a(), next: { b: b() } }];
    expect(tableSetChanged([a(), b()], joined)).toBe(false);
  });

  it('is true when a table is added inside a next map', () => {
    expect(tableSetChanged([a()], [{ ...a(), next: { b: b() } }])).toBe(true);
  });

  it('is true when a table nested in a next map is soft-deleted', () => {
    const before = [{ ...a(), next: { b: b() } }];
    const after = [{ ...a(), next: { b: { ...b(), deleted: true } } }];
    expect(tableSetChanged(before, after)).toBe(true);
  });

  it('handles null and undefined lists without throwing', () => {
    expect(tableSetChanged(null, null)).toBe(false);
    expect(tableSetChanged(undefined, [])).toBe(false);
    expect(tableSetChanged(null, [a()])).toBe(true);
  });
});

// ---- linkLabelText -------------------------------------------------------------------

describe('linkLabelText', () => {
  const child = tbl('c', 1, 0.1, 0.1, 0.2, 0.2);
  const rootTable = { ...tbl('r', 0, 0.1, 0.1, 0.2, 0.2), name: 'Root', next: { c: child } };
  const loner = tbl('x', 0, 0.6, 0.6, 0.2, 0.2);
  const list = [rootTable, loner];
  const roles = mergeRolesByTableId(list);
  const parents = linkedTablesWithParents(list);

  it('reads Selected for a table in no group', () => {
    expect(linkLabelText(loner, roles, parents, null)).toEqual({
      state: LINK_LABEL_PLAIN,
      text: 'Selected',
    });
  });

  it('reads Linked for the root of a group', () => {
    expect(linkLabelText(rootTable, roles, parents, null)).toEqual({
      state: LINK_LABEL_ROOT,
      text: 'Linked',
    });
  });

  it('names the root for a joined table', () => {
    expect(linkLabelText(child, roles, parents, null)).toEqual({
      state: LINK_LABEL_JOINED,
      text: 'Linked to Root',
    });
  });

  it('reads End Linking for the table rooting an open session', () => {
    expect(linkLabelText(loner, roles, parents, 'x')).toEqual({
      state: LINK_LABEL_END_LINKING,
      text: 'End Linking',
    });
  });

  it('prefers End Linking over Linked for a root with an open session', () => {
    expect(linkLabelText(rootTable, roles, parents, 'r').state).toBe(
      LINK_LABEL_END_LINKING
    );
  });

  it('falls back to the id when a joined table has no parent entry', () => {
    expect(
      linkLabelText(child, { c: MERGE_ROLE_JOINED }, [], null).text
    ).toBe('Linked to c');
  });
});

// ---- canJoinLinkGroup ----------------------------------------------------------------

describe('canJoinLinkGroup', () => {
  const rootTable = { ...tbl('r', 0, 0.1, 0.1, 0.2, 0.2), tableInPage: 1 };
  const laterPage = { ...tbl('p', 1, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
  const laterSamePage = { ...tbl('s', 0, 0.1, 0.5, 0.2, 0.2), tableInPage: 2 };
  const earlier = { ...tbl('e', 0, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };

  it('admits an ungrouped table on a later page', () => {
    expect(canJoinLinkGroup(laterPage, rootTable, {})).toBe(true);
  });

  it('admits an ungrouped table later on the same page', () => {
    expect(canJoinLinkGroup(laterSamePage, rootTable, {})).toBe(true);
  });

  it('refuses a table above the root', () => {
    expect(canJoinLinkGroup(earlier, rootTable, {})).toBe(false);
  });

  it('refuses the root itself', () => {
    expect(canJoinLinkGroup(rootTable, rootTable, {})).toBe(false);
  });

  it('refuses a table already in a group', () => {
    expect(
      canJoinLinkGroup(laterPage, rootTable, { p: MERGE_ROLE_JOINED })
    ).toBe(false);
    expect(
      canJoinLinkGroup(laterPage, rootTable, { p: MERGE_ROLE_ROOT })
    ).toBe(false);
  });

  it('refuses a missing table or root', () => {
    expect(canJoinLinkGroup(null, rootTable, {})).toBe(false);
    expect(canJoinLinkGroup(laterPage, null, {})).toBe(false);
  });
});

// ---- removeFromLinkGroup ---------------------------------------------------------------

describe('removeFromLinkGroup', () => {
  const above = { ...tbl('a', 0, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
  const member1 = { ...tbl('m1', 1, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
  const member2 = { ...tbl('m2', 2, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
  const below = { ...tbl('z', 3, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
  const root = (extra = {}) => ({
    ...tbl('r', 0, 0.1, 0.5, 0.2, 0.2),
    tableInPage: 1,
    next: { m1: member1, m2: member2 },
    ...extra,
  });
  const list = (extra = {}) => [above, root(extra), below];

  it('takes the member out of `next` and leaves the others', () => {
    const out = removeFromLinkGroup(list(), 'r', 'm1');
    expect(Object.keys(out.find((t) => t.tableId === 'r').next)).toEqual(['m2']);
  });

  it('returns the member to the top-level list in document order', () => {
    const out = removeFromLinkGroup(list(), 'r', 'm1');
    expect(out.map((t) => t.tableId)).toEqual(['a', 'r', 'm1', 'z']);
  });

  it('appends a member that comes after every top-level table', () => {
    const late = { ...tbl('m9', 9, 0.1, 0.1, 0.2, 0.2), tableInPage: 0 };
    const out = removeFromLinkGroup(
      [above, { ...root(), next: { m9: late } }, below],
      'r',
      'm9'
    );
    expect(out.map((t) => t.tableId)).toEqual(['a', 'r', 'z', 'm9']);
  });

  it('nulls `next` once the last member leaves', () => {
    const one = [above, { ...root(), next: { m1: member1 } }, below];
    const out = removeFromLinkGroup(one, 'r', 'm1');
    expect(out.find((t) => t.tableId === 'r').next).toBeNull();
  });

  it('drops the root grid whole, not just the removed cell', () => {
    const before = list({
      grid: [
        ['r', 'm1'],
        ['m2', ''],
      ],
    });
    const out = removeFromLinkGroup(before, 'r', 'm1');
    expect(out.find((t) => t.tableId === 'r').grid).toBeNull();
  });

  it('leaves every other table untouched', () => {
    const before = list();
    const out = removeFromLinkGroup(before, 'r', 'm1');
    expect(out.find((t) => t.tableId === 'a')).toBe(above);
    expect(out.find((t) => t.tableId === 'z')).toBe(below);
    expect(out.find((t) => t.tableId === 'm1')).toBe(member1);
  });

  it('returns the list unchanged by reference for an unknown root or member', () => {
    const before = list();
    expect(removeFromLinkGroup(before, 'nope', 'm1')).toBe(before);
    expect(removeFromLinkGroup(before, 'r', 'nope')).toBe(before);
    // A top-level table is not a member of the group, even though it exists.
    expect(removeFromLinkGroup(before, 'r', 'z')).toBe(before);
  });

  it('refuses a member of a DIFFERENT root', () => {
    const other = {
      ...tbl('o', 0, 0.1, 0.8, 0.2, 0.2),
      tableInPage: 2,
      next: { x: tbl('x', 4, 0.1, 0.1, 0.2, 0.2) },
    };
    const before = [...list(), other];
    expect(removeFromLinkGroup(before, 'r', 'x')).toBe(before);
  });
});

// ---- additional tables ----------------------------------------------------------------
// A root holding linked tables in `next` with no grid laid out for them: the state the
// linking flow writes. The Document Overview lists them rather than a grid size.

describe('additional tables', () => {
  const child = (id, page, inPage) => ({
    ...tbl(id, page, 0.1, 0.1, 0.2, 0.2),
    tableInPage: inPage,
  });

  const rootWithNext = (next) => ({
    ...tbl('r', 0, 0.1, 0.1, 0.2, 0.2),
    next,
  });

  describe('additionalTables', () => {
    it('is empty for a table with no next', () => {
      expect(additionalTables(tbl('r', 0, 0.1, 0.1, 0.2, 0.2))).toEqual([]);
      expect(additionalTables(null)).toEqual([]);
    });

    it('is empty when the root has a saved grid', () => {
      const root = {
        ...rootWithNext({ c: child('c', 1, 0) }),
        grid: [['r', 'c']],
      };
      expect(additionalTables(root)).toEqual([]);
    });

    it('orders the next tables by page then tableInPage', () => {
      const root = rootWithNext({
        late: child('late', 2, 0),
        second: child('second', 0, 5),
        first: child('first', 0, 1),
      });
      expect(additionalTables(root).map((t) => t.tableId)).toEqual([
        'first',
        'second',
        'late',
      ]);
    });
  });

  describe('tableSizeLabel with next but no grid', () => {
    it('counts the additional tables', () => {
      const root = rootWithNext({
        a: child('a', 1, 0),
        b: child('b', 2, 0),
      });
      expect(tableSizeLabel(root).tablesLine).toBe('Additional tables 2');
    });

    it('still reports a grid size when a grid is saved', () => {
      const root = {
        ...rootWithNext({ c: child('c', 1, 0) }),
        grid: [['r', 'c']],
      };
      expect(tableSizeLabel(root).tablesLine).toBe('2 × 1 Tables');
    });

    it('reports no tables line for a plain table', () => {
      expect(tableSizeLabel(tbl('r', 0, 0.1, 0.1, 0.2, 0.2)).tablesLine).toBeNull();
    });
  });
});
