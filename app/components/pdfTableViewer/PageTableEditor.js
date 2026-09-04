'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import toast from 'react-hot-toast';
import { PageImageWithOverlay } from 'components/pdfTableViewer/PageImageWithOverlay';
import StagedPageGridEditor from 'components/pdfTableViewer/StagedPageGridEditor';
import LayersPanel from 'components/pdfTableViewer/LayersPanel';
import EditorScaleSelector from 'components/pdfTableViewer/EditorScaleSelector';
import DimDocumentToggle from 'components/pdfTableViewer/DimDocumentToggle';
import GridToolRail from 'components/pdfTableViewer/GridToolRail';
import {
  metadataTablesToOverlay,
  normaliseTableBounds,
  fillGridCells,
  findTableById,
  linkedTablesWithParents,
  mapAllTables,
  replaceTableById,
  tableSetChanged,
  buildCalcHint,
  mergeFindGridLines,
  overlapArea,
  changedColouredAreaRects,
  zeroConfidenceInRects,
} from 'components/pdfTableViewer/tableSupportUtils';
import {
  scalePercentToWidthPx,
  nextTableOnPage,
  orderedPageTables,
  prevTableOnPage,
} from 'components/pdfTableViewer/layerUtils';
import {
  columnBounds,
  rowBounds,
} from 'components/pdfTableViewer/gridToolUtils';
import { hasSavedGrid } from 'components/pdfTableViewer/gridUtilities';
import { useEditorPass } from 'components/EditorPassProvider';
import { getImage, findGridLines } from 'services/images';
import {
  editorPageTitleHelpId,
  resizeDebounceMs,
  stagedGridEditorEnabled,
  defaultScalePercent,
  scaleDebounceMs,
  baseImageWidthPx,
  processedImageStyle,
  rawImageStyle,
} from 'config';

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
  // Staged-editor props supplied by the host; defaulted so this component can be
  // rendered (and tested) standalone.
  selectedTableId = null,
  onSelectTable = () => {},
  hasPrevPage = false,
  hasNextPage = false,
  onPrevPage = () => {},
  onNextPage = () => {},
  onColouredAreasChange = () => {},
  // Bumped by the host after every successful save. A save is the only thing that can
  // change what the back end renders for a page — coloured areas drive the PROCESSED
  // rendering — so it is the signal that every page image already fetched is stale.
  savedRevision = 0,
  // The table rooting an open linking session, or null. Held by the host and only passed
  // through: this component keeps nothing of the session itself.
  linkingRootId = null,
  onToggleLinking = () => {},
  // Reports which pass the editor is in, so the host can hide the Pages list in the contents
  // pass. The pass itself stays this component's own state.
  onEditorModeChange = () => {},
  // Saves the document, resolving to whether the save reached the server. "Validate Tables"
  // persists the boundary pass through it before the contents pass begins.
  //
  // Takes what the flush reported, because a flush and the save that follows it happen in one
  // handler: the flush's setTables has not re-rendered the host yet, so a save reading its own
  // closure would send the list from BEFORE the edit. See `flushPending`.
  onSave = async () => true,
  // Registers `leaveFor` with the host, so a page change the host drives — a thumbnail, the
  // Document Overview list — settles this page the same way the editor's own Next/Previous
  // does. Without it those routes reach the page-change effect below with a border move still
  // held, and it discards it.
  onRegisterLeave = () => {},
}) {
  const staged = stagedGridEditorEnabled();

  // The toolbar's pass tabs stand outside this tree and switch passes through the handlers
  // below. Absent outside a provider, which a test that renders this component alone is.
  const editorPass = useEditorPass();
  const setPassActions = editorPass ? editorPass.setPassActions : null;

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
  // Which pass the editor is in. It starts on the boundary pass and, once "Validate
  // Tables" has moved it on, stays on the contents pass: it survives moving between tables
  // and between pages, and returns to 'border' only when the editor is remounted.
  const [editorMode, setEditorMode] = useState('border');
  // Which layers are drawn in gridMode. Editor state, never persisted and never reset by
  // navigation — what a user chose to look at outlives the table they chose it on.
  const [layerVisibility, setLayerVisibility] = useState({
    rows: true,
    columns: true,
    special: true,
    colours: true,
  });
  // The armed grid tool and, for the Special tool, its armed entry.
  const [tool, setTool] = useState(null);
  const [specialTool, setSpecialTool] = useState(null);
  // The coloured-area tools' draft: which rows / columns / rectangle are picked but not yet
  // written out, and the colours they will be written with.
  const [pendingSelection, setPendingSelection] = useState(null);
  const [colourDraft, setColourDraft] = useState({
    foreground: null,
    background: null,
  });
  // The just-created, still-unconfirmed table's id (transient, not persisted), or null.
  const [createdTableId, setCreatedTableId] = useState(null);
  // The selected internal grid line reported up by StagedPageGridEditor, or null. Drives the
  // enable/disable state of the Rows/Columns Options buttons.
  const [selectedLine, setSelectedLine] = useState(null);
  // The selected section-title row's `tableRow` reported up by StagedPageGridEditor, or null.
  // Drives the Special Cells "Delete Section Title Row" button and the "Column name" combo.
  const [selectedSectionRow, setSelectedSectionRow] = useState(null);

  // ---- Colours-layer view state (transient, not persisted) ----------------------------
  // The selected coloured area's index on the displayed page, or null.
  const [selectedColouredIndex, setSelectedColouredIndex] = useState(null);
  // 'foreground' | 'background' while picking that channel's colour by dragging over the
  // page, else null.
  const [colourPickMode, setColourPickMode] = useState(null);
  // The pixel colour under the pick-drag cursor (live preview shown in the armed swatch),
  // or null when no pick drag is in flight.
  const [colourPreview, setColourPreview] = useState(null);

  // Which rendering of the page is displayed. The boundary pass is about the page as the
  // PDF draws it, so it is always RAW; the contents pass follows the Colours eye, whose
  // whole function is to switch between the processed rendering and the raw one. The legacy
  // branch has neither pass and keeps the processed rendering it has always shown.
  const imageStyle = !staged
    ? processedImageStyle()
    : editorMode === 'grid' && layerVisibility.colours !== false
      ? processedImageStyle()
      : rawImageStyle();

  const containerRef = useRef(null);

  // Report the pass up whenever it changes, including the initial 'border'. An effect rather
  // than a call beside each setEditorMode, so a future switch cannot forget to report.
  useEffect(() => {
    onEditorModeChange(editorMode);
  }, [editorMode, onEditorModeChange]);

  // Which end of the next page's tables to select once that page's tables arrive: 'first'
  // after a Next that ran off the end of a page, 'last' after a Previous that ran off the
  // start, and null when the page changed by any other route (a thumbnail click, the list),
  // which leaves the selection alone.
  const pageEdgeSelectionRef = useRef(null);

  // Page renderings already fetched, keyed by `${page}|${width}|${imageStyle}`. Cleared on a
  // document change, since the keys name pages of the document that was open.
  const imageCacheRef = useRef(new Map());

  // The tableIds whose `bounds` have changed since the page was loaded (or since the last
  // SUCCESSFUL Borders find-grid-lines call), and the tableIds created in it. Gates the
  // blocking Borders-tick call: with no moved border and no created table the back end has
  // nothing new to work from, so the request would be pure latency.
  //
  // Deliberately recorded for ANY reported bounds change: a bounds change invalidates the
  // detected grid whatever made it, so it must arm the call.
  //
  // A ref, not state: nothing renders from it, and it is written inside an edit commit where a
  // re-render would be wasted work.
  const changedBoundsRef = useRef(new Set());

  // Imperative action handles handed up from StagedPageGridEditor (the LayerOptions buttons
  // invoke these). Stored in refs so re-registration never re-renders.
  const createActionRef = useRef(null);
  const deleteActionRef = useRef(null);

  const registerCreate = useCallback((fn) => {
    createActionRef.current = fn;
  }, []);
  const registerDelete = useCallback((fn) => {
    deleteActionRef.current = fn;
  }, []);

  // Normalise each table's bounds to the I1/I2 invariant (bounds.width/height == axis
  // sums; see normaliseTableBounds) then materialise a cell for every grid square the
  // backend left unmapped (fillGridCells) — the same two idempotent passes the metadata
  // loader runs, so the list emitted through onChange is normalised too.
  const metadataTables = useMemo(
    () => (metadata.tables ?? []).map(normaliseTableBounds).map(fillGridCells),
    [metadata.tables]
  );

  // A border move is PROVISIONAL: it is held here and reported to the host only when the layer
  // is left through `leaveFor`, which is also when the grid-lines rebuild it arms is made.
  // Writing it into the document at each drag bought nothing — the rebuild overwrites the
  // hand-positioned border with the detector's version anyway — while marking the document
  // dirty and pushing a whole table list up per mouse-up.
  //
  // Consequence, accepted: leaving by any route that is not `leaveFor` DISCARDS a held move
  // (see the page and document effects below), and the document is not dirty until the flush.
  //
  // A coloured-area edit is held here too, but it is NOT provisional in that sense: it reaches
  // the document at the mutation (see `commitColouredAreas`), because the area decides how its
  // region flattens whether or not the rebuild follows. What is held is the copy the editor
  // renders from and the arming of the per-page rebuild.
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

  const pageColouredAreas = metadata.pages?.[displayPage]?.colouredAreas;
  const isCreatedUnconfirmed =
    createdTableId != null && selectedTable?.tableId === createdTableId;

  // The displayed page's coloured areas (never null): what is held provisionally for THIS page,
  // else the document's. Memoised so its reference is stable across renders (it feeds the
  // runBorderGridLines callback deps).
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
  // Take a coloured-area edit.
  //
  // The edit reaches the DOCUMENT here, at the mutation, rather than being held until the
  // layer is left: a coloured area decides how its region is flattened, so an edit to one is a
  // change to the document whether or not the grid-lines rebuild that leaving fires ever
  // happens, and Save has to offer to keep it. It is still held in `pendingColouredAreas` as
  // well, because the rebuild is armed per page and the editor renders from what is held.
  //
  // Cells the edit touched lose their confidence in the same commit. What the change covers is
  // `changedColouredAreaRects` — for a moved or resized area that is the old rectangle and the
  // new one, since the area stopped flattening what it used to and started flattening what it
  // now does, and a cell under either can no longer be trusted.
  //
  // Any held border move is flushed along with it: both are page-scoped and provisional, and
  // reporting the zeroed cells while still holding a move would push a table list the move had
  // been edited out of.
  const commitColouredAreas = useCallback(
    (next) => {
      const changedRects = changedColouredAreaRects(currentColouredAreas, next);
      setPendingColouredAreas({ page: displayPage, areas: next });
      // Every coloured-area mutation (add / delete / resize / foreground-background pick)
      // funnels through here, so recording the page is an exact dirty flag — no deep
      // comparison of the areas is needed.
      onColouredAreasChange(displayPage, next);
      const zeroed = zeroConfidenceInRects(normalisedTables, displayPage, changedRects);
      if (zeroed !== metadataTables) {
        onChange(zeroed);
        setPendingTables(null);
      }
    },
    [
      currentColouredAreas,
      displayPage,
      normalisedTables,
      metadataTables,
      onColouredAreasChange,
      onChange,
    ]
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

  // Report everything held provisionally to the host, and stop holding it. `tables` is the
  // list to report, defaulting to the one being worked from — a rebuild passes its merged
  // list instead, so what it detected and what was held arrive as one write rather than two,
  // the second undoing the first.
  //
  // Called on the way out of a table, a page or the boundary pass, and nowhere else: this is
  // the one place a border move or a coloured-area edit reaches the document.
  // Returns what it reported, as `{ tables, colouredAreaPage }`. React has not re-rendered
  // the host by the time the caller's next statement runs, so a save made in the same handler
  // cannot read the flushed values off the host's state — it has to be handed them.
  const flushPending = useCallback(
    (tables = normalisedTables) => {
      let colouredAreaPage = null;
      if (pendingColouredAreas?.page === displayPage) {
        onColouredAreasChange(displayPage, pendingColouredAreas.areas);
        colouredAreaPage = {
          page: displayPage,
          areas: pendingColouredAreas.areas,
        };
      }
      if (
        tables.length !== metadataTables.length ||
        tables.some((table, index) => table !== metadataTables[index])
      ) {
        onChange(tables);
      }
      setPendingTables(null);
      setPendingColouredAreas(null);
      return { tables, colouredAreaPage };
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

  // A coloured-area selection or draft has no meaning once the page or the armed tool
  // changes.
  useEffect(() => {
    setSelectedColouredIndex(null);
    setColourPickMode(null);
    setColourPreview(null);
    setPendingSelection(null);
  }, [displayPage, tool, specialTool]);

  // Land on the end of the new page the step came from. Keyed on the page and on the
  // tables it holds, because a page change and the arrival of its tables are not the same
  // render.
  useEffect(() => {
    const edge = pageEdgeSelectionRef.current;
    if (!edge) return;
    const ordered = orderedPageTables(samePageTables.filter((t) => !t.deleted));
    if (ordered.length === 0) return;
    pageEdgeSelectionRef.current = null;
    const table = edge === 'first' ? ordered[0] : ordered[ordered.length - 1];
    onSelectTable(table.tableId);
    setSelectedLine(null);
    setSelectedSectionRow(null);
    setSelectedColouredIndex(null);
    setPendingSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPage, samePageTables]);

  // The changed-bounds set is page-scoped: the border call it arms is made for one page at a
  // time.
  //
  // The provisional border moves and coloured areas go with them, DISCARDED rather than
  // reported: a page left through `leaveFor` has already flushed them, so anything still held
  // here was left by another route — the thumbnails, the left-hand list — and was never
  // confirmed by the rebuild that gives it its point.
  useEffect(() => {
    changedBoundsRef.current = new Set();
    setPendingTables(null);
    setPendingColouredAreas(null);
  }, [displayPage]);

  // This component is not remounted per document, so the changed-bounds set and anything
  // held provisionally — keyed by page number / by the current document's tableIds, and so
  // only meaningful within one document — have to be dropped when the displayed PDF changes.
  useEffect(() => {
    changedBoundsRef.current = new Set();
    imageCacheRef.current = new Map();
    setPendingTables(null);
    setPendingColouredAreas(null);
  }, [metadata.pdfId]);

  // A save changes the page the back end renders — the coloured areas it just stored are
  // what the PROCESSED rendering flattens — so every cached rendering is stale. Dropping
  // the whole cache marks them all as needing reload without fetching any of them: each is
  // re-fetched when its page or zoom is next displayed. The displayed page reloads at once,
  // because `savedRevision` is a dependency of both fetch effects below.
  //
  // Declared BEFORE those effects so it runs first in the same commit and they see an
  // empty cache, which is the same ordering the per-document reset above relies on.
  useEffect(() => {
    imageCacheRef.current = new Map();
  }, [savedRevision]);

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
  }, [staged, metadata.pdfId, page, measuredWidth, imageStyle, savedRevision]);

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
  //
  // Each rendering is remembered against the page and width it was fetched for, because
  // get-image returns one rendering per call and the Colours eye switches between two: with
  // the cache, flipping it after the first fetch of each costs nothing.
  useEffect(() => {
    if (!staged) return undefined;
    let cancelled = false;
    const width = scalePercentToWidthPx(debouncedScale, baseImageWidthPx());
    const key = `${page}|${width}|${imageStyle}`;
    const cached = imageCacheRef.current.get(key);
    if (cached) {
      setError(null);
      setPageImage({ ...cached, page });
      setImageLoading(false);
      return undefined;
    }
    setImageLoading(true);
    (async () => {
      try {
        const data = await getImage(metadata.pdfId, page, width, imageStyle);
        if (cancelled) return;
        imageCacheRef.current.set(key, data);
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
  }, [staged, metadata.pdfId, page, debouncedScale, imageStyle, savedRevision]);

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

  // The editor keeps no internal table state: every edit is reported straight up. Nothing
  // here writes `confirmationStage` — no control does any more — so an edit carries whatever
  // stage its table already had.
  //
  // Walked with mapAllTables so a table joined under another table's grid is seen too: it
  // sits in its root's `next` map rather than on the top-level list.
  const handleEditTables = (nextTables) => {
    mapAllTables(nextTables, (t) => {
      const before = findTableById(normalisedTables, t.tableId);
      // A table created in this session has no `before` to compare against, but it is the
      // table that most needs detecting: it carries a border and no grid at all. It is
      // recorded like a moved border, so leaving the table, the page or the pass detects it.
      // The Calculate button remains the way to detect it WITHOUT leaving, and clears the
      // record when it succeeds so the two never run the same detection twice.
      if (!before || boundsDiffer(before.bounds, t.bounds)) {
        changedBoundsRef.current.add(t.tableId);
      }
      return t;
    });
    // What is held is decided by what the edit DID, not by which pass it happened in. A
    // border move is held until the boundary pass is left, along with the rebuild it arms.
    // A change to the SET of tables — a create, a delete — is reported at once whatever the
    // pass: the host lists from that set, so the Document Overview, the thumbnails and the
    // Save button's dirty flag all go stale while it is held. Anything held alongside it
    // travels with it, as a flush would have sent it, and the rebuild it armed still happens
    // because changedBoundsRef is a ref that outlives the commit.
    if (
      staged &&
      editorMode === 'border' &&
      !tableSetChanged(normalisedTables, nextTables)
    ) {
      setPendingTables(nextTables);
      return;
    }
    commitTables(nextTables);
  };

  // ---- Coloured-area submission --------------------------------------------------------

  // True once the coloured-area tools have something to write out. Coloured Table needs no
  // selection: it colours the whole of the selected table.
  const hasPendingSelection =
    specialTool === 'colouredTable'
      ? Boolean(selectedTable)
      : Boolean(
          pendingSelection &&
            ((pendingSelection.rows ?? []).length ||
              (pendingSelection.columns ?? []).length ||
              pendingSelection.rect)
        );

  // Write the pending selection out as coloured areas, one per picked row or column, one for
  // a drawn rectangle, one for the whole table. An area already selected is recoloured in
  // place instead. The selection is cleared and the tool stays armed, so several groups can
  // be coloured in turn.
  const handleColourSubmit = useCallback(() => {
    const colours = {
      foreground: colourDraft.foreground,
      background: colourDraft.background,
    };
    if (selectedColouredIndex != null) {
      commitColouredAreas(
        currentColouredAreas.map((area, i) =>
          i === selectedColouredIndex ? { ...area, ...colours } : area
        )
      );
      return;
    }
    if (!selectedTable) return;
    const added = [];
    if (specialTool === 'colouredTable') {
      added.push({ ...selectedTable.bounds, ...colours });
    } else if (pendingSelection?.rect) {
      added.push({ ...pendingSelection.rect, ...colours });
    } else {
      (pendingSelection?.rows ?? []).forEach((r) => {
        const b = rowBounds(selectedTable, r);
        if (b) added.push({ ...b, ...colours });
      });
      (pendingSelection?.columns ?? []).forEach((c) => {
        const b = columnBounds(selectedTable, c);
        if (b) added.push({ ...b, ...colours });
      });
    }
    if (!added.length) return;
    commitColouredAreas([...currentColouredAreas, ...added]);
    setPendingSelection(null);
  }, [
    colourDraft,
    selectedColouredIndex,
    currentColouredAreas,
    commitColouredAreas,
    selectedTable,
    specialTool,
    pendingSelection,
  ]);

  // ---- Staged Layers-panel wiring -----------------------------------------------------

  // Detect the grid inside a just-created border table. ONE blocking call: find-grid-lines,
  // hinted with the drawn border, to DETECT bounds/columnWidths/rowHeights inside it. A
  // freshly drawn border needs this
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
        // `cells` nor `title`, and its row/column counts are always null. The page's coloured
        // areas travel on the request, not per hint, so its fourth argument is left off.
        const gridResponse = await findGridLines(
          metadata.pdfId,
          displayPage,
          currentColouredAreas,
          [buildCalcHint(t, null, null)]
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
        // Detected here, so leaving owes no detection for it.
        changedBoundsRef.current.delete(t.tableId);
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
      normalisedTables,
      commitTables,
    ]
  );

  // Leaving the boundary pass having moved a border or created a table is a
  // DELIBERATE blocking step: re-detect the grid lines of those tables, wait for the response,
  // merge it, and ONLY THEN run `after` — so nothing is worked on before the re-detected
  // geometry has landed. Note this deliberately OVERWRITES a hand-positioned border with the
  // detector's snapped version for every hinted table: that is the purpose of the call.
  //
  // On failure `after` is NOT run, so the user stays where they were and the next attempt to
  // leave tries again.
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
          // `cells` nor `title`, and its row/column counts are always null. The page's
          // coloured areas travel on the request, not per hint, so its fourth argument is
          // left off.
          hintTables.map((h) => buildCalcHint(h, null, null))
        );
        // Reported through the flush rather than as a bare commit: what was held provisionally
        // travels with what the detector returned, as ONE write, and only now — a failed call
        // reports nothing and leaves it held for the next attempt.
        const flushed = flushPending(
          mergeFindGridLines(normalisedTables, displayPage, response?.tables ?? [])
        );
        // The detected grid now reflects every moved border, so nothing is outstanding. Inside
        // the try deliberately: a failed call must leave the set intact so the next attempt to
        // leave Borders retries rather than silently skipping.
        changedBoundsRef.current = new Set();
        // Only now — after the geometry whatever comes next draws from has merged — move on.
        after(flushed);
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

  // The rebuild the boundary pass owes before anything else may happen, as a function taking
  // what to do once its merge has landed — or null when nothing is owed and the move can
  // simply be made.
  //
  // Only the boundary pass owes one: a moved border, and a table created with no grid at all,
  // both need detecting before that pass is left, whether the move is to another table, to
  // another page, or on to the contents pass. Coloured-area edits made in the contents pass
  // deliberately do NOT re-probe — the user is validating those grids by hand, and a probe
  // would overwrite the work in progress.
  //
  // The changed-bounds set is read here rather than memoised: it is a ref, and the host may
  // not have re-rendered this component since the edit that armed it.
  const owedRebuild = useCallback(() => {
    if (editorMode !== 'border') return null;
    const hintTables = samePageTables.filter((t) =>
      changedBoundsRef.current.has(t.tableId)
    );
    if (hintTables.length === 0) return null;
    return (after) => runBorderGridLines(after, hintTables);
  }, [editorMode, samePageTables, runBorderGridLines]);

  // Make a move, first settling whatever the pass being left owes: what is held provisionally
  // is reported to the host, and the rebuild it arms is made. Each rebuild is blocking and runs
  // the move itself once its merge has landed, so a failure leaves the user where they are with
  // the work still outstanding.
  //
  // The rebuild is chosen and started against the list that INCLUDES what was held, since it is
  // that geometry the detector is being asked about; the flush merely puts the same edits on the
  // document, so the merge it commits afterwards carries them either way.
  // `move` receives what the flush reported, so a move that saves can send the flushed list
  // rather than the host's not-yet-updated state.
  const leaveFor = useCallback(
    (move) => {
      const rebuild = owedRebuild();
      if (rebuild) {
        rebuild(move);
        return;
      }
      move(flushPending());
    },
    [owedRebuild, flushPending]
  );

  // Hand `leaveFor` to the host. A ref on the host's side, so re-registering never re-renders
  // it; re-registered whenever `leaveFor` changes so the host never holds a stale closure.
  useEffect(() => {
    onRegisterLeave(leaveFor);
    return () => onRegisterLeave(null);
  }, [onRegisterLeave, leaveFor]);

  // Cancel a just-created table: remove it from the list and clear the selection/flag.
  const cancelCreated = useCallback(() => {
    if (!createdTableId) return;
    commitTables(normalisedTables.filter((t) => t.tableId !== createdTableId));
    onSelectTable(null);
    setCreatedTableId(null);
  }, [createdTableId, normalisedTables, commitTables, onSelectTable]);

  // Step to `table`, dropping the selections that belonged to the table being left. The
  // armed tool, the layer flags and the mode all outlive the step: they are how the user
  // chose to work, not something about one table.
  //
  // Leaving a table is leaving the boundary pass as far as the rebuild is concerned, so a
  // step that owes one waits for it: the moved border is re-detected before the table it
  // belongs to is left, rather than being left for whenever the pass happens to end.
  const stepToTable = useCallback(
    (table) => {
      leaveFor(() => {
        onSelectTable(table.tableId);
        setSelectedLine(null);
        setSelectedSectionRow(null);
        setSelectedColouredIndex(null);
        setPendingSelection(null);
      });
    },
    [onSelectTable, leaveFor]
  );

  // Next and Previous walk the whole document: the next table on this page, else the next
  // page, and past the last page the first one — the host wraps there, so walking far enough
  // returns to the start rather than stopping. Previous is the exact reverse.
  //
  // Which table to land on after a page change is decided here and consumed once the new
  // page's tables have arrived: Next lands on the first table of the page it moved to,
  // Previous on the last. A ref, not state, because nothing renders from it.
  // A one-page document has no page to move to, so the document's wrap is this page's wrap
  // and the step is made here: the page prop would never change, and the landing selection
  // below waits on exactly that change.
  const onlyPage = !hasPrevPage && !hasNextPage;
  const pageEndTable = useCallback(
    (end) => {
      const ordered = orderedPageTables(
        samePageTables.filter((t) => !t.deleted)
      );
      if (ordered.length === 0) return null;
      return end === 'first' ? ordered[0] : ordered[ordered.length - 1];
    },
    [samePageTables]
  );

  const handleNext = useCallback(() => {
    const next = nextTableOnPage(samePageTables, selectedTable?.tableId);
    if (next) {
      stepToTable(next);
      return;
    }
    if (onlyPage) {
      const first = pageEndTable('first');
      if (first) stepToTable(first);
      return;
    }
    pageEdgeSelectionRef.current = 'first';
    leaveFor(onNextPage);
  }, [
    samePageTables,
    selectedTable,
    stepToTable,
    leaveFor,
    onNextPage,
    onlyPage,
    pageEndTable,
  ]);

  const handlePrev = useCallback(() => {
    const prev = prevTableOnPage(samePageTables, selectedTable?.tableId);
    if (prev) {
      stepToTable(prev);
      return;
    }
    if (onlyPage) {
      const last = pageEndTable('last');
      if (last) stepToTable(last);
      return;
    }
    pageEdgeSelectionRef.current = 'last';
    leaveFor(onPrevPage);
  }, [
    samePageTables,
    selectedTable,
    stepToTable,
    leaveFor,
    onPrevPage,
    onlyPage,
    pageEndTable,
  ]);

  // Toggle one layer's eye. Nothing else follows from it: a flag decides what is drawn and
  // never what can be edited.
  const handleToggleLayer = useCallback((key) => {
    setLayerVisibility((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  // Arm a grid tool, or disarm it when it is already armed. Only one is ever armed, and
  // disarming the Special tool takes its armed entry with it.
  const handleSelectTool = useCallback((key) => {
    setTool((current) => {
      const next = current === key ? null : key;
      if (next !== 'special') setSpecialTool(null);
      return next;
    });
  }, []);

  // Arm one of the Special tool's entries, or disarm it when it is already armed. Whatever
  // the previous entry was accumulating is dropped: a half-finished coloured-row selection
  // must not be submittable from another entry.
  const handleSelectSpecialTool = useCallback((key) => {
    setSpecialTool((current) => (current === key ? null : key));
    setPendingSelection(null);
    setSelectedColouredIndex(null);
    setColourPickMode(null);
    setColourDraft({ foreground: null, background: null });
  }, []);

  // End the boundary pass: settle what it owes, save the document, and only then move on to
  // the contents pass at the page's first non-deleted table. A failed save abandons the
  // switch — the toast the host raised is the user's feedback, the document stays dirty, and
  // the user stays in borderMode to retry.
  const handleValidateTables = useCallback(() => {
    leaveFor(async (flushed) => {
      const saved = await onSave(flushed);
      if (!saved) return;
      setEditorMode('grid');
      setTool(null);
      setSpecialTool(null);
      const first = orderedPageTables(
        samePageTables.filter((t) => !t.deleted)
      )[0];
      if (first) onSelectTable(first.tableId);
    });
  }, [leaveFor, onSave, samePageTables, onSelectTable]);

  // Ends the contents pass and goes back to the boundary pass, the reverse of
  // handleValidateTables and settling the same debts on the way: the rebuild the pass owes
  // is made through leaveFor, and the save is not optional — a failure abandons the switch
  // and leaves the user where they were, its own toast being the feedback.
  //
  // The armed tool and the selections that belong to the contents pass go with it; they
  // mean nothing in the boundary pass. The SELECTED TABLE does not. handleValidateTables
  // picks the page's first table because the contents pass is about one table and arrives
  // with none chosen; the boundary pass is about the page, so the table the user was just
  // working on is still a sensible thing to have selected.
  const handleValidateBorders = useCallback(() => {
    leaveFor(async (flushed) => {
      const saved = await onSave(flushed);
      if (!saved) return;
      setEditorMode('border');
      setTool(null);
      setSpecialTool(null);
      setSelectedLine(null);
      setSelectedSectionRow(null);
      setSelectedColouredIndex(null);
      setPendingSelection(null);
    });
  }, [leaveFor, onSave]);

  // The toolbar's two pass tabs make the same switch the Layers panel's Validate button
  // makes, so they call these very handlers rather than a second copy of them. Registered
  // once, through a ref: both are rebuilt whenever the page's tables change, and handing
  // the context a new pair each time would re-render the whole application for callbacks
  // nothing reads until a tab is clicked. The registration goes when this component does,
  // which is what tells the toolbar the switch is out of reach while a full panel is up.
  const passSwitchRef = useRef({});
  passSwitchRef.current = {
    validateBorders: handleValidateBorders,
    validateTables: handleValidateTables,
  };

  useEffect(() => {
    if (!setPassActions) {
      return undefined;
    }

    setPassActions({
      validateBorders: () => passSwitchRef.current.validateBorders(),
      validateTables: () => passSwitchRef.current.validateTables(),
    });

    return () => setPassActions(null);
  }, [setPassActions]);

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
            data-help-id={editorPageTitleHelpId()}
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
          <DimDocumentToggle on={dimDocument} onChange={setDimDocument} />
          <EditorScaleSelector percent={scalePercent} onChange={setScalePercent} />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {editorMode === 'grid' ? (
            <GridToolRail
              tool={tool}
              specialTool={specialTool}
              onSelectTool={handleSelectTool}
              onSelectSpecialTool={handleSelectSpecialTool}
            />
          ) : null}
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
              <Box
                data-testid={'middle-image'}
                sx={{ width: 'fit-content' }}
              >
                <StagedPageGridEditor
                  image={pageImage.image}
                  pixelWidth={pageImage.pixelWidth}
                  pixelHeight={pageImage.pixelHeight}
                  page={pageImage.page}
                  metadataTables={normalisedTables}
                  selectedTableId={selectedTableId}
                  editorMode={editorMode}
                  tool={tool}
                  specialTool={specialTool}
                  layerVisibility={layerVisibility}
                  dim={dimDocument}
                  onEditTables={handleEditTables}
                  onSelectTable={onSelectTable}
                  onCreatedTable={setCreatedTableId}
                  linkingRootId={linkingRootId}
                  onToggleLinking={onToggleLinking}
                  onRequestCreate={registerCreate}
                  onRequestDelete={registerDelete}
                  onSelectedLineChange={setSelectedLine}
                  onSelectedSectionRowChange={setSelectedSectionRow}
                  colouredAreas={currentColouredAreas}
                  selectedColouredIndex={selectedColouredIndex}
                  onSelectColouredArea={setSelectedColouredIndex}
                  onColouredAreasChange={commitColouredAreas}
                  pendingSelection={pendingSelection}
                  onPendingSelectionChange={setPendingSelection}
                  onColourSeed={setColourDraft}
                  colourPickMode={colourPickMode}
                  onClearColourPick={() => setColourPickMode(null)}
                  onColourPreview={setColourPreview}
                  onColourPicked={(hex) => {
                    setColourPreview(null);
                    if (!colourPickMode) return;
                    // A picked colour lands in the draft, and — when the selection is an
                    // area already saved — on that area straight away, so what is on the
                    // page and what the swatch shows never disagree.
                    setColourDraft((draft) => ({ ...draft, [colourPickMode]: hex }));
                    if (selectedColouredIndex == null) return;
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
            editorMode={editorMode}
            layerVisibility={layerVisibility}
            onToggleLayer={handleToggleLayer}
            tool={tool}
            specialTool={specialTool}
            selectedTable={selectedTable}
            samePageTables={samePageTables}
            pageColouredAreas={pageColouredAreas}
            onPrev={handlePrev}
            onNext={handleNext}
            onValidateTables={handleValidateTables}
            onValidateBorders={handleValidateBorders}
            isCreatedUnconfirmed={isCreatedUnconfirmed}
            onDeleteTable={() =>
              deleteActionRef.current?.(selectedTable?.tableId)
            }
            onCreateTable={() => createActionRef.current?.()}
            onConfirmCreated={() =>
              selectedTable && detectCreatedTableGrid(selectedTable)
            }
            onCancelCreated={cancelCreated}
            onDeleteHeader={() => {
              if (!selectedTable) return;
              commitTables(
                replaceTableById(normalisedTables, selectedTable.tableId, {
                  ...selectedTable,
                  headerCount: 0,
                })
              );
            }}
            hasPendingSelection={hasPendingSelection}
            hasSavedAreaSelected={selectedColouredIndex != null}
            foregroundColour={
              colourPickMode === 'foreground' && colourPreview != null
                ? colourPreview
                : selectedColouredArea?.foreground ?? colourDraft.foreground
            }
            backgroundColour={
              colourPickMode === 'background' && colourPreview != null
                ? colourPreview
                : selectedColouredArea?.background ?? colourDraft.background
            }
            colourPickMode={colourPickMode}
            onToggleForegroundPick={() =>
              setColourPickMode((m) => (m === 'foreground' ? null : 'foreground'))
            }
            onToggleBackgroundPick={() =>
              setColourPickMode((m) => (m === 'background' ? null : 'background'))
            }
            onColourSubmit={handleColourSubmit}
            onColourDelete={() => {
              if (selectedColouredIndex == null) return;
              commitColouredAreas(
                currentColouredAreas.filter(
                  (_, i) => i !== selectedColouredIndex
                )
              );
              setSelectedColouredIndex(null);
              setColourPickMode(null);
            }}
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
