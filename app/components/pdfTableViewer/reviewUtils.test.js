// No config mock: reviewUtils imports no config, so there is nothing here to stub.
import {
  looksNumeric,
  isWideText,
  adjacentPoorCell,
  adjacentReviewTableId,
  belowHighConfidenceCells,
  cellCoordinate,
  cellTextLines,
  columnLabel,
  confidenceLabel,
  flaggedForReviewLabel,
  lowConfidenceTitle,
  lowConfidenceSectionTitle,
  mergedCellLayout,
  reviewRowNumbers,
} from 'components/pdfTableViewer/reviewUtils';

describe('reviewUtils', () => {
  describe('looksNumeric', () => {
    it('accepts plain integers and decimals', () => {
      expect(looksNumeric('0')).toBe(true);
      expect(looksNumeric('12')).toBe(true);
      expect(looksNumeric('1234567')).toBe(true);
      expect(looksNumeric('4.00')).toBe(true);
      expect(looksNumeric('0.5')).toBe(true);
    });

    it('accepts thousands commas', () => {
      expect(looksNumeric('1,234')).toBe(true);
      expect(looksNumeric('1,234,567')).toBe(true);
      expect(looksNumeric('1,234.56')).toBe(true);
    });

    it('accepts a leading minus sign', () => {
      expect(looksNumeric('-12')).toBe(true);
      expect(looksNumeric('-1,234.56')).toBe(true);
    });

    it('accepts one leading currency symbol, with or without spaces', () => {
      expect(looksNumeric('£12')).toBe(true);
      expect(looksNumeric('$1,234.56')).toBe(true);
      expect(looksNumeric('€0.99')).toBe(true);
      expect(looksNumeric('£ 12')).toBe(true);
      expect(looksNumeric('$  1,234')).toBe(true);
      expect(looksNumeric('£-12')).toBe(true);
      expect(looksNumeric('£ -12')).toBe(true);
    });

    it('ignores surrounding whitespace', () => {
      expect(looksNumeric('  12  ')).toBe(true);
      expect(looksNumeric('\t-4.00\n')).toBe(true);
    });

    it('rejects empty and absent text', () => {
      expect(looksNumeric('')).toBe(false);
      expect(looksNumeric('   ')).toBe(false);
      expect(looksNumeric(null)).toBe(false);
      expect(looksNumeric(undefined)).toBe(false);
    });

    it('rejects everything that is not a plain number', () => {
      expect(looksNumeric('12%')).toBe(false);
      expect(looksNumeric('1.2.3')).toBe(false);
      expect(looksNumeric('(4.00)')).toBe(false);
      expect(looksNumeric('abc')).toBe(false);
      expect(looksNumeric('12 34')).toBe(false);
      expect(looksNumeric('1,2,3.4.5')).toBe(false);
    });

    it('rejects more than one currency symbol, or a trailing one', () => {
      expect(looksNumeric('££12')).toBe(false);
      expect(looksNumeric('12£')).toBe(false);
    });
  });

  describe('adjacentReviewTableId', () => {
    const tables = [
      { tableId: 'a' },
      { tableId: 'gone', deleted: true },
      { tableId: 'b' },
      { tableId: 'c' },
    ];

    it('steps to the next and previous table in list order', () => {
      expect(adjacentReviewTableId(tables, 'b', 1)).toBe('c');
      expect(adjacentReviewTableId(tables, 'b', -1)).toBe('a');
    });

    it('skips deleted tables', () => {
      expect(adjacentReviewTableId(tables, 'a', 1)).toBe('b');
      expect(adjacentReviewTableId(tables, 'b', -1)).toBe('a');
    });

    it('is null past either end, or for a table not in the list', () => {
      expect(adjacentReviewTableId(tables, 'a', -1)).toBeNull();
      expect(adjacentReviewTableId(tables, 'c', 1)).toBeNull();
      expect(adjacentReviewTableId(tables, 'missing', 1)).toBeNull();
      expect(adjacentReviewTableId(undefined, 'a', 1)).toBeNull();
    });
  });

  describe('isWideText', () => {
    it('is true only above the threshold, not at it', () => {
      expect(isWideText('abcd', 3)).toBe(true);
      expect(isWideText('abc', 3)).toBe(false);
      expect(isWideText('ab', 3)).toBe(false);
    });

    it('measures the trimmed text, so padding cannot make it wide', () => {
      expect(isWideText('  ab  ', 3)).toBe(false);
      expect(isWideText('  abcd  ', 3)).toBe(true);
    });

    it('measures the longest line when given a line-break pattern', () => {
      const pattern = /[\r\n]+/;
      expect(isWideText('abc\nab\r\nabc', 3, pattern)).toBe(false);
      expect(isWideText('ab\nabcd', 3, pattern)).toBe(true);
      expect(isWideText('  ab  \n  abc  ', 3, pattern)).toBe(false);
    });

    it('rejects empty and absent text', () => {
      expect(isWideText('', 3)).toBe(false);
      expect(isWideText('   ', 3)).toBe(false);
      expect(isWideText(null, 3)).toBe(false);
      expect(isWideText(undefined, 3)).toBe(false);
    });
  });

  describe('columnLabel', () => {
    it('names the first twenty-six columns A to Z', () => {
      expect(columnLabel(0)).toBe('A');
      expect(columnLabel(1)).toBe('B');
      expect(columnLabel(25)).toBe('Z');
    });

    it('carries into two letters after Z, with no gap at the boundary', () => {
      expect(columnLabel(26)).toBe('AA');
      expect(columnLabel(27)).toBe('AB');
      expect(columnLabel(51)).toBe('AZ');
      expect(columnLabel(52)).toBe('BA');
    });

    it('carries into three letters after ZZ', () => {
      expect(columnLabel(701)).toBe('ZZ');
      expect(columnLabel(702)).toBe('AAA');
    });
  });

  describe('cellCoordinate', () => {
    it('is the column letters followed by the 1-based row number', () => {
      expect(cellCoordinate(0, 0)).toBe('A1');
      expect(cellCoordinate(1, 1)).toBe('B2');
      expect(cellCoordinate(9, 26)).toBe('AA10');
    });
  });

  describe('belowHighConfidenceCells', () => {
    const sourced = (confidence) => ({
      tableId: 'alpha',
      row: 0,
      column: 0,
      text: 'x',
      confidence,
    });
    const sourceless = (confidence) => ({
      tableId: '',
      row: 0,
      column: 0,
      text: '',
      confidence,
    });

    it('lists every cell below the threshold, in reading order, with its coordinate', () => {
      expect(
        belowHighConfidenceCells(
          [
            [sourced(10), sourced(90)],
            [sourced(79), sourced(60)],
          ],
          80
        )
      ).toEqual([
        { rowIndex: 0, columnIndex: 0, label: 'A1' },
        { rowIndex: 1, columnIndex: 0, label: 'A2' },
        { rowIndex: 1, columnIndex: 1, label: 'B2' },
      ]);
    });

    it('does not list a cell sitting exactly on the threshold', () => {
      expect(belowHighConfidenceCells([[sourced(80)]], 80)).toEqual([]);
      expect(belowHighConfidenceCells([[sourced(79.9)]], 80)).toHaveLength(1);
    });

    it('ignores sourceless positions, which read 0 only because nothing read them', () => {
      expect(
        belowHighConfidenceCells([[sourceless(0), sourced(0)]], 80)
      ).toEqual([{ rowIndex: 0, columnIndex: 1, label: 'B1' }]);
    });

    it('lists a section-title cell like any other', () => {
      expect(
        belowHighConfidenceCells(
          [[{ tableId: 'alpha', sectionTitleIndex: 0, text: 'x', confidence: 20 }]],
          80
        )
      ).toEqual([{ rowIndex: 0, columnIndex: 0, label: 'A1' }]);
    });

    it('numbers rows from the very top, header rows included, so top left is A1', () => {
      expect(
        belowHighConfidenceCells([[sourced(10)], [sourced(10)]], 80).map(
          (c) => c.label
        )
      ).toEqual(['A1', 'A2']);
    });

    it('is empty for an empty grid or a missing one', () => {
      expect(belowHighConfidenceCells([], 80)).toEqual([]);
      expect(belowHighConfidenceCells(undefined, 80)).toEqual([]);
      expect(belowHighConfidenceCells(null, 80)).toEqual([]);
    });

    it('skips a covered position when a layout is supplied', () => {
      const rows = [[sourced(10)], [sourced(10)]];
      const layout = [[{ rowSpan: 2, columnSpan: 1 }], [null]];
      expect(belowHighConfidenceCells(rows, 80, layout)).toEqual([
        { rowIndex: 0, columnIndex: 0, label: 'A1' },
      ]);
      expect(belowHighConfidenceCells(rows, 80)).toEqual([
        { rowIndex: 0, columnIndex: 0, label: 'A1' },
        { rowIndex: 1, columnIndex: 0, label: 'A2' },
      ]);
    });
  });

  describe('mergedCellLayout', () => {
    const SINGLE = 1;
    const one = { rowSpan: 1, columnSpan: 1 };
    const cell = (spans = {}) => ({
      tableId: 'alpha',
      row: 0,
      column: 0,
      text: 'x',
      confidence: 90,
      ...spans,
    });
    const grid = (rowCount, columnCount) =>
      Array.from({ length: rowCount }, () =>
        Array.from({ length: columnCount }, () => cell())
      );

    it('gives every entry a single span for an unmerged grid', () => {
      expect(mergedCellLayout(grid(2, 3), SINGLE)).toEqual([
        [one, one, one],
        [one, one, one],
      ]);
    });

    it('covers the position below a two-row merge', () => {
      const rows = grid(2, 1);
      rows[0][0] = cell({ rowSpan: 2 });
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [{ rowSpan: 2, columnSpan: 1 }],
        [null],
      ]);
    });

    it('covers the position right of a two-column merge', () => {
      const rows = grid(1, 2);
      rows[0][0] = cell({ columnSpan: 2 });
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [{ rowSpan: 1, columnSpan: 2 }, null],
      ]);
    });

    it('covers three positions for a 2x2 merge at the top left of a 3x3 grid', () => {
      const rows = grid(3, 3);
      rows[0][0] = cell({ rowSpan: 2, columnSpan: 2 });
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [{ rowSpan: 2, columnSpan: 2 }, null, one],
        [null, null, one],
        [one, one, one],
      ]);
    });

    it('clamps spans running past the bottom and right edges', () => {
      const rows = grid(2, 2);
      rows[1][0] = cell({ rowSpan: 5 });
      rows[0][1] = cell({ columnSpan: 5 });
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [one, one],
        [one, one],
      ]);
      const tall = grid(2, 2);
      tall[0][1] = cell({ rowSpan: 5, columnSpan: 5 });
      expect(mergedCellLayout(tall, SINGLE)).toEqual([
        [one, { rowSpan: 2, columnSpan: 1 }],
        [one, null],
      ]);
    });

    it('treats absent, zero, negative and fractional spans as single', () => {
      [undefined, 0, -1, 1.5].forEach((value) => {
        const rows = grid(2, 2);
        rows[0][0] = cell({ rowSpan: value, columnSpan: value });
        expect(mergedCellLayout(rows, SINGLE)).toEqual([
          [one, one],
          [one, one],
        ]);
      });
    });

    it('treats a section-title cell as single', () => {
      expect(
        mergedCellLayout(
          [[{ tableId: 'alpha', sectionTitleIndex: 0, text: 'x', confidence: 20 }]],
          SINGLE
        )
      ).toEqual([[one]]);
    });

    it('draws an overlapping later merge single while the earlier keeps its spans', () => {
      const rows = grid(2, 2);
      rows[0][1] = cell({ rowSpan: 2 });
      rows[1][0] = cell({ columnSpan: 2 });
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [one, { rowSpan: 2, columnSpan: 1 }],
        [one, null],
      ]);
    });

    it('keeps a claimed position null in a shorter later row', () => {
      const rows = [[cell({ rowSpan: 2, columnSpan: 2 }), cell()], [cell()]];
      expect(mergedCellLayout(rows, SINGLE)).toEqual([
        [{ rowSpan: 2, columnSpan: 2 }, null],
        [null],
      ]);
    });

    it('is empty for missing or empty rows', () => {
      expect(mergedCellLayout(undefined, SINGLE)).toEqual([]);
      expect(mergedCellLayout(null, SINGLE)).toEqual([]);
      expect(mergedCellLayout([], SINGLE)).toEqual([]);
    });
  });

  describe('flaggedForReviewLabel', () => {
    it('is singular for exactly one', () => {
      expect(flaggedForReviewLabel(1)).toBe('1 entry flagged for review');
    });

    it('is plural for none, two, and many', () => {
      expect(flaggedForReviewLabel(0)).toBe('0 entries flagged for review');
      expect(flaggedForReviewLabel(2)).toBe('2 entries flagged for review');
      expect(flaggedForReviewLabel(17)).toBe('17 entries flagged for review');
    });
  });

  describe('lowConfidenceTitle', () => {
    const titleLabel = 'Title';
    const title = (confidence, text = 'Motor claims') => ({
      tableId: 'alpha',
      text,
      confidence,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });

    it('has nothing to flag when there is no title', () => {
      expect(lowConfidenceTitle(null, 80, titleLabel)).toBeNull();
      expect(lowConfidenceTitle(undefined, 80, titleLabel)).toBeNull();
    });

    it('flags a title read below the threshold, passing the label through', () => {
      expect(lowConfidenceTitle(title(20), 80, titleLabel)).toEqual({
        title: true,
        label: titleLabel,
      });
      expect(lowConfidenceTitle(title(79.9), 80, 'Table title')).toEqual({
        title: true,
        label: 'Table title',
      });
    });

    it('does not flag a title sitting exactly on the threshold', () => {
      expect(lowConfidenceTitle(title(80), 80, titleLabel)).toBeNull();
    });

    it('does not flag a title read above the threshold', () => {
      expect(lowConfidenceTitle(title(95), 80, titleLabel)).toBeNull();
    });

    it('flags a title that is present but was never read', () => {
      expect(lowConfidenceTitle(title(0, ''), 80, titleLabel)).toEqual({
        title: true,
        label: titleLabel,
      });
    });
  });

  describe('adjacentPoorCell', () => {
    const poor = [
      { rowIndex: 0, columnIndex: 1, label: 'B1' },
      { rowIndex: 2, columnIndex: 0, label: 'A3' },
      { rowIndex: 3, columnIndex: 4, label: 'E4' },
    ];

    it('steps forward and back through the list', () => {
      expect(adjacentPoorCell(poor, { label: 'A3' }, 1)).toEqual(poor[2]);
      expect(adjacentPoorCell(poor, { label: 'A3' }, -1)).toEqual(poor[0]);
    });

    it('stops at each end rather than wrapping round', () => {
      expect(adjacentPoorCell(poor, { label: 'B1' }, -1)).toBeNull();
      expect(adjacentPoorCell(poor, { label: 'E4' }, 1)).toBeNull();
    });

    it('enters the list at the near end when nothing is selected', () => {
      expect(adjacentPoorCell(poor, null, 1)).toEqual(poor[0]);
      expect(adjacentPoorCell(poor, null, -1)).toEqual(poor[2]);
    });

    it('enters at the near end when the selection is not itself poor', () => {
      // A confident cell can be selected by clicking it; stepping from there has to
      // start somewhere rather than refuse.
      const confident = { rowIndex: 9, columnIndex: 9, label: 'J10' };
      expect(adjacentPoorCell(poor, confident, 1)).toEqual(poor[0]);
      expect(adjacentPoorCell(poor, confident, -1)).toEqual(poor[2]);
    });

    it('matches by label, so the title entry takes part despite having no coordinate', () => {
      const withTitle = [{ title: true, label: 'Title' }, ...poor];
      expect(adjacentPoorCell(withTitle, { title: true, label: 'Title' }, 1)).toEqual(
        poor[0]
      );
      expect(adjacentPoorCell(withTitle, { label: 'B1' }, -1)).toEqual(
        withTitle[0]
      );
      expect(
        adjacentPoorCell(withTitle, { title: true, label: 'Title' }, -1)
      ).toBeNull();
    });

    it('has nowhere to go in an empty or missing list', () => {
      expect(adjacentPoorCell([], null, 1)).toBeNull();
      expect(adjacentPoorCell([], { label: 'A1' }, -1)).toBeNull();
      expect(adjacentPoorCell(undefined, null, 1)).toBeNull();
    });
  });

  describe('confidenceLabel', () => {
    it('states the confidence as a whole percent', () => {
      expect(confidenceLabel(87)).toBe('Confidence 87%');
      expect(confidenceLabel(100)).toBe('Confidence 100%');
      // 0 is a reading, and the worst one: it is stated, not called unknown.
      expect(confidenceLabel(0)).toBe('Confidence 0%');
    });

    it('rounds a fractional confidence', () => {
      expect(confidenceLabel(87.4)).toBe('Confidence 87%');
      expect(confidenceLabel(87.5)).toBe('Confidence 88%');
    });

    it('says unknown rather than 0% when there is no confidence at all', () => {
      // Padding and appended labels carry no reading; claiming 0% would report a bad
      // reading where in fact there was none.
      expect(confidenceLabel(undefined)).toBe('Confidence unknown');
      expect(confidenceLabel(null)).toBe('Confidence unknown');
      expect(confidenceLabel('90')).toBe('Confidence unknown');
      expect(confidenceLabel(NaN)).toBe('Confidence unknown');
    });
  });
});

describe('lowConfidenceSectionTitle', () => {
  const label = 'Section Title';

  it('flags a section title read below the threshold', () => {
    expect(
      lowConfidenceSectionTitle({ text: 'Motor', confidence: 40 }, 80, label)
    ).toEqual({ sectionTitle: true, label });
  });

  it('does not flag one read at or above it', () => {
    expect(
      lowConfidenceSectionTitle({ text: 'Motor', confidence: 80 }, 80, label)
    ).toBeNull();
  });

  // An unsplit table has none, and neither do the rows above the first section title.
  it('flags nothing when the table was not split on one', () => {
    expect(lowConfidenceSectionTitle(null, 80, label)).toBeNull();
    expect(lowConfidenceSectionTitle(undefined, 80, label)).toBeNull();
  });

  // A section title present but never read is exactly what must be flagged.
  it('flags one that was never read', () => {
    expect(
      lowConfidenceSectionTitle({ text: '', confidence: 0 }, 80, label)
    ).toEqual({ sectionTitle: true, label });
  });
});

describe('reviewRowNumbers', () => {
  it('numbers every row index + 1 when no rows are joined', () => {
    expect(reviewRowNumbers(4, 1, [])).toEqual([1, 2, 3, 4]);
  });

  it('numbers a joined pair as one row', () => {
    expect(reviewRowNumbers(6, 1, [2])).toEqual([1, 2, 3, null, 4, 5]);
  });

  it('numbers a chain of joined rows as one row', () => {
    expect(reviewRowNumbers(6, 1, [2, 3])).toEqual([1, 2, 3, null, null, 4]);
  });

  it('leaves header rows numbered index + 1', () => {
    expect(reviewRowNumbers(5, 2, [2])).toEqual([1, 2, 3, null, 4]);
  });

  it('ignores entries naming a header row, the last row or beyond', () => {
    expect(reviewRowNumbers(4, 2, [0, 1, 3, 7, -1])).toEqual([1, 2, 3, 4]);
  });

  it('treats a missing list as empty', () => {
    expect(reviewRowNumbers(3, 1, undefined)).toEqual([1, 2, 3]);
    expect(reviewRowNumbers(3, 1, null)).toEqual([1, 2, 3]);
  });
});

describe('cellTextLines', () => {
  const pattern = /[\r\n]+/;

  it('returns one line when there is no break', () => {
    expect(cellTextLines('abc', pattern)).toEqual(['abc']);
  });

  it('splits on a lone \\n, a lone \\r and \\r\\n', () => {
    expect(cellTextLines('a\nb', pattern)).toEqual(['a', 'b']);
    expect(cellTextLines('a\rb', pattern)).toEqual(['a', 'b']);
    expect(cellTextLines('a\r\nb', pattern)).toEqual(['a', 'b']);
  });

  it('treats a mixed run of breaks as one break', () => {
    expect(cellTextLines('a\r\n\n\rb', pattern)).toEqual(['a', 'b']);
  });

  it('keeps an empty first or last line for a leading or trailing run', () => {
    expect(cellTextLines('\na', pattern)).toEqual(['', 'a']);
    expect(cellTextLines('a\r\n', pattern)).toEqual(['a', '']);
  });

  it('returns a single empty line for an empty string', () => {
    expect(cellTextLines('', pattern)).toEqual(['']);
  });

  it('returns a non-string value unchanged in a one-element array', () => {
    expect(cellTextLines(null, pattern)).toEqual([null]);
    expect(cellTextLines(undefined, pattern)).toEqual([undefined]);
    expect(cellTextLines(42, pattern)).toEqual([42]);
  });
});
