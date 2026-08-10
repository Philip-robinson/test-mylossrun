'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import toast from 'react-hot-toast';
import { PageImageWithOverlay } from 'components/pdfTableViewer/PageImageWithOverlay';
import StagedPageGridEditor from 'components/pdfTableViewer/StagedPageGridEditor';
import LayersPanel from 'components/pdfTableViewer/LayersPanel';
import EditorScaleSelector from 'components/pdfTableViewer/EditorScaleSelector';
import DimDocumentToggle from 'components/pdfTableViewer/DimDocumentToggle';
import RawProcessedToggle from 'components/pdfTableViewer/RawProcessedToggle';
import {
  metadataTablesToOverlay,
  normaliseTableBounds,
  fillGridCells,
  findTableById,
  linkedTablesWithParents,
  mapAllTables,
  replaceTableById,
  buildCalcHint,
  mergeFindGridLines,
  overlapArea,
  mergedCellLimits,
} from 'components/pdfTableViewer/tableSupportUtils';
import {
  scalePercentToWidthPx,
  nextConfirmationStage,
  layerKeyForStage,
  stageAfterEdit,
  layerDataChanged,
  collectColumnNames,
  nextSectionTitleColumnName,
  nextTableOnPage,
  prevTableOnPage,
} from 'components/pdfTableViewer/layerUtils';
import {
  hasSavedGrid,
  isAmalgamated,
} from 'components/pdfTableViewer/gridUtilities';
import { getImage, findGridLines } from 'services/images';
import {
  resizeDebounceMs,
  stagedGridEditorEnabled,
  entryConfirmationStage,
  defaultSectionTitleColumnName,
  defaultScalePercent,
  scaleDebounceMs,
  baseImageWidthPx,
  gridLockedLayerKeys,
  defaultImageStyle,
} from 'config';

// A table with no expected-count hints typed yet: both fields blank.
const BLANK_EXPECTED_COUNTS = { expectedColumns: '', expectedRows: '' };

// The empty hint map. Shared (rather than a fresh {} per clear) so re-clearing an already
// empty map is referentially identical and React skips the re-render.
const NO_EXPECTED_COUNTS = {};

// True when either expected-count field of one table's hint entry has been filled in. A
// missing entry counts as blank.
function hasExpectedCount(counts) {
  const { expectedColumns, expectedRows } = counts ?? BLANK_EXPECTED_COUNTS;
  return (expectedColumns ?? '') !== '' || (expectedRows ?? '') !== '';
}

// Whether two bounds differ. Compared FIELD BY FIELD, not by reference: every edit reported up
// from the editor rebuilds the bounds object, so a reference test would call every reported
// table changed.
function boundsDiffer(a, b) {
  const x = a ?? {};
  const y = b ?? {};
  return (
    x.left !== y.left ||
    x.top !== y.top ||
    x.width !== y.width ||
    x.height !== y.height
  );
}

// Controlled, self-contained centre panel: the page-image grid editor. Selects between the
// legacy interactive editor (PageImageWithOverlay) and the new staged editor
// (StagedPageGridEditor) via the config flag stagedGridEditorEnabled(). Owns only
// display-side state (the fetched image, its loading flag, the action-busy flag, the last
// image error, the measured container width, and — for the staged branch — the zoom/dim/
// layer view state, and the border moves and coloured-area edits held provisionally until the
// layer they belong to is left). `metadata.tables` remains the host's single source of truth:
// nothing held here is persisted, and it is either reported up or dropped, never kept. It calls
// the backend only for getImage and findGridLines
// (directly, for the created-table grid detection and the Colours/Borders confirmation steps),
// plus findTables indirectly inside PageImageWithOverlay's legacy Calculate/Recalculate. It
// reads no cell text: that is the host's page-exit recalculation. It never persists, renders no
// Save button, and does not render the empty state
// or the "← All Files" chrome.
export default function PageTableEditor({
  metadata,
  page,
  tableId = null,
  onChange,
  deletedPreview = null,
  onHoverTable,
  // Staged-editor props supplied by the host (Task 14); defaulted so this component can be
  // rendered (and tested) standalone.
  selectedTableId = null,
  onSelectTable = () => {},
  hasPrevPage = false,
  hasNextPage = false,
  onPrevPage = () => {},
  onNextPage = () => {},
  onColouredAreasChange = () => {},
  onExpectedCountsMapChange = () => {},
}) {
  const staged = stagedGridEditorEnabled();

  // The getImage response tagged with the page it was fetched for ({ ...data, page }),
  // or null until the first image loads. `data` carries image (base64 PNG), pixelWidth,
  // pixelHeight.
  const [pageImage, setPageImage] = useState(null);
  // True while a getImage request is in flight.
  const [imageLoading, setImageLoading] = useState(false);
  // True while a blocking back-end call is in flight: the legacy Calculate/Recalculate
  // find-tables poll (reported up from PageImageWithOverlay via onActionBusyChange), or the
  // staged branch's own grid-lines / calculate-cells calls. Drives the same loading overlay.
  const [actionBusy, setActionBusy] = useState(false);
  // Last image-load error message, or null.
  const [error, setError] = useState(null);
  // Container width in whole pixels; 0 before the first measurement. (Legacy branch only.)
  const [measuredWidth, setMeasuredWidth] = useState(0);

  // ---- Staged-editor view state (flag-on only) ----------------------------------------
  // Zoom/scale percentage bound to the top-toolbar EditorScaleSelector.
  const [scalePercent, setScalePercent] = useState(defaultScalePercent());
  // Debounced mirror of scalePercent that actually drives the image refetch, so dragging
  // the zoom stepper coalesces into a single fetch.
  const [debouncedScale, setDebouncedScale] = useState(defaultScalePercent());
  // "Dim Document" toggle (defaults on).
  const [dimDocument, setDimDocument] = useState(true);
  // "Raw / Processed" toggle: which rendering of the page get-image returns. Unlike the
  // dim toggle this is not a display trick — changing it refetches the page, because the
  // processed rendering is produced by the backend from the page's coloured areas.
  const [imageStyle, setImageStyle] = useState(defaultImageStyle());
  // The active Layer row / staged editing mode: 'border' | 'rows' | 'columns' | 'special' |
  // 'colours'.
  const [selectedLayer, setSelectedLayer] = useState('colours');
  // The just-created, still-unconfirmed table's id (transient, not persisted), or null.
  const [createdTableId, setCreatedTableId] = useState(null);
  // The selected internal grid line reported up by StagedPageGridEditor, or null. Drives the
  // enable/disable state of the Rows/Columns Options buttons.
  const [selectedLine, setSelectedLine] = useState(null);
  // The selected section-title row's `tableRow` reported up by StagedPageGridEditor, or null.
  // Drives the Special Cells "Delete Section Title Row" button and the "Column name" combo.
  const [selectedSectionRow, setSelectedSectionRow] = useState(null);
  // The selected merged cell's anchor ({ row, column }) reported up by StagedPageGridEditor,
  // or null. Mirrored straight back down so the editor can highlight it, and used here to
  // gate the Special Areas Extend/Reduce buttons.
  const [selectedMergedCell, setSelectedMergedCell] = useState(null);

  // ---- Borders-layer expected-count hints (transient, not persisted) ------------------
  // tableId -> { expectedColumns, expectedRows }, both strings, blank being ''. Nothing on
  // PDFTable stores these: they are per-table hints typed in the Borders layer and consumed
  // by the layer-transition / recalculation calls. Keyed by tableId so switching table (or
  // layer) and back preserves what was typed; cleared on a page or document change below.
  const [expectedCounts, setExpectedCounts] = useState(NO_EXPECTED_COUNTS);

  // ---- Colours-layer view state (transient, not persisted) ----------------------------
  // The selected coloured area's index on the displayed page, or null.
  const [selectedColouredIndex, setSelectedColouredIndex] = useState(null);
  // True while an "Add" rubber-band gesture is armed in the Colours layer.
  const [colourAddMode, setColourAddMode] = useState(false);
  // 'foreground' | 'background' while picking that channel's colour by dragging over the
  // page, else null.
  const [colourPickMode, setColourPickMode] = useState(null);
  // The pixel colour under the pick-drag cursor (live preview shown in the armed swatch),
  // or null when no pick drag is in flight.
  const [colourPreview, setColourPreview] = useState(null);

  const containerRef = useRef(null);

  // The page numbers whose coloured areas have been edited since the page was loaded (or
  // since the last SUCCESSFUL find-grid-lines call for that page). It gates the blocking
  // Colours-tick probe: with nothing changed the back end would return the same grid lines,
  // so the request is pure latency. A mutable Set held in a REF, not state, because nothing
  // renders from it — marking a page dirty happens inside a coloured-area commit, and a
  // re-render there would be wasted work.
  const dirtyColourPagesRef = useRef(new Set());

  // The tableIds whose `bounds` have changed since the page was loaded (or since the last
  // SUCCESSFUL Borders find-grid-lines call). Together with the expected-count hints it gates
  // the blocking Borders-tick call: with no moved border and no expected count the back end has
  // nothing new to work from, so the request would be pure latency.
  //
  // Deliberately recorded for ANY reported bounds change, regardless of which layer was active
  // — a wider and simpler test than layerDataChanged('border', …), which only holds while the
  // Borders layer is selected. A bounds change made from any layer still invalidates the
  // detected grid, so it must still arm the call.
  //
  // A ref, not state: nothing renders from it, and it is written inside an edit commit where a
  // re-render would be wasted work.
  const changedBoundsRef = useRef(new Set());

  // Imperative action handles handed up from StagedPageGridEditor (the LayerOptions buttons
  // invoke these). Stored in refs so re-registration never re-renders.
  const createActionRef = useRef(null);
  const deleteActionRef = useRef(null);
  const rowsActionRef = useRef(null);
  const columnsActionRef = useRef(null);
  const specialActionRef = useRef(null);

  const registerCreate = useCallback((fn) => {
    createActionRef.current = fn;
  }, []);
  const registerDelete = useCallback((fn) => {
    deleteActionRef.current = fn;
  }, []);
  const registerRows = useCallback((fn) => {
    rowsActionRef.current = fn;
  }, []);
  const registerColumns = useCallback((fn) => {
    columnsActionRef.current = fn;
  }, []);
  const registerSpecial = useCallback((fn) => {
    specialActionRef.current = fn;
  }, []);

  // Normalise each table's bounds to the I1/I2 invariant (bounds.width/height == axis
  // sums; see normaliseTableBounds) then materialise a cell for every grid square the
  // backend left unmapped (fillGridCells) — the same two idempotent passes the metadata
  // loader runs, so the list emitted through onChange is normalised too.
  const metadataTables = useMemo(
    () => (metadata.tables ?? []).map(normaliseTableBounds).map(fillGridCells),
    [metadata.tables]
  );

  // A border move and a coloured-area edit are PROVISIONAL: they are held here and reported to
  // the host only when the layer is left through `leaveFor`, which is also when the grid-lines
  // rebuild they arm is made. Writing them into the document at each drag bought nothing — the
  // rebuild overwrites the hand-positioned border with the detector's version anyway — while
  // marking the document dirty and pushing a whole table list up per mouse-up.
  //
  // Consequences, accepted: leaving by any route that is not `leaveFor` DISCARDS what is held
  // (see the page and document effects below), and the document is not dirty until the flush,
  // so Save stays as it was until then.
  //
  // Both are PAGE-scoped, like the changed-bounds and dirty-colour sets they arm. Selecting
  // another table on the page therefore keeps them: that is a move within the work, not away
  // from it, and the rebuild is owed for the page either way.
  const [pendingTables, setPendingTables] = useState(null);
  const [pendingColouredAreas, setPendingColouredAreas] = useState(null);

  // The table list everything here works from: what is held provisionally, else the document's.
  // Held or not, it goes through the same two normalising passes — a border move must meet the
  // I1/I2 invariant whether it has reached the document yet or not, and it is this list the
  // grid is drawn from.
  const normalisedTables = useMemo(
    () =>
      pendingTables === null
        ? metadataTables
        : pendingTables.map(normaliseTableBounds).map(fillGridCells),
    [pendingTables, metadataTables]
  );

  // The page actually on screen: the fetched image's page, else the requested page.
  const displayPage = pageImage?.page ?? page;

  // Non-deleted tables on the displayed page (Border-row count, selection pool).
  // Every table joined under another table's grid. A saved link grid moves the joined
  // tables off the top-level metadata list, so nothing that walks that list alone can see
  // them — and they are the page's tables just as much as the roots they hang from.
  const linkedTables = useMemo(
    () => linkedTablesWithParents(normalisedTables).map(({ table }) => table),
    [normalisedTables]
  );

  const samePageTables = useMemo(
    () =>
      [...normalisedTables, ...linkedTables].filter(
        (t) => t.pdfPage === displayPage && !t.deleted
      ),
    [normalisedTables, linkedTables, displayPage]
  );

  // The selected table: the one whose id matches the host's selectedTableId, else the first
  // same-page non-deleted table.
  const selectedTable = useMemo(
    () =>
      samePageTables.find((t) => t.tableId === selectedTableId) ??
      samePageTables[0] ??
      null,
    [samePageTables, selectedTableId]
  );

  // The Layers rows the selected table cannot be edited through. A table that is part of a
  // grid of tables keeps the page colours, the outer border and the column arrangement its
  // join was built from; the rest of the table is edited as normal. Membership is either
  // end of the join: the root that holds the grid, or a table joined under one.
  const lockedLayers = useMemo(() => {
    const inGrid =
      isAmalgamated(selectedTable) ||
      linkedTables.some((t) => t.tableId === selectedTable?.tableId);
    return inGrid ? gridLockedLayerKeys() : [];
  }, [selectedTable, linkedTables]);

  // The selected table's expected-count hints, or blanks when it has no entry yet (and
  // when there is no selected table at all — the fields are hidden in that case).
  const selectedExpectedCounts =
    (selectedTable ? expectedCounts[selectedTable.tableId] : null) ??
    BLANK_EXPECTED_COUNTS;

  // Record one field of the selected table's hints, leaving every other table's entry
  // untouched.
  const handleExpectedCountsChange = useCallback(
    (field, value) => {
      if (!selectedTable) return;
      setExpectedCounts((prev) => ({
        ...prev,
        [selectedTable.tableId]: {
          ...(prev[selectedTable.tableId] ?? BLANK_EXPECTED_COUNTS),
          [field]: value,
        },
      }));
    },
    [selectedTable]
  );

  // Report the whole hint map up to the host whenever it changes — including when it is
  // cleared on a page or document change below. These values are transient view state owned
  // here, and this is the host's only channel to them. An effect rather than a call at each
  // mutation site, so a future write or clear cannot forget to report.
  useEffect(() => {
    onExpectedCountsMapChange(expectedCounts);
  }, [expectedCounts, onExpectedCountsMapChange]);

  const pageColouredAreas = metadata.pages?.[displayPage]?.colouredAreas;
  const isCreatedUnconfirmed =
    createdTableId != null && selectedTable?.tableId === createdTableId;

  // The displayed page's coloured areas (never null): what is held provisionally for THIS page,
  // else the document's. Memoised so its reference is stable across renders (it feeds the
  // runFindGridLines callback deps).
  const currentColouredAreas = useMemo(
    () =>
      pendingColouredAreas?.page === displayPage
        ? pendingColouredAreas.areas
        : pageColouredAreas ?? [],
    [pendingColouredAreas, displayPage, pageColouredAreas]
  );
  const selectedColouredArea =
    selectedColouredIndex != null
      ? currentColouredAreas[selectedColouredIndex] ?? null
      : null;
  // Take a coloured-area edit, held for this page until the layer is left.
  const commitColouredAreas = useCallback(
    (next) => {
      setPendingColouredAreas({ page: displayPage, areas: next });
      // Every coloured-area mutation (add / delete / resize / foreground-background pick)
      // funnels through here, so recording the page is an exact dirty flag — no deep
      // comparison of the areas is needed.
      dirtyColourPagesRef.current.add(displayPage);
    },
    [displayPage]
  );

  // Report a table list to the host. Every caller derives what it reports from
  // `normalisedTables`, so anything held provisionally is already folded into it and is no
  // longer held — leaving it held would mask the very list just reported.
  const commitTables = useCallback(
    (next) => {
      onChange(next);
      setPendingTables(null);
    },
    [onChange]
  );

  // Report everything held provisionally to the host, and stop holding it. `tables` is the list
  // to report, defaulting to the one being worked from — a rebuild passes its merged list
  // instead, so what it detected and what was held arrive as one write rather than two, the
  // second undoing the first.
  //
  // Called on the way out of a layer and nowhere else: this is the one place a border move or a
  // coloured-area edit reaches the document.
  const flushPending = useCallback(
    (tables = normalisedTables) => {
      const flushAreas = pendingColouredAreas?.page === displayPage;
      if (flushAreas) {
        onColouredAreasChange(displayPage, pendingColouredAreas.areas);
      }
      // Coloured areas are page-scoped, so editing them (add / delete / resize / colour pick)
      // invalidates the Colours confirmation for EVERY table on the displayed page: unticking
      // Colours (and therefore every layer above it) drops each such table's stage via
      // stageAfterEdit('colours', …) — i.e. to 0. Untouched tables (a stage that would not
      // change) keep their identity so no spurious edit is reported. Walked with
      // mapAllTables so a table joined under another table's grid — off the top-level list,
      // but on the page and carrying its own Colours tick — is dropped with the rest.
      const next = mapAllTables(tables, (table) => {
        if (!flushAreas || table.pdfPage !== displayPage || table.deleted) return table;
        const nextStage = stageAfterEdit('colours', table.confirmationStage ?? 0);
        return nextStage === (table.confirmationStage ?? 0)
          ? table
          : { ...table, confirmationStage: nextStage };
      });
      if (
        next.length !== metadataTables.length ||
        next.some((table, index) => table !== metadataTables[index])
      ) {
        onChange(next);
      }
      setPendingTables(null);
      setPendingColouredAreas(null);
    },
    [
      pendingColouredAreas,
      displayPage,
      normalisedTables,
      metadataTables,
      onColouredAreasChange,
      onChange,
    ]
  );

  // A coloured-area selection / pending gesture has no meaning once the page or the active
  // layer changes.
  useEffect(() => {
    setSelectedColouredIndex(null);
    setColourAddMode(false);
    setColourPickMode(null);
    setColourPreview(null);
  }, [displayPage, selectedLayer]);

  // The expected-count hints are scoped to the page being worked on, so a newly displayed
  // page always starts with both fields blank. Keyed on displayPage ONLY (not selectedLayer)
  // so leaving the Borders layer and coming back keeps what was typed. The changed-bounds set
  // is page-scoped in the same way: the Borders call it arms is made for one page at a time.
  //
  // The provisional border moves and coloured areas go with them, DISCARDED rather than
  // reported: a page left through `leaveFor` has already flushed them, so anything still held
  // here was left by another route — the thumbnails, the left-hand list — and was never
  // confirmed by the rebuild that gives it its point.
  useEffect(() => {
    setExpectedCounts(NO_EXPECTED_COUNTS);
    changedBoundsRef.current = new Set();
    setPendingTables(null);
    setPendingColouredAreas(null);
  }, [displayPage]);

  // This component is not remounted per document, so the hints — and the dirty-coloured-page
  // and changed-bounds sets and anything held provisionally, which are keyed by page number /
  // by the current document's tableIds and so only meaningful within one document — also have
  // to be dropped when the displayed PDF changes.
  useEffect(() => {
    setExpectedCounts(NO_EXPECTED_COUNTS);
    dirtyColourPagesRef.current = new Set();
    changedBoundsRef.current = new Set();
    setPendingTables(null);
    setPendingColouredAreas(null);
  }, [metadata.pdfId]);

  // On a page change, re-derive the selected layer from the (new) selected table's
  // confirmation stage: select the first row without a tick, or the last row when all are
  // ticked. Keyed on displayPage only so ticking a box on the current page (which advances
  // the selection itself) is not overridden; selectedTable is read intentionally without
  // being a dependency.
  useEffect(() => {
    setSelectedLayer(layerKeyForStage(selectedTable?.confirmationStage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPage]);

  // Entering a table with nothing recorded against it opens on the layer
  // entryConfirmationStage() derives — Special Areas. The rows are no longer a ladder to be
  // climbed, so opening at the bottom of one would only mean working upwards through four rows
  // that no longer gate anything. A table already part-way up opens where it left off.
  //
  // The stage itself is deliberately NOT written. It would be a document change made by merely
  // looking at a table, which marks the document dirty and arms Save before the user has
  // touched anything — and it would buy nothing visible, since with no ticks on the first four
  // rows a stage of 0 and a stage of 4 render identically. The stage is still written by the
  // first real edit, through `stageAfterEdit`.
  useEffect(() => {
    if (!selectedTable) return;
    if ((selectedTable.confirmationStage ?? 0) !== 0) return;
    setSelectedLayer(layerKeyForStage(entryConfirmationStage()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable?.tableId, selectedTable?.confirmationStage]);

  // Measure the container pixel width (legacy branch only). The backend derives render dpi
  // from a target pixel width, so fetches are driven off the measured layout rather than a
  // hard-coded dpi. The first measurement is immediate; while the window is being resized,
  // measurements are debounced (resizeDebounceMs()) so a drag coalesces into a single
  // refetch. Rounded to whole pixels so sub-pixel reflow is not treated as a change.
  useEffect(() => {
    if (staged) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;

    const apply = () => {
      setMeasuredWidth(Math.round(el.getBoundingClientRect().width));
    };
    apply();

    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(apply, resizeDebounceMs());
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [staged]);

  // On a pdfId change, clear the current image up front so a stale document's image is
  // never shown across the change while the new one loads (or if the load fails).
  useEffect(() => {
    setPageImage(null);
  }, [metadata.pdfId]);

  // Legacy branch: load the full-resolution image once the container has been measured.
  // Re-fetches whenever the pdf, page, or measured width changes. The in-flight/unmount race
  // is guarded with a cancelled flag so a superseded or unmounted request never applies its
  // result. The response is tagged with the page it was fetched for so the overlay is derived
  // from the page actually on screen.
  useEffect(() => {
    if (staged) return undefined;
    if (measuredWidth <= 0) return undefined;
    let cancelled = false;
    setImageLoading(true);
    (async () => {
      try {
        const data = await getImage(
          metadata.pdfId,
          page,
          Math.round(measuredWidth * 0.95),
          imageStyle
        );
        if (cancelled) return;
        setError(null);
        setPageImage({ ...data, page });
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          toast.error(err.message);
        }
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staged, metadata.pdfId, page, measuredWidth, imageStyle]);

  // Staged branch: debounce scalePercent -> debouncedScale so a burst of zoom steps
  // coalesces into a single refetch (scaleDebounceMs()). The initial value already equals
  // scalePercent, so the first fetch (below) is immediate.
  useEffect(() => {
    if (!staged) return undefined;
    const timer = setTimeout(
      () => setDebouncedScale(scalePercent),
      scaleDebounceMs()
    );
    return () => clearTimeout(timer);
  }, [staged, scalePercent]);

  // Staged branch: fetch the page image at a width derived from the (debounced) zoom
  // percentage. Same cancelled-flag race guard as the legacy branch; response tagged with
  // its page.
  useEffect(() => {
    if (!staged) return undefined;
    let cancelled = false;
    setImageLoading(true);
    const width = scalePercentToWidthPx(debouncedScale, baseImageWidthPx());
    (async () => {
      try {
        const data = await getImage(metadata.pdfId, page, width, imageStyle);
        if (cancelled) return;
        setError(null);
        setPageImage({ ...data, page });
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          toast.error(err.message);
        }
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staged, metadata.pdfId, page, debouncedScale, imageStyle]);

  // Derive the centre overlay's flat pixel-space tables from the normalised metadata,
  // scaled by the get-image pixel dimensions (legacy branch). Empty until the page image
  // has loaded.
  const overlayTables = pageImage
    ? metadataTablesToOverlay(
        [
          ...normalisedTables
            .filter((t) => !t.deleted)
            .map((t) =>
              hasSavedGrid(t)
                ? {
                    ...t,
                    locked: true,
                    lockedMessage: 'Locked as linked to other tables',
                  }
                : t
            )
            .map((t) =>
              tableId != null && t.tableId !== tableId
                ? {
                    ...t,
                    locked: true,
                    lockedMessage: t.lockedMessage ?? 'Locked',
                  }
                : t
            ),
          ...linkedTablesWithParents(normalisedTables)
            .filter(({ table }) => !table.deleted)
            .map(({ table, parentName }) => ({
              ...table,
              locked: true,
              lockedMessage: `Locked as part of ${parentName}`,
            })),
        ],
        pageImage.page,
        pageImage.pixelWidth,
        pageImage.pixelHeight
      )
    : [];

  // Overlay-shaped geometry for the deletedPreview table, iff it is on the displayed page.
  const deletedPreviewOverlay =
    pageImage && deletedPreview
      ? metadataTablesToOverlay(
          [deletedPreview],
          pageImage.page,
          pageImage.pixelWidth,
          pageImage.pixelHeight
        )[0] ?? null
      : null;

  // The editor keeps no internal table state: every edit is reported straight up. A
  // geometry / special edit reported here is owned by the active Layer (selectedLayer),
  // so any table whose owned data actually changed has that layer — and everything above
  // it — unticked via stageAfterEdit. A confirmationStage write is never itself treated as
  // an edit (the editor never touches it), and a just-created table (no `before`) keeps
  // its unconfirmed stage untouched.
  // Walked with mapAllTables, and `before` looked up with findTableById, so a table joined
  // under another table's grid is adjusted too: it sits in its root's `next` map rather than
  // on the top-level list, and Rows and Special Areas are the only layers it can be edited
  // through, so a top-level walk left exactly those two edits with a stale stage.
  const handleEditTables = (nextTables) => {
    const adjusted = mapAllTables(nextTables, (t) => {
      const before = findTableById(normalisedTables, t.tableId);
      // A table created in this session has no `before` to compare, so it is not recorded as
      // bounds-changed: it has no previous geometry to have moved away from, and the create
      // flow already runs its own grid-lines Calculate that detects its geometry. It becomes
      // eligible for the Borders call only once its border is moved or a count is typed.
      if (!before) return t;
      // Recorded before the layer-ownership test below, and independently of it: the Borders
      // grid-lines call cares only THAT the bounds moved, not which layer moved them.
      if (boundsDiffer(before.bounds, t.bounds)) {
        changedBoundsRef.current.add(t.tableId);
      }
      if (!layerDataChanged(selectedLayer, before, t)) return t;
      const nextStage = stageAfterEdit(
        selectedLayer,
        before.confirmationStage ?? 0
      );
      return nextStage === (before.confirmationStage ?? 0)
        ? t
        : { ...t, confirmationStage: nextStage };
    });
    // An edit made on the Borders layer is a border move: held here until the layer is left,
    // along with the stage drop it implies. Every other layer's edits go straight up as
    // before — only the two layers whose work a rebuild rewrites are provisional.
    if (selectedLayer === 'border') {
      setPendingTables(adjusted);
      return;
    }
    commitTables(adjusted);
  };

  // ---- Special Cells section-title wiring ---------------------------------------------

  // The selected section-title row's DTO on the selected table (matched by tableRow), or
  // null. Feeds the combo's bound value and the area-selected / row-selected gating.
  const selectedSection =
    selectedTable?.sectionTitles?.find(
      (s) => s.tableRow === selectedSectionRow
    ) ?? null;

  // Which of the four span edits the selected merged cell admits. `mergedCellLimits` is the
  // single definition of the span arithmetic (all four false when nothing is selected, or when
  // the selection matches no cell), so nothing about spans is decided here or in LayerOptions.
  // With no selected table there is nothing for a stale selection to refer to, so it is passed
  // as no selection at all.
  const mergeLimits = useMemo(
    () =>
      mergedCellLimits(selectedTable ?? {}, selectedTable ? selectedMergedCell : null),
    [selectedTable, selectedMergedCell]
  );

  // Every distinct section-title columnName across the whole PDF (the combo's option list).
  const columnNameOptions = useMemo(
    () => collectColumnNames(normalisedTables),
    [normalisedTables]
  );

  // Write the combo's chosen/typed value to the selected section-title's columnName. Routed
  // through handleEditTables so the 'special' edit drops the table's confirmationStage, and
  // written with replaceTableById so the write lands whether the selected table is on the
  // top-level list or joined under another table's grid.
  const setSectionColumnName = (value) => {
    if (!selectedTable || selectedSectionRow == null) return;
    handleEditTables(
      replaceTableById(normalisedTables, selectedTable.tableId, {
        ...selectedTable,
        sectionTitles: (selectedTable.sectionTitles ?? []).map((s) =>
          s.tableRow === selectedSectionRow ? { ...s, columnName: value } : s
        ),
      })
    );
  };

  // ---- Staged Layers-panel wiring -----------------------------------------------------

  // Detect the grid inside a just-created border table. ONE blocking call: find-grid-lines,
  // hinted with the drawn border (and the expected row/column counts if the user typed them),
  // to DETECT bounds/columnWidths/rowHeights inside it. A freshly drawn border needs this
  // because buildManualTable gives it a single full-width column, a single full-height row and
  // one cell — it has no interior grid at all until this call supplies one.
  //
  // It deliberately does NOT read the cells' text. That read belongs to the page-exit
  // recalculation (recalcPageTables in PDFEditTableStructure), which covers every table in the
  // host's change set — this one included, because the onChange below puts it there. Reading
  // here would be both duplicated and premature: it would run at the Border layer, before the
  // user has reached Rows, Columns or Special Areas, so any grid edit they subsequently make
  // would invalidate whatever was read. The gap this leaves — a page saved without ever being
  // navigated away from is never re-read at all — is a known issue recorded under "Cell text is
  // re-read on page exit only" in services/mylossrun_service/README.md, and is not this
  // function's to paper over.
  //
  // Detecting nothing for this table means there is nothing to commit: the informational toast
  // stands in for the result. Errors surface through toast.error. The transient created flag is
  // cleared in every case.
  const detectCreatedTableGrid = useCallback(
    async (t) => {
      setActionBusy(true);
      try {
        // buildCalcHint takes (table, rows, cols): rows BEFORE columns. It emits neither
        // `cells` nor `title`, and includes each expected count only when it is non-blank. The
        // page's coloured areas travel on the request, not per hint, so its fourth argument is
        // left off.
        const counts = expectedCounts[t.tableId] ?? BLANK_EXPECTED_COUNTS;
        const gridResponse = await findGridLines(
          metadata.pdfId,
          displayPage,
          currentColouredAreas,
          [buildCalcHint(t, counts.expectedRows, counts.expectedColumns)]
        );
        const returned = gridResponse?.tables ?? [];
        const merged = mergeFindGridLines(
          normalisedTables,
          displayPage,
          returned
        );
        const detected = merged.find((x) => x.tableId === t.tableId);
        // Nothing was detected FOR THIS TABLE when no returned table overlaps its border (or
        // when the merge dropped it as a duplicate of a bigger-overlap match). Its own entry
        // then still has no grid, so there is nothing to commit.
        if (!detected || !returned.some((r) => overlapArea(t.bounds, r.bounds) > 0)) {
          toast('No table found');
          return;
        }
        commitTables(merged);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setActionBusy(false);
        setCreatedTableId(null);
      }
    },
    [
      metadata.pdfId,
      displayPage,
      currentColouredAreas,
      expectedCounts,
      normalisedTables,
      commitTables,
    ]
  );

  // Leaving the Colours layer having changed the page's coloured areas is a DELIBERATE
  // blocking step: probe the back-end for this page's grid lines, wait for the response, merge
  // the returned geometry into the metadata tables (matched by tableInPage; unmatched returned
  // tables are added), and ONLY THEN run `after` — so nothing is drawn from geometry the
  // coloured areas have already invalidated. `after` is whatever the move was: showing another
  // layer, stepping to another table, or changing the page.
  //
  // The full-panel loadingOverlay is shown throughout (actionBusy). On failure the error is
  // surfaced and `after` is NOT run, so the user stays where they were on Colours and the next
  // attempt to leave tries again; actionBusy is always cleared.
  const runFindGridLines = useCallback(
    async (after) => {
      setActionBusy(true);
      try {
        const response = await findGridLines(
          metadata.pdfId,
          displayPage,
          currentColouredAreas
        );
        // Reported through the flush rather than as a bare commit: what was held provisionally
        // travels with what the detector returned, as ONE write, and only now — a failed call
        // reports nothing and leaves it held for the next attempt.
        flushPending(
          mergeFindGridLines(normalisedTables, displayPage, response?.tables ?? [])
        );
        // The page's grid lines now match its coloured areas, so it is clean again. Inside
        // the try deliberately: a failed call must leave the page dirty so the next attempt
        // to leave Colours retries rather than silently skipping.
        dirtyColourPagesRef.current.delete(displayPage);
        // Only now — after the geometry whatever comes next draws from has merged — move on.
        after();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setActionBusy(false);
      }
    },
    [
      metadata.pdfId,
      displayPage,
      currentColouredAreas,
      normalisedTables,
      flushPending,
    ]
  );

  // Leaving the Borders layer having moved a border (or typed an expected count) is the second
  // DELIBERATE blocking step: re-detect the grid lines of those tables, wait for the response,
  // merge it, and ONLY THEN run `after` — so nothing is worked on before the re-detected
  // geometry has landed. Note this deliberately OVERWRITES a hand-positioned border with the
  // detector's snapped version for every hinted table: that is the purpose of the call.
  //
  // On failure `after` is NOT run, so the user stays where they were on Borders and the next
  // attempt to leave tries again.
  //
  // KNOWN RISK, ACCEPTED: mergeFindGridLines' rules were written for a whole-page response. It
  // matches each returned table to the live same-page table with the largest bounds overlap,
  // HARD-deletes the other live tables that returned table also overlaps as spurious
  // duplicates, and APPENDS a returned table overlapping nothing. A hinted response covers only
  // the changed tables, so if a re-detected table's bounds grow over an UNCHANGED neighbour
  // that neighbour is hard-deleted. Reusing the single merge path is nonetheless the required
  // behaviour (see the test that documents this consequence).
  const runBorderGridLines = useCallback(
    async (after, hintTables) => {
      setActionBusy(true);
      try {
        const response = await findGridLines(
          metadata.pdfId,
          displayPage,
          currentColouredAreas,
          // buildCalcHint takes (table, rows, cols): rows BEFORE columns. It emits neither
          // `cells` nor `title`, and includes each expected count only when it is non-blank.
          // The page's coloured areas travel on the request, not per hint, so its fourth
          // argument is left off.
          hintTables.map((h) => {
            const counts = expectedCounts[h.tableId] ?? BLANK_EXPECTED_COUNTS;
            return buildCalcHint(h, counts.expectedRows, counts.expectedColumns);
          })
        );
        // Reported through the flush rather than as a bare commit: what was held provisionally
        // travels with what the detector returned, as ONE write, and only now — a failed call
        // reports nothing and leaves it held for the next attempt.
        flushPending(
          mergeFindGridLines(normalisedTables, displayPage, response?.tables ?? [])
        );
        // The detected grid now reflects every moved border, so nothing is outstanding. Inside
        // the try deliberately: a failed call must leave the set intact so the next attempt to
        // leave Borders retries rather than silently skipping.
        changedBoundsRef.current = new Set();
        // Only now — after the geometry whatever comes next draws from has merged — move on.
        after();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setActionBusy(false);
      }
    },
    [
      metadata.pdfId,
      displayPage,
      currentColouredAreas,
      expectedCounts,
      normalisedTables,
      flushPending,
    ]
  );

  // The rebuild the layer being LEFT owes before anything else may happen, as a function
  // taking what to do once its merge has landed — or null when nothing is owed and the move
  // can simply be made.
  //
  // What makes a rebuild necessary is moving on from geometry the edits have invalidated, and
  // that is just as true of leaving the table or the page as of picking another Layers row: all
  // three go through here, so none of them can slip past the rebuild. `destination` is the
  // layer that will be shown afterwards, or null when the move changes the page and so lands
  // on a table whose stage this component cannot read yet.
  const owedRebuild = useCallback(
    (destination) => {
      // Leaving Colours having changed the page's coloured areas: re-probe the whole page's
      // grid lines. The dirty flag is page-scoped, not table-scoped, and that is correct —
      // coloured areas belong to the page, and one probe refreshes every table on it.
      if (
        selectedLayer === 'colours' &&
        dirtyColourPagesRef.current.has(displayPage)
      ) {
        return (after) => runFindGridLines(after);
      }
      // Leaving Borders for anywhere but Colours, having moved a border or typed an expected
      // count: re-detect those tables. Going back to Colours is exempt, because a coloured-area
      // change rebuilds the grid lines on the way out of Colours anyway — re-detecting here
      // would only be overwritten by that. An unknown destination is read as "not Colours",
      // which is the conservative answer: a rebuild owed is made rather than skipped.
      //
      // The changed-bounds set is read here rather than memoised: it is a ref, and the host may
      // not have re-rendered this component since the edit that armed it.
      if (selectedLayer === 'border' && destination !== 'colours') {
        const hintTables = samePageTables.filter(
          (t) =>
            changedBoundsRef.current.has(t.tableId) ||
            hasExpectedCount(expectedCounts[t.tableId])
        );
        if (hintTables.length > 0) {
          return (after) => runBorderGridLines(after, hintTables);
        }
      }
      return null;
    },
    [
      selectedLayer,
      displayPage,
      samePageTables,
      expectedCounts,
      runFindGridLines,
      runBorderGridLines,
    ]
  );

  // Make a move, first settling whatever the layer being left owes: what is held provisionally
  // is reported to the host, and the rebuild it arms is made. Each rebuild is blocking and runs
  // the move itself once its merge has landed, so a failure leaves the user where they are with
  // the work still outstanding.
  //
  // The rebuild is chosen and started against the list that INCLUDES what was held, since it is
  // that geometry the detector is being asked about; the flush merely puts the same edits on the
  // document, so the merge it commits afterwards carries them either way.
  const leaveFor = useCallback(
    (destination, move) => {
      const rebuild = owedRebuild(destination);
      if (rebuild) {
        rebuild(move);
        return;
      }
      flushPending();
      move();
    },
    [owedRebuild, flushPending]
  );

  // Cancel a just-created table: remove it from the list and clear the selection/flag.
  const cancelCreated = useCallback(() => {
    if (!createdTableId) return;
    commitTables(normalisedTables.filter((t) => t.tableId !== createdTableId));
    onSelectTable(null);
    setCreatedTableId(null);
  }, [createdTableId, normalisedTables, commitTables, onSelectTable]);

  // Layers-panel Next: step to the next table on this page first, and only move the page once
  // the last table on it has been reached. Confirming Special Areas routes through here too
  // (LayersPanel calls onNext for the last row), so ticking the final layer walks the page's
  // tables in turn and then leaves the page.
  //
  // The step also re-derives the per-table view state, which is why this lives here and not in
  // the host: the host owns neither the selected layer nor the line/section/merged selections.
  //
  // Leaving the table is leaving the layer as far as the rebuilds are concerned, so a step owed
  // one waits for it — the moved border is re-detected before the table it belongs to is left,
  // not left for whenever the user happens to leave Borders again. A step to the page carries
  // the same debt: the changed-bounds set and the expected counts are dropped on a page change,
  // so a rebuild not made on the way out would never be made at all.
  // Step to `table`, re-deriving the per-table view state: its own layer, and none of the
  // line / section / merged selections, which belonged to the table being left.
  const stepToTable = useCallback(
    (table) => {
      leaveFor(layerKeyForStage(table.confirmationStage), () => {
        onSelectTable(table.tableId);
        setSelectedLayer(layerKeyForStage(table.confirmationStage));
        setSelectedLine(null);
        setSelectedSectionRow(null);
        setSelectedMergedCell(null);
      });
    },
    [onSelectTable, leaveFor]
  );

  const handleNext = useCallback(() => {
    const next = nextTableOnPage(samePageTables, selectedTable?.tableId);
    if (!next) {
      leaveFor(null, onNextPage);
      return;
    }
    stepToTable(next);
  }, [samePageTables, selectedTable, onNextPage, leaveFor, stepToTable]);

  // Layers-panel Previous: the mirror of Next — back through the page's tables first, and
  // only the page itself once the first of them is reached. Same debt either way: the page
  // it leaves takes its changed-bounds set and expected counts with it.
  const handlePrev = useCallback(() => {
    const prev = prevTableOnPage(samePageTables, selectedTable?.tableId);
    if (!prev) {
      leaveFor(null, onPrevPage);
      return;
    }
    stepToTable(prev);
  }, [samePageTables, selectedTable, onPrevPage, leaveFor, stepToTable]);

  // Select a Layers row, rebuilding first when the layer being LEFT has outstanding work.
  //
  // The rebuilds used to hang off the Colours and Borders ticks. They are transitions now,
  // which is where they belong: what makes a rebuild necessary is moving on to a layer that
  // would be drawn from geometry the edits have invalidated, not the act of confirming a row.
  const handleSelectLayer = useCallback(
    (nextLayer) => {
      if (nextLayer === selectedLayer) return;
      leaveFor(nextLayer, () => setSelectedLayer(nextLayer));
    },
    [selectedLayer, leaveFor]
  );

  // Toggle a Layer row's tick. Special Areas is the only tickable row, and its tick confirms
  // the table: the row/checked pair maps through nextConfirmationStage and the new stage is
  // committed. The blocking grid-lines rebuilds that Colours and Borders ticks used to fire are
  // handled by `handleSelectLayer` now, and a created table's grid detection by the Calculate
  // button in the Borders options.
  const handleToggleTick = useCallback(
    (rowNumber, checked) => {
      if (!selectedTable) return;
      const nextStage = nextConfirmationStage(
        rowNumber,
        selectedTable.confirmationStage ?? 0,
        checked
      );
      // replaceTableById, not a top-level map: the tick must land on a table joined under
      // another table's grid too, and that table is held in its root's `next` map.
      commitTables(
        replaceTableById(normalisedTables, selectedTable.tableId, {
          ...selectedTable,
          confirmationStage: nextStage,
        })
      );
    },
    [selectedTable, commitTables, normalisedTables]
  );

  // Loading overlay shown while the page image loads or a Calculate/Recalculate poll runs.
  const loadingOverlay = !error && (imageLoading || actionBusy) && (
    <Box
      data-testid={'image-loading-overlay'}
      sx={{
        position: 'absolute',
        top: staged ? 40 : 24,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(128, 128, 128, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
      }}
    >
      <CircularProgress />
    </Box>
  );

  // ---- Staged layout (flag on) --------------------------------------------------------
  if (staged) {
    return (
      <Box
        ref={containerRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box
          data-testid={'editor-toolbar'}
          sx={{
            height: 40,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
          }}
        >
          <Box
            data-testid={'middle-title-bar'}
            sx={{
              flexGrow: 1,
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              fontSize: '0.8125rem',
            }}
          >
            {pageImage === null
              ? metadata.name
              : `${metadata.name} — Page ${pageImage.page + 1}`}
          </Box>
          <RawProcessedToggle value={imageStyle} onChange={setImageStyle} />
          <DimDocumentToggle on={dimDocument} onChange={setDimDocument} />
          <EditorScaleSelector percent={scalePercent} onChange={setScalePercent} />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              backgroundColor: '#e0e0e0',
              // Scroll both axes when the pixel-for-pixel image exceeds the area. NOT a
              // flex/centred container: centring clips the left/top of an overflowing
              // child, so the image sits top-left and scrolls instead.
              overflow: 'auto',
            }}
          >
            {!error && pageImage && (
              <Box data-testid={'middle-image'} sx={{ width: 'fit-content' }}>
                <StagedPageGridEditor
                  image={pageImage.image}
                  pixelWidth={pageImage.pixelWidth}
                  pixelHeight={pageImage.pixelHeight}
                  page={pageImage.page}
                  metadataTables={normalisedTables}
                  selectedTableId={selectedTableId}
                  mode={selectedLayer}
                  locked={lockedLayers.includes(selectedLayer)}
                  dim={dimDocument}
                  onEditTables={handleEditTables}
                  onSelectTable={onSelectTable}
                  onCreatedTable={setCreatedTableId}
                  pdfId={metadata.pdfId}
                  onRequestCreate={registerCreate}
                  onRequestDelete={registerDelete}
                  onRequestRowsAction={registerRows}
                  onRequestColumnsAction={registerColumns}
                  onRequestSpecialAction={registerSpecial}
                  onSelectedLineChange={setSelectedLine}
                  onSelectedSectionRowChange={setSelectedSectionRow}
                  // The name a newly drawn section title starts with. Decided here because it
                  // reads the collected column names, and passed down rather than derived
                  // there so the editor holds no config of its own.
                  newSectionTitleColumnName={nextSectionTitleColumnName(
                    selectedTable,
                    columnNameOptions,
                    defaultSectionTitleColumnName()
                  )}
                  selectedMergedCell={selectedMergedCell}
                  onSelectedMergedCellChange={setSelectedMergedCell}
                  colouredAreas={currentColouredAreas}
                  selectedColouredIndex={selectedColouredIndex}
                  onSelectColouredArea={setSelectedColouredIndex}
                  onColouredAreasChange={commitColouredAreas}
                  colourAddMode={colourAddMode}
                  onColourAdded={() => setColourAddMode(false)}
                  colourPickMode={colourPickMode}
                  onClearColourPick={() => setColourPickMode(null)}
                  onColourPreview={setColourPreview}
                  onColourPicked={(hex) => {
                    setColourPreview(null);
                    if (selectedColouredIndex == null || !colourPickMode) return;
                    commitColouredAreas(
                      currentColouredAreas.map((area, i) =>
                        i === selectedColouredIndex
                          ? { ...area, [colourPickMode]: hex }
                          : area
                      )
                    );
                  }}
                />
              </Box>
            )}
          </Box>

          <LayersPanel
            selectedTable={selectedTable}
            samePageTables={samePageTables}
            pageColouredAreas={pageColouredAreas}
            selectedLayer={selectedLayer}
            confirmationStage={selectedTable?.confirmationStage ?? null}
            hasPrevPage={hasPrevPage}
            hasNextPage={hasNextPage}
            onSelectLayer={handleSelectLayer}
            onToggleTick={handleToggleTick}
            onPrev={handlePrev}
            onNext={handleNext}
            hasSelectedLine={Boolean(selectedLine)}
            hasInternalLines={(selectedTable?.rowHeights?.length ?? 0) > 1}
            isCreatedUnconfirmed={isCreatedUnconfirmed}
            lockedLayers={lockedLayers}
            expectedColumns={selectedExpectedCounts.expectedColumns}
            expectedRows={selectedExpectedCounts.expectedRows}
            onExpectedCountsChange={handleExpectedCountsChange}
            onDeleteTable={() =>
              deleteActionRef.current?.(selectedTable?.tableId)
            }
            onCreateTable={() => createActionRef.current?.()}
            onConfirmCreated={() =>
              selectedTable && detectCreatedTableGrid(selectedTable)
            }
            onCancelCreated={cancelCreated}
            onAddAbove={() => rowsActionRef.current?.('addAbove')}
            onAddBelow={() => rowsActionRef.current?.('addBelow')}
            onAddRow={() => rowsActionRef.current?.('addRow')}
            onAddLeft={() => columnsActionRef.current?.('addLeft')}
            onAddRight={() => columnsActionRef.current?.('addRight')}
            onDeleteLine={() => {
              if (selectedLayer === 'rows') rowsActionRef.current?.('deleteLine');
              else if (selectedLayer === 'columns')
                columnsActionRef.current?.('deleteLine');
            }}
            onSetTitle={() => specialActionRef.current?.('setTitle')}
            onDeleteTitle={() => specialActionRef.current?.('deleteTitle')}
            onRemoveHeader={() => specialActionRef.current?.('removeHeader')}
            onAddHeader={() => specialActionRef.current?.('addHeader')}
            onAddSubTitleRow={() =>
              specialActionRef.current?.('addSubTitleRow')
            }
            onDeleteSubTitleRow={() =>
              specialActionRef.current?.('deleteSubTitleRow')
            }
            onAddHiddenRow={() => specialActionRef.current?.('addHiddenRow')}
            // A hidden row IS a section-title row, so it is deleted by the same action: both
            // buttons remove whichever section-title row is selected.
            onDeleteHiddenRow={() =>
              specialActionRef.current?.('deleteSubTitleRow')
            }
            headerCount={selectedTable?.headerCount ?? 0}
            hasSectionRowSelected={selectedSectionRow != null}
            sectionAreaSelected={selectedSection?.data != null}
            columnName={selectedSection?.columnName ?? null}
            columnNameOptions={columnNameOptions}
            onColumnNameChange={setSectionColumnName}
            onMergeCell={() => specialActionRef.current?.('mergeCell')}
            onExtendColumn={() => specialActionRef.current?.('extendColumn')}
            onReduceColumn={() => specialActionRef.current?.('reduceColumn')}
            onExtendRow={() => specialActionRef.current?.('extendRow')}
            onReduceRow={() => specialActionRef.current?.('reduceRow')}
            canExtendColumn={mergeLimits.canExtendColumn}
            canReduceColumn={mergeLimits.canReduceColumn}
            canExtendRow={mergeLimits.canExtendRow}
            canReduceRow={mergeLimits.canReduceRow}
            colouredSelected={selectedColouredIndex != null}
            foregroundColour={
              colourPickMode === 'foreground' && colourPreview != null
                ? colourPreview
                : selectedColouredArea?.foreground
            }
            backgroundColour={
              colourPickMode === 'background' && colourPreview != null
                ? colourPreview
                : selectedColouredArea?.background
            }
            colourPickMode={colourPickMode}
            onColourAdd={() => {
              setColourAddMode(true);
              setColourPickMode(null);
            }}
            onColourDelete={() => {
              commitColouredAreas(
                currentColouredAreas.filter(
                  (_, i) => i !== selectedColouredIndex
                )
              );
              setSelectedColouredIndex(null);
              setColourPickMode(null);
            }}
            onToggleForegroundPick={() =>
              setColourPickMode((m) => (m === 'foreground' ? null : 'foreground'))
            }
            onToggleBackgroundPick={() =>
              setColourPickMode((m) => (m === 'background' ? null : 'background'))
            }
          />
        </Box>
        {loadingOverlay}
      </Box>
    );
  }

  // ---- Legacy layout (flag off) — unchanged -------------------------------------------
  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        data-testid={'middle-title-bar'}
        sx={{
          height: 24,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          px: 1,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontSize: '0.8125rem',
        }}
      >
        {pageImage === null
          ? metadata.name
          : `${metadata.name} — Page ${pageImage.page + 1}`}
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          backgroundColor: '#e0e0e0',
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {!error && pageImage && (
          <Box data-testid={'middle-image'}>
            <PageImageWithOverlay
              image={pageImage.image}
              tables={overlayTables}
              withGrid={true}
              onHoverTable={onHoverTable}
              metadataTables={normalisedTables}
              page={pageImage.page}
              pixelWidth={pageImage.pixelWidth}
              pixelHeight={pageImage.pixelHeight}
              onEditTables={handleEditTables}
              deletedPreview={deletedPreviewOverlay}
              pdfId={metadata.pdfId}
              editableTableId={tableId ?? null}
              onActionBusyChange={setActionBusy}
            />
          </Box>
        )}
      </Box>
      {/* Loading overlay — a sibling of the scroll container (NOT inside it) so it stays
          pinned over the visible panel and does not scroll. Covers the area below the
          fixed 24px title bar. Shown while the page image loads and while a
          Calculate/Recalculate poll is in flight. */}
      {loadingOverlay}
    </Box>
  );
}
