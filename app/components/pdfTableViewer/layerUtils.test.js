import {
  scalePercentToWidthPx,
  stepScale,
  layerRowTicked,
  nextConfirmationStage,
  layerCounts,
  layerKeyForStage,
  stageAfterEdit,
  layerDataChanged,
  collectColumnNames,
  nextTableOnPage,
  prevTableOnPage,
  nextSectionTitleColumnName,
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

describe('layerRowTicked', () => {
  const stages = [null, 0, 1, 2, 3, 4, 5];
  const rows = [1, 2, 3, 4, 5];

  it('is ticked iff (stage ?? 0) >= rowNumber', () => {
    rows.forEach((rowNumber) => {
      stages.forEach((stage) => {
        const expected = (stage ?? 0) >= rowNumber;
        expect(layerRowTicked(rowNumber, stage)).toBe(expected);
      });
    });
  });
});

describe('nextConfirmationStage', () => {
  it('returns rowNumber when checked, else rowNumber - 1', () => {
    expect(nextConfirmationStage(2, null, true)).toBe(2);
    expect(nextConfirmationStage(2, null, false)).toBe(1);
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

describe('stageAfterEdit', () => {
  it('unticks the edited layer and every layer above it (drops to level - 1)', () => {
    // colours=1, border=2, rows=3, columns=4, special=5
    expect(stageAfterEdit('colours', 5)).toBe(0);
    expect(stageAfterEdit('border', 5)).toBe(1);
    expect(stageAfterEdit('rows', 5)).toBe(2);
    expect(stageAfterEdit('columns', 5)).toBe(3);
    expect(stageAfterEdit('special', 5)).toBe(4);
  });

  it('editing colours drops the stage to 0 from any ticked stage', () => {
    [1, 2, 3, 4, 5].forEach((stage) => {
      expect(stageAfterEdit('colours', stage)).toBe(0);
    });
  });

  it('never raises the stage (returns min(currentStage, level - 1))', () => {
    // Editing rows (level 3) when only Colours+Border are ticked leaves it at 2.
    expect(stageAfterEdit('rows', 2)).toBe(2);
    // Editing Special (level 5) at a lower stage leaves the lower stage untouched.
    expect(stageAfterEdit('special', 2)).toBe(2);
    expect(stageAfterEdit('columns', 1)).toBe(1);
  });

  it('treats a null/absent stage as 0', () => {
    expect(stageAfterEdit('border', null)).toBe(0);
    expect(stageAfterEdit('special', undefined)).toBe(0);
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

describe('layerKeyForStage', () => {
  it('selects the first un-ticked row for each stage', () => {
    expect(layerKeyForStage(null)).toBe('colours');
    expect(layerKeyForStage(0)).toBe('colours');
    expect(layerKeyForStage(1)).toBe('border');
    expect(layerKeyForStage(2)).toBe('rows');
    expect(layerKeyForStage(3)).toBe('columns');
    expect(layerKeyForStage(4)).toBe('special');
  });

  it('selects the last row when all are ticked (or beyond)', () => {
    expect(layerKeyForStage(5)).toBe('special');
    expect(layerKeyForStage(99)).toBe('special');
  });
});

describe('nextTableOnPage', () => {
  it('walks tableInPage order, not array order', () => {
    // Document order (a, b, c) disagrees with tableInPage order (c, a, b).
    const samePageTables = [
      { tableId: 'a', tableInPage: 2 },
      { tableId: 'b', tableInPage: 3 },
      { tableId: 'c', tableInPage: 1 },
    ];
    expect(nextTableOnPage(samePageTables, 'c').tableId).toBe('a');
    expect(nextTableOnPage(samePageTables, 'a').tableId).toBe('b');
  });

  it('returns null for the highest tableInPage', () => {
    const samePageTables = [
      { tableId: 'a', tableInPage: 2 },
      { tableId: 'b', tableInPage: 3 },
      { tableId: 'c', tableInPage: 1 },
    ];
    expect(nextTableOnPage(samePageTables, 'b')).toBeNull();
  });

  it('returns null for an empty or nullish list', () => {
    expect(nextTableOnPage([], 'a')).toBeNull();
    expect(nextTableOnPage(null, 'a')).toBeNull();
    expect(nextTableOnPage(undefined, 'a')).toBeNull();
  });

  it('returns null for an unknown currentTableId', () => {
    const samePageTables = [
      { tableId: 'a', tableInPage: 0 },
      { tableId: 'b', tableInPage: 1 },
    ];
    expect(nextTableOnPage(samePageTables, 'zzz')).toBeNull();
  });

  it('treats a null tableInPage as 0, so such a table sorts first', () => {
    const samePageTables = [
      { tableId: 'a', tableInPage: 1 },
      { tableId: 'b', tableInPage: null },
      { tableId: 'c' },
    ];
    expect(nextTableOnPage(samePageTables, 'b').tableId).toBe('c');
    expect(nextTableOnPage(samePageTables, 'c').tableId).toBe('a');
    expect(nextTableOnPage(samePageTables, 'a')).toBeNull();
  });

  it('orders fractional tableInPage values correctly', () => {
    const samePageTables = [
      { tableId: 'last', tableInPage: 1 },
      { tableId: 'first', tableInPage: 0 },
      { tableId: 'middle', tableInPage: 0.5 },
    ];
    expect(nextTableOnPage(samePageTables, 'first').tableId).toBe('middle');
    expect(nextTableOnPage(samePageTables, 'middle').tableId).toBe('last');
    expect(nextTableOnPage(samePageTables, 'last')).toBeNull();
  });

  it('keeps document order for ties', () => {
    const samePageTables = [
      { tableId: 'a', tableInPage: 1 },
      { tableId: 'b', tableInPage: 1 },
      { tableId: 'c', tableInPage: 1 },
    ];
    expect(nextTableOnPage(samePageTables, 'a').tableId).toBe('b');
    expect(nextTableOnPage(samePageTables, 'b').tableId).toBe('c');
    expect(nextTableOnPage(samePageTables, 'c')).toBeNull();
  });
});

// The exact mirror of nextTableOnPage: the same order walked backwards, so Previous steps
// back through the page's tables before the page itself.
describe('prevTableOnPage', () => {
  const samePageTables = [
    { tableId: 'a', tableInPage: 2 },
    { tableId: 'b', tableInPage: 3 },
    { tableId: 'c', tableInPage: 1 },
  ];

  it('walks tableInPage order backwards, not array order', () => {
    expect(prevTableOnPage(samePageTables, 'b').tableId).toBe('a');
    expect(prevTableOnPage(samePageTables, 'a').tableId).toBe('c');
  });

  it('returns null for the lowest tableInPage', () => {
    expect(prevTableOnPage(samePageTables, 'c')).toBeNull();
  });

  it('returns null for an unknown id, and for an empty or nullish list', () => {
    expect(prevTableOnPage(samePageTables, 'zzz')).toBeNull();
    expect(prevTableOnPage([], 'a')).toBeNull();
    expect(prevTableOnPage(null, 'a')).toBeNull();
  });

  it('steps back over every table Next steps forward over', () => {
    ['c', 'a', 'b'].forEach((id) => {
      const forward = nextTableOnPage(samePageTables, id);
      if (forward) {
        expect(prevTableOnPage(samePageTables, forward.tableId).tableId).toBe(
          id,
        );
      }
    });
  });

  it('does not mutate the input array', () => {
    const samePageTables = [
      { tableId: 'a', tableInPage: 2 },
      { tableId: 'b', tableInPage: 3 },
      { tableId: 'c', tableInPage: 1 },
    ];
    nextTableOnPage(samePageTables, 'c');
    expect(samePageTables.map((t) => t.tableId)).toEqual(['a', 'b', 'c']);
  });
});

// A new section title arrives already named, so it means something the moment it is drawn.
describe('nextSectionTitleColumnName', () => {
  const withNames = (...names) => ({
    sectionTitles: names.map((columnName, i) => ({ tableRow: i, columnName })),
  });

  it('takes the name from the most recently added named section title', () => {
    expect(
      nextSectionTitleColumnName(withNames('Region', 'Branch'), ['Region', 'Branch'], 'Section Title'),
    ).toBe('Branch');
  });

  it('skips unnamed entries when looking back', () => {
    // An unnamed entry is a hidden row: it names no column, so it is not what was last used.
    expect(
      nextSectionTitleColumnName(withNames('Region', null), ['Region'], 'Section Title'),
    ).toBe('Region');
  });

  it('falls back to the last collected option when this table has named nothing', () => {
    expect(
      nextSectionTitleColumnName({ sectionTitles: [] }, ['Region', 'Branch'], 'Section Title'),
    ).toBe('Branch');
  });

  it('falls back to the supplied default when no column name exists anywhere', () => {
    expect(nextSectionTitleColumnName({ sectionTitles: [] }, [], 'Section Title')).toBe(
      'Section Title',
    );
  });

  it('tolerates a nullish table and a nullish options list', () => {
    expect(nextSectionTitleColumnName(null, null, 'Section Title')).toBe('Section Title');
    expect(nextSectionTitleColumnName({}, undefined, 'Section Title')).toBe('Section Title');
  });
});
