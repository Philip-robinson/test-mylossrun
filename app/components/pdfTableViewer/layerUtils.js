// Pure, dependency-free helpers for the staged grid editor's Layers panel and
// zoom/scale selector. No React, no config import: any value that would come
// from a named constant is accepted as an argument, so these stay trivially
// unit-testable and free of import cycles.

// Rendered width in px for a zoom percentage relative to a base width.
export const scalePercentToWidthPx = (percent, baseWidthPx) =>
  Math.round((baseWidthPx * percent) / 100);

// Step to the next (+1) or previous (-1) option in the ordered `options` array,
// clamped at the ends (returns `current` when already at an end or not found).
export const stepScale = (options, current, direction) => {
  const index = options.indexOf(current);
  if (index === -1) {
    return current;
  }
  const target = index + direction;
  if (target < 0 || target >= options.length) {
    return current;
  }
  return options[target];
};

// Layers row K's checkbox is ticked iff confirmationStage >= K. A null/absent
// stage is treated as 0.
export const layerRowTicked = (rowNumber, confirmationStage) =>
  (confirmationStage ?? 0) >= rowNumber;

// Ticking row K sets stage K; unticking row K sets stage K - 1.
export const nextConfirmationStage = (rowNumber, currentStage, checked) =>
  (checked ? rowNumber : rowNumber - 1);

// The Layers rows in display / stage order (row K = index K-1). Must match the
// order rendered by LayersPanel.
export const LAYER_KEY_ORDER = [
  'colours',
  'border',
  'rows',
  'columns',
  'special',
];

// The 1-based level of a layer key (its LAYER_KEY_ORDER index + 1): colours=1,
// border=2, rows=3, columns=4, special=5. Returns 0 for an unknown key.
export const layerLevel = (layerKey) => LAYER_KEY_ORDER.indexOf(layerKey) + 1;

// The confirmationStage after data owned by `editedLayerKey` is edited: editing a
// layer unticks that layer and every layer above it, so the stage drops to level - 1.
// It NEVER raises the stage (an edit to a not-yet-confirmed layer leaves the stage as
// it is). A null/absent stage is treated as 0.
export const stageAfterEdit = (editedLayerKey, currentStage) =>
  Math.min(currentStage ?? 0, layerLevel(editedLayerKey) - 1);

// A stable string projection of a table's merged cells: one
// `row,column,rowSpan,columnSpan` entry per cell that spans more than a single
// grid square, sorted so cell ordering within `cells` is irrelevant. `text` and
// `confidence` are deliberately excluded — a recalculation writes those two
// fields back into `cells`, and including them would make every re-read look
// like a fresh Special-Areas edit.
const cellSpanProjection = (table) =>
  (table?.cells ?? [])
    .filter((cell) => (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1)
    .map(
      (cell) =>
        `${cell.row},${cell.column},${cell.rowSpan ?? 1},${cell.columnSpan ?? 1}`,
    )
    .sort()
    .join('|');

// True when the data OWNED by `layerKey` differs between the pre-edit (`before`) and
// post-edit (`after`) table snapshots. Used to decide whether an edit reported through
// the table-commit path should drop that table's confirmationStage. Colours are
// page-scoped (not per-table), so this always returns false for the 'colours' key.
// Merged cells are edited from the Special Areas layer, so a span change counts as a
// Special-Areas edit.
export const layerDataChanged = (layerKey, before, after) => {
  if (!before || !after) return false;
  const j = (v) => JSON.stringify(v ?? null);
  switch (layerKey) {
    case 'border':
      return j(before.bounds) !== j(after.bounds);
    case 'rows':
      return j(before.rowHeights) !== j(after.rowHeights);
    case 'columns':
      return j(before.columnWidths) !== j(after.columnWidths);
    case 'special':
      return (
        j(before.title) !== j(after.title) ||
        (before.headerCount ?? 0) !== (after.headerCount ?? 0) ||
        j(before.sectionTitles) !== j(after.sectionTitles) ||
        j(before.footer) !== j(after.footer) ||
        cellSpanProjection(before) !== cellSpanProjection(after)
      );
    default:
      return false;
  }
};

// The layer to auto-select for a table at `confirmationStage`: the first row
// WITHOUT a tick (rows 1..stage are ticked), or the last row when all are ticked.
// A null/absent stage is treated as 0 (nothing ticked -> the first row).
export const layerKeyForStage = (confirmationStage) => {
  const stage = Math.max(0, confirmationStage ?? 0);
  const index = Math.min(stage, LAYER_KEY_ORDER.length - 1);
  return LAYER_KEY_ORDER[index];
};

// The column name a newly drawn section title should start with, so it means something the
// moment it appears rather than waiting to be named.
//
// The name most recently given to a section title of THIS table wins — `sectionTitles` is
// appended to, so the last named entry is the latest, which is what follows the user down a
// table. Unnamed entries are skipped: those are hidden rows, and they name no column. Failing
// that the last of `options` (the names collected across the linked group) is taken, and
// failing that `fallback`. `fallback` is passed in rather than read from config, this module
// holding no config of its own.
export const nextSectionTitleColumnName = (table, options, fallback) => {
  const named = (table?.sectionTitles ?? []).filter((s) => s.columnName);
  if (named.length) return named[named.length - 1].columnName;
  if (options?.length) return options[options.length - 1];
  return fallback;
};

// Counts shown against each Layers row. Border/Colours are page-scoped; Rows,
// Columns and Special Cells are scoped to the selected table.
export const layerCounts = ({
  selectedTable,
  samePageTables,
  pageColouredAreas,
}) => ({
  border: samePageTables?.length ?? 0,
  rows: selectedTable?.rowHeights?.length ?? 0,
  columns: selectedTable?.columnWidths?.length ?? 0,
  specialCells:
    (selectedTable?.headerCount > 0 ? 1 : 0) +
    (selectedTable?.title ? 1 : 0) +
    (selectedTable?.sectionTitles?.length ?? 0),
  colours: pageColouredAreas?.length ?? 0,
});

// One page's non-deleted tables in ascending tableInPage order. A null/absent tableInPage
// sorts as 0 and ties keep document order, so the walk is deterministic whatever the
// metadata carries.
const orderedPageTables = (samePageTables) =>
  (samePageTables ?? [])
    .map((table, index) => ({ table, index }))
    .sort(
      (a, b) =>
        (a.table.tableInPage ?? 0) - (b.table.tableInPage ?? 0) ||
        a.index - b.index,
    )
    .map(({ table }) => table);

// The table one step from `currentTableId` in that order — `direction` 1 for the next, -1
// for the previous — or null at that end of the page (or when the id is not in the list).
const stepTableOnPage = (samePageTables, currentTableId, direction) => {
  const ordered = orderedPageTables(samePageTables);
  const position = ordered.findIndex(
    (table) => table.tableId === currentTableId,
  );
  if (position === -1) return null;
  const target = position + direction;
  if (target < 0 || target >= ordered.length) return null;
  return ordered[target];
};

// The next table after `currentTableId`, or null when it is the last one on the page.
export const nextTableOnPage = (samePageTables, currentTableId) =>
  stepTableOnPage(samePageTables, currentTableId, 1);

// The table before `currentTableId`, or null when it is the first one on the page.
export const prevTableOnPage = (samePageTables, currentTableId) =>
  stepTableOnPage(samePageTables, currentTableId, -1);

// The distinct, non-null section-title `columnName` values used across every table
// of the whole PDF, in first-seen order. Feeds the "Column name" combo's option list
// (the same name may be reused for the same purpose on any table/page).
export const collectColumnNames = (tables) => {
  const seen = [];
  const set = new Set();
  (tables ?? []).forEach((t) => {
    (t.sectionTitles ?? []).forEach((s) => {
      if (s.columnName && !set.has(s.columnName)) {
        set.add(s.columnName);
        seen.push(s.columnName);
      }
    });
  });
  return seen;
};
