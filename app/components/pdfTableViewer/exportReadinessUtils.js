// Whether a table listed in the Document Overview still holds anything for the user to
// look at, which is what turns its Review button into "Ready for Export". Export itself
// waits for nothing: it is offered whatever state the tables are in. The answer is
// DERIVED from the confidences the metadata
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
// `withHeaderCells` says whether the table's header rows reach the merged grid. Every table
// of a group contributes its DATA rows only; the header rows come from the grid's TOP ROW
// alone. A member stacked below the root therefore has header cells that are never drawn on
// the review screen and can never be corrected there, so they must not be counted — the same
// reason the title is conditional.
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
// see and correct. A cell in the header block travels only when the table's header rows do;
// below it, a cell travels unless its row is a section title's.
const reachesTheGrid = (cell, table, withHeaderCells, skippedRows) => {
  const row = cell?.row ?? 0;
  if (row < (table?.headerCount ?? 0)) return withHeaderCells;
  return !skippedRows.has(row);
};

const correctableValues = (table, { withTitle, withHeaderCells }) => {
  const skippedRows = sectionTitleRows(table);
  return [
    ...(table?.cells ?? []).filter((cell) =>
      reachesTheGrid(cell, table, withHeaderCells, skippedRows)
    ),
    ...(withTitle && table?.title ? [table.title] : []),
    ...(table?.sectionTitles ?? []).flatMap((sectionTitle) =>
      sectionTitle?.data ? [sectionTitle.data] : []
    ),
  ];
};

// Whether `tableId` sits in the group grid's top row, which is the row the merged grid
// takes its header rows from.
const inTopGridRow = (root, tableId) =>
  ((root?.grid ?? [])[0] ?? []).includes(tableId);

const isLow = (value, threshold) =>
  !(typeof value?.confidence === 'number' && Number.isFinite(value.confidence)) ||
  value.confidence < threshold;

// The values of one table read below `threshold`, in the order they were gathered.
// `withTitle` says whether the table's own title is one of them — true for a table read on
// its own or as a group's root, false for a linked member. `withHeaderCells` says whether
// its header rows are, which a stacked member's are not.
export const lowConfidenceValues = (
  table,
  threshold,
  { withTitle = true, withHeaderCells = true } = {}
) =>
  correctableValues(table, { withTitle, withHeaderCells }).filter((value) =>
    isLow(value, threshold)
  );

// Whether `root` and every table linked to it is ready for export.
//
// A table the user has not yet marked ready is never ready for export, whatever its
// confidences say — below `minimumStage` the Document Overview offers Mark Ready rather
// than a Review button, so there is no label for this to change. A linked MEMBER is
// judged by its values alone: a joined table is off
// the top-level list and is never marked ready in its own right — and by its values MINUS
// its title, and minus its header cells unless it sits in the grid's top row, none of which
// the review screen ever shows.
export const isExportReady = (root, threshold, minimumStage) => {
  if (!root) return false;
  if ((root.confirmationStage ?? 0) < minimumStage) return false;
  if (lowConfidenceValues(root, threshold).length > 0) return false;
  return linkedMembers(root).every(
    (member) =>
      lowConfidenceValues(member, threshold, {
        withTitle: false,
        withHeaderCells: inTopGridRow(root, member.tableId),
      }).length === 0
  );
};
