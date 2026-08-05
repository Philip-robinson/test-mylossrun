'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Switch,
  Typography,
} from '@mui/material';
import PictureAsPdf from '@mui/icons-material/PictureAsPdf';
import Link from '@mui/icons-material/Link';
import TableLinkageEditor from 'components/pdfTableViewer/TableLinkageEditor';
import PageTableEditor from 'components/pdfTableViewer/PageTableEditor';
import ReviewTablePanel from 'components/pdfTableViewer/ReviewTablePanel';
import toast from 'react-hot-toast';
import {
  calculateCells,
  getMetadata,
  getThumbnails,
  saveTables,
} from 'services/images';
import {
  confirmedTableStage,
  readyTableStage,
  resizeDebounceMs,
  stagedGridEditorEnabled,
} from 'config';
import {
  buildCalcCellsRequestTable,
  fillGridCells,
  mergeCalcCellsResponse,
  mergeRolesByTableId,
  normaliseTableBounds,
  overlaps,
  tableCountLabel,
  tableSizeLabel,
  tablesOnPage,
} from 'components/pdfTableViewer/tableSupportUtils';
import { layerDataChanged } from 'components/pdfTableViewer/layerUtils';
import { PageImageWithOverlay } from 'components/pdfTableViewer/PageImageWithOverlay';

// Classify how a table changed between its pre-edit (`before`) and post-edit (`after`)
// snapshots, for the per-table change set (Task 14). A table counts as changed when it was
// newly created (no `before`), its outer boundary moved, an internal grid line moved, or any
// data the Special Areas layer owns changed.
//
// That last clause is delegated to `layerDataChanged('special', …)` rather than restated here,
// so "what Special Areas owns" has ONE definition: its title, its header count, its sub-title
// rows and its footer. Three of those four are rectangles a calculate-cells request carries, so
// an edit confined to that layer still needs the page-exit re-read — adding a sub-title row in
// particular creates a rectangle whose text has never been read. (Header count adds no
// rectangle, so its call reads nothing new; it is included anyway because one rule per layer is
// worth more than carving out the single field that happens to add nothing, and the call is
// backgrounded.)
//
// `titleChanged` is still reported separately as a record of WHY the table is in the change set;
// the page-change recalculation no longer needs it to decide what to send, because a
// calculate-cells request carries the title rectangle of every table that has one.
// Rename (name only) and confirmation-stage toggles are deliberately NOT treated as changes.
// The projection of a table used by the recalculation's staleness comparison: everything
// except `confirmationStage`, normalised so its value cannot affect the result.
//
// That guard's job is to protect edits the USER made while a backgrounded recalculation was in
// flight, so that a response carrying old text cannot overwrite them. A confirmationStage
// advance is not such an edit — it touches nothing the response writes back — and it MUST be
// excluded, because the Special Areas tick advances the stage through onChange and performs the
// Next action in the SAME event. The recalculation is therefore always launched from a render
// that predates its own trigger's stage write, so a whole-table comparison would find every
// such snapshot stale and silently discard the response — losing the title text, the re-read
// cell text and the special areas' text for every page left by confirming Special Areas.
function recalcComparable(table) {
  return JSON.stringify({ ...table, confirmationStage: null });
}

function classifyTableChange(before, after) {
  if (!before) return { changed: true, titleChanged: false };
  const boundaryMoved =
    JSON.stringify(before.bounds) !== JSON.stringify(after.bounds);
  const gridMoved =
    JSON.stringify(before.columnWidths) !==
      JSON.stringify(after.columnWidths) ||
    JSON.stringify(before.rowHeights) !== JSON.stringify(after.rowHeights);
  const specialChanged = layerDataChanged('special', before, after);
  const titleChanged =
    JSON.stringify(before.title ?? null) !== JSON.stringify(after.title ?? null);
  return {
    changed: boundaryMoved || gridMoved || specialChanged,
    titleChanged,
  };
}

export default function PDFEditTableStructure({ pdfId, onAllFiles }) {
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbnailsLoaded, setThumbnailsLoaded] = useState(false);
  // Bumped after a successful save so the right-column thumbnails re-fetch and
  // reflect the just-saved tables (the server renders them from page.tables).
  const [thumbnailsRefresh, setThumbnailsRefresh] = useState(0);
  const [selectedPage, setSelectedPage] = useState(0);
  const [error, setError] = useState(null);

  // The loaded table list is the edit result: every field and the array order is
  // preserved (only a later rename task mutates `name`). The backend PUT replaces
  // metadata.tables wholesale, so anything dropped here is lost server-side.
  const [tables, setTables] = useState([]);
  // metadata.pages: the per-page records (dimensions, origin table lists and coloured
  // areas). Read-only apart from `colouredAreas`, the one field edited and saved from here.
  // The right-column counts no longer read page.tables — they are derived from the live
  // `tables` state so they reflect edits before a save.
  const [pages, setPages] = useState([]);
  // The loaded PDF filename (metadata.name), shown in the centre-panel title bar.
  const [pdfName, setPdfName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // The tableId whose name is being edited inline (null when none), plus the
  // working draft of that name. Only `name` is ever mutated on commit; every
  // other field and the array order is preserved because the Save PUT replaces
  // metadata.tables wholesale.
  const [editingTableId, setEditingTableId] = useState(null);
  const [draftName, setDraftName] = useState('');
  // tableId of the selected table (null when none). Owned by the host and passed down to
  // the staged editor as selectedTableId; defaulted to the first non-deleted table on the
  // displayed page (see the default-selection effect). Also drives the left-entry
  // bounding-box highlight and the scroll-into-view effect. The join to the left list is by
  // the stable tableId, unaffected by rename.
  const [selectedTableId, setSelectedTableId] = useState(null);
  // Per-table change set since the last load/save: tableId -> { titleChanged }. A table is
  // added when it is created, its boundary moves, a grid line moves, or its title changes
  // (see classifyTableChange). Drives the Recalculate-on-page-change; cleared on save and on
  // (re)load.
  const [changedTableIds, setChangedTableIds] = useState({});
  // Left-list "Include deleted" toggle; default OFF.
  const [includeDeleted, setIncludeDeleted] = useState(false);
  // tableId of the DELETED left-list row currently hovered (null when none). Lifted here
  // so the centre overlay (Task 5) can draw a transient preview of that table's grid.
  // Distinct from selectedTableId (the centre-hover -> left-highlight path, unchanged).
  const [hoveredDeletedTableId, setHoveredDeletedTableId] = useState(null);
  // Popup menu for a clicked DELETED left-list row: single "Reinstate" item, anchored at
  // the click. { tableId, clientX, clientY } | null.  (Consumed by Task 6.)
  const [reinstateMenu, setReinstateMenu] = useState(null);
  // tableId of the table the Grid Editor is open for (null when closed). That panel
  // (TableLinkageEditor) is mounted only while this is set, so its image cache and internal
  // state are discarded when it closes. Reset per pdfId with the rest of the per-document
  // state.
  const [linkRootId, setLinkRootId] = useState(null);
  // tableId of the table the middle panel is REVIEWING (null when not in review mode). Set by
  // the left column's Review button, but only after the document has been saved — see
  // handleReview. Reset per pdfId with the rest of the per-document state.
  const [reviewTableId, setReviewTableId] = useState(null);
  // Per-entry refs keyed by tableId so the selected entry can be scrolled into
  // the left panel's scroll area.
  const entryRefs = useRef({});
  // The centre panel's transient Borders-layer expected-count hints, mirrored here:
  // tableId -> { expectedColumns, expectedRows } (both strings, '' when blank). They are
  // PageTableEditor's own view state (nothing on PDFTable stores them) and are reported up
  // through onExpectedCountsMapChange so the host has them to hand. They steer grid
  // DETECTION, so the page-change recalculation — a text read that detects nothing — does not
  // send them; the centre panel's own Calculate does. A ref, not state: nothing renders from
  // them, so a report must not re-render.
  const expectedCountsRef = useRef({});
  const handleExpectedCountsMapChange = useCallback((counts) => {
    expectedCountsRef.current = counts ?? {};
  }, []);

  const rightRef = useRef(null);
  const [rightWidth, setRightWidth] = useState(0);

  // Measure the right (thumbnail) pane pixel width. The backend derives render
  // dpi from a target pixel width, so we drive fetches off the measured layout
  // rather than a hard-coded dpi literal. The first measurement is immediate; while
  // the window is being resized, measurements are debounced (resizeDebounceMs()) so a
  // drag coalesces into a single refetch instead of one per frame. Widths are rounded
  // to whole pixels so sub-pixel reflow (e.g. a scrollbar toggling) is not treated as
  // a change. The centre pane's own width is measured by PageTableEditor.
  useEffect(() => {
    const rightEl = rightRef.current;
    if (!rightEl) return undefined;

    const apply = () => {
      setRightWidth(Math.round(rightEl.getBoundingClientRect().width));
    };
    apply();

    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(apply, resizeDebounceMs());
    });
    observer.observe(rightEl);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // On a pdfId change, clear all three panels (left table list, centre page image,
  // right thumbnails) and their per-document state up front, so nothing from the
  // previous document lingers while the new one loads — or if any load fails. The
  // fetch effects below then repopulate each section for the new pdfId.
  useEffect(() => {
    setThumbnails([]);
    setThumbnailsLoaded(false);
    setSelectedPage(0);
    setTables([]);
    setPages([]);
    setPdfName('');
    setDirty(false);
    setEditingTableId(null);
    setDraftName('');
    setSelectedTableId(null);
    setChangedTableIds({});
    setIncludeDeleted(false);
    setHoveredDeletedTableId(null);
    setReinstateMenu(null);
    setLinkRootId(null);
    setReviewTableId(null);
    setError(null);
    entryRefs.current = {};
  }, [pdfId]);

  // Load thumbnails on mount and whenever the pdf or measured right-pane width
  // changes. Guarded on a positive width so we never request a degenerate
  // zero-width render before the first layout.
  useEffect(() => {
    if (rightWidth <= 0) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await getThumbnails(pdfId, Math.round(rightWidth * 0.95));
        if (cancelled) return;
        const images = data.images || [];
        setError(null);
        setThumbnails(images);
        setThumbnailsLoaded(true);
        // Keep the current selection; only move it when it would be out of range
        // (a shorter document), in which case fall back to the last page.
        setSelectedPage((prev) =>
          images.length === 0 ? prev : Math.min(prev, images.length - 1)
        );
      } catch (err) {
        // `error` still gates the centre panel (so no stale content shows); the
        // message itself is surfaced via a toast (same mechanism as elsewhere).
        if (!cancelled) {
          setError(err.message);
          toast.error(err.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, rightWidth, thumbnailsRefresh]);

  // Load the editable table metadata on mount and whenever the pdf changes. The
  // in-flight/unmount race is guarded with a cancelled flag, as the thumbnail and
  // image effects are. A (re)load is a clean state, so dirty is cleared.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMetadata(pdfId);
        if (cancelled) return;
        // Normalise each table's bounds to the I1/I2 invariant (bounds.width/height ==
        // axis sums; see normaliseTableBounds) so backend metadata that violates it does
        // not make the first boundary drag zero every cell's confidence, then materialise a
        // cell for every grid square the backend left unmapped (see fillGridCells), so every
        // area of the grid has editable, displayable cell data.
        setTables(
          (data.tables ?? []).map(normaliseTableBounds).map(fillGridCells)
        );
        setPages(data.pages ?? []);
        setPdfName(data.name ?? '');
        setDirty(false);
        setChangedTableIds({});
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  // Scroll the selected left entry into view (block: 'nearest' keeps the page
  // from scrolling). Keyed on selectedTableId so it only fires on a new hover.
  useEffect(() => {
    if (selectedTableId == null) return;
    const el = entryRefs.current[selectedTableId];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedTableId]);

  // Default the selection to the first non-deleted table on the displayed page whenever the
  // current selection is not a live table on that page — i.e. on initial load, on a page
  // change (Prev/Next or a thumbnail click), or when the selected table is deleted. A
  // still-valid selection (one the user clicked, or a just-created table) is left untouched.
  // This first-class selection is a staged-editor behaviour only: in the legacy editor
  // selection is transient (centre-hover -> left-highlight), so leave selectedTableId null
  // there and do not pre-highlight a left entry.
  //
  // The page's tables include those joined under another table's grid: a saved link grid
  // moves them off the top-level list, and a page holding only joined tables would
  // otherwise land with nothing selected at all.
  useEffect(() => {
    if (!stagedGridEditorEnabled()) return;
    const onPage = tablesOnPage(tables, selectedPage);
    const stillValid = onPage.some((t) => t.tableId === selectedTableId);
    if (!stillValid) {
      setSelectedTableId(onPage.length > 0 ? onPage[0].tableId : null);
    }
  }, [selectedPage, tables, selectedTableId]);

  // Persist the current table list. On success the edit state is clean again; on
  // failure the error is surfaced and dirty is left set so the user can retry.
  //
  // Returns whether the save reached the server. The top Save button ignores that (a failure
  // is already a toast, and dirty is left set), but handleReview must not open the review
  // panel on a document the worker cannot see — hence the boolean rather than a bare void.
  const handleSave = async () => {
    setSaving(true);
    try {
      // Send every page that carries a coloured-areas array (including an empty one,
      // so clearing a page's areas is persisted). Pages that never had the field are
      // omitted and left untouched server-side.
      const colouredAreas = (pages || [])
        .filter((p) => Array.isArray(p.colouredAreas))
        .map((p) => ({ pdfPage: p.page, colouredAreas: p.colouredAreas }));
      await saveTables(pdfId, tables, colouredAreas);
      setDirty(false);
      setChangedTableIds({});
      // The save scatters the edited tables into page.tables server-side, and the
      // thumbnails are rendered from page.tables — so re-fetch them to reflect the
      // just-saved changes (borders, size labels, low-confidence lines).
      setThumbnailsRefresh((n) => n + 1);
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Replace one page's coloured areas (Colours layer) immutably and mark the edit
  // dirty so Save enables. `pageNumber` is the 0-based page; `nextAreas` the new list.
  const handleColouredAreasChange = (pageNumber, nextAreas) => {
    setPages((prev) =>
      prev.map((p) =>
        p.page === pageNumber ? { ...p, colouredAreas: nextAreas } : p
      )
    );
    setDirty(true);
  };

  // Begin editing a table's name: seed the draft from the current name.
  const startEditing = (t) => {
    setEditingTableId(t.tableId);
    setDraftName(t.name);
  };

  // Commit the draft name onto the matching table immutably (map by tableId).
  // ONLY `name` is mutated; tableId, pdfPage, geometry, cells and the array
  // order are preserved. Marks the edit dirty so Save enables.
  const commitEditing = () => {
    setTables((prev) =>
      prev.map((t) =>
        t.tableId === editingTableId ? { ...t, name: draftName } : t
      )
    );
    setDirty(true);
    setEditingTableId(null);
  };

  // Cancel the edit without changing anything.
  const cancelEditing = () => {
    setEditingTableId(null);
  };

  // The commit path shared by the geometry-editing tasks. Given the full next table
  // list, adopt it and mark the edit dirty so Save enables. Immutable: callers build
  // nextTables by mapping over the current tables and replacing only the edited one.
  const onEditTables = (nextTables) => {
    // Update the per-table change set by comparing each next table against its pre-edit
    // snapshot (the current `tables`, captured in this closure). A `titleChanged` flag, once
    // set for a table, sticks until the set is cleared.
    setChangedTableIds((prev) => {
      const updated = { ...prev };
      const beforeById = new Map(tables.map((t) => [t.tableId, t]));
      for (const after of nextTables) {
        const { changed, titleChanged } = classifyTableChange(
          beforeById.get(after.tableId),
          after
        );
        if (changed) {
          updated[after.tableId] = {
            titleChanged: (updated[after.tableId]?.titleChanged ?? false) || titleChanged,
          };
        }
      }
      return updated;
    });
    setTables(nextTables);
    setDirty(true);
  };

  // Recalculate the listed tables of ONE page: the single place every recalculation trigger
  // routes through, so a further cause (the specification anticipates more, yet to be defined)
  // is one call rather than a copy of this body. `recalcPage` is the 0-based page and
  // `tableIds` the ids to consider — non-existent ids, ids on another page and soft-deleted
  // tables are dropped here, so a caller can simply hand over its whole change set.
  //
  // Each table contributes one calculate-cells request table (buildCalcCellsRequestTable): its
  // own rectangle, its cells' rectangles and, when it has them, its title and special-area
  // rectangles. The recalculated page's coloured areas travel once, as the request's page-level
  // argument. This is a text READ, not a detection: every rectangle sent is taken as correct, so
  // nothing is hinted, nothing is detected and the response carries no geometry — which is
  // precisely why it cannot strip a table's grid lines, as the old cell-bearing find-tables
  // hint did.
  //
  // The call is fired but NOT awaited: the caller has already moved the page, so navigation
  // feels instant and the recalculation completes in the background. When it resolves, each
  // returned table's TEXT is merged into the local table it was produced for (matched by
  // tableInPage + pdfPage) via a functional setTables update. Best-effort: a failure is
  // surfaced but the page has already moved.
  const recalcPageTables = (recalcPage, tableIds) => {
    const ids = new Set(tableIds);
    const changedOnPage = tables.filter(
      (t) => ids.has(t.tableId) && t.pdfPage === recalcPage && !t.deleted
    );
    if (changedOnPage.length === 0) {
      return;
    }

    // The recalculated page's coloured areas — matched on `page` exactly as handleSave does.
    // The request has a page-level field for them, so they are sent once rather than per table.
    const colouredAreas = pages.find((p) => p.page === recalcPage)?.colouredAreas;

    const requestTables = changedOnPage.map((t) => buildCalcCellsRequestTable(t));

    // Snapshot each table IN FULL at launch (a JSON comparison, as classifyTableChange uses),
    // so on resolve we can tell whether the user has edited it in the meantime. This guard is
    // load-bearing: the call is backgrounded and writes back every cell's text, not just a
    // title, so a table the user has touched since must be left ENTIRELY alone rather than
    // partly overwritten — otherwise every edit made in the seconds after navigating away is
    // silently destroyed.
    const launchSnapshotById = {};
    for (const t of changedOnPage) {
      launchSnapshotById[t.tableId] = recalcComparable(t);
    }

    (async () => {
      try {
        const response =
          (await calculateCells(
            pdfId,
            recalcPage,
            colouredAreas ?? [],
            requestTables
          )) ?? {};
        const returnedList = response.tables ?? [];
        if (returnedList.length === 0) {
          return;
        }
        // Match each requested table to its result by tableInPage + pdfPage. The endpoint
        // reflects table_in_page back onto each result, and the page is a property of the
        // response as a whole (one call covers one page). A returned table matching nothing is
        // ignored.
        const responsePage = response.pdfPage ?? recalcPage;
        const replacementById = {};
        for (const t of changedOnPage) {
          const match = returnedList.find(
            (r) => r.tableInPage === t.tableInPage && responsePage === t.pdfPage
          );
          if (match) {
            replacementById[t.tableId] = mergeCalcCellsResponse(t, match);
          }
        }
        if (Object.keys(replacementById).length === 0) {
          return;
        }
        let wrote = false;
        setTables((prev) =>
          prev.map((t) => {
            const replacement = replacementById[t.tableId];
            if (!replacement) return t;
            // The staleness guard: any difference OTHER than confirmationStage (see
            // recalcComparable) means the user edited the table after this recalculation
            // launched, so their version stands untouched.
            if (recalcComparable(t) !== launchSnapshotById[t.tableId]) return t;
            // A result identical to the table we already hold (the snapshot, which we have just
            // established still matches) is not an edit, so do not dirty the document for it.
            if (recalcComparable(replacement) === launchSnapshotById[t.tableId]) {
              return t;
            }
            wrote = true;
            // The replacement was built from the LAUNCH snapshot, so its confirmationStage is
            // the pre-launch one. Keep the live value: the tick that triggered this call has
            // since advanced it, and reverting that would untick Special Areas.
            return { ...replacement, confirmationStage: t.confirmationStage };
          })
        );
        if (wrote) setDirty(true);
      } catch (err) {
        toast.error(err.message);
      }
    })();
  };

  // Move to `nextPage`, recalculating every table that changed on the page being left and
  // clearing the change set. The page advances FIRST (synchronously) so navigation is never
  // blocked by the backgrounded calculate-cells call.
  const recalcAndGoToPage = (nextPage) => {
    const recalcPage = selectedPage;
    const changedIds = Object.keys(changedTableIds);

    // Advance immediately, clearing the change set for the page we are leaving.
    setChangedTableIds({});
    setSelectedPage(nextPage);

    recalcPageTables(recalcPage, changedIds);
  };

  // Layers-panel Previous/Next. At the ends of the document there is no page to move to, so
  // surface a Start of list / End of list message and leave the page unchanged.
  const onPrevPage = () => {
    if (selectedPage <= 0) {
      toast('Start of list');
      return;
    }
    recalcAndGoToPage(selectedPage - 1);
  };
  const onNextPage = () => {
    if (selectedPage >= thumbnails.length - 1) {
      toast('End of list');
      return;
    }
    recalcAndGoToPage(selectedPage + 1);
  };

  // A right-column thumbnail click is a page change like Prev/Next, so it recalculates the
  // page being left too. Clicking the page already displayed leaves no page, so it does
  // nothing.
  // While a panel (grid editor / review) owns the middle panel there is no page editor to
  // move, so a thumbnail click is ignored rather than silently changing the page behind the
  // panel — which would also fire a recalculation for a page the user cannot see.
  const onThumbnailClick = (index) => {
    if (centreMode !== 'editor') return;
    if (index === selectedPage) return;
    recalcAndGoToPage(index);
  };

  // A Document Overview entry click selects that table for editing. The list spans the whole
  // document, so an entry off the displayed page moves the page with it — a page change like
  // any other, recalculating what changed on the page being left. Without the move the
  // default-selection effect would take the selection straight back.
  //
  // A deleted row is not selectable: it is not editable, and its own click opens the
  // Reinstate menu. Clicking the name selects too, and starts the inline rename with it —
  // renaming a table is a reason to be looking at it.
  const onTableEntryClick = (table) => {
    if (table.deleted) return;
    if (table.pdfPage !== selectedPage) recalcAndGoToPage(table.pdfPage);
    setSelectedTableId(table.tableId);
  };

  // Convenience wrapper the overlay uses when it edits exactly one table: map over the
  // current tables immutably, replacing only the table whose tableId matches with the
  // supplied new table object (which must itself carry new bounds/columnWidths/rowHeights
  // arrays — never mutate the existing one). tableId, pdfPage and array order are
  // preserved for every other table. Tasks 2-4 call this from within the overlay.
  // eslint-disable-next-line no-unused-vars
  const commitTableEdit = (tableId, newTable) => {
    onEditTables(tables.map((t) => (t.tableId === tableId ? newTable : t)));
  };

  // Mark one prepared table "ready": advance its confirmationStage to readyTableStage(),
  // one above the five-row Layers ladder's maximum (confirmedTableStage()). Routed through
  // onEditTables like every other edit, so the document becomes dirty and the new stage is
  // persisted by the next Save — this button does NOT PUT anything itself. Every other
  // table, and every other field of this one, is preserved.
  //
  // Nothing here guards against a later demotion: layerUtils.stageAfterEdit still drops the
  // stage when a confirmed layer is edited, so editing a ready table un-readies it.
  const handleMarkReady = (tableId) => {
    onEditTables(
      tables.map((t) =>
        t.tableId === tableId
          ? { ...t, confirmationStage: readyTableStage() }
          : t
      )
    );
  };

  // Review the extracted output of a ready table: SAVE FIRST, then hand the middle panel over
  // to the review panel, which dispatches the extraction and polls for the merged table.
  //
  // The save is not optional. The extraction runs in a worker that reads this document's
  // metadata from S3, so anything still local — every pending edit, and in particular the
  // stage advance the Mark Ready button just made — would be invisible to it. A failed save
  // therefore aborts: the toast handleSave raised is the user's feedback and the editor stays
  // put. Re-entrancy is guarded on `saving`, so a double click cannot fire two PUTs.
  const handleReview = async (tableId) => {
    if (saving) return;
    const saved = await handleSave();
    if (!saved) return;
    setLinkRootId(null);
    setReviewTableId(tableId);
  };

  // Reinstate (un-delete) the table the Reinstate menu targets. Design decision 3
  // (overlap semantics): a table may only be reinstated if it does not overlap any LIVE
  // (non-deleted) table on the SAME page — collisions with other deleted tables are
  // ignored. Comparison is in fraction space via the shared module-scope `overlaps`
  // helper (strict inequalities, so edge-touching is allowed, matching Add table). On
  // success clear `deleted` immutably and mark dirty through onEditTables (which replaces
  // the whole list and sets dirty); on failure show an info snackbar and change nothing.
  const handleReinstate = () => {
    if (!reinstateMenu) return;
    const table = tables.find((t) => t.tableId === reinstateMenu.tableId);
    if (!table) {
      setReinstateMenu(null);
      return;
    }
    // Other NON-deleted tables on the SAME page. Overlaps against OTHER deleted tables are
    // ignored — only collisions with live tables block reinstatement.
    const others = tables.filter(
      (o) =>
        o.tableId !== table.tableId && o.pdfPage === table.pdfPage && !o.deleted
    );
    const collides = others.some((o) => overlaps(table.bounds, o.bounds));
    if (collides) {
      toast(`Not enough room to reinstate grid ${table.name}`);
    } else {
      // Clear the flag immutably and mark dirty. onEditTables replaces the whole list and
      // sets dirty.
      onEditTables(
        tables.map((t) =>
          t.tableId === table.tableId ? { ...t, deleted: false } : t
        )
      );
    }
    setReinstateMenu(null);
    setHoveredDeletedTableId(null);
  };

  // Which component owns the middle panel: the page editor, the grid editor, or the review
  // panel. The two targets are the single source of truth, resolved against the LIVE table
  // list, so a target that no longer names a table (a reload, a deletion) falls back to the
  // editor rather than mounting a panel with nothing to show. Review wins over link because
  // handleReview clears the link target as it switches.
  const linkRootTable =
    linkRootId != null
      ? tables.find((t) => t.tableId === linkRootId) ?? null
      : null;
  const reviewTable =
    reviewTableId != null
      ? tables.find((t) => t.tableId === reviewTableId) ?? null
      : null;
  let centreMode = 'editor';
  if (reviewTable) {
    centreMode = 'review';
  } else if (linkRootTable) {
    centreMode = 'link';
  }

  // Empty only once a fetch has completed and returned no pages — not during the
  // initial pre-measurement window when thumbnails is still its empty default.
  const isEmpty = thumbnailsLoaded && thumbnails.length === 0;

  // Document-wide progress for the summary under the PAGES title, read from the LIVE
  // `tables` state rather than the immutable per-page origin lists (metadata.pages[].tables),
  // which only refresh after a save. Soft-deleted tables are excluded, as everywhere else in
  // the editor, so the two counts partition the non-deleted set: a table is completed once
  // its confirmationStage has reached confirmedTableStage(); every stage below that — a
  // missing or null stage included, treated as 0 as the rest of the editor does — is still to
  // process.
  const liveTables = tables.filter((t) => !t.deleted);
  const tablesCompleted = liveTables.filter(
    (t) => (t.confirmationStage ?? 0) >= confirmedTableStage()
  ).length;
  const tablesToProcess = liveTables.length - tablesCompleted;

  // The LIVE tables whose borders a page's thumbnail draws, in page-fraction space (the
  // thumbnail overlay scales them itself, from the loaded image's natural size). Taken from
  // the editable `tables` state — not the thumbnail fetch, which only refreshes after a
  // save — so an edit shows on the thumbnail straight away. Soft-deleted tables are
  // excluded, as everywhere else in the editor. Tables joined into another table's grid are
  // INCLUDED: a saved link grid moves them off the top-level list, and taking the top level
  // alone left them with no border, no name and no tick despite being on the page.
  const thumbnailTablesOnPage = (index) => tablesOnPage(tables, index);

  // Each merged table's part in a merge, keyed by tableId, for the thumbnails' link badge.
  // Computed from the whole document because a joined table's root may sit on another page.
  const mergeRoles = mergeRolesByTableId(tables);

  // Non-deleted tables: shown for ALL pages (unchanged behaviour). Deleted tables: shown
  // ONLY when the toggle is on AND the table is on the page currently selected in the
  // centre panel (selectedPage). Order is preserved (filter keeps array order).
  const displayedPage = selectedPage;
  const listedTables = tables.filter(
    (t) =>
      !t.deleted ||
      (includeDeleted && displayedPage !== null && t.pdfPage === displayedPage)
  );

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Left panel — Document Overview (placeholder) */}
      <Box
        sx={{
          width: '12%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '1px solid #e0e0e0',
        }}
      >
        {/* Save pinned at the top: disabled while clean or in-flight. */}
        <Box sx={{ p: 1, flexShrink: 0 }}>
          <Button
            variant={'contained'}
            size={'small'}
            fullWidth
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
        <Box sx={{ px: 1, pb: 1, flexShrink: 0 }}>
          <FormControlLabel
            control={
              <Switch
                size={'small'}
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
              />
            }
            label={'Include deleted'}
            sx={{ '& .MuiFormControlLabel-label': { fontSize: '12px' } }}
          />
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', px: 1, pb: 1 }}>
          {'Document Overview'}
        </Typography>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {listedTables.map((t) => {
            const nameColour = t.deleted
              ? 'var(--secondary-text)'
              : 'var(--primary-text)';
            // One call per entry, destructured: sizeLine is always present, tablesLine
            // only for a table with a saved link grid.
            const { sizeLine, tablesLine } = tableSizeLabel(t);
            return (
              <Box
                key={t.tableId}
                ref={(el) => {
                  entryRefs.current[t.tableId] = el;
                }}
                data-testid={'table-entry'}
                onClick={() => onTableEntryClick(t)}
                onMouseEnter={
                  t.deleted
                    ? () => setHoveredDeletedTableId(t.tableId)
                    : undefined
                }
                onMouseLeave={
                  t.deleted ? () => setHoveredDeletedTableId(null) : undefined
                }
                sx={{
                  p: 1,
                  cursor: t.deleted ? 'default' : 'pointer',
                  // Cross-panel highlight: a clear bounding box (reusing the
                  // thumbnail-selection style) on the entry joined to the hovered
                  // overlay table by tableId. The unselected box is a transparent
                  // 2px border so the divider keeps each entry separated without a
                  // layout shift on selection.
                  borderBottom: '1px solid #e0e0e0',
                  border:
                    t.tableId === selectedTableId
                      ? '2px solid #1976d2'
                      : '2px solid transparent',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 0.5,
                  }}
                >
                  <Box
                    data-testid={'table-entry-name'}
                    onClick={(e) => {
                      if (t.deleted) {
                        // Deleted rows never start rename; open the Reinstate menu instead.
                        setReinstateMenu({
                          tableId: t.tableId,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                      } else if (editingTableId !== t.tableId) {
                        startEditing(t);
                      }
                    }}
                    sx={{
                      flexGrow: 1,
                      minWidth: 0,
                      color: nameColour,
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: t.deleted ? 'pointer' : 'text',
                    }}
                  >
                    {editingTableId === t.tableId && !t.deleted ? (
                      <InputBase
                        autoFocus
                        fullWidth
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={commitEditing}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitEditing();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEditing();
                          }
                        }}
                        sx={{
                          color: 'var(--primary-text)',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          p: 0,
                        }}
                      />
                    ) : (
                      t.name
                    )}
                  </Box>
                </Box>
                {/* Title line: a SIBLING of the name Box (not inside it) for the same
                    reason as the link button — the name Box's onClick starts the inline
                    rename, so a nested title would begin a rename when clicked. Rendered
                    only once the title text has actually been read (title.text is null
                    until then). Long titles wrap rather than overflow the panel. */}
                {t.title?.text ? (
                  <Box
                    data-testid={'table-entry-title'}
                    sx={{
                      color: 'var(--secondary-text)',
                      fontSize: '12px',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {t.title.text}
                  </Box>
                ) : null}
                <Box
                  data-testid={'table-entry-size'}
                  sx={{ color: 'var(--secondary-text)', fontSize: '12px' }}
                >
                  {sizeLine}
                </Box>
                {tablesLine ? (
                  <Box
                    data-testid={'table-entry-tables'}
                    sx={{ color: 'var(--secondary-text)', fontSize: '12px' }}
                  >
                    {tablesLine}
                  </Box>
                ) : null}
                {/* Button row, below every text line and a SIBLING of the name Box (never
                    inside it) — the name Box's onClick starts the inline rename, so a
                    nested control would begin a rename when clicked. Rendered only for
                    non-deleted rows: a deleted row offers no stage button and no Link
                    button, its click opening the Reinstate menu instead.

                    The stage button follows the table's progress up the ladder, treating a
                    missing or null confirmationStage as 0 as the rest of the editor does:
                    nothing below confirmedTableStage(), "Mark Ready" exactly at it, and
                    "Review" once readyTableStage() has been reached. The ready stage is
                    tested FIRST because it is the higher of the two. */}
                {!t.deleted && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      mt: 0.5,
                    }}
                  >
                    {(t.confirmationStage ?? 0) >= readyTableStage() ? (
                      <Button
                        data-testid={'review-table'}
                        size={'small'}
                        variant={'outlined'}
                        sx={{ fontSize: '11px', py: 0, minWidth: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReview(t.tableId);
                        }}
                      >
                        {'Review'}
                      </Button>
                    ) : (t.confirmationStage ?? 0) === confirmedTableStage() ? (
                      <Button
                        data-testid={'mark-ready'}
                        size={'small'}
                        variant={'outlined'}
                        sx={{ fontSize: '11px', py: 0, minWidth: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkReady(t.tableId);
                        }}
                      >
                        {'Mark Ready'}
                      </Button>
                    ) : null}
                    {/* Spacer so the Link button sits at the right-hand end of the row
                        whether or not a stage button is present. */}
                    <Box sx={{ flexGrow: 1 }} />
                    <IconButton
                      data-testid={'link-table'}
                      aria-label={'Link tables'}
                      size={'small'}
                      sx={{ p: 0, flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkRootId(t.tableId);
                      }}
                    >
                      <Link sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Middle panel — the page editor ('editor' mode; the other two modes are drawn as a
          full-editor overlay below). The interactive editor (image fetch, container sizing,
          overlay derivation, title bar and loading overlay) lives in PageTableEditor; the
          host keeps only the empty-state chrome and the outer flex column. */}
      <Box
        data-testid={'middle-panel'}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Empty document: a completed thumbnails fetch that returned no pages. Keep
            the host's own title bar (showing the PDF name) and the "No Document"
            block with the "← All Files" button. */}
        {!error && isEmpty && (
          <>
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
              {pdfName}
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
              <Box
                data-testid={'editor-empty-state'}
                sx={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    maxWidth: '50%',
                    minWidth: '300px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 70,
                      height: 70,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'var(--background-green)',
                    }}
                  >
                    <PictureAsPdf sx={{ fontSize: 40, color: 'var(--secondary-text)' }} />
                  </Box>
                  <Typography
                    sx={{
                      fontSize: '25px',
                      fontWeight: 'bold',
                      color: 'var(--primary-text)',
                      fontFamily: 'inherit',
                    }}
                  >
                    {'No Document'}
                  </Typography>
                  <Typography sx={{ fontSize: '15px', color: 'var(--secondary-text)' }}>
                    {'There are no documents to display'}
                  </Typography>
                  <button
                    type={'button'}
                    className={'toolbar-tab toolbar-tab-link'}
                    onClick={onAllFiles}
                  >
                    {'← All Files'}
                  </button>
                </Box>
              </Box>
            </Box>
          </>
        )}
        {/* Non-empty document: the self-contained editor owns the centre image, its
            title bar and loading overlay. Mounted only once a page exists (mirrors the
            old getImage gate on thumbnails.length), so the image is never fetched for an
            empty document. `tables` stays the host's single source of truth; every edit
            comes back through onEditTables. */}
        {!error && thumbnails.length > 0 && centreMode === 'editor' && (
          <PageTableEditor
            metadata={{ pdfId, tables, pages, name: pdfName }}
            page={selectedPage}
            onChange={onEditTables}
            onHoverTable={setSelectedTableId}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTableId}
            hasPrevPage={selectedPage > 0}
            hasNextPage={selectedPage < thumbnails.length - 1}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            onColouredAreasChange={handleColouredAreasChange}
            onExpectedCountsMapChange={handleExpectedCountsMapChange}
            deletedPreview={
              tables.find(
                (t) => t.tableId === hoveredDeletedTableId && t.deleted
              ) ?? null
            }
          />
        )}
      </Box>

      {/* Right panel — PAGES thumbnails */}
      <Box
        ref={rightRef}
        sx={{
          width: '15%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderLeft: '1px solid #e0e0e0',
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', p: 1 }}>
          {'PAGES'}
        </Typography>
        <Box
          data-testid={'pages-summary'}
          sx={{
            px: 1,
            pb: 1,
            flexShrink: 0,
            color: 'var(--secondary-text)',
            fontSize: '12px',
          }}
        >
          <Box data-testid={'pages-summary-pages'}>
            {`Pages: ${thumbnails.length}`}
          </Box>
          <Box data-testid={'pages-summary-to-process'}>
            {`Tables to process: ${tablesToProcess}`}
          </Box>
          <Box data-testid={'pages-summary-completed'}>
            {`Tables completed: ${tablesCompleted}`}
          </Box>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {thumbnails.map((thumb, index) => (
            <Box
              key={index}
              data-testid={'thumbnail'}
              onClick={() => onThumbnailClick(index)}
              sx={{
                cursor: 'pointer',
                p: 0.5,
                border:
                  index === selectedPage
                    ? '2px solid #1976d2'
                    : '2px solid transparent',
              }}
            >
              <Box
                data-testid={'thumbnail-page-title'}
                sx={{
                  color: 'var(--primary-text)',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                {`Page ${index + 1}`}
              </Box>
              <Box
                data-testid={'thumbnail-page-tables'}
                sx={{ color: 'var(--secondary-text)', fontSize: '12px' }}
              >
                {/* Counted from the live tables state (the same list the thumbnail's
                    borders are drawn from), so an edit is reflected without a save. */}
                {tableCountLabel(thumbnailTablesOnPage(index).length)}
              </Box>
              <PageImageWithOverlay
                image={thumb.image}
                thumbnailTables={thumbnailTablesOnPage(index)}
                thumbnailMergeRoles={mergeRoles}
                withGrid={false}
              />
            </Box>
          ))}
        </Box>
      </Box>

      {/* The Grid Editor and the Review panel are full-editor screens: each covers the left
          list, the centre and the thumbnails rather than sitting in the middle column. Drawn as
          an overlay so the three panels stay MOUNTED underneath, which keeps exiting instant and
          the thumbnails un-refetched.

          Grid Editor mode: the Link tables feature. Mounted only while a link target resolves,
          so its image cache and internal state are discarded on exit. rootTable comes from the
          live `tables` list, so it always reflects current edits.

          Review mode: the panel dispatches the extraction for this table and polls for the
          merged result. The document was saved before the mode was entered (handleReview), so
          the worker sees every edit. The panel can also write a MANUAL CORRECTION back into the
          local metadata: a cell of the merged grid names the source cell it came from, so
          `tables` lets the panel find that cell and `onEditTables` commits the amended list.
          Reusing the shared commit path rather than a narrow callback is deliberate — it is how
          every other edit here commits, it leaves the existing Save button as the single
          persistence point, and a text-only edit classifies as not geometry-changed, so nothing
          is recalculated. Its Export button saves the document through the host's own save and
          then leaves for the PDF list, hence onSave, originalFilename and onAllFiles. */}
      {!error && centreMode !== 'editor' && (
        <Box
          data-testid={'full-panel'}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            backgroundColor: 'var(--background)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {centreMode === 'link' ? (
            <TableLinkageEditor
              pdfId={pdfId}
              rootTable={linkRootTable}
              tables={tables}
              onCancel={() => setLinkRootId(null)}
              onSave={(nextTables) => {
                onEditTables(nextTables); // sets tables + dirty
                setLinkRootId(null);
              }}
            />
          ) : (
            <ReviewTablePanel
              pdfId={pdfId}
              tableId={reviewTableId}
              tables={tables}
              onEditTables={onEditTables}
              onExit={() => setReviewTableId(null)}
              onSave={handleSave}
              originalFilename={pdfName}
              onAllFiles={onAllFiles}
            />
          )}
        </Box>
      )}

      <Menu
        open={Boolean(reinstateMenu)}
        onClose={() => setReinstateMenu(null)}
        anchorReference={'anchorPosition'}
        anchorPosition={
          reinstateMenu
            ? { top: reinstateMenu.clientY, left: reinstateMenu.clientX }
            : undefined
        }
      >
        <MenuItem onClick={handleReinstate}>{'Reinstate'}</MenuItem>
      </Menu>
    </Box>
  );
}
