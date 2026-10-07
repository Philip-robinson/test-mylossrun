/**
 * Configuration
 *
 * Application configuration and endpoints
 */

export function baseUrl() {
  return process.env.MYLOSSRUN_BASE_URL || 'http://localhost:8085';
}

// Debounce window (ms) for re-measuring pane widths on window resize, so a
// drag-resize issues a single refetch rather than one per animation frame.
export function resizeDebounceMs() {
  return 400;
}

// Maximum number of characters of a document name shown before it is truncated
// with an ellipsis.
export function nameTruncateLength() {
  return 60;
}

// Interval (ms) between polls of the PDF display list while it reports 304 (not
// yet changed).
export function pollIntervalMs() {
  return 30000;
}

// Interval (ms) between polls of a single display entry (awaitEntryChange) while
// it reports 304 — faster than the whole-list poll because it reads one record.
export function entryPollIntervalMs() {
  return 5000;
}

// Cap (ms) for a single awaitEntryChange call: it returns "no change" once this
// much time has been spent waiting on 304s.
export function awaitEntryTimeoutMs() {
  return 60000;
}

// Cap (ms) for the component-level watch loop that keeps calling awaitEntryChange
// after an upload until the row reaches READY_FOR_REVIEW/ERROR.
export function entryWatchTotalMs() {
  return 120000;
}

// Colour of live table rectangles, their internal grid lines, and the hover label fill.
export function gridLineColour() {
  return 'blue';
}

// Colour used to preview a DELETED table's grid when its left-list row is hovered.
export function deletedGridLineColour() {
  return '#c0c0c0';
}

// Stroke width (screen px, via non-scaling-stroke) of the invisible pointer hit lines.
export function hitLineWidthPx() {
  return 8;
}

// Target pixel width of each cropped table image shown as a cell in the Link popup
// (both the Select column and the Linked grid). Passed as `width` to
// POST /mylossrun/get-table-images.
export function linkTableCellWidth() {
  return 150;
}

// Peak-to-trough height of the grid editor's wavy bottom border (1.5px up and down).
export function linkCellWaveHeightPx() {
  return 3;
}

// Width of one full cycle of the grid editor's wavy bottom border.
export function linkCellWavePitchPx() {
  return 20;
}

// Colour of a grid editor table cell's border, straight or wavy.
export function linkCellBorderColour() {
  return '#ccc';
}

// Width of a grid editor table cell's border, straight or wavy.
export function linkCellBorderWidthPx() {
  return 1;
}

// Cell-confidence thresholds, as percentages (0–100): at/above high = green,
// below low = red, in between = orange.
export function highConfidence() {
  return 80;
}

// Cell-confidence thresholds, as percentages (0–100): at/above high = green,
// below low = red, in between = orange.
export function lowConfidence() {
  return 50;
}

// Review-screen cell-confidence threshold, as a percentage (0–100): a cell below
// lowConfidence() is low confidence, one below this is medium. Deliberately equal
// to the back end's high_confidence().
export function mediumConfidence() {
  return 80;
}

// Interval (ms) between polls of a find-tables worker run's status while it
// reports PROCESSING.
export function findTablesPollIntervalMs() {
  return 1000;
}

// Maximum time (ms) to keep polling a find-tables worker run before giving up.
export function findTablesPollTimeoutMs() {
  return 300000;
}

// Interval (ms) between polls of an extract worker run's status while it reports
// PROCESSING. Deliberately separate from findTablesPollIntervalMs() — same initial
// value — so the two features can be tuned independently.
export function extractPollIntervalMs() {
  return 1000;
}

// Maximum time (ms) to keep polling an extract worker run before giving up.
// Deliberately separate from findTablesPollTimeoutMs() for the same reason.
export function extractPollTimeoutMs() {
  return 300000;
}

// Back-end path the /api/find-grid-lines proxy forwards to. The endpoint is
// synchronous (single page, no OCR) and returns the FindGridLinesResponse directly,
// so the proxy forwards the POST and returns the JSON with no long-poll.
export function findGridLinesPath() {
  return '/mylossrun/find-grid-lines';
}

// Back-end path the /api/calculate-cells proxy forwards to. Like find-grid-lines the
// endpoint is synchronous — it only reads the text inside rectangles the caller already
// knows — so the proxy forwards the POST and returns the JSON with no long-poll.
export function calculateCellsPath() {
  return '/mylossrun/calculate-cells';
}

// Back-end path the /api/to-excel proxy forwards to. The endpoint is synchronous — it
// builds the workbook, stores it and returns a presigned URL — so the proxy forwards the
// POST and returns the JSON with no long-poll.
export function toExcelPath() {
  return '/mylossrun/to-excel';
}

// MIME type of the exported workbook, carried by the /api/to-excel response and by the
// Blob the browser saves from it.
export function excelContentType() {
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

// Extension the exported workbook is offered to the user under.
export function excelFileSuffix() {
  return '.xlsx';
}

// Back-end path the /api/original-pdf proxy forwards to.
export function originalPdfPath() {
  return '/mylossrun/original-pdf';
}

// MIME type of the original PDF the /api/original-pdf proxy returns.
export function pdfContentType() {
  return 'application/pdf';
}

// Document statuses whose original PDF may be downloaded from the document list.
export function originalDownloadableStatuses() {
  return ['LOADED', 'READY_FOR_REVIEW', 'VALIDATING', 'EXTRACTION_IN_PROGRESS', 'COMPLETED'];
}

// Document statuses that may be exported from the document list.
export function exportableStatuses() {
  return ['READY_FOR_REVIEW', 'VALIDATING', 'EXTRACTION_IN_PROGRESS', 'COMPLETED'];
}

// Text between the document stem and the table name in a single-table export's filename.
export function tableExportFilenameSeparator() {
  return ' - ';
}

// Path separators replaced in a table name used in a single-table export's filename.
export function tableExportFilenamePathSeparatorPattern() {
  return /[/\\]/g;
}

// Text that replaces each path separator in a table name used in a single-table export's filename.
export function tableExportFilenamePathSeparatorReplacement() {
  return '-';
}

// Editor-selection flag: when true, PageTableEditor renders the new staged
// grid editor (StagedPageGridEditor); when false, the existing interactive
// PageImageWithOverlay editor.
export function stagedGridEditorEnabled() {
  return true;
}

// Experimental: in the Validate tables pass, display whitespace above and below each table
// (or each run of vertically overlapping tables). Display only; page coordinates are unchanged.
export function tableSeparationEnabled() {
  return true;
}

// Screen px of whitespace drawn above and below each table when tableSeparationEnabled().
export function tableSeparationGapPx() {
  return 15;
}

// Page px two tables may overlap vertically and still be separated as touching tables.
export function tableSeparationTouchTolerancePx() {
  return 1;
}

// Width of the slot each Layers row reserves for its eye, whether or not it has one.
// Without a reserved slot, a row drawn without an eye would sit its count an icon's width
// further right than every other row's.
export function layerTickSlotWidthPx() {
  return 42;
}

// Default zoom/scale (percent) for the staged editor's scale selector.
export function defaultScalePercent() {
  return 100;
}

// Ordered zoom/scale options (percent) offered by the scale selector.
export function scalePercentOptions() {
  return [50, 75, 100, 150, 200];
}

// Base rendered width (screen px) of the page image at 100% scale.
export function baseImageWidthPx() {
  return 1000;
}

// Debounce window (ms) applied to scale changes before re-rendering/refetching.
export function scaleDebounceMs() {
  return 400;
}

// Opacity applied to the page image when "Dim Document" is toggled on.
export function documentDimOpacity() {
  return 0.35;
}

// The two renderings /api/get-image can return, sent as its `imageStyle`. RAW is the page
// as the PDF draws it; PROCESSED has the page's coloured areas flattened to black on
// white, which is the page the extraction reads.
export function rawImageStyle() {
  return 'RAW';
}

export function processedImageStyle() {
  return 'PROCESSED';
}

// Layer row colours (Border, Rows, Columns, Special Cells, Colours), and the
// 10%-opacity background colour each layer's row takes when its eye is off. Both
// live in globals.css; these name them.
export function layerBorderColour() {
  return 'var(--border-colour)';
}

export function layerRowsColour() {
  return 'var(--rows-colour)';
}

export function layerColumnsColour() {
  return 'var(--columns-colour)';
}

export function layerSpecialCellsColour() {
  return 'var(--special-colour)';
}

export function layerColoursColour() {
  return 'var(--colours-colour)';
}

export function layerBorderBackgroundColour() {
  return 'var(--border-background-colour)';
}

export function layerRowsBackgroundColour() {
  return 'var(--rows-background-colour)';
}

export function layerColumnsBackgroundColour() {
  return 'var(--columns-background-colour)';
}

export function layerSpecialCellsBackgroundColour() {
  return 'var(--special-background-colour)';
}

export function layerColoursBackgroundColour() {
  return 'var(--colours-background-colour)';
}

// The font size of the Document Overview entry buttons; the value lives in globals.css.
export function documentOverviewButtonFontSize() {
  return 'var(--overview-button-font-size)';
}

// The options every selection scroll passes to scrollIntoView.
export function selectionScrollIntoViewOptions() {
  return { block: 'nearest', inline: 'nearest' };
}

// Screen px above a selected table that its centre-view scroll also brings into view, so the
// table's name label stays visible.
export function selectedTableLabelClearancePx() {
  return 20;
}

// The colour a grid line is drawn in when its layer's eye is off.
export function layerGrey() {
  return 'var(--layer-grey)';
}

// The colour a table that is a member of a linked group is emphasised in, and the width
// and gap (screen px) of the ring that emphasis draws around such a table on a page
// thumbnail.
export function linkedEmphasisColour() {
  return 'var(--linked-emphasis)';
}

export function linkedGroupOutlineWidthPx() {
  return 2;
}

export function linkedGroupOutlineGapPx() {
  return 2;
}

// The grid tool-bar's icon geometry: each button's square size, the thickness of the
// Rows/Columns bar drawn inside it, and the stroke width of the Special hollow square.
export function gridToolIconSizePx() {
  return 20;
}

export function gridToolLineThicknessPx() {
  return 3;
}

export function gridToolSquareStrokePx() {
  return 2;
}

// The grid tool-bar's group box: the border that encloses the buttons, its corner
// rounding, and its shadow. The shadow has zero offset so it reads as a halo on all four
// sides rather than a drop on two.
export function gridToolbarBorderWidthPx() {
  return 1;
}

export function gridToolbarBorderColour() {
  return layerGrey();
}

export function gridToolbarCornerRadiusPx() {
  return 8;
}

export function gridToolbarShadow() {
  return '0 0 6px 1px rgba(0,0,0,0.18)';
}

// The share of a grid square's width and of its height that the Merge Cells tool's drawn
// rectangle must cover before that square joins the block.
export function mergeCoverageFraction() {
  return 0.6;
}

// Stroke width of the outline drawn around a merged cell's block.
export function mergedCellOutlineWidthPx() {
  return 2;
}

// Peak-to-trough height of the wave drawn along a split row's edge.
export function splitRowWaveHeightPx() {
  return 5;
}

// Width of one full cycle of the split-row wave.
export function splitRowWavePitchPx() {
  return 30;
}

// The Special tools that pick something to colour, in menu order. One list, read by the
// editor to decide a colour tool is armed and by the Options block to decide the colour
// selectors are shown.
export function colourSpecialToolKeys() {
  return [
    'colouredRows',
    'colouredColumns',
    'colouredTable',
    'colouredCell',
    'colouredArea',
  ];
}

// Column name a section title drawn with the Section Title Row tool starts with. It is a
// placeholder: nothing reads it, and naming the column is later work.
export function sectionTitlePlaceholderColumnName() {
  return '~~SECTION-TITLE~~';
}

// 50%-transparent highlight lines drawn either side of a selected row line.
export function selectedRowHighlight() {
  return 'rgba(255,165,0,0.5)';
}

// 50%-transparent highlight lines drawn either side of a selected column line.
export function selectedColumnHighlight() {
  return 'rgba(128,0,128,0.5)';
}

// Fixed width (screen px) of the right-hand "Layers" panel.
export function layersPanelWidthPx() {
  return 200;
}

// 50%-transparent brown highlight line drawn just inside and just outside the
// dotted boundary of the selected coloured area (Colours layer).
export function selectedColouredAreaHighlight() {
  return 'rgba(165,42,42,0.5)';
}

// Stroke colour of the dotted "Section Title" section-title-row markers (and their
// selected-area rectangles) drawn in Special Cells mode.
export function sectionTitleMarkerColour() {
  return 'black';
}

// SVG stroke-dasharray for the dotted section-title-row markers.
export function sectionTitleMarkerDash() {
  return '2 2';
}

// Colour of the Cut End / Cut Cancel text and border and the cut lines' stroke.
export function cutColour() {
  return 'var(--in-progress-strong)';
}

// The cut colour's key, carried as a data-colour attribute.
export function cutColourKey() {
  return 'in-progress-strong';
}

// SVG stroke-dasharray for the cut lines.
export function cutLineDash() {
  return '6 4';
}

// Stroke width (screen px) of the cut lines.
export function cutLineWidthPx() {
  return 2;
}

// 50%-transparent green highlight line drawn just inside and just outside the
// dotted boundary of the selected section-title row (Special Cells layer).
export function selectedSectionTitleHighlight() {
  return 'rgba(0,128,0,0.5)';
}

// The `confirmationStage` at or above which a table is fully confirmed — all five
// layer rows ticked, Special Areas included. It is the maximum the five-row ladder
// produces.
export function confirmedTableStage() {
  return 5;
}

// Fill colour of the small square badge drawn on a page thumbnail to mark a fully
// confirmed table.
export function confirmedTickBadgeColour() {
  return 'green';
}

// Colour of the tick mark drawn inside that badge.
export function confirmedTickColour() {
  return 'white';
}

// Side length (screen px) of the square confirmed-table tick badge.
export function confirmedTickBadgeSizePx() {
  return 14;
}

// Fill colour of the merge-ROOT variant of the link badge drawn on a page thumbnail —
// the inverse of the joined variant, which reuses the confirmed-tick colours.
export function mergeLinkRootBadgeColour() {
  return 'white';
}

// Colour of the horizontal rule separating groups of buttons within an Options
// block, as the shared neutral label background (see globals.css) so it tracks the
// palette rather than pinning its own grey.
export function optionsSeparatorColour() {
  return 'var(--neutral-label-background)';
}

// Width of that separator rule as a percentage of the Options block's width, so a
// consumer renders it as `${optionsSeparatorWidthPercent()}%`.
export function optionsSeparatorWidthPercent() {
  return 50;
}

// Thickness (screen px) of the Options group separator rule.
export function optionsSeparatorHeightPx() {
  return 3;
}

// Vertical margin (screen px) above the Options group separator rule.
export function optionsSeparatorMarginTopPx() {
  return 10;
}

// Vertical margin (screen px) below the Options group separator rule. Tighter than
// the margin above so each rule sits closer to the group it opens, which is what
// keeps the Special Areas block on screen.
export function optionsSeparatorMarginBottomPx() {
  return 5;
}

// Corner radius (screen px) of the Options group separator rule. Half its thickness
// or more renders as fully rounded ends (a stadium), whatever the thickness becomes.
export function optionsSeparatorRadiusPx() {
  return optionsSeparatorHeightPx() / 2;
}

// MUI Typography variant used for the small heading above each Options group.
export function optionsGroupTitleVariant() {
  return 'caption';
}

// MUI spacing units between an Options group's heading and its rows of buttons.
export function optionsGroupSpacing() {
  return 0.5;
}

// MUI spacing units between the buttons sharing one row of an Options group.
export function optionsRowSpacing() {
  return 0.5;
}

// Maximum rendered width (screen px) of a review-table column before its content
// wraps.
export function reviewColumnMaxWidthPx() {
  return 400;
}

// The row or column span of a cell that is not merged.
export function singleCellSpan() {
  return 1;
}

// Text length (characters) at or below which a review-table cell is treated as short.
// A cell holding MORE than this is long enough that wrapping it into a narrow column
// would squeeze it into a tall ribbon, so such a cell is pinned to the full column
// width instead.
export function reviewWideCellMinCharacters() {
  return 60;
}

// Border colour of EVERY review-table cell. Confidence is shown by a wash and a marker
// instead, so the grid keeps one uniform ruling whatever it holds.
export function reviewCellBorderColour() {
  return 'blue';
}

// Colour of the wave drawn on the review grid between the two halves of a split row.
export function reviewSplitRowWaveColour() {
  return 'red';
}

// Stroke width of the review grid's split-row wave.
export function reviewSplitRowWaveStrokeWidthPx() {
  return 1;
}

// Wash over a review-table cell read below highConfidence().
export function reviewLowConfidenceBackgroundColour() {
  return 'var(--low-confidence-background)';
}

// Colour of the marker running down a below-high cell's left edge, and of the ring
// around the selected cell.
export function reviewLowConfidenceBorderColour() {
  return 'var(--low-confidence-border)';
}

// Width (screen px) of that left-edge marker.
export function reviewLowConfidenceMarkerWidthPx() {
  return 4;
}

// The selected cell — the one last clicked, or last jumped to from the coordinate list
// — is lifted out of its cell's wash by a ring of its own.
export function reviewSelectedCellBackgroundColour() {
  return '#ffffff';
}

export function reviewSelectedCellBorderWidthPx() {
  return 1.5;
}

export function reviewSelectedCellRadiusPx() {
  return 6;
}

export function reviewSelectedCellPaddingPx() {
  return 5;
}

export function reviewSelectedCellShadow() {
  return '0 0 0 3px rgba(217,155,28,.15)';
}

// Fill of the cell-edit dialog's reject (X) button, taken from the shared palette
// in globals.css so it tracks the palette rather than pinning its own colour.
export function cancelColour() {
  return 'var(--cancel)';
}

// Fill of the cell-edit dialog's accept (tick) button, likewise from globals.css.
export function confirmColour() {
  return 'var(--confirm)';
}

// Rendered width (screen px) of the cell-edit dialog itself.
export function reviewCellEditDialogWidthPx() {
  return 360;
}

// Initial number of visible rows of the in-cell correction field. One, because the
// field sits inside the grid cell it corrects and a taller one would shove the whole
// row open; it grows as it is typed into and can be dragged taller.
export function reviewCellEditRowCount() {
  return 1;
}

// Narrowest the in-cell correction field may be (screen px). A grid column is sized to
// its content, so without a floor the field in a one-character column would be too
// small to type a correction into.
export function reviewCellEditorMinWidthPx() {
  return 120;
}

// Tallest the cell-edit dialog's image area may be (screen px). The crop is scaled down to
// fit the dialog's width; anything still taller than this scrolls rather than pushing the
// text field off the bottom of the dialog.
export function maxCellEditorImageHeight() {
  return 150;
}

// Diameter (screen px) of the spinner shown in the cell-edit dialog's image area while
// the crop is being fetched.
export function cellEditImageSpinnerSizePx() {
  return 24;
}

// Height (screen px) the cell-edit dialog's image area reserves while that spinner shows,
// so the dialog does not jump when the crop lands.
export function cellEditImageLoadingHeightPx() {
  return 40;
}

// Confidence written into a cell that has been manually corrected. cell_reread's
// _is_low re-reads any cell whose confidence is below lowConfidence(), so a manual
// correction must be recorded at full confidence to stop the next extraction from
// re-reading that region and discarding the correction.
export function reviewEditedCellConfidence() {
  return 100;
}

// Rendered width (screen px) of the review bar's "go to a low confidence cell" coordinate
// list. Sized by its LABEL rather than its options: the label sits in the outline's notch,
// so it, not a three-letter column and four-figure row, is what the control has to fit.
export function reviewPoorCellSelectWidthPx() {
  return 200;
}

// Width (screen px) of the review grid's row-number ruler down the left edge. Fixed
// rather than content-sized so the ruler does not widen as the row numbers gain digits
// and shift the whole grid sideways mid-scroll.
export function reviewGutterWidthPx() {
  return 44;
}

// Height (screen px) of the review grid's column-letter ruler across the top.
export function reviewGutterHeightPx() {
  return 24;
}

// Fill of both rulers. Opaque by necessity: they are sticky, so the grid scrolls
// underneath them and a transparent ruler would show two things at once.
export function reviewGutterBackgroundColour() {
  return 'var(--neutral-label-background)';
}

// Colour of the line separating each ruler from the grid it labels.
export function reviewGutterBorderColour() {
  return 'var(--secondary-text)';
}

// Font sizes (percent of 1rem) the review grid's zoom steps through.
export function reviewFontScalePercentOptions() {
  return [70, 85, 100, 115, 130];
}

// Review grid font size (percent of 1rem) used until the user picks another.
export function reviewDefaultFontScalePercent() {
  return 85;
}

// localStorage key remembering the review grid's chosen font size.
export function reviewFontScaleStorageKey() {
  return 'mylossrun.review.fontScalePercent';
}

// Gap (px) between the review screen's header row and what follows it.
export function reviewHeaderRowGapPx() {
  return 10;
}

// Line-break runs that split a review grid cell's text into separate lines.
export function cellLineBreakPattern() {
  return /[\r\n]+/;
}

// Name of the review screen's in-flight operation while it is closing.
export function reviewClosingOperation() {
  return 'closing';
}

// Name of the review screen's in-flight operation while it is exporting.
export function reviewExportingOperation() {
  return 'exporting';
}

// The Go to… list's entry for the table title on the review screen, and the word the
// selected-value readout uses for it. The title is not at a grid coordinate, so it needs a
// name of its own rather than a spreadsheet reference.
export function reviewTitleLabel() {
  return 'Title';
}

// The section title a split review table was cut on: the label drawn beside it on the
// review screen, its entry in the Go to… list, and the word the selected-value readout uses
// for it. Like the title it is at no grid coordinate, so it needs a name rather than a
// spreadsheet reference. One word, matching reviewTitleLabel() beside it.
export function reviewSectionTitleLabel() {
  return 'Section';
}

// Label of the review screen's button that returns to the screen the review was opened from.
export function reviewCloseLabel() {
  return 'Close';
}

// Label of the review screen's button that exports the reviewed table.
export function reviewExportLabel() {
  return 'Export this table';
}

// Label of the review screen's export button while the export is in flight.
export function reviewExportingLabel() {
  return 'Exporting…';
}

// Label of the grid editor's button that exports the root table.
export function linkExportLabel() {
  return 'Export this table';
}

// Label of the grid editor's export button while the export is in flight.
export function linkExportingLabel() {
  return 'Exporting…';
}

// ---------------------------------------------------------------------------
// Help and hints overlay
//
// Colours and metrics of the help overlay — its scrim, the hole it cuts around
// the described element, and the card it draws beside that hole — plus the
// localStorage key prefix its "seen" record uses. These return literal values
// rather than var(--…) references to globals.css: the overlay owns its own
// palette.
// ---------------------------------------------------------------------------

// Fill of the scrim drawn over the whole viewport behind the overlay.
export function helpScrimColour() {
  return 'rgba(28, 32, 30, 0.62)';
}

// Padding (screen px) added around the described element's rect to make the hole
// the scrim leaves clear of it.
export function helpHolePaddingPx() {
  return 6;
}

// Corner radius (screen px) of that hole.
export function helpHoleRadiusPx() {
  return 8;
}

// Spread (screen px) of the box-shadow that paints the scrim outward from the
// hole. Large enough to cover any viewport.
export function helpHoleShadowSpreadPx() {
  return 9999;
}

// Rendered width (screen px) of the help card.
export function helpCardWidthPx() {
  return 380;
}

// Height (screen px) the card is assumed to have while it is being placed. The card
// is positioned before the browser lays it out, so its real height is not knowable
// at that point; placement clamps every edge inside the viewport margins, so an
// assumed height that is wrong only slides the card along the hole's edge.
export function helpCardAssumedHeightPx() {
  return 220;
}

// Size (screen px) of the caret pointing from the card at the hole. It stands this
// far out from the card's edge and is twice this across, being a border triangle.
export function helpCardCaretSizePx() {
  return 8;
}

// Gap (screen px) between the hole's edge and the card beside it.
export function helpCardGapPx() {
  return 12;
}

// Minimum gap (screen px) between the card and the viewport edge.
export function helpViewportMarginPx() {
  return 16;
}

// z-index of the overlay layer. Above every level the application already uses.
export function helpLayerZIndex() {
  return 2000;
}

// Namespace prefix for the localStorage keys recording which screen's hints a
// user has already seen. localStorage is shared with unprefixed keys, so these
// carry their own namespace.
export function helpSeenKeyPrefix() {
  return 'mylossrun.help.seen.';
}

// Fill of the help card.
export function helpCardBackgroundColour() {
  return '#1d4634';
}

// Text colour on that card.
export function helpCardTextColour() {
  return '#ffffff';
}

// Font size of the card's body text — the tip's words, and the summary and
// introduction on the entry card. Smaller than the title above it.
export function helpCardBodyFontSize() {
  return '0.8rem';
}

// Line height of that body text.
export function helpCardBodyLineHeight() {
  return 1.2;
}

// Height of the gap a paragraph break opens in that body text. The break also ends
// the line it stands on, so this is the space between two paragraphs and not the
// space between two lines of one.
export function helpCardParagraphGapHeight() {
  return '0.6em';
}

// Fill of the HELP chip on the card.
export function helpChipBackgroundColour() {
  return '#2f6b4f';
}

// Fill of the numbered hint badge, and the colour of the number on it.
export function helpBadgeBackgroundColour() {
  return '#3DB86A';
}

export function helpBadgeTextColour() {
  return '#ffffff';
}

// The `data-help-id` values. Each element the overlay can describe carries one of
// these as its attribute and the copy module keys its tips by the same function,
// so no id exists as a literal on either side: an unknown id is ignored by the
// hit-test, so a typo would show up as help that does nothing rather than as an
// error.
//
// helpButtonHelpId is read by three sides that must agree — the overlay measures
// the entry card's hole from it, the toolbar button carries it as its attribute,
// and no screen may author a tip for it.
export function helpButtonHelpId() {
  return 'help-button';
}

// The account button at the far right of the toolbar, beside the `?`. The toolbar stands
// over every screen, so every screen describes it.
export function accountButtonHelpId() {
  return 'account-button';
}

export function dropBoxHelpId() {
  return 'document-drop-box';
}

export function documentListCountsHelpId() {
  return 'document-list-counts';
}

export function documentListTableHelpId() {
  return 'document-list-table';
}

export function documentListStatusHelpId() {
  return 'document-list-status';
}

// The actions button at the end of each document list row.
export function documentListActionsHelpId() {
  return 'document-list-actions';
}

// The boundary pass's ids. The two Options buttons and the pass-switch / page buttons
// live in the Layers panel, the dim and scale controls in the editor's own toolbar, the
// two labels on the selected table's corners, and the rest in the Document Overview
// column down the left or the Pages column down the right.
//
// The two corner labels are not the boundary pass's alone: both passes describe both of
// them — the name label in the same words, from one shared list, and the status label in
// words of each pass's own, the boundary pass's about the linking a click drives and the
// contents pass's about what the label says where it is inert.
//
// The Document Overview column stands unchanged through both editor passes, so the ids
// from documentOverviewSaveHelpId down are described by the contents pass too.
export function boundaryDeleteTableHelpId() {
  return 'boundary-delete-table';
}

// The Cut Start button.
export function boundaryCutStartHelpId() {
  return 'boundary-cut-start';
}

// The Cut End button.
export function boundaryCutEndHelpId() {
  return 'boundary-cut-end';
}

// The Cut Cancel button.
export function boundaryCutCancelHelpId() {
  return 'boundary-cut-cancel';
}

// The Delete all tables button.
export function boundaryDeleteAllTablesHelpId() {
  return 'boundary-delete-all-tables';
}

export function boundaryCreateTableHelpId() {
  return 'boundary-create-table';
}

// The three things in the editor's own title bar, above the page: which document and page
// are on screen, and the two controls for how that page is shown.
export function editorPageTitleHelpId() {
  return 'editor-page-title';
}

export function editorDimDocumentHelpId() {
  return 'editor-dim-document';
}

export function editorScaleHelpId() {
  return 'editor-scale';
}

export function pagesColumnHelpId() {
  return 'pages-column';
}

export function tableLinkLabelHelpId() {
  return 'table-link-label';
}

export function tableNameLabelHelpId() {
  return 'table-name-label';
}

export function toolbarAllFilesHelpId() {
  return 'toolbar-all-files';
}

// The toolbar's two pass tabs. They stand in the toolbar rather than the Layers panel, so
// they carry ids of their own even though their words are the panel buttons' words: an id
// names one element, and the overlay measures its hole from the element it finds.
export function toolbarValidateBordersHelpId() {
  return 'toolbar-validate-borders';
}

export function toolbarValidateTablesHelpId() {
  return 'toolbar-validate-tables';
}

// The toolbar's screen tabs that appear only on the screen they name.
export function toolbarReviewHelpId() {
  return 'toolbar-review';
}

export function toolbarGridEditorHelpId() {
  return 'toolbar-grid-editor';
}

// The toolbar tabs' labels.
export function toolbarAllFilesLabel() {
  return '← All Files';
}

export function toolbarValidateBordersLabel() {
  return 'Validate Borders';
}

export function toolbarValidateTablesLabel() {
  return 'Validate Tables';
}

export function toolbarReviewLabel() {
  return 'Review';
}

export function toolbarGridEditorLabel() {
  return 'Grid Editor';
}

export function validateTablesHelpId() {
  return 'layers-validate-tables';
}

// The pass switch's other face, in the same place in the panel: the contents pass shows
// Validate Borders where the boundary pass shows Validate Tables.
export function validateBordersHelpId() {
  return 'layers-validate-borders';
}

export function layersPreviousHelpId() {
  return 'layers-previous';
}

export function layersNextHelpId() {
  return 'layers-next';
}

export function documentOverviewSaveHelpId() {
  return 'document-overview-save';
}

export function includeDeletedHelpId() {
  return 'overview-include-deleted';
}

export function documentOverviewHelpId() {
  return 'document-overview';
}

export function documentOverviewEntryHelpId() {
  return 'document-overview-entry';
}

export function documentOverviewLinkHelpId() {
  return 'document-overview-link';
}

export function documentOverviewReviewHelpId() {
  return 'document-overview-review';
}

export function documentOverviewExportHelpId() {
  return 'document-overview-export';
}

export function documentOverviewExportTableHelpId() {
  return 'document-overview-export-table';
}

// The contents pass's ids: the Layers column, the tool rail and its three buttons, and the
// nine entries of the Special tool's sub-menu — and the page in the centre, which is not
// the contents pass's alone. Both passes describe editorPageTableHelpId, in different
// words: the boundary pass as the selected table's boundary, the contents pass as the grid
// that boundary holds.
export function editorPageTableHelpId() {
  return 'editor-page-table';
}

export function layersPanelHelpId() {
  return 'layers-panel';
}

// One per layer row in that panel.
export function layersBordersHelpId() {
  return 'layers-borders';
}

export function layersRowsHelpId() {
  return 'layers-rows';
}

export function layersColumnsHelpId() {
  return 'layers-columns';
}

export function layersSpecialHelpId() {
  return 'layers-special';
}

export function layersColoursHelpId() {
  return 'layers-colours';
}

export function gridToolRailHelpId() {
  return 'grid-tool-rail';
}

export function gridToolRowsHelpId() {
  return 'grid-tool-rows';
}

export function gridToolColumnsHelpId() {
  return 'grid-tool-columns';
}

export function gridToolSpecialHelpId() {
  return 'grid-tool-special';
}

export function specialToolHeaderHelpId() {
  return 'special-tool-header';
}

export function specialToolTitleHelpId() {
  return 'special-tool-title';
}

export function specialToolSectionHelpId() {
  return 'special-tool-section';
}

export function specialToolHideRowHelpId() {
  return 'special-tool-hide-row';
}

export function specialToolMergedHelpId() {
  return 'special-tool-merged';
}

export function specialToolJoinedEndRowHelpId() {
  return 'special-tool-joined-end-row';
}

// The review screen's ids: the two titles above the grid, the count and the go-to controls
// in the bar over them, the grid itself, the section tabs under it and the Save that ends
// the review.
// The grid editor's ids: the two lists it moves tables between, and the four buttons on
// its foot.
export function linkAvailableTablesHelpId() {
  return 'link-available-tables';
}

export function linkLinkedTablesHelpId() {
  return 'link-linked-tables';
}

export function linkUnlinkHelpId() {
  return 'link-unlink';
}

export function linkCancelHelpId() {
  return 'link-cancel';
}

// Grid editor's Export button help id.
export function linkExportHelpId() {
  return 'link-export';
}

export function linkSaveHelpId() {
  return 'link-save';
}

export function reviewTitleHelpId() {
  return 'review-title-row';
}

export function reviewSectionTitleHelpId() {
  return 'review-section-title-row';
}

export function reviewFlaggedCountHelpId() {
  return 'review-flagged-count';
}

export function reviewPoorCellsHelpId() {
  return 'review-poor-cells-controls';
}

export function reviewGridHelpId() {
  return 'review-grid';
}

export function reviewTabsHelpId() {
  return 'review-tabs';
}

export function reviewCloseHelpId() {
  return 'review-close';
}

export function reviewExportHelpId() {
  return 'review-export';
}

export function reviewTableNameHelpId() {
  return 'review-table-name';
}

export function reviewFontScaleHelpId() {
  return 'review-font-scale';
}

// The cell-edit dialog's ids: the crop of the cell as the document has it, the three
// buttons that end the edit and the confidence the value was read with. They belong to
// the review screen's tips, the dialog being part of that screen rather than one of its
// own.
export function cellEditImageHelpId() {
  return 'cell-edit-image';
}

export function cellEditCancelHelpId() {
  return 'cell-edit-cancel';
}

export function cellEditConfirmHelpId() {
  return 'cell-edit-confirm';
}

export function cellEditNextHelpId() {
  return 'cell-edit-confirm-next';
}

export function cellEditConfidenceHelpId() {
  return 'cell-edit-confidence';
}

export function specialToolColouredRowsHelpId() {
  return 'special-tool-coloured-rows';
}

export function specialToolColouredColumnsHelpId() {
  return 'special-tool-coloured-columns';
}

export function specialToolColouredTableHelpId() {
  return 'special-tool-coloured-table';
}

export function specialToolColouredCellHelpId() {
  return 'special-tool-coloured-cell';
}

export function specialToolColouredAreaHelpId() {
  return 'special-tool-coloured-area';
}

// The screen ids. Each names one arrangement of the UI that gets its own help, and
// is derived from state that already exists: the document list is PDFLoader being
// mounted, the two passes are the editor's border/grid modes, and the link and
// review screens are its centreMode. Named here because the copy keys its screens
// by them and the registration sites report them, so a literal in either place
// would fail silently — an id with no copy simply has no help.
export function documentListScreenId() {
  return 'documentList';
}

export function boundaryPassScreenId() {
  return 'boundaryPass';
}

export function contentsPassScreenId() {
  return 'contentsPass';
}

export function linkTablesScreenId() {
  return 'linkTables';
}

export function reviewTableScreenId() {
  return 'reviewTable';
}

// The page editor's mode in each of the two passes.
export function boundaryPassEditorMode() {
  return 'border';
}

export function contentsPassEditorMode() {
  return 'grid';
}

export function unknownExtractionMechanism() {
  return 'UNKNOWN';
}

export function emphasiseLowQualityCells() {
  return false;
}

// The width and height in screen px of a toolbar icon button. It governs the help
// '?' and the account button beside it alike, which is what makes them one size.
export function toolbarIconButtonSizePx() {
  return 20;
}

// Size (screen px) of the spinner the document row menu button shows while an action runs.
export function documentRowMenuSpinnerSizePx() {
  return 20;
}

// The label on the sign-out menu item.
export function signOutLabel() {
  return 'Sign Out';
}

// Document row menu labels, shared with the help copy.
export function downloadOriginalLabel() {
  return 'Download Original';
}

export function exportDocumentLabel() {
  return 'Export';
}

// Border-pass cut and delete-all button and dialog labels.
export function cutStartLabel() {
  return 'Start Cut Table';
}

export function cutEndLabel() {
  return 'End Cut';
}

export function cutCancelLabel() {
  return 'Cancel Cut';
}

export function deleteAllTablesLabel() {
  return 'Delete all tables';
}

export function deleteAllTablesTitle() {
  return 'Are you sure?';
}

export function deleteAllTablesBody() {
  return 'Delete every table in this PDF, or only the tables on this page?';
}

export function deleteAllCancelLabel() {
  return 'No: Cancel';
}

export function deleteAllYesAllLabel() {
  return 'Yes: All tables';
}

export function deleteAllYesPageLabel() {
  return 'Yes: Just this pages tables';
}

export function appVersion() {
  return process.env.NEXT_PUBLIC_APP_VERSION || '';
}

// The two localStorage keys holding the login data. Sign-in and sign-out must agree
// about what the login data is; these values are what the application already
// stores and must not change.
export function accessCodeStorageKey() {
  return 'access_code';
}

export function userEmailStorageKey() {
  return 'user_email';
}

// Where the browser goes once signed out.
export function signedOutPath() {
  return '/';
}

const default_export = {
  baseUrl,
  resizeDebounceMs,
  nameTruncateLength,
  pollIntervalMs,
  gridLineColour,
  deletedGridLineColour,
  hitLineWidthPx,
  linkTableCellWidth,
  linkCellWaveHeightPx,
  linkCellWavePitchPx,
  linkCellBorderColour,
  linkCellBorderWidthPx,
  highConfidence,
  lowConfidence,
  mediumConfidence,
  findTablesPollIntervalMs,
  findTablesPollTimeoutMs,
  extractPollIntervalMs,
  extractPollTimeoutMs,
  findGridLinesPath,
  calculateCellsPath,
  toExcelPath,
  excelContentType,
  excelFileSuffix,
  originalPdfPath,
  pdfContentType,
  originalDownloadableStatuses,
  exportableStatuses,
  tableExportFilenameSeparator,
  tableExportFilenamePathSeparatorPattern,
  tableExportFilenamePathSeparatorReplacement,
  stagedGridEditorEnabled,
  tableSeparationEnabled,
  tableSeparationGapPx,
  tableSeparationTouchTolerancePx,
  layerTickSlotWidthPx,
  defaultScalePercent,
  scalePercentOptions,
  baseImageWidthPx,
  scaleDebounceMs,
  documentDimOpacity,
  rawImageStyle,
  processedImageStyle,
  layerBorderColour,
  layerRowsColour,
  layerColumnsColour,
  layerSpecialCellsColour,
  layerColoursColour,
  layerBorderBackgroundColour,
  layerRowsBackgroundColour,
  layerColumnsBackgroundColour,
  layerSpecialCellsBackgroundColour,
  layerColoursBackgroundColour,
  documentOverviewButtonFontSize,
  selectionScrollIntoViewOptions,
  selectedTableLabelClearancePx,
  layerGrey,
  linkedEmphasisColour,
  linkedGroupOutlineWidthPx,
  linkedGroupOutlineGapPx,
  gridToolIconSizePx,
  gridToolLineThicknessPx,
  gridToolSquareStrokePx,
  gridToolbarBorderWidthPx,
  gridToolbarBorderColour,
  gridToolbarCornerRadiusPx,
  gridToolbarShadow,
  mergeCoverageFraction,
  mergedCellOutlineWidthPx,
  splitRowWaveHeightPx,
  splitRowWavePitchPx,
  colourSpecialToolKeys,
  sectionTitlePlaceholderColumnName,
  selectedRowHighlight,
  selectedColumnHighlight,
  layersPanelWidthPx,
  selectedColouredAreaHighlight,
  sectionTitleMarkerColour,
  sectionTitleMarkerDash,
  cutColour,
  cutColourKey,
  cutLineDash,
  cutLineWidthPx,
  selectedSectionTitleHighlight,
  confirmedTableStage,
  confirmedTickBadgeColour,
  confirmedTickColour,
  confirmedTickBadgeSizePx,
  mergeLinkRootBadgeColour,
  optionsSeparatorColour,
  optionsSeparatorWidthPercent,
  optionsSeparatorHeightPx,
  optionsSeparatorMarginTopPx,
  optionsSeparatorMarginBottomPx,
  optionsSeparatorRadiusPx,
  optionsGroupTitleVariant,
  optionsGroupSpacing,
  optionsRowSpacing,
  reviewColumnMaxWidthPx,
  singleCellSpan,
  reviewWideCellMinCharacters,
  reviewCellBorderColour,
  reviewSplitRowWaveColour,
  reviewSplitRowWaveStrokeWidthPx,
  reviewLowConfidenceBackgroundColour,
  reviewLowConfidenceBorderColour,
  reviewLowConfidenceMarkerWidthPx,
  reviewSelectedCellBackgroundColour,
  reviewSelectedCellBorderWidthPx,
  reviewSelectedCellRadiusPx,
  reviewSelectedCellPaddingPx,
  reviewSelectedCellShadow,
  cancelColour,
  confirmColour,
  reviewCellEditDialogWidthPx,
  reviewCellEditRowCount,
  reviewCellEditorMinWidthPx,
  maxCellEditorImageHeight,
  cellEditImageSpinnerSizePx,
  cellEditImageLoadingHeightPx,
  reviewEditedCellConfidence,
  reviewPoorCellSelectWidthPx,
  reviewGutterWidthPx,
  reviewGutterHeightPx,
  reviewGutterBackgroundColour,
  reviewGutterBorderColour,
  reviewFontScalePercentOptions,
  reviewDefaultFontScalePercent,
  reviewFontScaleStorageKey,
  reviewHeaderRowGapPx,
  cellLineBreakPattern,
  reviewClosingOperation,
  reviewExportingOperation,
  reviewTitleLabel,
  reviewSectionTitleLabel,
  reviewCloseLabel,
  reviewExportLabel,
  reviewExportingLabel,
  linkExportLabel,
  linkExportingLabel,
  helpScrimColour,
  helpHolePaddingPx,
  helpHoleRadiusPx,
  helpHoleShadowSpreadPx,
  helpCardWidthPx,
  helpCardAssumedHeightPx,
  helpCardCaretSizePx,
  helpCardGapPx,
  helpViewportMarginPx,
  helpLayerZIndex,
  helpSeenKeyPrefix,
  helpCardBackgroundColour,
  helpCardTextColour,
  helpCardBodyFontSize,
  helpCardBodyLineHeight,
  helpCardParagraphGapHeight,
  helpChipBackgroundColour,
  helpBadgeBackgroundColour,
  helpBadgeTextColour,
  helpButtonHelpId,
  accountButtonHelpId,
  documentListScreenId,
  boundaryPassScreenId,
  contentsPassScreenId,
  linkTablesScreenId,
  reviewTableScreenId,
  boundaryPassEditorMode,
  contentsPassEditorMode,
  dropBoxHelpId,
  documentListCountsHelpId,
  documentListTableHelpId,
  documentListStatusHelpId,
  documentListActionsHelpId,
  boundaryDeleteTableHelpId,
  boundaryCutStartHelpId,
  boundaryCutEndHelpId,
  boundaryCutCancelHelpId,
  boundaryDeleteAllTablesHelpId,
  boundaryCreateTableHelpId,
  editorPageTitleHelpId,
  editorDimDocumentHelpId,
  editorScaleHelpId,
  pagesColumnHelpId,
  tableLinkLabelHelpId,
  tableNameLabelHelpId,
  toolbarAllFilesHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
  toolbarReviewHelpId,
  toolbarGridEditorHelpId,
  toolbarAllFilesLabel,
  toolbarValidateBordersLabel,
  toolbarValidateTablesLabel,
  toolbarReviewLabel,
  toolbarGridEditorLabel,
  validateTablesHelpId,
  validateBordersHelpId,
  layersPreviousHelpId,
  layersNextHelpId,
  documentOverviewSaveHelpId,
  includeDeletedHelpId,
  documentOverviewHelpId,
  documentOverviewEntryHelpId,
  documentOverviewLinkHelpId,
  documentOverviewReviewHelpId,
  documentOverviewExportHelpId,
  documentOverviewExportTableHelpId,
  editorPageTableHelpId,
  layersPanelHelpId,
  layersBordersHelpId,
  layersRowsHelpId,
  layersColumnsHelpId,
  layersSpecialHelpId,
  layersColoursHelpId,
  gridToolRailHelpId,
  gridToolRowsHelpId,
  gridToolColumnsHelpId,
  gridToolSpecialHelpId,
  specialToolHeaderHelpId,
  specialToolTitleHelpId,
  specialToolSectionHelpId,
  specialToolHideRowHelpId,
  specialToolMergedHelpId,
  specialToolJoinedEndRowHelpId,
  linkAvailableTablesHelpId,
  linkLinkedTablesHelpId,
  linkUnlinkHelpId,
  linkCancelHelpId,
  linkExportHelpId,
  linkSaveHelpId,
  reviewTitleHelpId,
  reviewSectionTitleHelpId,
  reviewFlaggedCountHelpId,
  reviewPoorCellsHelpId,
  reviewGridHelpId,
  reviewTabsHelpId,
  reviewCloseHelpId,
  reviewExportHelpId,
  reviewTableNameHelpId,
  reviewFontScaleHelpId,
  cellEditImageHelpId,
  cellEditCancelHelpId,
  cellEditConfirmHelpId,
  cellEditNextHelpId,
  cellEditConfidenceHelpId,
  specialToolColouredRowsHelpId,
  specialToolColouredColumnsHelpId,
  specialToolColouredTableHelpId,
  specialToolColouredCellHelpId,
  specialToolColouredAreaHelpId,
  unknownExtractionMechanism,
  emphasiseLowQualityCells,
  toolbarIconButtonSizePx,
  documentRowMenuSpinnerSizePx,
  signOutLabel,
  downloadOriginalLabel,
  exportDocumentLabel,
  cutStartLabel,
  cutEndLabel,
  cutCancelLabel,
  deleteAllTablesLabel,
  deleteAllTablesTitle,
  deleteAllTablesBody,
  deleteAllCancelLabel,
  deleteAllYesAllLabel,
  deleteAllYesPageLabel,
  appVersion,
  accessCodeStorageKey,
  userEmailStorageKey,
  signedOutPath
};

export default default_export;
