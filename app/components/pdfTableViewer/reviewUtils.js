// Pure, dependency-free helpers for the extraction review screen: numeric
// detection (drives cell alignment), long-text detection (drives the column
// width), spreadsheet coordinates, and the cells worth checking (which drive the
// bar above the grid, the wash over a cell and the marker down its edge). No
// React, no DOM, no config import: the threshold arrives as an argument so the
// component owns the config lookup and these stay trivially unit-testable.

// A plain number, optionally money: one leading currency symbol (with optional
// spaces after it), an optional minus, then digits either ungrouped or in
// thousands groups, and at most one decimal point.
const NUMERIC_PATTERN = /^[£$€]?\s*-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

// True when `text` reads as a number and so should be right-aligned. Anything
// else - empty, absent, percentages, parenthesised negatives, prose - is false.
export const looksNumeric = (text) =>
  typeof text === 'string' && NUMERIC_PATTERN.test(text.trim());

// True when `text` is long enough that the column should be held open to its full
// width rather than allowed to shrink to fit its neighbours. Whitespace is trimmed
// first so trailing padding cannot tip a short value over the threshold; absent or
// non-string text is never wide.
export const isWideText = (text, minCharacters) =>
  typeof text === 'string' && text.trim().length > minCharacters;

// A column's spreadsheet name: A-Z, then AA-AZ, BA-… and so on. This is BIJECTIVE
// base-26, not ordinary base-26 — there is no zero digit, so AA follows Z directly
// with no gap, exactly as a spreadsheet numbers its columns.
export const columnLabel = (index) => {
  let label = '';
  let remaining = index;
  while (remaining >= 0) {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return label;
};

// A cell's spreadsheet coordinate from its position in the merged grid: the column
// letters followed by the 1-based row number, so the top left cell is A1. Rows are
// counted from the very top, header rows included — what the user is being pointed at
// is a position on the screen, not a position in the data.
export const cellCoordinate = (rowIndex, columnIndex) =>
  `${columnLabel(columnIndex)}${rowIndex + 1}`;

// Every cell of the merged grid (rows of cells) read with less than full confidence,
// in reading order, each as { rowIndex, columnIndex, label }. These are the cells worth
// the user's eye: the review screen counts them and offers them as places to go. A
// confidence sitting exactly on the threshold is not listed: the threshold is the
// lowest reading counted as good.
//
// SOURCELESS positions are skipped. Padding, and the appended column-name labels, carry
// a confidence of 0 because nothing ever read them — not because a read went badly —
// and there is nothing behind them to correct, so listing them would bury the real ones
// under blanks. A blank tableId is the marker for that.
export const belowHighConfidenceCells = (rows, highThreshold) =>
  (rows ?? []).flatMap((row, rowIndex) =>
    row.flatMap((cell, columnIndex) =>
      cell.tableId && cell.confidence < highThreshold
        ? [{ rowIndex, columnIndex, label: cellCoordinate(rowIndex, columnIndex) }]
        : [],
    ),
  );

// "1 entry flagged for review" / "N entries flagged for review". Zero is plural, as English
// requires. Entries rather than cells: the title is flagged alongside them and is not one.
export const flaggedForReviewLabel = (count) =>
  count === 1
    ? '1 entry flagged for review'
    : `${count} entries flagged for review`;

// The title's entry for the low-confidence list, or null when there is nothing to flag.
// `title` is the merged table's title ({ tableId, text, confidence, bounds }) or null;
// `label` is the caller's name for it, since this module holds no config. A confidence
// sitting exactly on the threshold is not flagged, as for the grid cells.
//
// A title that is present but was never read — empty text, zero confidence — IS flagged.
// Absence of a title is the only thing that excludes it. This differs from the sourceless
// cell rule deliberately: a sourceless cell is padding nothing could ever read, whereas a
// defined title area with nothing in it is exactly what the user should look at.
export const lowConfidenceTitle = (title, highThreshold, label) =>
  title && title.confidence < highThreshold ? { title: true, label } : null;

// The section title a split table was cut on, as an entry for the low-confidence list, or
// null when there is nothing to flag. `sectionTitle` is the merged table's `sectionTitle`
// ({ tableId, sectionTitleIndex, text, confidence }) or null; `label` is the caller's name
// for it, since this module holds no config.
//
// It is flagged on exactly the title's terms, and for a sharper reason: the placeholder
// column this value came from decides how the grid is split and names the table, and is
// then dropped from the grid — so a misreading silently mis-sections the data and misnames
// the sheet, and appears nowhere the reviewer could correct it.
export const lowConfidenceSectionTitle = (sectionTitle, highThreshold, label) =>
  sectionTitle && sectionTitle.confidence < highThreshold
    ? { sectionTitle: true, label }
    : null;

// The entry `step` places along `poorCells` from `selected` (+1 forward, -1 back), or
// null when there is nowhere to go. Stepping STOPS at each end rather than wrapping:
// running off the end and silently reappearing at the other would leave the user unsure
// whether they had seen everything.
//
// Matching is by `label`, not by grid position, so a non-grid entry — the title — can take
// part. Grid labels are spreadsheet coordinates and so never collide with it.
//
// A selection that is not itself in the list — a confident cell, which can be selected by
// clicking it — enters the list at whichever end the step comes from, since refusing to
// move would be the less useful answer.
export const adjacentPoorCell = (poorCells, selected, step) => {
  const cells = poorCells ?? [];
  if (cells.length === 0) return null;
  const current = selected
    ? cells.findIndex((cell) => cell.label === selected.label)
    : -1;
  if (current === -1) return step > 0 ? cells[0] : cells[cells.length - 1];
  const target = current + step;
  return target >= 0 && target < cells.length ? cells[target] : null;
};

// How confidently the extraction read one value, as the edit dialog states it —
// "Confidence 87%" — rounded to a whole percent because the scale is 0–100 and a
// fraction of a percent is not a distinction the reader can act on. A value that
// carries no confidence at all reads "Confidence unknown" rather than "0%", which
// would claim a bad reading where in fact there was no reading.
export const confidenceLabel = (confidence) =>
  typeof confidence === 'number' && Number.isFinite(confidence)
    ? `Confidence ${Math.round(confidence)}%`
    : 'Confidence unknown';
