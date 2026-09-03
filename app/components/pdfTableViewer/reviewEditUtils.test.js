import {
  isSectionTitleCell,
  isTitleCell,
  cellSourceKey,
  findSourceTable,
  findSourceValue,
  applyEditToTables,
  applyEditToGrid,
  applyEditToSectionTitle,
  dialogPlacement,
  draggedPosition,
  sameRect,
} from 'components/pdfTableViewer/reviewEditUtils';

// A cell of the amalgamated grid: a reference back to a source table cell.
const gridCell = (tableId, row, column, text = '', confidence = 0) => ({
  tableId,
  row,
  column,
  text,
  confidence,
});

// A cell of the amalgamated grid carrying a section title's value instead.
const gridSectionTitle = (
  tableId,
  sectionTitleIndex,
  text = '',
  confidence = 0,
) => ({ tableId, sectionTitleIndex, text, confidence });

// A reference to a table's title rather than to a position in the grid.
const titleRef = (tableId, text = '', confidence = 0) => ({
  tableId,
  titleRef: true,
  text,
  confidence,
});

// A cell as it is held in the local document metadata.
const metadataCell = (row, column, text, confidence = 80) => ({
  row,
  column,
  rowSpan: 1,
  columnSpan: 1,
  bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.04 },
  text,
  confidence,
  header: false,
});

// A section title as it is held in the local document metadata.
const metadataSectionTitle = (tableRow, text, confidence = 70) => ({
  tableRow,
  delete: false,
  columnName: 'Year',
  data: {
    bounds: { left: 0.1, top: 0.5, width: 0.3, height: 0.04 },
    text,
    confidence,
  },
});

// A table's title as it is held in the local document metadata.
const metadataTitle = (text, confidence = 60) => ({
  bounds: { left: 0.1, top: 0.05, width: 0.4, height: 0.03 },
  text,
  confidence,
});

// The reviewed root, a table linked to it through `next`, and an unrelated
// table that no edit should ever touch. The root's cells are deliberately not
// in row-major order.
const makeTables = () => {
  const child = {
    tableId: 'child',
    name: 'Child',
    title: metadataTitle('Child title'),
    cells: [metadataCell(0, 0, 'child a'), metadataCell(0, 1, 'child b')],
    sectionTitles: [
      metadataSectionTitle(0, '2019'),
      metadataSectionTitle(2, '2020'),
    ],
    headerCount: 1,
  };
  const root = {
    tableId: 'root',
    name: 'Root',
    title: metadataTitle('Root title'),
    next: { child },
    cells: [
      metadataCell(1, 1, 'root d'),
      metadataCell(0, 1, 'root b'),
      metadataCell(1, 0, 'root c'),
      metadataCell(0, 0, 'root a'),
    ],
    sectionTitles: [metadataSectionTitle(1, '2018')],
    headerCount: 1,
  };
  const other = {
    tableId: 'other',
    name: 'Other',
    next: {},
    cells: [metadataCell(0, 0, 'other a')],
    sectionTitles: [],
    headerCount: 1,
  };
  return { root, child, other, tables: [root, other] };
};

describe('reviewEditUtils', () => {
  describe('isSectionTitleCell', () => {
    it('is true for a section title cell, including index zero', () => {
      expect(isSectionTitleCell({ sectionTitleIndex: 0 })).toBe(true);
      expect(isSectionTitleCell(gridSectionTitle('a', 0))).toBe(true);
      expect(isSectionTitleCell(gridSectionTitle('a', 3))).toBe(true);
    });

    it('is false for an ordinary cell', () => {
      expect(isSectionTitleCell(gridCell('a', 0, 0))).toBe(false);
      expect(isSectionTitleCell({ sectionTitleIndex: undefined })).toBe(false);
      expect(isSectionTitleCell({ sectionTitleIndex: null })).toBe(false);
    });

    it('is false for an absent cell', () => {
      expect(isSectionTitleCell(null)).toBe(false);
      expect(isSectionTitleCell(undefined)).toBe(false);
    });
  });

  describe('isTitleCell', () => {
    it('is true for a title reference', () => {
      expect(isTitleCell({ titleRef: true })).toBe(true);
      expect(isTitleCell(titleRef('a'))).toBe(true);
    });

    it('is false for an ordinary cell or a section title cell', () => {
      expect(isTitleCell(gridCell('a', 0, 0))).toBe(false);
      expect(isTitleCell(gridSectionTitle('a', 0))).toBe(false);
    });

    it('is false for an absent cell', () => {
      expect(isTitleCell(null)).toBe(false);
      expect(isTitleCell(undefined)).toBe(false);
    });
  });

  describe('cellSourceKey', () => {
    it('keys a section title distinctly from an ordinary cell', () => {
      const title = cellSourceKey(gridSectionTitle('t1', 2));
      const ordinary = cellSourceKey(gridCell('t1', 2, 0));
      expect(title).not.toBe(ordinary);
      expect(typeof title).toBe('string');
      expect(typeof ordinary).toBe('string');
    });

    it('gives different keys to different cells of one table', () => {
      expect(cellSourceKey(gridCell('t1', 0, 1))).not.toBe(
        cellSourceKey(gridCell('t1', 1, 0)),
      );
      expect(cellSourceKey(gridCell('t1', 0, 0))).not.toBe(
        cellSourceKey(gridCell('t2', 0, 0)),
      );
    });

    it('gives the same key to two references to one source', () => {
      expect(cellSourceKey(gridCell('t1', 1, 2, 'a'))).toBe(
        cellSourceKey(gridCell('t1', 1, 2, 'b')),
      );
      expect(cellSourceKey(gridSectionTitle('t1', 1, 'a'))).toBe(
        cellSourceKey(gridSectionTitle('t1', 1, 'b')),
      );
      expect(cellSourceKey(gridSectionTitle('t1', 0))).not.toBe(
        cellSourceKey(gridSectionTitle('t1', 1)),
      );
    });

    it('has no key for a cell with no source', () => {
      expect(cellSourceKey(gridCell('', 0, 0))).toBeNull();
      expect(cellSourceKey({ row: 0, column: 0, text: '', confidence: 0 })).toBeNull();
      expect(cellSourceKey({ sectionTitleIndex: 0 })).toBeNull();
      expect(cellSourceKey(null)).toBeNull();
    });

    it('keys a title reference by its table', () => {
      expect(cellSourceKey(titleRef('t1'))).toBe('t1:t');
      expect(cellSourceKey(titleRef('t1', 'a'))).toBe(
        cellSourceKey(titleRef('t1', 'b')),
      );
      expect(cellSourceKey(titleRef('t1'))).not.toBe(cellSourceKey(titleRef('t2')));
    });

    it('has no key for a title reference with no source', () => {
      expect(cellSourceKey(titleRef(''))).toBeNull();
      expect(cellSourceKey({ titleRef: true })).toBeNull();
    });

    it('keys the three kinds of source distinctly for one table', () => {
      const keys = [
        cellSourceKey(gridCell('t1', 0, 0)),
        cellSourceKey(gridSectionTitle('t1', 0)),
        cellSourceKey(titleRef('t1')),
      ];
      expect(new Set(keys).size).toBe(3);
    });
  });

  describe('findSourceTable', () => {
    it('finds the reviewed root itself', () => {
      const { root, tables } = makeTables();
      expect(findSourceTable(tables, 'root', gridCell('root', 0, 0))).toBe(root);
    });

    it('finds a linked table through next', () => {
      const { child, tables } = makeTables();
      expect(findSourceTable(tables, 'root', gridCell('child', 0, 0))).toBe(
        child,
      );
    });

    it('has no table for an unknown or blank table id', () => {
      const { tables } = makeTables();
      expect(findSourceTable(tables, 'root', gridCell('nope', 0, 0))).toBeNull();
      expect(findSourceTable(tables, 'root', gridCell('', 0, 0))).toBeNull();
      expect(findSourceTable(tables, 'root', gridCell('other', 0, 0))).toBeNull();
    });

    it('has no table when the reviewed root is not in the list', () => {
      const { tables } = makeTables();
      expect(findSourceTable(tables, 'missing', gridCell('root', 0, 0))).toBeNull();
      expect(findSourceTable([], 'root', gridCell('root', 0, 0))).toBeNull();
    });
  });

  describe('findSourceValue', () => {
    it('finds a cell by its source row and column, in any order', () => {
      const { root } = makeTables();
      expect(findSourceValue(root, gridCell('root', 1, 0)).text).toBe('root c');
      expect(findSourceValue(root, gridCell('root', 0, 1)).text).toBe('root b');
      expect(findSourceValue(root, gridCell('root', 1, 1))).toBe(root.cells[0]);
    });

    it("finds a section title's data", () => {
      const { child } = makeTables();
      expect(findSourceValue(child, gridSectionTitle('child', 1))).toBe(
        child.sectionTitles[1].data,
      );
      expect(findSourceValue(child, gridSectionTitle('child', 1)).text).toBe(
        '2020',
      );
    });

    it('has no value for a section title index out of range', () => {
      const { child } = makeTables();
      expect(findSourceValue(child, gridSectionTitle('child', 9))).toBeNull();
    });

    it('has no value for a row and column no cell holds', () => {
      const { root } = makeTables();
      expect(findSourceValue(root, gridCell('root', 7, 7))).toBeNull();
    });

    it("finds the table's title for a title reference", () => {
      const { root, child } = makeTables();
      expect(findSourceValue(root, titleRef('root'))).toBe(root.title);
      expect(findSourceValue(child, titleRef('child')).text).toBe('Child title');
    });

    it('has no value for a title reference to a table with no title', () => {
      const { root } = makeTables();
      expect(findSourceValue({ ...root, title: null }, titleRef('root'))).toBeNull();
      expect(
        findSourceValue({ tableId: 'root', cells: [] }, titleRef('root')),
      ).toBeNull();
    });
  });

  describe('applyEditToTables', () => {
    it('writes the new text and confidence into a linked child table', () => {
      const { tables } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        gridCell('child', 0, 1),
        'corrected',
        100,
      );
      const nextChild = next[0].next.child;
      const edited = nextChild.cells.find((c) => c.row === 0 && c.column === 1);
      expect(edited.text).toBe('corrected');
      expect(edited.confidence).toBe(100);
      expect(nextChild.cells.find((c) => c.column === 0).text).toBe('child a');
    });

    it('leaves the original tables unmutated', () => {
      const { tables, child, root } = makeTables();
      applyEditToTables(tables, 'root', gridCell('child', 0, 1), 'corrected', 100);
      expect(child.cells[1].text).toBe('child b');
      expect(child.cells[1].confidence).toBe(80);
      applyEditToTables(tables, 'root', gridCell('root', 0, 0), 'corrected', 100);
      expect(root.cells[3].text).toBe('root a');
    });

    it('returns untouched tables by identity', () => {
      const { tables, other } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        gridCell('child', 0, 1),
        'corrected',
        100,
      );
      expect(next[1]).toBe(other);
      expect(next).not.toBe(tables);
    });

    it('edits a cell of the reviewed root itself', () => {
      const { tables } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        gridCell('root', 1, 0),
        'fixed',
        100,
      );
      const edited = next[0].cells.find((c) => c.row === 1 && c.column === 0);
      expect(edited.text).toBe('fixed');
      expect(edited.confidence).toBe(100);
      expect(next[0].next.child).toBe(tables[0].next.child);
    });

    it('has no result when the source table or source cell is missing', () => {
      const { tables } = makeTables();
      expect(
        applyEditToTables(tables, 'root', gridCell('gone', 0, 0), 'x', 100),
      ).toBeNull();
      expect(
        applyEditToTables(tables, 'root', gridCell('root', 9, 9), 'x', 100),
      ).toBeNull();
      expect(
        applyEditToTables(tables, 'missing', gridCell('root', 0, 0), 'x', 100),
      ).toBeNull();
    });

    it('edits one section title and leaves its siblings alone', () => {
      const { tables } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        gridSectionTitle('child', 1),
        '2021',
        100,
      );
      const nextChild = next[0].next.child;
      expect(nextChild.sectionTitles[1].data.text).toBe('2021');
      expect(nextChild.sectionTitles[1].data.confidence).toBe(100);
      expect(nextChild.sectionTitles[0].data.text).toBe('2019');
      expect(nextChild.sectionTitles[0]).toBe(tables[0].next.child.sectionTitles[0]);
    });

    it('has no result for a section title index out of range', () => {
      const { tables } = makeTables();
      expect(
        applyEditToTables(tables, 'root', gridSectionTitle('child', 9), 'x', 100),
      ).toBeNull();
    });

    it("edits the reviewed root's title and nothing else on it", () => {
      const { tables, root } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        titleRef('root'),
        'Corrected title',
        100,
      );
      expect(next[0].title.text).toBe('Corrected title');
      expect(next[0].title.confidence).toBe(100);
      expect(next[0].title.bounds).toBe(root.title.bounds);
      expect(next[0].cells).toBe(root.cells);
      expect(next[0].sectionTitles).toBe(root.sectionTitles);
      expect(next[0].next.child).toBe(root.next.child);
      expect(root.title.text).toBe('Root title');
    });

    it("edits a linked child table's title", () => {
      const { tables, child, other } = makeTables();
      const next = applyEditToTables(
        tables,
        'root',
        titleRef('child'),
        'Corrected child',
        100,
      );
      const nextChild = next[0].next.child;
      expect(nextChild.title.text).toBe('Corrected child');
      expect(nextChild.title.confidence).toBe(100);
      expect(nextChild.cells).toBe(child.cells);
      expect(nextChild.sectionTitles).toBe(child.sectionTitles);
      expect(next[1]).toBe(other);
      expect(child.title.text).toBe('Child title');
    });

    it('has no result for a title reference with no title to edit', () => {
      const { tables, root } = makeTables();
      const untitled = tables.map((table) =>
        table === root ? { ...root, title: null } : table,
      );
      expect(
        applyEditToTables(untitled, 'root', titleRef('root'), 'x', 100),
      ).toBeNull();
      expect(
        applyEditToTables(tables, 'root', titleRef('gone'), 'x', 100),
      ).toBeNull();
    });
  });

  describe('applyEditToGrid', () => {
    it('updates the one matching ordinary cell and nothing else', () => {
      const target = gridCell('t1', 1, 1, 'old', 40);
      const rows = [
        [gridCell('t1', 0, 0, 'a', 90), gridCell('t1', 0, 1, 'b', 90)],
        [gridCell('t1', 1, 0, 'c', 90), target],
      ];
      const next = applyEditToGrid(rows, target, 'new', 100);
      expect(next[1][1].text).toBe('new');
      expect(next[1][1].confidence).toBe(100);
      expect(next[1][1].tableId).toBe('t1');
      expect(next[1][0]).toBe(rows[1][0]);
      expect(target.text).toBe('old');
    });

    it('returns a row with no match by identity', () => {
      const target = gridCell('t1', 1, 1, 'old', 40);
      const rows = [[gridCell('t1', 0, 0, 'a', 90)], [target]];
      const next = applyEditToGrid(rows, target, 'new', 100);
      expect(next[0]).toBe(rows[0]);
      expect(next[1]).not.toBe(rows[1]);
    });

    it('updates every position sharing one section title reference', () => {
      const target = gridSectionTitle('t1', 0, 'old', 40);
      const rows = [
        [gridSectionTitle('t1', 0, 'old', 40), gridCell('t1', 0, 0, 'a', 90)],
        [gridSectionTitle('t1', 0, 'old', 40), gridCell('t1', 1, 0, 'b', 90)],
        [gridSectionTitle('t1', 1, 'other', 40), gridCell('t1', 2, 0, 'c', 90)],
      ];
      const next = applyEditToGrid(rows, target, 'new', 100);
      expect(next[0][0].text).toBe('new');
      expect(next[1][0].text).toBe('new');
      expect(next[0][0].confidence).toBe(100);
      expect(next[1][0].confidence).toBe(100);
      expect(next[2][0].text).toBe('other');
      expect(next[2]).toBe(rows[2]);
      expect(next[0][1]).toBe(rows[0][1]);
    });

    it('leaves the grid alone for a cell with no source', () => {
      const rows = [[gridCell('', 0, 0, '', 0), gridCell('t1', 0, 0, 'a', 90)]];
      const next = applyEditToGrid(rows, gridCell('', 0, 0), 'new', 100);
      expect(next[0]).toBe(rows[0]);
    });

    it('leaves the grid alone for a title reference, which it never holds', () => {
      const rows = [
        [gridSectionTitle('t1', 0, 'old', 40), gridCell('t1', 0, 0, 'a', 90)],
        [gridCell('t1', 1, 0, 'b', 90), gridCell('t1', 1, 1, 'c', 90)],
      ];
      const next = applyEditToGrid(rows, titleRef('t1'), 'new', 100);
      expect(next[0]).toBe(rows[0]);
      expect(next[1]).toBe(rows[1]);
    });
  });

  // The heading a split tab was cut on. It is drawn above the grid rather than in it,
  // so it takes its correction through this rather than through applyEditToGrid.
  describe('applyEditToSectionTitle', () => {
    it('applies the correction to the heading the edit names', () => {
      const heading = gridSectionTitle('t1', 0, 'old', 40);
      const next = applyEditToSectionTitle(heading, heading, 'new', 100);
      expect(next).toEqual({ ...heading, text: 'new', confidence: 100 });
      expect(heading.text).toBe('old');
    });

    // Every tab of a split carries its own heading, and only the edited one moves.
    it('returns a heading of another section by identity', () => {
      const heading = gridSectionTitle('t1', 1, 'other', 40);
      const next = applyEditToSectionTitle(
        heading,
        gridSectionTitle('t1', 0, 'old', 40),
        'new',
        100,
      );
      expect(next).toBe(heading);
    });

    it('returns the heading by identity for an ordinary cell or a title', () => {
      const heading = gridSectionTitle('t1', 0, 'old', 40);
      expect(
        applyEditToSectionTitle(heading, gridCell('t1', 0, 0), 'new', 100),
      ).toBe(heading);
      expect(applyEditToSectionTitle(heading, titleRef('t1'), 'new', 100)).toBe(
        heading,
      );
    });

    it('answers with what it was given when there is no heading or no source', () => {
      const heading = gridSectionTitle('t1', 0, 'old', 40);
      expect(
        applyEditToSectionTitle(null, gridSectionTitle('t1', 0), 'new', 100),
      ).toBeNull();
      expect(
        applyEditToSectionTitle(heading, gridCell('', 0, 0), 'new', 100),
      ).toBe(heading);
    });
  });

  describe('sameRect', () => {
    const rect = {
      left: 10,
      top: 20,
      right: 70,
      bottom: 40,
      width: 60,
      height: 20,
    };

    it('holds for a distinct object describing the same box', () => {
      expect(sameRect(rect, { ...rect })).toBe(true);
      expect(sameRect(rect, rect)).toBe(true);
    });

    it('fails on any member that differs', () => {
      for (const member of Object.keys(rect)) {
        expect(sameRect(rect, { ...rect, [member]: rect[member] + 1 })).toBe(
          false
        );
      }
    });

    it('is false against nothing, and true for two nothings only by identity', () => {
      expect(sameRect(rect, null)).toBe(false);
      expect(sameRect(null, rect)).toBe(false);
      expect(sameRect(undefined, rect)).toBe(false);
      expect(sameRect(null, null)).toBe(true);
    });
  });

  describe('dialogPlacement', () => {
    const size = { width: 200, height: 100 };
    const viewport = { width: 1000, height: 800 };

    it('puts its bottom right corner on the cell\'s bottom left corner', () => {
      const placement = dialogPlacement(
        { left: 300, top: 400, right: 380, bottom: 420 },
        size,
        viewport,
      );
      expect(placement).toEqual({ left: 100, top: 320, placement: 'left' });
    });

    it('puts its bottom left corner on the cell\'s bottom right corner when the left will not fit', () => {
      const placement = dialogPlacement(
        { left: 100, top: 400, right: 180, bottom: 420 },
        size,
        viewport,
      );
      expect(placement).toEqual({ left: 180, top: 320, placement: 'right' });
    });

    // The left is preferred, so the right is taken only once the left genuinely runs
    // off the screen — a cell exactly a dialog's width from the edge still goes left.
    it('prefers the left while it fits exactly', () => {
      const placement = dialogPlacement(
        { left: 200, top: 400, right: 280, bottom: 420 },
        size,
        viewport,
      );
      expect(placement).toEqual({ left: 0, top: 320, placement: 'left' });
    });

    it('moves down until it fits when the cell is too high for it', () => {
      // Bottom edge at 60, dialog 100 tall: aligning the bottoms would put the top at
      // -40, so it comes down to the top of the screen instead.
      const placement = dialogPlacement(
        { left: 300, top: 40, right: 380, bottom: 60 },
        size,
        viewport,
      );
      expect(placement).toEqual({ left: 100, top: 0, placement: 'left' });
    });

    it('moves up until it fits when the cell is too low for it', () => {
      const placement = dialogPlacement(
        { left: 300, top: 830, right: 380, bottom: 850 },
        size,
        viewport,
      );
      expect(placement).toEqual({
        left: 100,
        top: viewport.height - size.height,
        placement: 'left',
      });
    });

    // A wide element — the review screen's title and section fields span almost the
    // whole editor — leaves room on neither side, so the dialog goes below it rather
    // than over the field being corrected.
    it('goes below when there is room on neither side', () => {
      const wide = { left: 20, top: 400, right: 980, bottom: 440 };
      const placement = dialogPlacement(wide, size, viewport);
      expect(placement).toEqual({ left: 20, top: 440, placement: 'below' });
    });

    // Below is still the answer for an element too low to hang a whole dialog under:
    // it comes up only as far as the bottom of the screen requires.
    it('comes up from the bottom of the screen when a wide element sits too low', () => {
      const wide = { left: 20, top: 740, right: 980, bottom: 780 };
      const placement = dialogPlacement(wide, size, viewport);
      expect(placement).toEqual({
        left: 20,
        top: viewport.height - size.height,
        placement: 'below',
      });
    });

    // The left edges are aligned, so a wide element scrolled off the left of the screen
    // would take the dialog with it.
    it('holds a below placement on the screen horizontally', () => {
      const wide = { left: -40, top: 400, right: 980, bottom: 440 };
      const placement = dialogPlacement(wide, size, viewport);
      expect(placement).toEqual({ left: 0, top: 440, placement: 'below' });
    });

    it('never returns a negative coordinate, even oversized', () => {
      const huge = { width: 1200, height: 900 };
      const placement = dialogPlacement(
        { left: 300, top: 400, right: 380, bottom: 420 },
        huge,
        viewport,
      );
      expect(placement.left).toBe(0);
      expect(placement.top).toBe(0);
    });
  });

  describe('draggedPosition', () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 200, height: 100 };
    const origin = { left: 300, top: 400, pointerX: 350, pointerY: 420 };

    it('moves the dialog by however far the pointer has moved', () => {
      expect(draggedPosition(origin, { x: 380, y: 450 }, size, viewport)).toEqual({
        left: 330,
        top: 430,
      });
    });

    it('follows the pointer backwards too', () => {
      expect(draggedPosition(origin, { x: 300, y: 380 }, size, viewport)).toEqual({
        left: 250,
        top: 360,
      });
    });

    it('cannot be dragged off the near edges', () => {
      expect(draggedPosition(origin, { x: -400, y: -400 }, size, viewport)).toEqual({
        left: 0,
        top: 0,
      });
    });

    it('cannot be dragged off the far edges, which are its own size in', () => {
      expect(draggedPosition(origin, { x: 4000, y: 4000 }, size, viewport)).toEqual({
        left: viewport.width - size.width,
        top: viewport.height - size.height,
      });
    });

    it('pins a dialog bigger than the viewport to the near edge', () => {
      const huge = { width: 1200, height: 900 };
      expect(draggedPosition(origin, { x: 4000, y: 4000 }, huge, viewport)).toEqual({
        left: 0,
        top: 0,
      });
    });
  });
});
