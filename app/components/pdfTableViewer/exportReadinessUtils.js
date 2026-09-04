// Whether a table listed in the Document Overview still holds anything for the user to
// look at, which is what turns its Review button into "Ready for Export" and what the
// Export button waits for. The answer is DERIVED from the confidences the metadata
// already carries and is never stored: a re-extraction can lower a value's confidence,
// and a stage recorded while the table was clean would outlive the fact it recorded.
//
// The threshold and the minimum stage arrive as arguments — no config import — so these
// stay trivially unit-testable and the component owns the lookup.
//
// A value is low confidence when its confidence is STRICTLY below the threshold, which is
// the review screen's rule; a value carrying no numeric confidence is read as confidence
// 0, since an absent reading is not a good one. A table holding no values at all is
// ready: a table with a border has cells, so the empty case is not a table the extraction
// has still to reach.

import { linkedMembers } from 'components/pdfTableViewer/gridUtilities';

// Every value of ONE table that the review screen could be asked to correct: its cells,
// each of its section titles' values, and — only when `withTitle` — its title. Absent
// members are simply absent, so a malformed or missing table yields nothing rather than
// throwing.
//
// `headerRowsShown` is how many of the table's LEADING rows the merged grid draws as its
// header rows; it defaults to the table's own header block, which is the standalone case.
// Every table of a group contributes its DATA rows only, and the header block is copied
// from the grid's TOP ROW for as many rows as the ROOT's header block is deep. So a member
// stacked below the root shows none of its header cells, and a member joined alongside one
// shows only the first `root.headerCount` of them — a member whose own header block is
// deeper keeps the rest, which the merge draws neither as header rows nor as data rows.
// None of those can be corrected on the review screen, so none of them may be counted —
// the same reason the title is conditional.
//
// Section-title rows are dropped on the same principle and for the same reason: the merge
// skips such a row entirely, carrying only its section-title value into the placeholder
// column, so every other cell along that row is invisible to the reviewer. This is not a
// judgement about whether those cells matter — see the note in IMPLEMENTATION.md — only
// about whether the review screen can do anything about them.
//
// The title is conditional because the review screen shows the ROOT's title and no other:
// the merged table carries one `AmalgamatedTitle`, built from the root. A member's own
// title is drawn on the page and saved with it, but never appears on the review screen and
// so can never be corrected there — counting it would hold a group root out of "Ready for
// Export" for ever with nothing on screen to fix. A member's CELLS and SECTION TITLES do
// appear in the merged grid, each naming its source table, so they still count.
// The rows the merged grid takes no cells from: every row named by a section title, whose
// row the merge skips whole — only the carried value travels — so nothing else along it is
// ever drawn. `_data_row_indexes` in the back end is the same rule.
const sectionTitleRows = (table) =>
  new Set(
    (table?.sectionTitles ?? [])
      .map((sectionTitle) => sectionTitle?.tableRow)
      .filter((row) => typeof row === 'number')
  );

// Whether one cell of `table` reaches the merged grid, and so is a value the reviewer can
// see and correct. A cell in the table's own header block travels only while the merged
// grid's header block is still that deep; below it, a cell travels unless its row is a
// section title's.
const reachesTheGrid = (cell, table, headerRowsShown, skippedRows) => {
  const row = cell?.row ?? 0;
  if (row < (table?.headerCount ?? 0)) return row < headerRowsShown;
  return !skippedRows.has(row);
};

const correctableValues = (
  table,
  { withTitle, headerRowsShown, sectionTitleIndexes }
) => {
  const skippedRows = sectionTitleRows(table);
  const shown = headerRowsShown ?? table?.headerCount ?? 0;
  return [
    ...(table?.cells ?? []).filter((cell) =>
      reachesTheGrid(cell, table, shown, skippedRows)
    ),
    ...(withTitle && table?.title ? [table.title] : []),
    ...(table?.sectionTitles ?? []).flatMap((sectionTitle, index) =>
      sectionTitle?.data &&
      (sectionTitleIndexes === null || sectionTitleIndexes.has(index))
        ? [sectionTitle.data]
        : []
    ),
  ];
};

// Whether `tableId` sits in the group grid's top row, which is the row the merged grid
// takes its header rows from.
const inTopGridRow = (root, tableId) =>
  ((root?.grid ?? [])[0] ?? []).includes(tableId);

// The tables the merged rows are driven by: the one at column 0 of each grid row, the root
// first. Only these carry a section-title value forward — a table joined ALONGSIDE one has
// its section-title rows dropped from its data rows and its values carried nowhere.
const spineTables = (root) => {
  const grid = root?.grid ?? [];
  if (grid.length === 0) return root ? [root] : [];
  return grid
    .map((gridRow, index) => (index === 0 ? root : root?.next?.[gridRow?.[0]]))
    .filter(Boolean);
};

const rowCount = (table) =>
  (table?.rowHeights ?? []).length ||
  (table?.cells ?? []).reduce(
    (most, cell) => Math.max(most, (cell?.row ?? 0) + (cell?.rowSpan ?? 1)),
    0
  );

// The section titles of one table that carry a value into a column of the merged grid, by
// the row they sit on. A section title with no column name carries nothing — that is the
// marker the Special tool writes to hide a row.
const carryingSectionTitles = (table) => {
  const byRow = new Map();
  (table?.sectionTitles ?? []).forEach((sectionTitle, index) => {
    if (!sectionTitle?.columnName) return;
    byRow.set(sectionTitle?.tableRow, { sectionTitle, index });
  });
  return byRow;
};

// Which section titles of a group the review screen can show, as a Map of table id to the set
// of indexes within that table's `sectionTitles`.
//
// A section-title value travels as a column of the merged grid, carried forward from the row
// it sits on across every row below it. A value named for a column of its own is DRAWN in
// that column and can be corrected there, so it is shown as soon as one row carries it. The
// placeholder column — the name the Section Title Row tool writes, since naming one properly
// is later work — is different: the merge SPLITS the grid on it and then drops it, one tab
// per distinct value, each tab naming the single section title that was carried when its
// first row was emitted. Two section titles reading the same text therefore produce one tab,
// named after the first; the second appears nowhere on the review screen and can never be
// corrected there. Two that were never read at all BOTH read as blank, which is exactly how
// a group of unread section titles gets stuck — hence this walk rather than a simpler "one
// per distinct value" rule.
//
// The walk is the merge's own: rows in order, spine table by spine table, a section-title row
// setting its column's carried value instead of emitting, every other row emitting. Rows
// above the group's first section title carry nothing and claim the blank value for no
// section title at all, which is what puts a later unread one out of reach. A section title
// with no row below it is never carried onto a row and so is never shown.
//
// `placeholderColumnName` arrives as an argument for the same reason the threshold does:
// this module holds no config and the component owns the lookup.
export const shownSectionTitles = (root, placeholderColumnName) => {
  const shown = new Map();
  const claimed = new Set();
  const carried = new Map();

  const show = (entry) => {
    if (!shown.has(entry.tableId)) shown.set(entry.tableId, new Set());
    shown.get(entry.tableId).add(entry.index);
  };

  for (const table of spineTables(root)) {
    const carrying = carryingSectionTitles(table);
    const skippedRows = sectionTitleRows(table);
    for (let row = table.headerCount ?? 0; row < rowCount(table); row += 1) {
      const entry = carrying.get(row);
      if (entry) {
        const { sectionTitle, index } = entry;
        carried.set(
          sectionTitle.columnName,
          sectionTitle.data
            ? {
                tableId: table.tableId,
                index,
                text: sectionTitle.data.text ?? '',
              }
            : null
        );
        continue;
      }
      // A hidden row: the merge skips it whole, so it emits nothing and claims nothing.
      if (skippedRows.has(row)) continue;
      for (const [columnName, value] of carried) {
        if (columnName !== placeholderColumnName) {
          if (value) show(value);
          continue;
        }
        const text = value?.text ?? '';
        if (claimed.has(text)) continue;
        claimed.add(text);
        if (value) show(value);
      }
      // The placeholder column claims its blank value even before anything carries one, so
      // that a later unread section title cannot claim it.
      if (!carried.has(placeholderColumnName)) claimed.add('');
    }
  }
  return shown;
};

const isLow = (value, threshold) =>
  !(typeof value?.confidence === 'number' && Number.isFinite(value.confidence)) ||
  value.confidence < threshold;

// The values of one table read below `threshold`, in the order they were gathered.
// `withTitle` says whether the table's own title is one of them — true for a table read on
// its own or as a group's root, false for a linked member. `headerRowsShown` says how many
// of its header rows are, which is none for a stacked member; omitted, the table keeps its
// whole header block, as a table read on its own does. `sectionTitleIndexes` is the set of
// its section titles the review screen can show, from `shownSectionTitles`; omitted, they
// all count.
export const lowConfidenceValues = (
  table,
  threshold,
  { withTitle = true, headerRowsShown = null, sectionTitleIndexes = null } = {}
) =>
  correctableValues(table, {
    withTitle,
    headerRowsShown,
    sectionTitleIndexes,
  }).filter((value) => isLow(value, threshold));

// Whether `root` and every table linked to it is ready for export.
//
// A table the user has not yet marked ready is never ready for export, whatever its
// confidences say — below `minimumStage` the Document Overview offers Mark Ready rather
// than a Review button, so there is no label to change and nothing for the Export gate to
// be satisfied by. A linked MEMBER is judged by its values alone: a joined table is off
// the top-level list and is never marked ready in its own right — and by its values MINUS
// its title, minus the header cells the merged grid does not draw, and minus the section
// titles the split leaves unreachable, none of which the review screen ever shows.
export const isExportReady = (
  root,
  threshold,
  minimumStage,
  placeholderColumnName
) => {
  if (!root) return false;
  if ((root.confirmationStage ?? 0) < minimumStage) return false;
  const shown = shownSectionTitles(root, placeholderColumnName);
  const indexesFor = (table) => shown.get(table.tableId) ?? new Set();
  if (
    lowConfidenceValues(root, threshold, {
      sectionTitleIndexes: indexesFor(root),
    }).length > 0
  ) {
    return false;
  }
  // The merged grid's header block is as deep as the ROOT's, and is taken from the grid's
  // top row alone. A member elsewhere shows none of its header rows; one in the top row
  // shows that many of them, however deep its own header block goes.
  const headerRows = root.headerCount ?? 0;
  return linkedMembers(root).every(
    (member) =>
      lowConfidenceValues(member, threshold, {
        withTitle: false,
        headerRowsShown: inTopGridRow(root, member.tableId) ? headerRows : 0,
        sectionTitleIndexes: indexesFor(member),
      }).length === 0
  );
};

// Whether every table of `tables` is ready. An empty list is vacuously ready: whether
// there is anything to export at all is the caller's question, not this one's.
export const allExportReady = (
  tables,
  threshold,
  minimumStage,
  placeholderColumnName
) =>
  (tables ?? []).every((table) =>
    isExportReady(table, threshold, minimumStage, placeholderColumnName)
  );
