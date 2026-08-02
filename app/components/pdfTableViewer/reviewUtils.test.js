import {
  looksNumeric,
  isWideText,
  adjacentPoorCell,
  belowHighConfidenceCells,
  cellCoordinate,
  columnLabel,
  flaggedForReviewLabel,
  lowConfidenceTitle,
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
});
