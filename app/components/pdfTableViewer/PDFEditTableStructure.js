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
  tableToExcel,
} from 'services/images';
import {
  excelFilename,
  exportableTableIds,
  exportableTables,
  saveBlob,
} from 'components/pdfTableViewer/exportUtils';
import {
  allExportReady,
  isExportReady,
} from 'components/pdfTableViewer/exportReadinessUtils';
import {
  boundaryPassScreenId,
  confirmedTableStage,
  contentsPassScreenId,
  documentOverviewEntryHelpId,
  documentOverviewExportHelpId,
  documentOverviewHelpId,
  documentOverviewLinkHelpId,
  documentOverviewReviewHelpId,
  documentOverviewSaveHelpId,
  highConfidence,
  includeDeletedHelpId,
  linkTablesScreenId,
  pagesColumnHelpId,
  readyTableStage,
  resizeDebounceMs,
  reviewTableScreenId,
  sectionTitlePlaceholderColumnName,
  stagedGridEditorEnabled,
} from 'config';
import useScreenHelp from 'components/help/useScreenHelp';
import { useEditorPass } from 'components/EditorPassProvider';
import { linkedMembers } from 'components/pdfTableViewer/gridUtilities';
import {
  buildCalcCellsRequestTable,
  canJoinLinkGroup,
  findTableById,
  fillGridCells,
  mergeCalcCellsResponse,
  mergeRolesByTableId,
  normaliseTableBounds,
  overlaps,
  removeFromLinkGroup,
  tableCountLabel,
  tableSizeLabel,
  tablesOnPage,
  tablesWithLostConfidence,
} from 'components/pdfTableViewer/tableSupportUtils';
import { layerDataChanged } from 'components/pdfTableViewer/layerUtils';
import { PageImageWithOverlay } from 'components/pdfTableViewer/PageImageWithOverlay';
import AdditionalTablesList from 'components/pdfTableViewer/AdditionalTablesList';

// Classify how a table changed between its pre-edit (`before`) and post-edit (`after`)
// snapshots, for the per-table change set. A table counts as changed when it was
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
// except `confirmationStage` and `next`, normalised so neither can affect the result.
//
// That guard's job is to protect edits the USER made while a backgrounded recalculation was in
// flight, so that a response carrying old text cannot overwrite them. A confirmationStage
// advance is not such an edit — it touches nothing the response writes back — and it MUST be
// excluded, because the Special Areas tick advances the stage through onChange and performs the
// Next action in the SAME event. The recalculation is therefore always launched from a render
// that predates its own trigger's stage write, so a whole-table comparison would find every
// such snapshot stale and silently discard the response — losing the title text, the re-read
// cell text and the special areas' text for every page left by confirming Special Areas.
//
// `next` is excluded for the same reason and one of its own. A saved link grid nests every
// joined table under its root, so including it made a root's comparison cover the whole group:
// any edit to any member — even a rename, which the response cannot write — silently discarded
// the ROOT's entire reading, title included. A single table has no such surface, which is why
// this only ever showed on a linked group. The response never writes into `next` (the merge
// spreads it through untouched), so it is neither what the guard protects nor anything the
// reading depends on.
//
// Excluding it makes the write-back responsible for `next` instead: the replacement was built
// from the LAUNCH snapshot and carries the launch-time children, so it must take the LIVE map
// rather than reinstate them — exactly as it already does for confirmationStage.
function recalcComparable(table) {
  return JSON.stringify({ ...table, confirmationStage: null, next: null });
}

// The rectangles a table asks to have read that are not cells: its title, and each of its
// section titles' value areas. Both are drawn by hand and seeded empty, and both are read by
// the same calculate-cells call.
function readableRegionBounds(table) {
  return JSON.stringify([
    table?.title?.bounds ?? null,
    (table?.sectionTitles ?? []).map(
      (sectionTitle) => sectionTitle?.data?.bounds ?? null
    ),
  ]);
}

// Every table whose readable rectangles are new or have moved, which is the edit that
// creates a region needing to be read. One that gained text at the same bounds has been
// corrected, not redrawn.
//
// Joined members are walked as well as top-level tables: a member's edit arrives as a change
// to its ROOT, so comparing roots alone would miss a rectangle drawn on one — and a member
// sits on its own page, so it is its own recalculation target.
function tablesWithNewRegions(before, after) {
  const found = [];
  if (!after.deleted && readableRegionBounds(before) !== readableRegionBounds(after)) {
    found.push(after);
  }
  const beforeMembers = before?.next ?? {};
  for (const [id, member] of Object.entries(after.next ?? {})) {
    if (
      !member.deleted &&
      readableRegionBounds(beforeMembers[id]) !== readableRegionBounds(member)
    ) {
      found.push(member);
    }
  }
  return found;
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

// Which of the editor's four screens the user is looking at, for the help overlay. The
// internal names and the users' names for these do not line up: the screen the user calls
// the GRID EDITOR is `centreMode === 'link'`, not the contents pass — and it is the
// contents pass whose own mode is the one called `grid`.
function editorHelpScreenId(centreMode, editorMode) {
  if (centreMode === 'link') {
    return linkTablesScreenId();
  }
  if (centreMode === 'review') {
    return reviewTableScreenId();
  }
  return editorMode === 'grid' ? contentsPassScreenId() : boundaryPassScreenId();
}

export default function PDFEditTableStructure({ pdfId, onAllFiles }) {
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbnailsLoaded, setThumbnailsLoaded] = useState(false);
  // Bumped after every successful save. Everything the back end renders from the stored
  // document is stale at that moment, so this one signal drives both consumers: the
  // right-column thumbnails re-fetch (the server renders them from page.tables) and the
  // centre editor drops its page-image cache and reloads what is on screen.
  const [savedRevision, setSavedRevision] = useState(0);
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
  // Whether the document is being exported, which disables the button so a second click
  // cannot start a second workbook.
  const [exporting, setExporting] = useState(false);
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
  // so the centre overlay can draw a transient preview of that table's grid.
  // Distinct from selectedTableId (the centre-hover -> left-highlight path, unchanged).
  const [hoveredDeletedTableId, setHoveredDeletedTableId] = useState(null);
  // Popup menu for a clicked DELETED left-list row: single "Reinstate" item, anchored at
  // the click. { tableId, clientX, clientY } | null.
  const [reinstateMenu, setReinstateMenu] = useState(null);
  // tableId of the table the Grid Editor is open for (null when closed). That panel
  // (TableLinkageEditor) is mounted only while this is set, so its image cache and internal
  // state are discarded when it closes. Reset per pdfId with the rest of the per-document
  // state.
  const [linkRootId, setLinkRootId] = useState(null);
  // Which pass the centre editor is in, reported up by PageTableEditor. The Pages list picks
  // the tables that join a linked group, which is boundary-pass work, so the contents pass
  // does not show it.
  const [editorMode, setEditorMode] = useState('border');
  // The toolbar's pass tabs live outside this tree, so the pass reaches them through the
  // editor-pass context. Absent outside a provider, which a test that renders this
  // component alone is.
  const editorPass = useEditorPass();
  const setEditorPass = editorPass ? editorPass.setPass : null;
  // tableId of the root whose linked-tables list is expanded in the Document Overview, or
  // null when none is. Either size line opens it — "Additional tables N" and "A × B
  // Tables" behave the same way. Only one is open at a time: the list is a way of reaching a linked
  // table, not a layout the user arranges.
  const [expandedNextRootId, setExpandedNextRootId] = useState(null);
  // tableId of the table rooting an open LINKING session, or null when none is open. A
  // session spans the middle panel (whose Link label opens and ends it) and the right-hand
  // thumbnails (where the tables that join the group are clicked), so it is held here, their
  // only common ancestor. Reset per pdfId with the rest of the per-document state.
  const [linkingRootId, setLinkingRootId] = useState(null);
  // tableId of the table the middle panel is REVIEWING (null when not in review mode). Set by
  // the left column's Review button, but only after the document has been saved — see
  // handleReview. Reset per pdfId with the rest of the per-document state.
  const [reviewTableId, setReviewTableId] = useState(null);
  // Per-entry refs keyed by tableId so the selected entry can be scrolled into
  // the left panel's scroll area.
  const entryRefs = useRef({});
  // The centre editor's `leaveFor`, registered by it. Null while the editor is not mounted
  // (the review and linking panels), in which case there is nothing held to settle.
  const leaveEditorRef = useRef(null);
  const registerLeave = useCallback((fn) => {
    leaveEditorRef.current = fn;
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
    setLinkingRootId(null);
    setExpandedNextRootId(null);
    setEditorMode('border');
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
  }, [pdfId, rightWidth, savedRevision]);

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

  // Ask for a save once React has applied whatever the caller just changed. A save called
  // directly from a handler reads the state of the render it was created in, so a flush's
  // setTables — or a recalculation's write-back — would not be in it. Bumping this counter is
  // batched with those updates, so the effect below runs in a render that has them all.
  const [saveRequest, setSaveRequest] = useState(0);
  const requestSave = useCallback(() => setSaveRequest((n) => n + 1), []);

  useEffect(() => {
    if (saveRequest === 0) return;
    handleSave();
    // handleSave is redefined every render; depending on it would save on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRequest]);

  // Closing, reloading or navigating away from the tab discards everything unsaved, and no
  // handler here can prevent that: the browser allows only a synchronous prompt, not a save.
  // Warning is therefore the most that can be done, and it is worth doing — every other exit
  // now saves, so an unsaved document at this point means the tab is being closed on work
  // that would otherwise have been kept.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      // Set for the browsers that still read it; modern ones show their own wording.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Persist the current table list. On success the edit state is clean again; on
  // failure the error is surfaced and dirty is left set so the user can retry.
  //
  // Returns whether the save reached the server. The top Save button ignores that (a failure
  // is already a toast, and dirty is left set), but handleReview must not open the review
  // panel on a document the worker cannot see — hence the boolean rather than a bare void.
  //
  // `flushed` is what a flush made in the SAME handler reported ({ tables, colouredAreaPage }).
  // Its setState has not re-rendered this component yet, so `tables`/`pages` here still hold the
  // pre-flush values and the save would drop the very edit that prompted it. Given the flush's
  // own values, they are used instead. A save with nothing flushed passes nothing.
  const handleSave = async (flushed) => {
    setSaving(true);
    try {
      const tablesToSave = flushed?.tables ?? tables;
      // Send every page that carries a coloured-areas array (including an empty one,
      // so clearing a page's areas is persisted). Pages that never had the field are
      // omitted and left untouched server-side.
      const flushedPage = flushed?.colouredAreaPage ?? null;
      const colouredAreas = (pages || [])
        .map((p) =>
          flushedPage && p.page === flushedPage.page
            ? { ...p, colouredAreas: flushedPage.areas }
            : p
        )
        .filter((p) => Array.isArray(p.colouredAreas))
        .map((p) => ({ pdfPage: p.page, colouredAreas: p.colouredAreas }));
      await saveTables(pdfId, tablesToSave, colouredAreas);
      setDirty(false);
      setChangedTableIds({});
      // The save scatters the edited tables into page.tables server-side and stores the
      // page coloured areas, and both the thumbnails and the centre editor's page image are
      // rendered from those — so mark every fetched rendering stale and reload what is on
      // screen (borders, size labels, low-confidence lines, coloured-area flattening).
      setSavedRevision((n) => n + 1);
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
    const beforeById = new Map(tables.map((t) => [t.tableId, t]));
    // A title or section-title rectangle the user has just drawn or moved is a region they
    // have asked to have read, and nothing else reads it: the page-exit recalculation would,
    // but only once the page is left, so a rectangle drawn and left alone stays unread —
    // empty text at no confidence — which flags it for review and holds the document out of
    // Ready for Export.
    //
    // Only the BOUNDS are watched. A value whose text changed is a correction the user typed
    // on the review screen, and re-reading it would be asking the extraction to second-guess
    // them; mergeCalcCellsResponse refuses to overwrite a manually entered reading anyway,
    // so the call would be pure waste.
    const drawnTitles = nextTables.flatMap((after) =>
      tablesWithNewRegions(beforeById.get(after.tableId), after)
    );
    const drawnTitleIds = new Set(drawnTitles.map((t) => t.tableId));

    // A coloured-area edit decides how its region is flattened before it is read, so
    // zeroConfidenceInRects strips the confidence from every value under it. Without this the
    // value stayed flagged for ever while still holding the text of the OLD flattening:
    // colours are page-scoped, so classifyTableChange never sees the edit — it asks
    // layerDataChanged, which returns false for 'colours' by design — and the table never
    // reached the page-exit recalculation that would have re-read it.
    //
    // Adding it to the change set is all that is owed, and the read stays where every other
    // edit's is. Reading on the spot, as a drawn title is, would be wrong here: a colour
    // session commits on every add, delete, resize and colour pick, so it would fire a call
    // per mutation and the staleness guard would discard all but the last.
    const invalidatedIds = nextTables.flatMap((after) =>
      tablesWithLostConfidence(beforeById.get(after.tableId), after).map(
        (t) => t.tableId
      )
    );

    setChangedTableIds((prev) => {
      const updated = { ...prev };
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
      for (const id of invalidatedIds) {
        updated[id] = { titleChanged: updated[id]?.titleChanged ?? false };
      }
      // A table about to be read on the spot owes no page-exit read: the request carries the
      // whole table, so the immediate call covers whatever else had changed on it too.
      for (const id of drawnTitleIds) delete updated[id];
      return updated;
    });
    setTables(nextTables);
    setDirty(true);

    for (const page of new Set(drawnTitles.map((t) => t.pdfPage))) {
      recalcPageTables(
        page,
        drawnTitles.filter((t) => t.pdfPage === page).map((t) => t.tableId),
        nextTables
      );
    }
  };

  // Recalculate the listed tables of ONE page: the single place every recalculation trigger
  // routes through, so a further cause (the specification anticipates more, yet to be defined)
  // is one call rather than a copy of this body. `recalcPage` is the 0-based page and
  // `tableIds` the ids to consider — non-existent ids, ids on another page and soft-deleted
  // tables are dropped here, so a caller can simply hand over its whole change set.
  // `sourceTables` is the list to read those tables out of, defaulting to the current state;
  // a caller reacting to an edit passes the post-edit list, because the state it would
  // otherwise be read from is the pre-edit one until React applies the update.
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
  const recalcPageTables = (recalcPage, tableIds, sourceTables = tables) => {
    const ids = new Set(tableIds);
    // Joined members are candidates too. A member is off the top-level list, so taking that
    // list alone left it unreadable for ever: a rectangle drawn on one after it was joined
    // stayed unread, which silently held its root out of "Ready for Export". A member sits
    // on its own page, so it is matched on that page like any other table.
    const candidates = sourceTables.flatMap((t) => [
      t,
      ...Object.values(t.next ?? {}),
    ]);
    const changedOnPage = candidates.filter(
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
        // Take the reading for one table, wherever it lives. Returns the table unchanged
        // when there is no reading for it, when the user has edited it since the call
        // launched, or when the reading says nothing new.
        const takeReading = (t) => {
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
          // The replacement was built from the LAUNCH snapshot, so its confirmationStage and
          // its `next` map are both the pre-launch ones. Keep the live values: the tick that
          // triggered this call has since advanced the stage, and reverting that would untick
          // Special Areas — while `next` is no longer covered by the staleness guard above,
          // so reinstating the launch-time children would silently undo an edit made to one
          // of them while this call was in flight.
          return {
            ...replacement,
            confirmationStage: t.confirmationStage,
            ...('next' in t ? { next: t.next } : {}),
          };
        };

        setTables((prev) =>
          prev.map((top) => {
            const root = takeReading(top);
            const members = root.next;
            if (!members) return root;
            let memberChanged = false;
            const nextMembers = {};
            for (const [id, member] of Object.entries(members)) {
              const taken = takeReading(member);
              if (taken !== member) memberChanged = true;
              nextMembers[id] = taken;
            }
            return memberChanged ? { ...root, next: nextMembers } : root;
          })
        );
        if (wrote) setDirty(true);
        // The page exit that launched this has already saved what leaving settled; this
        // reading arrived afterwards, so it needs a save of its own or it is held only in
        // the browser until the next one.
        //
        // Asked for unconditionally rather than under `wrote`. That flag is assigned inside
        // the setTables updater above, and React only runs an updater eagerly while the fiber
        // has no update pending — which the save this page exit already asked for makes false.
        // Reading it here would therefore see `false` whether or not anything was written. A
        // save with nothing to send is one wasted PUT; a reading silently left unsaved is
        // the defect this whole change is about.
        requestSave();
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

    // Settle the page being left before anything else: what the centre editor holds
    // provisionally — a moved border, a coloured area — reaches the document, and any
    // grid-lines rebuild the boundary pass owes is made and merged first. Without this the
    // page-change effect in PageTableEditor discards the held move, which is why a boundary
    // set and then left by thumbnail never took effect.
    const settle = leaveEditorRef.current ?? ((move) => move(null));

    settle(() => {
      // Advance immediately, clearing the change set for the page we are leaving. The page
      // moves before the save so navigation is never blocked on the round trip.
      setChangedTableIds({});
      setSelectedPage(nextPage);

      recalcPageTables(recalcPage, changedIds);
      // Persist what leaving settled. Requested rather than called, so the flush above is in
      // the saved list; the recalculation asks for its own save when its write-back lands,
      // since that arrives long after this handler has returned. A failed save raises its own
      // toast and leaves `dirty` set, and the user is already on the next page.
      requestSave();
    });
  };

  // Layers-panel Previous/Next reaching the end of a page. The document itself wraps: past
  // the last page is the first, and before the first is the last, so walking Next long
  // enough returns to where it started rather than stopping at a "End of list" message.
  const onPrevPage = () => {
    const last = Math.max(thumbnails.length - 1, 0);
    recalcAndGoToPage(selectedPage <= 0 ? last : selectedPage - 1);
  };
  const onNextPage = () => {
    const last = Math.max(thumbnails.length - 1, 0);
    recalcAndGoToPage(selectedPage >= last ? 0 : selectedPage + 1);
  };

  // A right-column thumbnail click is a page change like Prev/Next, so it recalculates the
  // page being left too. Clicking the page already displayed leaves no page, so it does
  // nothing.
  // While a panel (grid editor / review) owns the middle panel there is no page editor to
  // move, so a thumbnail click is ignored rather than silently changing the page behind the
  // panel — which would also fire a recalculation for a page the user cannot see.
  const onThumbnailClick = (index) => {
    if (centreMode !== 'editor') return;
    // While a linking session is open a thumbnail click picks a table to join the group, so
    // the normal page-changing function of the click is disabled.
    if (linkingRootId != null) return;
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

  // Mark one prepared table "ready": advance its confirmationStage to readyTableStage(),
  // one above the five-row Layers ladder's maximum (confirmedTableStage()). Routed through
  // onEditTables like every other edit, so the document becomes dirty and the new stage is
  // persisted by the next Save — this button does NOT PUT anything itself. Every other
  // table, and every other field of this one, is preserved.
  //
  // Nothing demotes a ready table any more: no editor control writes confirmationStage, so
  // a table stays ready until this button is used again or its link is undone.
  const handleMarkReady = (tableId) => {
    onEditTables(
      tables.map((t) =>
        t.tableId === tableId
          ? { ...t, confirmationStage: readyTableStage() }
          : t
      )
    );
  };

  // Leaving the editor for the PDF list unmounts everything, and the document's state goes
  // with it. Settle and save first, for the same reason a page change does; the move is made
  // whether or not the save succeeded, because the failed save has raised its own toast and
  // refusing to navigate would trap the user in the editor.
  const handleAllFiles = () => {
    const settle = leaveEditorRef.current ?? ((move) => move(null));
    settle(async (flushed) => {
      await handleSave(flushed);
      onAllFiles();
    });
  };

  // Review the extracted output of a ready table: SAVE FIRST, then hand the middle panel over
  // to the review panel, which dispatches the extraction and polls for the merged table.
  //
  // The save is not optional. The extraction runs in a worker that reads this document's
  // metadata from S3, so anything still local — every pending edit, and in particular the
  // stage advance the Mark Ready button just made — would be invisible to it. A failed save
  // therefore aborts: the toast handleSave raised is the user's feedback and the editor stays
  // put. Re-entrancy is guarded on `saving`, so a double click cannot fire two PUTs.
  const handleReview = (tableId) => {
    if (saving) return;
    // Settle before saving: the review panel replaces the centre editor, so anything it still
    // holds provisionally would be discarded on the way out and the worker would read a
    // document without it.
    const settle = leaveEditorRef.current ?? ((move) => move(null));
    settle(async (flushed) => {
      const saved = await handleSave(flushed);
      if (!saved) return;
      setLinkRootId(null);
      setReviewTableId(tableId);
    });
  };

  // Export the whole document: SAVE FIRST, then build one workbook covering every table
  // still in the document.
  //
  // The save is not optional, for the reason handleReview's is not: the back end rebuilds
  // every table from this document's metadata in S3, so anything still local would be
  // invisible to it and the workbook would describe a document the user is not looking at.
  // A failed save has already raised its own toast, so the export is simply abandoned.
  //
  // Unlike the Export this replaces, it does not leave for the PDF list. The export is now
  // a document-level action reachable at any time, and taking the user out of the editor
  // for saving a copy of their work would be surprising.
  const handleExport = async () => {
    if (saving || exporting) return;
    setExporting(true);
    try {
      // Settle first, for the reason handleReview does: the workbook is built from stored
      // metadata, so a held border move would be missing from it.
      const settle = leaveEditorRef.current ?? ((move) => move(null));
      const flushed = await new Promise((resolve) => settle(resolve));
      const saved = await handleSave(flushed);
      if (!saved) return;
      const filename = excelFilename(pdfName);
      const workbook = await tableToExcel({
        pdfId,
        rootTableIds: exportableTableIds(tables),
        filename,
      });
      saveBlob(workbook, filename);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  // Take the pass the centre editor reports. Entering the contents pass ends any open linking
  // session: its End Linking label is inert there and the Pages list it picks from is gone, so
  // a session left open could not be ended.
  const handleEditorModeChange = useCallback((mode) => {
    setEditorMode(mode);
    if (mode !== 'border') setLinkingRootId(null);
  }, []);

  // A Pages-list click during an open linking session, which either ADDS the table to the
  // session's group or TAKES IT BACK OUT again — the one click does both, because the same
  // thumbnail is how a group is built up and how it is corrected.
  //
  // Adding puts the table into the root's `next` map, keyed by its tableId, and takes it off
  // the top-level list — which is what removes it from the Document Overview, since that list
  // is what the left panel renders. Removing is removeFromLinkGroup, the exact reverse.
  //
  // `grid` is deliberately NOT written when adding. buildSaveTables writes it separately
  // because the Grid Editor lays a group out as a grid; this flow has no layout to record.
  // A root with `next` and no `grid` still reads as amalgamated everywhere (isAmalgamated
  // tests both), and tableSizeLabel gates its "N × M Tables" line on a saved grid, so no
  // bogus size appears.
  const handleJoinLinkGroup = (tableId) => {
    const root = tables.find((t) => t.tableId === linkingRootId);
    // Looked up through `next` as well as the top level: a thumbnail draws the tables joined
    // under another table's grid too, so a click can land on one. Found, it is refused by
    // canJoinLinkGroup with a message; not found, the click would fail silently.
    const table = findTableById(tables, tableId);
    if (!root || !table) return;
    // A member of THIS session's group leaves it. Only this group's: another group's members
    // are not the open session's to edit, and fall through to the refusal below, as does the
    // root itself — a root is never a key of its own `next` map.
    if (root.next?.[tableId]) {
      onEditTables(removeFromLinkGroup(tables, root.tableId, tableId));
      return;
    }
    const roles = mergeRolesByTableId(tables);
    if (!canJoinLinkGroup(table, root, roles)) {
      // Name the cause, not just the refusal: the three reasons are indistinguishable on
      // screen, so "cannot join" alone leaves the user with nothing to act on.
      const reason =
        table.tableId === root.tableId
          ? 'is the root of this group'
          : roles[table.tableId]
            ? 'is already in a linked group'
            : 'is above the root of this group';
      toast(`${table.name} ${reason}`);
      return;
    }
    onEditTables(
      tables
        .filter((t) => t.tableId !== table.tableId)
        .map((t) =>
          t.tableId === root.tableId
            ? { ...t, next: { ...(t.next ?? {}), [table.tableId]: table } }
            : t
        )
    );
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

  // One registration for all four editor screens: which one it is follows the centre mode
  // and the pass the page editor reports through onEditorModeChange, so the pass is not a
  // second call site of its own.
  useScreenHelp(editorHelpScreenId(centreMode, editorMode));

  // The toolbar's two pass tabs are drawn from this. Reported from here rather than from
  // the page editor, because the pass is still the pass while a full panel stands over
  // that editor — and this is the component that knows both.
  useEffect(() => {
    if (!setEditorPass) {
      return undefined;
    }

    setEditorPass(editorMode);

    return () => setEditorPass(null);
  }, [setEditorPass, editorMode]);

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
        data-testid={'left-panel'}
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
            data-testid={'save-document'}
            data-help-id={documentOverviewSaveHelpId()}
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
            data-help-id={includeDeletedHelpId()}
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
        <Box
          data-help-id={documentOverviewHelpId()}
          sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          {listedTables.map((t) => {
            const nameColour = t.deleted
              ? 'var(--secondary-text)'
              : 'var(--primary-text)';
            // One call per entry, destructured: sizeLine is always present, tablesLine
            // only for a table with a saved link grid.
            const { sizeLine, tablesLine } = tableSizeLabel(t);
            // The tables this root holds in `next`, whether or not a grid has been laid
            // out for them, and whichever of them is currently selected for editing. A root
            // whose linked table is being edited is boxed as though it were itself selected,
            // because that is where the edit is happening as far as this list is concerned.
            const linked = linkedMembers(t);
            // A root holding linked tables is marked ready from the Grid Editor, whose Ready
            // button is refused until every member of the group has a place in the grid.
            // Offering Mark Ready here would be a way round that gate.
            const holdsLinked = Object.keys(t.next ?? {}).length > 0;
            // Nothing in this table, or in the group it heads, is still flagged for the
            // user's attention. Derived from the confidences on every read rather than
            // stored: a re-extraction can lower one, and a stage recorded while the table
            // was clean would outlive the fact it recorded.
            const exportReady = isExportReady(
              t,
              highConfidence(),
              readyTableStage(),
              sectionTitlePlaceholderColumnName()
            );
            const editing = linked.find((x) => x.tableId === selectedTableId) ?? null;
            return (
              <Box
                key={t.tableId}
                ref={(el) => {
                  entryRefs.current[t.tableId] = el;
                }}
                data-testid={'table-entry'}
                data-help-id={documentOverviewEntryHelpId()}
                data-editing={editing ? 'true' : 'false'}
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
                    t.tableId === selectedTableId || editing
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
                    onClick={
                      linked.length
                        ? (e) => {
                            // A SIBLING of the name Box, so this click never starts the
                            // inline rename; it also must not fall through to the entry's
                            // own click, which would select the root.
                            e.stopPropagation();
                            setExpandedNextRootId((current) =>
                              current === t.tableId ? null : t.tableId
                            );
                          }
                        : undefined
                    }
                    sx={{
                      color: 'var(--secondary-text)',
                      fontSize: '12px',
                      cursor: linked.length ? 'pointer' : 'default',
                    }}
                  >
                    {tablesLine}
                  </Box>
                ) : null}
                {expandedNextRootId === t.tableId && linked.length ? (
                  <AdditionalTablesList
                    tables={linked}
                    selectedTableId={selectedTableId}
                    onSelect={onTableEntryClick}
                  />
                ) : null}
                {/* Which of this root's additional tables is open in the centre panel. */}
                {editing ? (
                  <Box
                    data-testid={'table-entry-editing'}
                    sx={{
                      color: 'var(--primary-text)',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                  >
                    {`${editing.name} being edited`}
                  </Box>
                ) : null}
                {/* Button row, below every text line and a SIBLING of the name Box (never
                    inside it) — the name Box's onClick starts the inline rename, so a
                    nested control would begin a rename when clicked. Rendered only for
                    non-deleted rows: a deleted row offers no stage button and no Link
                    button, its click opening the Reinstate menu instead.

                    The stage button: "Mark Ready" until readyTableStage() has been
                    reached, and from then on the review button — reading "Ready for
                    Export" once nothing in the table is still flagged, and "Review" while
                    something is. Only the LABEL changes: looking again at a table that
                    needs no correction must stay possible.

                    The link icon is offered only on a root that holds linked tables. The
                    Grid Editor it opens has nothing to lay out for a table holding none,
                    and a group is built through the Layers panel's linking session rather
                    than through this icon, so hiding it strands nobody. */}
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
                        data-help-id={documentOverviewReviewHelpId()}
                        size={'small'}
                        variant={'outlined'}
                        sx={{ fontSize: '11px', py: 0, minWidth: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReview(t.tableId);
                        }}
                      >
                        {exportReady ? 'Ready for Export' : 'Review'}
                      </Button>
                    ) : holdsLinked ? null : (
                      <Button
                        data-testid={'mark-ready'}
                        data-help-id={documentOverviewReviewHelpId()}
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
                    )}
                    {/* Spacer so the Link button sits at the right-hand end of the row
                        whether or not a stage button is present. */}
                    <Box sx={{ flexGrow: 1 }} />
                    {holdsLinked && (
                      <IconButton
                        data-testid={'link-table'}
                        data-help-id={documentOverviewLinkHelpId()}
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
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        {/* Pinned at the foot, mirroring Save at the head: one workbook covering every table
            still in the document, whichever one happens to be selected.

            Held back until every table it would cover is ready for export — there is no
            point exporting a document the user has not finished with — and until there is
            something to cover at all. */}
        <Box sx={{ p: 1, flexShrink: 0 }}>
          <Button
            data-testid={'export-document'}
            data-help-id={documentOverviewExportHelpId()}
            variant={'contained'}
            size={'small'}
            fullWidth
            disabled={
              saving ||
              exporting ||
              exportableTables(tables).length === 0 ||
              !allExportReady(
                exportableTables(tables),
                highConfidence(),
                readyTableStage(),
                sectionTitlePlaceholderColumnName()
              )
            }
            onClick={handleExport}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
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
                    onClick={handleAllFiles}
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
            onSave={handleSave}
            onHoverTable={setSelectedTableId}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTableId}
            hasPrevPage={selectedPage > 0}
            hasNextPage={selectedPage < thumbnails.length - 1}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            onColouredAreasChange={handleColouredAreasChange}
            savedRevision={savedRevision}
            linkingRootId={linkingRootId}
            onToggleLinking={setLinkingRootId}
            onEditorModeChange={handleEditorModeChange}
            onRegisterLeave={registerLeave}
            deletedPreview={
              tables.find(
                (t) => t.tableId === hoveredDeletedTableId && t.deleted
              ) ?? null
            }
          />
        )}
      </Box>

      {/* Right panel — PAGES thumbnails. Hidden in the contents pass: its function is picking
          the tables that join a linked group, which belongs to the boundary pass. */}
      {editorMode === 'border' && (
      <Box
        ref={rightRef}
        data-help-id={pagesColumnHelpId()}
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
                onThumbnailTableClick={
                  linkingRootId != null ? handleJoinLinkGroup : null
                }
                withGrid={false}
              />
            </Box>
          ))}
        </Box>
      </Box>
      )}

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
          is recalculated. Its Exit saves the document through the host's own save before it
          hands the panel back, hence onSave; exporting lives on the Document Overview. */}
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
