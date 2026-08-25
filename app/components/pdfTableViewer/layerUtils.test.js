import {
  scalePercentToWidthPx,
  stepScale,
  layerCounts,
  layerDataChanged,
  collectColumnNames,
  nextTableOnPage,
  prevTableOnPage,
} from 'components/pdfTableViewer/layerUtils';

describe('scalePercentToWidthPx', () => {
  it('scales a base width by a percentage, rounded', () => {
    expect(scalePercentToWidthPx(100, 900)).toBe(900);
    expect(scalePercentToWidthPx(50, 900)).toBe(450);
    expect(scalePercentToWidthPx(200, 900)).toBe(1800);
    expect(scalePercentToWidthPx(75, 900)).toBe(675);
    expect(scalePercentToWidthPx(150, 900)).toBe(1350);
  });
});

describe('stepScale', () => {
  const options = [50, 75, 100, 150, 200];

  it('steps forward and backward through the ordered options', () => {
    expect(stepScale(options, 100, +1)).toBe(150);
    expect(stepScale(options, 100, -1)).toBe(75);
  });

  it('clamps at the ends', () => {
    expect(stepScale(options, 200, +1)).toBe(200);
    expect(stepScale(options, 50, -1)).toBe(50);
  });
});

describe('layerCounts', () => {
  it('counts a populated selected table and page', () => {
    const selectedTable = {
      rowHeights: [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }],
      columnWidths: [{ value: 0.2 }, { value: 0.2 }],
      headerCount: 2,
      title: { bounds: {}, text: 'X', confidence: 1 },
    };
    const samePageTables = [{}, {}, {}, {}];
    const pageColouredAreas = [{}];

    expect(
      layerCounts({ selectedTable, samePageTables, pageColouredAreas }),
    ).toEqual({
      border: 4,
      rows: 3,
      columns: 2,
      specialCells: 2,
      colours: 1,
    });
  });

  it('adds the number of section titles to the special-cells count', () => {
    const selectedTable = {
      rowHeights: [{ value: 0.1 }, { value: 0.1 }],
      columnWidths: [{ value: 0.2 }],
      headerCount: 1,
      title: { bounds: {}, text: 'X', confidence: 1 },
      sectionTitles: [
        { tableRow: 0, data: null, delete: true, columnName: null },
        { tableRow: 1, data: {}, delete: false, columnName: 'Premium' },
      ],
    };
    const counts = layerCounts({
      selectedTable,
      samePageTables: [{}],
      pageColouredAreas: [],
    });
    // 1 (header) + 1 (title) + 2 (section titles) = 4
    expect(counts.specialCells).toBe(4);
  });

  it('returns all zeros for null/empty inputs', () => {
    expect(
      layerCounts({
        selectedTable: null,
        samePageTables: [],
        pageColouredAreas: [],
      }),
    ).toEqual({
      border: 0,
      rows: 0,
      columns: 0,
      specialCells: 0,
      colours: 0,
    });
  });
});

describe('collectColumnNames', () => {
  it('aggregates distinct, non-null columnName values across every table in order', () => {
    const tables = [
      {
        sectionTitles: [
          { tableRow: 0, columnName: 'Premium', data: {} },
          { tableRow: 1, columnName: null, data: null },
        ],
      },
      {
        sectionTitles: [
          { tableRow: 0, columnName: 'Claims', data: {} },
          { tableRow: 2, columnName: 'Premium', data: {} }, // duplicate
        ],
      },
      { sectionTitles: null },
      {},
    ];
    expect(collectColumnNames(tables)).toEqual(['Premium', 'Claims']);
  });

  it('returns [] for null / empty input', () => {
    expect(collectColumnNames(null)).toEqual([]);
    expect(collectColumnNames([])).toEqual([]);
  });
});

describe('layerDataChanged', () => {
  const base = {
    bounds: { top: 0, left: 0, width: 0.4, height: 0.3 },
    rowHeights: [{ value: 0.3, confidence: 90 }],
    columnWidths: [{ value: 0.4, confidence: 90 }],
    headerCount: 0,
    title: null,
    sectionTitles: null,
    footer: null,
  };

  it('border: true only when bounds change', () => {
    expect(layerDataChanged('border', base, { ...base })).toBe(false);
    expect(
      layerDataChanged('border', base, {
        ...base,
        bounds: { ...base.bounds, width: 0.5 },
      })
    ).toBe(true);
  });

  it('rows: true only when rowHeights change', () => {
    expect(layerDataChanged('rows', base, { ...base })).toBe(false);
    expect(
      layerDataChanged('rows', base, {
        ...base,
        rowHeights: [{ value: 0.15 }, { value: 0.15 }],
      })
    ).toBe(true);
  });

  it('columns: true only when columnWidths change', () => {
    expect(layerDataChanged('columns', base, { ...base })).toBe(false);
    expect(
      layerDataChanged('columns', base, {
        ...base,
        columnWidths: [{ value: 0.2 }, { value: 0.2 }],
      })
    ).toBe(true);
  });

  it('special: true when title, headerCount, sectionTitles or footer change', () => {
    expect(layerDataChanged('special', base, { ...base })).toBe(false);
    expect(layerDataChanged('special', base, { ...base, headerCount: 1 })).toBe(
      true
    );
    expect(
      layerDataChanged('special', base, {
        ...base,
        title: { bounds: {}, text: null, confidence: null },
      })
    ).toBe(true);
    expect(
      layerDataChanged('special', base, { ...base, sectionTitles: [{}] })
    ).toBe(true);
    expect(
      layerDataChanged('special', base, {
        ...base,
        footer: { bounds: {}, text: 'Total', confidence: 80 },
      })
    ).toBe(true);
  });

  describe('special: cell spans', () => {
    const cell = (row, column, rowSpan, columnSpan, extra = {}) => ({
      row,
      column,
      rowSpan,
      columnSpan,
      bounds: { top: 0, left: 0, width: 0.1, height: 0.1 },
      text: '',
      confidence: 0,
      header: false,
      ...extra,
    });

    const unmerged = {
      ...base,
      cells: [cell(0, 0, 1, 1), cell(0, 1, 1, 1), cell(1, 0, 1, 1)],
    };

    it('is true when a columnSpan changes from 1 to 2', () => {
      const after = {
        ...unmerged,
        cells: [cell(0, 0, 1, 2), cell(0, 1, 1, 1), cell(1, 0, 1, 1)],
      };
      expect(layerDataChanged('special', unmerged, after)).toBe(true);
    });

    it('is true when a rowSpan changes', () => {
      const before = {
        ...unmerged,
        cells: [cell(0, 0, 2, 1), cell(0, 1, 1, 1)],
      };
      const after = {
        ...unmerged,
        cells: [cell(0, 0, 3, 1), cell(0, 1, 1, 1)],
      };
      expect(layerDataChanged('special', before, after)).toBe(true);
    });

    it('is true when a merged cell is added to a table that had none', () => {
      const after = {
        ...unmerged,
        cells: [...unmerged.cells, cell(1, 1, 2, 2)],
      };
      expect(layerDataChanged('special', unmerged, after)).toBe(true);
    });

    it('is false when only a cell text differs', () => {
      const before = {
        ...unmerged,
        cells: [cell(0, 0, 1, 2, { text: 'old' }), cell(1, 0, 1, 1)],
      };
      const after = {
        ...unmerged,
        cells: [cell(0, 0, 1, 2, { text: 'new' }), cell(1, 0, 1, 1)],
      };
      expect(layerDataChanged('special', before, after)).toBe(false);
    });

    it('is false when only a cell confidence differs', () => {
      const before = {
        ...unmerged,
        cells: [cell(0, 0, 2, 1, { confidence: 10 }), cell(1, 1, 1, 1)],
      };
      const after = {
        ...unmerged,
        cells: [cell(0, 0, 2, 1, { confidence: 95 }), cell(1, 1, 1, 1)],
      };
      expect(layerDataChanged('special', before, after)).toBe(false);
    });

    it('is false when the same merges appear in a different order', () => {
      const before = {
        ...unmerged,
        cells: [cell(0, 0, 1, 2), cell(2, 1, 3, 1), cell(1, 0, 1, 1)],
      };
      const after = {
        ...unmerged,
        cells: [cell(1, 0, 1, 1), cell(2, 1, 3, 1), cell(0, 0, 1, 2)],
      };
      expect(layerDataChanged('special', before, after)).toBe(false);
    });

    it('is false when neither table has a merged cell and nothing else changed', () => {
      expect(layerDataChanged('special', unmerged, { ...unmerged })).toBe(false);
      expect(
        layerDataChanged('special', unmerged, {
          ...unmerged,
          cells: [cell(0, 0, 1, 1)],
        })
      ).toBe(false);
      expect(layerDataChanged('special', base, unmerged)).toBe(false);
    });

    it('treats absent rowSpan/columnSpan as 1', () => {
      const withoutSpans = {
        ...base,
        cells: [{ row: 0, column: 0 }, { row: 0, column: 1 }],
      };
      expect(layerDataChanged('special', withoutSpans, unmerged)).toBe(false);
      expect(
        layerDataChanged('special', withoutSpans, {
          ...base,
          cells: [{ row: 0, column: 0, columnSpan: 2 }],
        })
      ).toBe(true);
    });
  });

  it('colours is page-scoped (never a per-table change) and returns false', () => {
    expect(
      layerDataChanged('colours', base, {
        ...base,
        bounds: { ...base.bounds, width: 0.9 },
      })
    ).toBe(false);
  });

  it('returns false when either snapshot is missing', () => {
    expect(layerDataChanged('border', null, base)).toBe(false);
    expect(layerDataChanged('border', base, null)).toBe(false);
  });
});

// The exact mirror of nextTableOnPage: the same order walked backwards, so Previous steps
// back through the page's tables before the page itself.
// A new section title arrives already named, so it means something the moment it is drawn.
describe('nextTableOnPage / prevTableOnPage', () => {
  const samePageTables = [
    { tableId: 'a', tableInPage: 2 },
    { tableId: 'b', tableInPage: 3 },
    { tableId: 'c', tableInPage: 1 },
  ];

  it('steps in tableInPage order, not array order', () => {
    expect(nextTableOnPage(samePageTables, 'c').tableId).toBe('a');
    expect(prevTableOnPage(samePageTables, 'a').tableId).toBe('c');
  });

  it('stops at the ends of the page rather than wrapping', () => {
    expect(nextTableOnPage(samePageTables, 'b')).toBeNull();
    expect(prevTableOnPage(samePageTables, 'c')).toBeNull();
  });

  it('has no step to make on a single-table page', () => {
    const one = [{ tableId: 'only', tableInPage: 0 }];
    expect(nextTableOnPage(one, 'only')).toBeNull();
    expect(prevTableOnPage(one, 'only')).toBeNull();
  });

  it('returns null for an empty list or an unknown id', () => {
    expect(nextTableOnPage([], 'a')).toBeNull();
    expect(nextTableOnPage(null, 'a')).toBeNull();
    expect(prevTableOnPage(samePageTables, 'zzz')).toBeNull();
  });
});
