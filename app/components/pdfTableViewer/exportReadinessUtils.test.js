import {
  allExportReady,
  isExportReady,
  lowConfidenceValues,
  shownSectionTitles,
} from 'components/pdfTableViewer/exportReadinessUtils';

const HIGH = 80;
const READY = 6;
// The name the Section Title Row tool writes, whose column the merge splits on and drops.
const PLACEHOLDER = '~~SECTION-TITLE~~';

// A table prepared far enough for the Review button to be offered, with whatever values
// the case is about.
const readyTable = (fields) => ({
  tableId: 't-1',
  confirmationStage: READY,
  ...fields,
});

const cell = (row, column, confidence) => ({
  row,
  column,
  text: 'x',
  confidence,
});

describe('lowConfidenceValues', () => {
  it('answers nothing for a table whose cells were all read confidently', () => {
    const table = readyTable({ cells: [cell(0, 0, 80), cell(0, 1, 99)] });

    expect(lowConfidenceValues(table, HIGH)).toEqual([]);
  });

  it('answers the cells read below the threshold', () => {
    const table = readyTable({
      cells: [cell(0, 0, 79), cell(0, 1, 99), cell(1, 0, 12)],
    });

    expect(lowConfidenceValues(table, HIGH)).toHaveLength(2);
  });

  // The threshold is the lowest reading counted as good, matching the review screen.
  it('does not count a value sitting exactly on the threshold', () => {
    const table = readyTable({ cells: [cell(0, 0, HIGH)] });

    expect(lowConfidenceValues(table, HIGH)).toEqual([]);
  });

  // An absent reading is not a good one.
  it('counts a value whose confidence is not a finite number as confidence 0', () => {
    const absent = readyTable({ cells: [{ row: 0, column: 0, text: 'x' }] });
    const nulled = readyTable({ cells: [cell(0, 0, null)] });
    const nan = readyTable({ cells: [cell(0, 0, Number.NaN)] });

    expect(lowConfidenceValues(absent, HIGH)).toHaveLength(1);
    expect(lowConfidenceValues(nulled, HIGH)).toHaveLength(1);
    expect(lowConfidenceValues(nan, HIGH)).toHaveLength(1);
  });

  it('counts a low confidence title alongside the cells', () => {
    const table = readyTable({
      cells: [cell(0, 0, 99)],
      title: { text: 'Losses', confidence: 20 },
    });

    expect(lowConfidenceValues(table, HIGH)).toHaveLength(1);
  });

  it('counts a low confidence section title value', () => {
    const table = readyTable({
      cells: [cell(0, 0, 99)],
      sectionTitles: [
        { data: { text: 'Motor', confidence: 99 } },
        { data: { text: 'Property', confidence: 30 } },
      ],
    });

    expect(lowConfidenceValues(table, HIGH)).toHaveLength(1);
  });

  it('answers nothing, rather than throwing, for a table holding no values', () => {
    expect(lowConfidenceValues(readyTable({}), HIGH)).toEqual([]);
    expect(lowConfidenceValues(undefined, HIGH)).toEqual([]);
    expect(lowConfidenceValues(null, HIGH)).toEqual([]);
  });

  it('ignores a section title entry carrying no data', () => {
    const table = readyTable({ sectionTitles: [{}, { data: null }] });

    expect(lowConfidenceValues(table, HIGH)).toEqual([]);
  });
});

describe('isExportReady', () => {
  // The root's own title counts: it IS the review screen's title.
  it('counts the root\'s own low confidence title', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      title: { text: '', confidence: 0 },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  it('refuses a table below the minimum stage however clean its values are', () => {
    const table = { ...readyTable({ cells: [cell(0, 0, 99)] }), confirmationStage: READY - 1 };

    expect(isExportReady(table, HIGH, READY)).toBe(false);
  });

  it('refuses a table carrying no stage at all', () => {
    const table = { tableId: 't-1', cells: [cell(0, 0, 99)] };

    expect(isExportReady(table, HIGH, READY)).toBe(false);
  });

  it('accepts a prepared table whose every value was read confidently', () => {
    const table = readyTable({
      cells: [cell(0, 0, 99), cell(0, 1, HIGH)],
      title: { text: 'Losses', confidence: 95 },
    });

    expect(isExportReady(table, HIGH, READY)).toBe(true);
  });

  it('refuses a prepared table with a value read below the threshold', () => {
    const table = readyTable({ cells: [cell(0, 0, 99), cell(0, 1, 40)] });

    expect(isExportReady(table, HIGH, READY)).toBe(false);
  });

  // A bordered table has cells, so an empty one is not a table the extraction has still
  // to reach: it holds nothing for the user to look at, and so is ready.
  it('accepts a prepared table holding no values at all', () => {
    expect(isExportReady(readyTable({}), HIGH, READY)).toBe(true);
  });

  it('refuses a root whose own values are clean but whose linked member is not', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          cells: [cell(0, 0, 30)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  it('accepts a root whose group is clean throughout', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          cells: [cell(0, 0, 90)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  // The member's own stage says nothing: a joined table is off the top-level list and is
  // never marked ready in its own right.
  it('judges a member by its values alone, not by its stage', () => {
    const root = readyTable({
      next: {
        'joined-1': { tableId: 'joined-1', pdfPage: 1, cells: [cell(0, 0, 99)] },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  // The review screen's title is the ROOT's: `AmalgamatedTitle` is built from the root
  // alone, so a member's own title is never shown there and cannot be corrected. Counting
  // it would block the root for ever with nothing on screen to fix.
  it('ignores a linked member\'s own title, which the review screen never shows', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      title: { text: 'Losses', confidence: 95 },
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          cells: [cell(0, 0, 90)],
          // Seeded by the Title tool and never read.
          title: { text: '', confidence: 0 },
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  // A member's cells and section titles DO appear in the merged grid, each naming its
  // source table, so they stay countable.
  it('still counts a linked member\'s section title values', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      grid: [['t-1'], ['joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          cells: [cell(0, 0, 90), cell(1, 0, 90)],
          sectionTitles: [
            {
              tableRow: 0,
              columnName: PLACEHOLDER,
              data: { text: 'Motor', confidence: 15 },
            },
          ],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(false);
  });

  // A group's merged grid takes its header rows from the grid's TOP ROW and every table's
  // DATA rows only, so a member stacked below the root contributes no header cells to the
  // review screen — and a poor reading in one can never be corrected there.
  it('ignores a stacked member\'s header cells, which the merged grid drops', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      headerCount: 3,
      grid: [['t-1'], ['joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          headerCount: 3,
          cells: [cell(2, 0, 70), cell(3, 0, 96)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  it('still counts a stacked member\'s data cells', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      headerCount: 3,
      grid: [['t-1'], ['joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          headerCount: 3,
          cells: [cell(2, 0, 99), cell(3, 0, 40)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  // A member joined ALONGSIDE the root sits in the grid's top row, so its header rows are
  // emitted and do count.
  it('counts a side-by-side member\'s header cells', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      headerCount: 3,
      grid: [['t-1', 'joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          headerCount: 3,
          cells: [cell(2, 0, 70)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  // The merged grid's header block is as deep as the ROOT's, so a top-row member whose own
  // header block goes deeper keeps rows the merge draws neither as header rows nor as data
  // rows. They are hidden exactly as a stacked member's are, and are not counted.
  it('ignores a side-by-side member\'s header cells below the root\'s header block', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      headerCount: 2,
      grid: [['t-1', 'joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          headerCount: 4,
          cells: [cell(2, 0, 20), cell(3, 0, 30), cell(4, 0, 99)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  // The merge splits the grid on the placeholder column and keeps ONE section title per
  // distinct value: the one carried when that value's first row was emitted. A second
  // section title reading the same text supplies rows to a tab that names the first, so it
  // is drawn nowhere the reviewer could correct it. Two section titles that were never read
  // both read as blank, which is how a stacked group of unread section titles used to stick
  // on "Review" for ever.
  describe('section titles the split leaves unreachable', () => {
    // A stacked group of `texts`, one member per entry after the root, each carrying a
    // section title on its first row and a data row below it.
    const stackedGroup = (texts) => ({
      tableId: 't-1',
      confirmationStage: READY,
      cells: [cell(0, 0, 99)],
      grid: texts.map((_, index) => [index === 0 ? 't-1' : `joined-${index}`]),
      next: Object.fromEntries(
        texts.slice(1).map((text, index) => [
          `joined-${index + 1}`,
          {
            tableId: `joined-${index + 1}`,
            pdfPage: index + 1,
            cells: [cell(0, 0, 99), cell(1, 0, 99)],
            sectionTitles: [
              {
                tableRow: 0,
                columnName: PLACEHOLDER,
                data: { text, confidence: 10 },
              },
            ],
          },
        ])
      ),
    });

    it('shows the first section title of each distinct value and no other', () => {
      const shown = shownSectionTitles(
        stackedGroup([null, 'Motor', 'Property', 'Motor']),
        PLACEHOLDER
      );

      expect(shown.get('joined-1')).toEqual(new Set([0]));
      expect(shown.get('joined-2')).toEqual(new Set([0]));
      expect(shown.get('joined-3')).toBeUndefined();
    });

    it('counts the first of two section titles reading the same text', () => {
      const root = stackedGroup([null, 'Motor', 'Motor']);

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(false);
    });

    // Both members' section titles are unread, so both read blank; the first claims that
    // value and the second can never be reached. With the first corrected there is nothing
    // left on the review screen and the group is ready.
    it('accepts a group whose only remaining values are unreachable duplicates', () => {
      const root = stackedGroup([null, null, null]);
      root.next['joined-1'].sectionTitles[0].data = { text: '', confidence: 99 };

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(true);
    });

    // The rows above a group's first section title carry no value at all, so they claim the
    // blank tab for no section title — and an unread one below can never reach it.
    it('ignores a blank section title whose tab the rows above it already claimed', () => {
      const root = stackedGroup([null, null]);
      root.headerCount = 0;
      root.cells = [cell(0, 0, 99), cell(1, 0, 99)];

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(true);
    });

    // Only the spine carries a section-title value forward. A table joined ALONGSIDE one has
    // its section-title rows dropped from its data rows and its value carried nowhere.
    it('ignores a section title on a table joined alongside the spine', () => {
      const root = {
        tableId: 't-1',
        confirmationStage: READY,
        cells: [cell(0, 0, 99), cell(1, 0, 99)],
        grid: [['t-1', 'joined-1']],
        next: {
          'joined-1': {
            tableId: 'joined-1',
            pdfPage: 0,
            cells: [cell(0, 0, 99), cell(1, 0, 99)],
            sectionTitles: [
              {
                tableRow: 0,
                columnName: PLACEHOLDER,
                data: { text: 'Motor', confidence: 10 },
              },
            ],
          },
        },
      };

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(true);
    });

    // Nothing is carried onto a row that never comes, so the value names no tab.
    it('ignores a section title with no row below it', () => {
      const root = {
        tableId: 't-1',
        confirmationStage: READY,
        cells: [cell(0, 0, 99), cell(1, 0, 99)],
        rowHeights: [{ value: 1 }, { value: 1 }],
        sectionTitles: [
          {
            tableRow: 1,
            columnName: PLACEHOLDER,
            data: { text: 'Motor', confidence: 10 },
          },
        ],
      };

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(true);
    });

    // A section title named for a column of its own is not split on: that column survives
    // into the merged grid, so its value is drawn there and stays correctable.
    it('counts a section title named for a column of its own', () => {
      const root = {
        tableId: 't-1',
        confirmationStage: READY,
        cells: [cell(0, 0, 99), cell(1, 0, 99)],
        sectionTitles: [
          {
            tableRow: 0,
            columnName: 'Year',
            data: { text: '2024', confidence: 10 },
          },
        ],
      };

      expect(isExportReady(root, HIGH, READY, PLACEHOLDER)).toBe(false);
    });
  });

  // The root's own header cells are emitted as the merged grid's header rows.
  it('counts the root\'s own header cells', () => {
    const root = readyTable({ headerCount: 3, cells: [cell(1, 0, 55)] });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  // A section-title row contributes no cells to the merged grid: the row is skipped whole
  // and only its carried value travels, so a poor reading anywhere else along it is drawn
  // nowhere the reviewer could correct it.
  it('ignores cells in a section title row', () => {
    const root = readyTable({
      headerCount: 1,
      sectionTitles: [{ tableRow: 2, columnName: 'X', data: { text: 'A', confidence: 99 } }],
      cells: [cell(1, 0, 99), cell(2, 0, 0), cell(2, 5, 13), cell(3, 0, 99)],
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  it('still counts cells in the rows either side of it', () => {
    const root = readyTable({
      headerCount: 1,
      sectionTitles: [{ tableRow: 2, columnName: 'X', data: { text: 'A', confidence: 99 } }],
      cells: [cell(1, 0, 99), cell(2, 0, 0), cell(3, 0, 12)],
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  it('ignores cells in a linked member\'s section title row', () => {
    const root = readyTable({
      cells: [cell(0, 0, 99)],
      grid: [['t-1'], ['joined-1']],
      next: {
        'joined-1': {
          tableId: 'joined-1',
          pdfPage: 1,
          headerCount: 1,
          sectionTitles: [{ tableRow: 2, columnName: 'X', data: { text: 'A', confidence: 99 } }],
          cells: [cell(1, 0, 99), cell(2, 3, 13), cell(2, 4, 0)],
        },
      },
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  // A section-title row inside the header block still reaches the merged grid through the
  // header rows, so it is judged on the header rule rather than dropped.
  it('keeps a header row that is also a section title row for a top-row table', () => {
    const root = readyTable({
      headerCount: 2,
      sectionTitles: [{ tableRow: 1, columnName: 'X', data: { text: 'A', confidence: 99 } }],
      cells: [cell(1, 0, 20)],
    });

    expect(isExportReady(root, HIGH, READY)).toBe(false);
  });

  // The operator's rule for a subtotal row: only its section title matters. The row's own
  // cells are the subtotal figures, which the merge drops and the export never carries.
  it('counts a subtotal row\'s section title and nothing else along it', () => {
    const subtotalRow = (titleConfidence) =>
      readyTable({
        headerCount: 1,
        sectionTitles: [
          {
            tableRow: 2,
            delete: false,
            columnName: '~~SECTION-TITLE~~',
            data: { text: 'Section A', confidence: titleConfidence },
          },
        ],
        cells: [cell(1, 0, 99), cell(2, 3, 13), cell(2, 11, 0), cell(3, 0, 99)],
      });

    expect(isExportReady(subtotalRow(99), HIGH, READY)).toBe(true);
    expect(isExportReady(subtotalRow(20), HIGH, READY)).toBe(false);
  });

  // A hidden row is marked by a section title carrying no data at all. Nothing along it is
  // relevant, and it has no value of its own to read.
  it('ignores a hidden row entirely', () => {
    const root = readyTable({
      headerCount: 1,
      sectionTitles: [
        { tableRow: 2, delete: true, columnName: null, data: null },
      ],
      cells: [cell(1, 0, 99), cell(2, 0, 0), cell(2, 4, 11), cell(3, 0, 99)],
    });

    expect(isExportReady(root, HIGH, READY)).toBe(true);
  });

  it('refuses an absent table rather than throwing', () => {
    expect(isExportReady(undefined, HIGH, READY)).toBe(false);
    expect(isExportReady(null, HIGH, READY)).toBe(false);
  });
});

describe('allExportReady', () => {
  const clean = (tableId) => ({
    tableId,
    confirmationStage: READY,
    cells: [cell(0, 0, 99)],
  });

  it('accepts a list whose every table is ready', () => {
    expect(allExportReady([clean('t-1'), clean('t-2')], HIGH, READY)).toBe(true);
  });

  it('refuses a list holding one table that is not', () => {
    const poor = { ...clean('t-2'), cells: [cell(0, 0, 10)] };

    expect(allExportReady([clean('t-1'), poor], HIGH, READY)).toBe(false);
  });

  // Emptiness is the caller's question: there is no point exporting nothing, and the
  // Export button tests that separately.
  it('is vacuously true for an empty or absent list', () => {
    expect(allExportReady([], HIGH, READY)).toBe(true);
    expect(allExportReady(undefined, HIGH, READY)).toBe(true);
  });
});
