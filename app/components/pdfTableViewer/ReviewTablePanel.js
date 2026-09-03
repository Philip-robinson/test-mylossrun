'use client';

// The extraction review screen: fills the editor's middle panel and shows the tables
// produced by merging a linked group, so the user can see what will be built before
// committing to it. A group carrying the placeholder section-title column arrives as one
// table per section, and the tab strip under the grid is how the reviewer moves between
// them; a group without one arrives as a single table and shows no strip at all.
//
// Clicking any cell — or the table's title, which sits above the grid — turns that cell
// into a field and opens the cell-edit dialog beside it. The correction is typed in the
// cell and settled by the dialog's buttons; the panel holds the text in between, which
// is why `editing` carries it. A confirmed correction is written both into what is
// displayed and, through `onEditTables`, into the editor's locally held document
// metadata. `onEditTables` marks the document dirty and the editor's Save button stays
// the persistence point for ordinary editing.
//
// The Save button at the foot is the only way out, and it is labelled for the part that
// can fail: it saves through `onSave` and leaves only if that worked, because the export
// the Document Overview offers is built from what the SERVER holds. Exporting itself
// lives there rather than here — one workbook covers the whole document.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import toast from 'react-hot-toast';
import { extractTable, getCellImages } from 'services/images';
import CellEditDialog from 'components/pdfTableViewer/CellEditDialog';
import ReviewCellEditor from 'components/pdfTableViewer/ReviewCellEditor';
import ReviewTableTabs from 'components/pdfTableViewer/ReviewTableTabs';
import {
  adjacentPoorCell,
  belowHighConfidenceCells,
  cellCoordinate,
  columnLabel,
  flaggedForReviewLabel,
  isWideText,
  looksNumeric,
  lowConfidenceSectionTitle,
  lowConfidenceTitle,
} from 'components/pdfTableViewer/reviewUtils';
import {
  applyEditToGrid,
  applyEditToSectionTitle,
  applyEditToTables,
  cellSourceKey,
  isTitleCell,
  sameRect,
} from 'components/pdfTableViewer/reviewEditUtils';
import {
  highConfidence,
  reviewCellBorderColour,
  reviewFlaggedCountHelpId,
  reviewGridHelpId,
  reviewPoorCellsHelpId,
  reviewSaveHelpId,
  reviewSectionTitleHelpId,
  reviewTitleHelpId,
  reviewColumnMaxWidthPx,
  reviewEditedCellConfidence,
  reviewGutterBackgroundColour,
  reviewGutterBorderColour,
  reviewGutterHeightPx,
  reviewGutterWidthPx,
  reviewLowConfidenceBackgroundColour,
  reviewLowConfidenceBorderColour,
  reviewLowConfidenceMarkerWidthPx,
  reviewPoorCellSelectWidthPx,
  reviewSelectedCellBackgroundColour,
  reviewSelectedCellBorderWidthPx,
  reviewSelectedCellPaddingPx,
  reviewSelectedCellRadiusPx,
  reviewSelectedCellShadow,
  reviewSectionTitleLabel,
  reviewTitleLabel,
  reviewWideCellMinCharacters,
} from 'config';

// Columns are content-sized but capped, and over-long content wraps at word boundaries
// (never mid-word: `word-break: break-all` would split account numbers and names, which
// is worse than a wide column). Every cell is top-aligned so a tall wrapped cell does
// not float its short neighbours into the middle of the row.
//
// A cell holding long text also gets a MINIMUM width equal to the cap, because the
// browser's automatic table layout is free to squeeze a wrappable column down towards
// its longest word to make room for the rest of the row — which turns a long value into
// a narrow ribbon many lines tall. Pinning min and max to the same value takes that
// discretion away: a wide cell holds its column at exactly the cap, and (min-width being
// the stronger constraint of the two) is never squeezed below it. Since a column is as
// wide as its widest cell demands, one long cell is enough to hold the whole column open.
//
// Every cell is editable, so every cell carries the pointer cursor that says so.
//
// The ruling is uniform — one border colour for the whole grid. Confidence shows as a
// WASH over the cell instead, which reads as a region of the table needing attention
// rather than as a box drawn around each doubtful value. Its padding is zero because
// the wash has to reach the cell's edges and the body div inside it carries the
// spacing.
const cellStyle = (cell, poor) => ({
  maxWidth: reviewColumnMaxWidthPx(),
  minWidth: isWideText(cell.text, reviewWideCellMinCharacters())
    ? reviewColumnMaxWidthPx()
    : undefined,
  whiteSpace: 'normal',
  overflowWrap: 'break-word',
  verticalAlign: 'top',
  textAlign: looksNumeric(cell.text) ? 'right' : 'left',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: reviewCellBorderColour(),
  backgroundColor: poor ? reviewLowConfidenceBackgroundColour() : undefined,
  padding: 0,
  cursor: 'pointer',
  // Jumping to a coordinate must not park the cell underneath a ruler, so each cell
  // reserves the rulers' thickness as scroll margin.
  scrollMarginTop: reviewGutterHeightPx(),
  scrollMarginLeft: reviewGutterWidthPx(),
});

// The body wrapping a cell's text. Present in every cell so the text sits identically
// whether or not the cell is flagged, and filling the cell so a below-high cell's
// marker runs the full height of its left edge rather than the height of its text.
const cellBodyStyle = (poor) => ({
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: '2px 6px',
  borderLeft: poor
    ? `${reviewLowConfidenceMarkerWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`
    : undefined,
});

// The table's title, drawn as a flagged cell is drawn: the cell's own body style carries
// the left-edge marker, and the wash is the same one `cellStyle` puts behind a flagged
// cell. Built from those rather than restating either, so the title and the cells cannot
// drift apart. Editable, so it carries the pointer cursor that says so.
// The title and the section title are each drawn as a label beside their value. The label
// sits OUTSIDE the value's box, so the wash, the selection ring and the click that opens the
// editor all belong to the value alone.
const labelledRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 1,
};

const titleStyle = (poor) => ({
  ...cellBodyStyle(poor),
  backgroundColor: poor ? reviewLowConfidenceBackgroundColour() : undefined,
  cursor: 'pointer',
  flexGrow: 1,
  minWidth: 0,
});

// The ring around the selected cell, nested inside the body and still wrapping the
// text. Opaque, so on a washed cell it reads as the one value being worked on rather
// than one more flagged cell among many.
const cellSelectionStyle = () => ({
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  backgroundColor: reviewSelectedCellBackgroundColour(),
  border: `${reviewSelectedCellBorderWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`,
  borderRadius: reviewSelectedCellRadiusPx(),
  boxShadow: reviewSelectedCellShadow(),
  padding: reviewSelectedCellPaddingPx(),
});

// The two rulers stick against the panel's own scroller, each in ONE axis: the column
// letters hold their vertical place while travelling sideways with the columns they
// name, and the row numbers do the reverse. Their corner sticks in both, and so has to
// out-stack them where all three meet.
//
// Their separating line is an inset shadow rather than a border because the grid is
// `border-collapse: collapse`, which makes the TABLE draw a cell's border — so a sticky
// cell would leave its border behind as it moved. A shadow belongs to the cell and
// travels with it.
const gutterStyle = ({ top, left, zIndex }) => ({
  position: 'sticky',
  ...(top ? { top: 0 } : {}),
  ...(left ? { left: 0 } : {}),
  zIndex,
  backgroundColor: reviewGutterBackgroundColour(),
  boxShadow: [
    top ? `inset 0 -1px 0 ${reviewGutterBorderColour()}` : null,
    left ? `inset -1px 0 0 ${reviewGutterBorderColour()}` : null,
  ]
    .filter(Boolean)
    .join(', '),
  ...(top ? { height: reviewGutterHeightPx() } : {}),
  ...(left ? { width: reviewGutterWidthPx() } : {}),
  fontWeight: 'normal',
  textAlign: 'center',
  padding: '2px 6px',
});

export default function ReviewTablePanel({
  pdfId,
  tableId,
  tables,
  onEditTables,
  onExit,
  onSave,
}) {
  // Every table the extraction returned, and which of them is on screen. Deliberately not
  // called `tables`: that prop is the editor's list of PDFTables and is something else.
  const [mergedTables, setMergedTables] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Whether the save Exit runs is in flight, which locks the panel behind a spinner so a
  // second click cannot start a second save.
  const [exiting, setExiting] = useState(false);
  // The cell being corrected: the cell itself, the on-screen rectangle it occupies (the
  // dialog is placed against it), where it is in the grid — `{ rowIndex, columnIndex }`,
  // or `title: true` for the title — and the text as it currently stands in the field
  // inside it. Null when no cell is being corrected.
  //
  // The text lives HERE rather than in the field or the dialog because the field and the
  // buttons that commit it are now in two different places: the cell owns the typing and
  // the dialog owns the tick, and the panel is what they have in common.
  const [editing, setEditing] = useState(null);
  // Where the user is: `{ label, rowIndex, columnIndex }` for the grid cell last clicked
  // or last jumped to from the list, `{ label, title: true }` for the title, or null
  // before either. Kept separately from `editing` because it OUTLIVES the dialog —
  // closing the dialog leaves the value still marked, which is the point of marking it.
  //
  // The `label` is what stepping matches on, so the title — which is at no coordinate —
  // takes its turn in the list alongside the cells.
  const [selected, setSelected] = useState(null);
  // Cropped cell images, keyed by source key — one `{ raw, processed }` pair per cell, or
  // null where the fetch failed, which is what the dialog takes as its `image` — and the
  // set of keys already asked
  // for. Both live here rather than in the dialog, which is mounted only while a
  // cell is being edited, so re-opening a cell shows what was already fetched
  // instead of fetching it again.
  const [images, setImages] = useState({});
  const requestedRef = useRef(new Set());
  // The rendered element of each grid position, keyed 'row:column', so choosing a
  // coordinate can scroll straight to it. A plain object in a ref rather than state:
  // it is written during render commit and read only on a user action, so it must
  // never itself cause a render.
  const cellElementsRef = useRef({});
  // The rendered title element, held for the same reason and read the same way.
  const titleElementRef = useRef(null);
  // The rendered section-title element, likewise.
  const sectionTitleElementRef = useRef(null);

  // The extraction request in flight (or settled) for one addressed table:
  // { key, promise }. Held in a ref so the effect can ADOPT an existing request instead of
  // issuing a second one — see the effect below. A real unmount discards the ref with the
  // rest of the instance, so leaving and re-entering the panel starts a fresh extraction
  // rather than showing a stale one.
  const requestRef = useRef({ key: null, promise: null });

  // Fetch the merged table on mount and whenever the addressed table changes. The
  // in-flight/unmount race is guarded with a `cancelled` flag, exactly as the editor's
  // metadata and thumbnail effects do, so a late resolution (or rejection) after the
  // panel is gone sets no state and raises no toast. There is no automatic retry: the
  // extraction is expensive, so recovery is the user's decision.

  // Dispatching is deliberately separated from awaiting, because this effect runs TWICE on
  // mount under `next dev` (the App Router enables React StrictMode, whose setup/cleanup/setup
  // cycle would otherwise fire the request twice). The dispatch is not idempotent — each call
  // allocates a status id, writes a status file, moves the document to EXTRACTION_IN_PROGRESS
  // and fires a worker — so a second run adopts the promise the first one started, keyed on
  // the table it was started for. Adopting rather than skipping matters: the first run's
  // cleanup has already discarded its own result, so a run that fetched nothing and awaited
  // nothing would leave the panel on the spinner for ever.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMergedTables([]);
    setActiveIndex(0);
    // A coordinate means nothing against a different table.
    setSelected(null);
    const key = JSON.stringify([pdfId, tableId]);
    if (requestRef.current.key !== key) {
      requestRef.current = { key, promise: extractTable(pdfId, tableId) };
    }
    const pending = requestRef.current.promise;
    (async () => {
      try {
        const data = await pending;
        if (cancelled) return;
        setMergedTables(data?.tables ?? []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
        toast.error(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, tableId]);

  // The tab on screen. Everything the panel derives below reads this, so the review bar
  // and the Go to… list describe the table the user is actually looking at.
  const activeTable = mergedTables[activeIndex] ?? null;
  const rows = activeTable?.cells ?? [];
  // Recomputed every render from the DISPLAYED grid, so both the count and the list
  // of places to go shrink as corrections are confirmed. This is the list the GRID asks,
  // and only the grid: it holds nothing but positions, so the title can never match one.
  const poorCells = belowHighConfidenceCells(rows, highConfidence());
  // The title's entry, or null when there is no title or it was read confidently.
  const titleEntry = lowConfidenceTitle(
    activeTable?.title,
    highConfidence(),
    reviewTitleLabel()
  );
  // Everything worth the user's attention, in reading order. The title heads the list
  // because it sits above the grid on screen. This is what the count, the Go to… list and
  // the step buttons all work from.
  // The section title this tab was split out on, flagged on the title's terms. It sits
  // between them because that is where it is drawn: under the title, above the grid.
  const sectionTitleEntry = lowConfidenceSectionTitle(
    activeTable?.sectionTitle,
    highConfidence(),
    reviewSectionTitleLabel()
  );
  const poorEntries = [titleEntry, sectionTitleEntry, ...poorCells].filter(
    Boolean
  );

  // The title as a source reference the edit dialog and the edit helpers understand: it
  // names the table holding the title rather than a position in the grid.
  const titleCell = activeTable?.title
    ? {
        tableId: activeTable.title.tableId,
        titleRef: true,
        text: activeTable.title.text,
        confidence: activeTable.title.confidence,
      }
    : null;

  // The section title as a source reference: it names the table holding the section titles
  // and the index within them, which is what `reviewEditUtils` resolves a section-title cell
  // by — so it is corrected through exactly the same path as a cell or the title.
  const sectionTitleCell = activeTable?.sectionTitle
    ? {
        tableId: activeTable.sectionTitle.tableId,
        sectionTitleIndex: activeTable.sectionTitle.sectionTitleIndex,
        text: activeTable.sectionTitle.text,
        confidence: activeTable.sectionTitle.confidence,
      }
    : null;

  const titleSelected = selected?.title === true;
  const sectionTitleSelected = selected?.sectionTitle === true;
  const sectionTitleEditing = editing?.sectionTitle === true;
  // Whether the field is in the TITLE rather than in a grid cell.
  const titleEditing = editing?.title === true;

  // What the field in the cell reports as it is typed into. Written back through the
  // updater form so that a keystroke arriving after the edit was closed leaves it closed
  // rather than resurrecting it.
  const handleEditText = (text) =>
    setEditing((previous) => previous && { ...previous, text });

  // The rectangle the dialog is placed against, kept true to where the cell actually is.
  //
  // It cannot be measured once at the click and left: putting a field INTO the cell
  // changes the cell. A narrow column widens to the field's floor, the table's automatic
  // layout redistributes the rest of the row around it, and the cell that was clicked
  // ends up somewhere other than where it was measured — so a dialog placed on the
  // click-time rectangle sat over the very cell it is meant to sit beside. The field also
  // grows as it is typed into, which moves the cell's bottom edge the dialog aligns with.
  //
  // Re-measured after every paint for that reason, and guarded on the measurement rather
  // than on a dependency list: an unchanged rectangle sets no state, so the update this
  // makes settles after one round instead of measuring for ever.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!editing) return;
    const element = editing.title
      ? titleElementRef.current
      : cellElementsRef.current[`${editing.rowIndex}:${editing.columnIndex}`];
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setEditing((previous) =>
      previous && !sameRect(previous.rect, rect)
        ? { ...previous, rect }
        : previous
    );
  });

  // Bring a chosen entry into view. 'nearest' scrolls the least that will do, so
  // something already on screen does not jump, and only the review panel's own scroller
  // moves rather than the whole editor. The title lives outside that scroller, so it is
  // scrolled through its own element for the same reason.
  const goToCell = (target) => {
    if (!target) return;
    // Marked as well as scrolled to: a value that has just slid into view is no easier
    // to pick out of a full screen of cells than one that has not.
    if (target.title) {
      setSelected({ label: target.label, title: true });
      titleElementRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
      return;
    }
    if (target.sectionTitle) {
      setSelected({ label: target.label, sectionTitle: true });
      sectionTitleElementRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
      return;
    }
    setSelected({
      label: cellCoordinate(target.rowIndex, target.columnIndex),
      rowIndex: target.rowIndex,
      columnIndex: target.columnIndex,
    });
    cellElementsRef.current[`${target.rowIndex}:${target.columnIndex}`]
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const handleGoToCell = (label) =>
    goToCell(poorEntries.find((entry) => entry.label === label));

  // A grid coordinate means nothing against a different grid, so moving tab drops both the
  // marked cell and any open dialog — the same reasoning the extraction effect applies when
  // the addressed table changes. The image cache is keyed by cell SOURCE rather than by
  // position, so it survives the move and is left alone.
  const handleTabChange = (index) => {
    setActiveIndex(index);
    setSelected(null);
    setEditing(null);
  };

  // Where each step button would land, computed rather than stored: it is also what
  // decides whether that button has anywhere to go, and one source for both keeps a
  // button that does nothing from ever being enabled.
  const previousPoor = adjacentPoorCell(poorEntries, selected, -1);
  const nextPoor = adjacentPoorCell(poorEntries, selected, 1);

  // Fetch one cell's two crops, at most once per source. A failure is reported and then
  // recorded as "no crop": the image is a convenience, and losing it must not cost the
  // user the edit, so the dialog is left with an empty image area and remains usable.
  //
  // The cache therefore holds three states at a key, which is what lets the dialog tell a
  // crop still coming from one that is never coming:
  //
  //   undefined  — not asked, or asked and not yet answered
  //   null       — asked, and there is no crop to show
  //   { raw, processed } — asked, and answered with a crop
  const handleRequestImage = ({ key, page, bounds, width }) => {
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    // The width comes from the dialog, which knows the cell it is showing: the crop is
    // rendered at that cell's own on-screen width, so it arrives at the scale the user is
    // already reading the table at. `key` stays here as the cache key and travels no
    // further — the endpoint answers about one cell, so it needs no name for it.
    getCellImages(pdfId, page, width, bounds)
      .then((response) => {
        setImages((prev) => ({
          ...prev,
          [key]: { raw: response.rawImage, processed: response.processedImage },
        }));
      })
      .catch((err) => {
        // Recorded as an answer, not left as silence: the dialog spins while a key holds
        // `undefined`, so a failure that wrote nothing would spin for ever. It is also
        // what stops the failure being asked again on every render.
        setImages((prev) => ({ ...prev, [key]: null }));
        toast.error(err.message);
      });
  };

  // Take a correction: into the metadata first, because that is the step that can
  // fail. A source the metadata no longer holds — a table deleted since the
  // extraction — leaves both the grid and the metadata untouched, since showing a
  // correction that could not be persisted would be a lie the next extraction
  // would expose.
  // Returns the updated grid, or null when nothing could be written — which is what lets
  // the caller decide what to do next without repeating the decision about whether the
  // save worked. A title correction leaves the grid alone and comes back with it
  // unchanged, since the title is not in it.
  const commitCorrection = () => {
    const { text } = editing;
    const next = applyEditToTables(
      tables,
      tableId,
      editing.cell,
      text,
      reviewEditedCellConfidence(),
    );
    if (next === null) {
      toast.error(
        'That cell is no longer in the document, so it was not changed.'
      );
      return null;
    }
    if (isTitleCell(editing.cell)) {
      // Every table of a split carries the SAME title, so a title correction shows on all
      // of them or on none.
      setMergedTables((prev) =>
        prev.map((merged) => ({
          ...merged,
          title: merged.title && {
            ...merged.title,
            text,
            confidence: reviewEditedCellConfidence(),
          },
        }))
      );
      onEditTables(next);
      return activeTable.cells;
    }
    // Applied to EVERY tab's grid, not just the visible one: a section-title column's
    // carried value repeats down many rows and can now repeat across several split tables,
    // so updating only what is on screen would leave the others showing the old text until
    // the next extraction.
    //
    // The section title drawn above the grid is not in the grid — the placeholder column
    // it came from is dropped when the split is made — so it is corrected alongside it.
    // Without that the metadata takes the correction and the heading goes back to the old
    // text the moment the field closes, which is exactly the reload disagreeing with the
    // screen.
    const updated = mergedTables.map((merged) => ({
      ...merged,
      sectionTitle: applyEditToSectionTitle(
        merged.sectionTitle,
        editing.cell,
        text,
        reviewEditedCellConfidence(),
      ),
      cells: applyEditToGrid(
        merged.cells,
        editing.cell,
        text,
        reviewEditedCellConfidence(),
      ),
    }));
    setMergedTables(updated);
    onEditTables(next);
    return updated[activeIndex].cells;
  };

  const handleConfirm = () => {
    commitCorrection();
    setEditing(null);
  };

  // Correct this cell and carry straight on to the next one still wanting attention,
  // without going back to the grid in between.
  //
  // The target is read BEFORE the correction lands, because the correction takes this
  // cell out of the poor list — asking afterwards would be asking about a list this cell
  // has already left, and `adjacentPoorCell` would answer by starting again at the top.
  // The cell handed to the dialog comes from the UPDATED grid, since a section-title
  // correction can change the target's text too.
  const handleConfirmAndNext = () => {
    const target = nextPoor;
    const cells = commitCorrection();
    if (cells === null || !target) {
      setEditing(null);
      return;
    }
    goToCell(target);
    // The title heads the list, so stepping on from a value that is not itself in the
    // list can land there — and it has no grid position to look up.
    if (target.title) {
      setEditing({
        cell: titleCell,
        rect: titleElementRef.current?.getBoundingClientRect() ?? editing.rect,
        title: true,
        text: titleCell?.text ?? '',
      });
      return;
    }
    const element =
      cellElementsRef.current[`${target.rowIndex}:${target.columnIndex}`];
    const nextCell = cells[target.rowIndex][target.columnIndex];
    setEditing({
      cell: nextCell,
      // Measured after the scroll, so the dialog is placed against where the cell has
      // just moved to rather than where it was.
      rect: element?.getBoundingClientRect() ?? editing.rect,
      rowIndex: target.rowIndex,
      columnIndex: target.columnIndex,
      text: nextCell.text ?? '',
    });
  };

  // What Tab in the correction field does, or undefined when it must do nothing.
  //
  // Tab IS the Next button — the same handler, so a correction settled by keystroke lands
  // exactly as one settled by the click — and it is refused on exactly the terms that
  // disable that button: a cell with no source key has nothing in the metadata to write
  // back to. Refused by being withheld rather than by being swallowed, so the keystroke
  // then goes back to being an ordinary Tab.
  const handleTab =
    editing && cellSourceKey(editing.cell) ? handleConfirmAndNext : undefined;

  // Save, and leave for the editor once the save has landed.
  //
  // The save is not optional and its result is not ignored: the export the Document
  // Overview offers is built from what the SERVER holds, so leaving with edits unsent would
  // quietly export the wrong document. A failed save has already raised its own toast, so
  // there is nothing to add here — the panel simply stays put.
  //
  // The lock is what stops a second click starting a second save.
  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    const saved = await onSave();
    setExiting(false);
    if (saved) onExit();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        // The export overlay covers the panel, so the panel is what it is positioned
        // against.
        position: 'relative',
      }}
    >
      {/* How much of this table is worth checking, stated before the user starts
          reading it. Outside the scrolling region, so the number stays in view while
          the grid moves under it, and derived from the DISPLAYED grid, so it falls as
          corrections are confirmed. */}
      {!loading && !error && (
        <Box
          data-testid={'review-bar'}
          sx={{
            flexShrink: 0,
            px: 1,
            pt: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Typography
            data-testid={'review-confidence-count'}
            data-help-id={reviewFlaggedCountHelpId()}
            variant={'body2'}
          >
            {flaggedForReviewLabel(poorEntries.length)}
          </Typography>
          {/* Everything to do with GOING somewhere, grouped so the bar stays a count on
              the left and a set of controls on the right however wide the panel is. */}
          <Box
            data-help-id={reviewPoorCellsHelpId()}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
            }}
          >
            {/* Where the user is, in the same coordinates the list offers, so the two
                can be read against each other. Absent until something is selected —
                there is no honest thing to say before that. */}
            {selected && (
              <Typography
                data-testid={'review-selected-cell'}
                variant={'body2'}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {titleSelected
                  ? 'Selected title'
                  : `Selected cell ${cellCoordinate(
                      selected.rowIndex,
                      selected.columnIndex
                    )}`}
              </Typography>
            )}
            {/* Stepping beats re-opening the list for every cell in turn. Each button is
                disabled exactly when its own target is missing, both reading the same
                computed target the click uses, so one that would do nothing is never
                offered. */}
            <IconButton
              data-testid={'review-previous-poor-cell'}
              size={'small'}
              aria-label={'Previous low confidence cell'}
              disabled={!previousPoor}
              onClick={() => goToCell(previousPoor)}
            >
              <ChevronLeftIcon fontSize={'small'} />
            </IconButton>
            {/* A native select rather than MUI's popup list: the list is a plain jump
                target, and a native control stays usable with the keyboard and however
                long the list gets. The value is not held in state — picking the same
                coordinate twice should scroll to it twice, which a controlled value
                pinned to the last choice would swallow — so it resets to the placeholder
                after each jump. The label is pinned shrunk because a native select always
                shows its current option, which an unshrunk label would sit on top of. */}
            <TextField
              select
              size={'small'}
              label={'Low confidence cells'}
              value={''}
              disabled={poorEntries.length === 0}
              onChange={(event) => handleGoToCell(event.target.value)}
              InputLabelProps={{ shrink: true }}
              SelectProps={{
                native: true,
                inputProps: { 'data-testid': 'review-poor-cells' },
              }}
              sx={{ flexShrink: 0, width: reviewPoorCellSelectWidthPx() }}
            >
              <option value={''}>{'Go to…'}</option>
              {poorEntries.map((entry) => (
                <option key={entry.label} value={entry.label}>
                  {entry.label}
                </option>
              ))}
            </TextField>
            <IconButton
              data-testid={'review-next-poor-cell'}
              size={'small'}
              aria-label={'Next low confidence cell'}
              disabled={!nextPoor}
              onClick={() => goToCell(nextPoor)}
            >
              <ChevronRightIcon fontSize={'small'} />
            </IconButton>
          </Box>
        </Box>
      )}
      {/* The table's own title, above the grid and OUTSIDE the scroller so it stays in
          view while the grid moves under it — it names what is being read, which is worth
          having to hand throughout. Drawn and flagged exactly as a cell is, and editable
          in the same dialog: the extraction misreads a heading as readily as a value. */}
      {!loading && !error && activeTable?.title && (
        <Box
          data-help-id={reviewTitleHelpId()}
          sx={{ flexShrink: 0, px: 1, pt: 1, ...labelledRowStyle }}
        >
          <Typography
            data-testid={'review-title-label'}
            variant={'body2'}
            color={'text.secondary'}
            sx={{ flexShrink: 0 }}
          >
            {`${reviewTitleLabel()}:`}
          </Typography>
          <Box
            data-testid={'review-title'}
            ref={titleElementRef}
            style={titleStyle(Boolean(titleEntry))}
            onClick={(event) => {
              // A click landing in the field of a title already being corrected is not a
              // fresh click on the title: restarting the edit would throw away what has
              // been typed.
              if (titleEditing) return;
              setSelected({ label: reviewTitleLabel(), title: true });
              setEditing({
                cell: titleCell,
                rect: event.currentTarget.getBoundingClientRect(),
                title: true,
                text: activeTable.title.text ?? '',
              });
            }}
          >
            {titleSelected ? (
              <div
                data-testid={'review-title-selection'}
                style={cellSelectionStyle()}
              >
                {titleEditing ? (
                  <ReviewCellEditor
                    value={editing.text}
                    onChange={handleEditText}
                    onTab={handleTab}
                  />
                ) : (
                  activeTable.title.text
                )}
              </div>
            ) : (
              activeTable.title.text
            )}
          </Box>
        </Box>
      )}
      {/* The section title this tab was split out on, under the title and above the grid.
          It is drawn here because it is nowhere else: the placeholder column it came from
          decides how the grid is split and names the tab, and is then DROPPED from the grid,
          so without this the value would be uncorrectable — and a misreading would silently
          mis-section the data and misname the sheet. Flagged and edited exactly as the
          title is. */}
      {!loading && !error && activeTable?.sectionTitle && (
        <Box
          data-help-id={reviewSectionTitleHelpId()}
          sx={{ flexShrink: 0, px: 1, pt: 1, ...labelledRowStyle }}
        >
          <Typography
            data-testid={'review-section-title-label'}
            variant={'body2'}
            color={'text.secondary'}
            sx={{ flexShrink: 0 }}
          >
            {`${reviewSectionTitleLabel()}:`}
          </Typography>
          <Box
            data-testid={'review-section-title'}
            ref={sectionTitleElementRef}
            style={titleStyle(Boolean(sectionTitleEntry))}
            onClick={(event) => {
              if (sectionTitleEditing) return;
              setSelected({
                label: reviewSectionTitleLabel(),
                sectionTitle: true,
              });
              setEditing({
                cell: sectionTitleCell,
                rect: event.currentTarget.getBoundingClientRect(),
                sectionTitle: true,
                text: activeTable.sectionTitle.text ?? '',
              });
            }}
          >
            {sectionTitleSelected ? (
              <div
                data-testid={'review-section-title-selection'}
                style={cellSelectionStyle()}
              >
                {sectionTitleEditing ? (
                  <ReviewCellEditor
                    value={editing.text}
                    onChange={handleEditText}
                    onTab={handleTab}
                  />
                ) : (
                  activeTable.sectionTitle.text
                )}
              </div>
            ) : (
              activeTable.sectionTitle.text
            )}
          </Box>
        </Box>
      )}
      {/* No padding on the ruled edges. The rulers pin to this scrollport, so padding
          here would hold them that far in from the top and left of the visible area
          rather than flush against it; the far edges keep their breathing room. The
          loading and error states pad themselves instead. */}
      <Box
        data-testid={'review-scroll'}
        data-help-id={reviewGridHelpId()}
        sx={{ overflow: 'auto', flex: 1, minHeight: 0, pr: 1, pb: 1 }}
      >
        {loading && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              height: '100%',
            }}
          >
            <CircularProgress />
            <Typography variant={'body2'}>{'Extracting…'}</Typography>
          </Box>
        )}
        {!loading && error && (
          <Typography variant={'body2'} color={'error'} sx={{ p: 1 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && (
          <Box component={'table'} sx={{ borderCollapse: 'collapse' }}>
            <tbody>
              {/* The column-letter ruler, one cell per grid column plus the corner. */}
              <tr>
                <th
                  data-testid={'review-corner'}
                  style={gutterStyle({ top: true, left: true, zIndex: 3 })}
                />
                {(rows[0] ?? []).map((_, columnIndex) => (
                  <th
                    key={columnIndex}
                    data-testid={'review-column-head'}
                    style={gutterStyle({ top: true, zIndex: 2 })}
                  >
                    {columnLabel(columnIndex)}
                  </th>
                ))}
              </tr>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {/* The row-number ruler. Numbered from the top of the DISPLAYED
                      grid, header rows included, so it agrees with the coordinates
                      the bar's list offers. */}
                  <th
                    data-testid={'review-row-head'}
                    style={gutterStyle({ left: true, zIndex: 1 })}
                  >
                    {rowIndex + 1}
                  </th>
                  {row.map((cell, columnIndex) => {
                    // The merged table's leading rows are its headers; there is no
                    // per-cell header flag to consult.
                    const Tag =
                      rowIndex < (activeTable.headerCount ?? 0) ? 'th' : 'td';
                    // Flagged on the SAME rule the bar counts by, and deliberately not
                    // on a sourceless position: a blank nothing ever read is not a poor
                    // reading. `poorCells` already applies both, so ask it rather than
                    // re-deriving the test here and risking the two drifting apart.
                    const poor = poorCells.some(
                      (candidate) =>
                        candidate.rowIndex === rowIndex &&
                        candidate.columnIndex === columnIndex
                    );
                    const isSelected =
                      selected?.rowIndex === rowIndex &&
                      selected?.columnIndex === columnIndex;
                    // The one position whose text is being typed. Matched on position
                    // rather than on source: a section title's value repeats down many
                    // rows, and only the one that was clicked becomes a field.
                    const isEditing =
                      editing?.rowIndex === rowIndex &&
                      editing?.columnIndex === columnIndex;
                    return (
                      <Tag
                        key={columnIndex}
                        data-testid={'review-cell'}
                        ref={(element) => {
                          cellElementsRef.current[
                            `${rowIndex}:${columnIndex}`
                          ] = element;
                        }}
                        style={cellStyle(cell, poor)}
                        onClick={(event) => {
                          // A click landing in the field of the cell already being
                          // corrected is not a fresh click on the cell: restarting the
                          // edit would throw away what has been typed.
                          if (isEditing) return;
                          setSelected({
                            label: cellCoordinate(rowIndex, columnIndex),
                            rowIndex,
                            columnIndex,
                          });
                          setEditing({
                            cell,
                            rect: event.currentTarget.getBoundingClientRect(),
                            rowIndex,
                            columnIndex,
                            text: cell.text ?? '',
                          });
                        }}
                      >
                        <div
                          data-testid={'review-cell-body'}
                          style={cellBodyStyle(poor)}
                        >
                          {isSelected ? (
                            <div
                              data-testid={'review-cell-selection'}
                              style={cellSelectionStyle()}
                            >
                              {isEditing ? (
                                <ReviewCellEditor
                                  value={editing.text}
                                  onChange={handleEditText}
                                  onTab={handleTab}
                                />
                              ) : (
                                cell.text
                              )}
                            </div>
                          ) : (
                            cell.text
                          )}
                        </div>
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Box>
        )}
      </Box>
      {/* Under the grid and above the buttons, so moving between sections is where the
          sections are. Draws nothing at all for a single table. */}
      <ReviewTableTabs
        tables={mergedTables}
        activeIndex={activeIndex}
        onChange={handleTabChange}
      />
      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          p: 1,
        }}
      >
        <Button
          data-testid={'review-exit'}
          data-help-id={reviewSaveHelpId()}
          variant={'outlined'}
          size={'small'}
          disabled={exiting}
          onClick={handleExit}
        >
          {'Save'}
        </Button>
      </Box>
      {/* The save lock. It covers the whole panel — bar, grid and buttons — because what is
          being sent is the document as it stands, so nothing may be changed while it goes.
          Opaque rather than a tint, so it also reads as "wait". */}
      {exiting && (
        <Box
          data-testid={'review-exiting'}
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            backgroundColor: 'background.paper',
            zIndex: 'modal',
          }}
        >
          <CircularProgress />
          <Typography variant={'body2'}>{'Saving…'}</Typography>
        </Box>
      )}
      {/* Mounting IS opening: the dialog owns no open state, so it exists only while
          a cell is being edited. */}
      {editing && (
        <CellEditDialog
          pdfId={pdfId}
          cell={editing.cell}
          tables={tables}
          reviewedTableId={tableId}
          anchorRect={editing.rect}
          image={images[cellSourceKey(editing.cell)]}
          onRequestImage={handleRequestImage}
          onCancel={() => setEditing(null)}
          onConfirm={handleConfirm}
          onConfirmAndNext={handleConfirmAndNext}
        />
      )}
    </Box>
  );
}
