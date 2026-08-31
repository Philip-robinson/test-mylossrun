'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  TextField,
} from '@mui/material';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';
import toast from 'react-hot-toast';
import {
  findTables,
} from 'services/images';
import {
  confirmedTableStage,
  deletedGridLineColour,
  gridLineColour,
  highConfidence,
  hitLineWidthPx,
} from 'config';
import {
  newUUID,
} from 'common/utils';
import {
  hasSavedGrid,
} from 'components/pdfTableViewer/gridUtilities';
import ConfirmedTickBadge from 'components/pdfTableViewer/ConfirmedTickBadge';
import MergeLinkBadge from 'components/pdfTableViewer/MergeLinkBadge';
import LinkedGroupOutline from 'components/pdfTableViewer/LinkedGroupOutline';
import {
  CONFIDENCE_COLOUR_VARS,
  buildCalcHint,
  buildCalcReplacement,
  buildRecalcHint,
  cellAt,
  chooseCellTextPlacement,
  clampBoundaryTarget,
  cleanupAxis,
  confidenceColour,
  cumulative,
  distanceOutsideTable,
  identityMap,
  makeDefaultCell,
  mergeCells,
  mergeMap,
  mergeRecalcCells,
  metadataTableToThumbnailOverlay,
  moveDivider,
  overlaps,
  pickCalcResultTable,
  recalcShortfallMessage,
  reconcileAxisEdit,
  resizeBoundary,
  selectLowConfidenceCells,
  splitEntry,
  splitMap,
  splitMapBelow,
} from 'components/pdfTableViewer/tableSupportUtils';

// data-testid marker on the transparent wide-stroke hit lines that sit on top of
// the visible geometry to receive pointer events. Visible <rect>/<line> elements
// never carry it, so tests can select each set independently.
const HIT_LINE_TESTID = 'hit-line';

// Cell editor textarea sizing (in `ch`, independent of the cell's column width): text under
// 30 chars gets its length plus a little breathing room; longer text is capped at 30 chars;
// MIN_CH is the floor so an empty or very short cell still opens a usable box. The initial
// width is min(30, max(text.length + EDITOR_WIDTH_PADDING_CH, MIN_CH)) ch.
const MIN_CH = 8;
const EDITOR_WIDTH_PADDING_CH = 3;
const EDITOR_MAX_CH = 30;

// Internal grid dividers for one table. The final cumulative value on each axis
// is dropped because it coincides with the rectangle's far edge already drawn by
// the <rect>.
function gridLines(t, colour = gridLineColour()) {
  const vlines = cumulative(t.columnWidths)
    .slice(0, -1)
    .map((c) => t.left + c);
  const hlines = cumulative(t.rowHeights)
    .slice(0, -1)
    .map((c) => t.top + c);

  return (
    <>
      {vlines.map((x, i) => (
        <line
          key={`v${i}`}
          x1={x}
          y1={t.top}
          x2={x}
          y2={t.top + t.height}
          stroke={colour}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        />
      ))}
      {hlines.map((y, i) => (
        <line
          key={`h${i}`}
          x1={t.left}
          y1={y}
          x2={t.left + t.width}
          y2={y}
          stroke={colour}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        />
      ))}
    </>
  );
}

// Transparent wide-stroke hit lines drawn on top of one table's visible geometry so
// the boundary edges and internal grid lines can receive pointer events. Purely a
// pointer target: stroke is transparent, width is a fixed screen px (non-scaling), and
// pointerEvents:'stroke' means only the drawn stroke is hittable (not the empty box a
// <line> would otherwise expose). Each line carries a static identity (kind, tableId,
// and for internal lines the 1-based divider index k) so the pointer handler knows
// what was grabbed. onHit(identity, event) is attached to onMouseDown (the mouse event
// family is used for the whole drag gesture — down here, move/up on window — because
// jsdom does not construct PointerEvents carrying clientX).
function hitLines(t, onHit) {
  const vInner = cumulative(t.columnWidths)
    .slice(0, -1)
    .map((c) => t.left + c); // internal vertical dividers, x positions
  const hInner = cumulative(t.rowHeights)
    .slice(0, -1)
    .map((c) => t.top + c); // internal horizontal dividers, y positions

  const common = {
    stroke: 'transparent',
    strokeWidth: hitLineWidthPx(),
    vectorEffect: 'non-scaling-stroke',
    'data-testid': HIT_LINE_TESTID,
    style: { pointerEvents: 'stroke' },
  };

  const vLine = (x, extra, key, identity, cursor) => (
    <line
      key={key}
      x1={x}
      y1={t.top}
      x2={x}
      y2={t.top + t.height}
      {...common}
      cursor={cursor}
      onMouseDown={(e) => onHit(identity, e)}
      {...extra}
    />
  );

  const hLine = (y, extra, key, identity, cursor) => (
    <line
      key={key}
      x1={t.left}
      y1={y}
      x2={t.left + t.width}
      y2={y}
      {...common}
      cursor={cursor}
      onMouseDown={(e) => onHit(identity, e)}
      {...extra}
    />
  );

  return (
    <>
      {/* Boundary edges: left/right are vertical (ew-resize); top/bottom horizontal (ns-resize). */}
      {vLine(t.left, {}, 'b-left', { kind: 'boundary-left', tableId: t.tableId }, 'ew-resize')}
      {vLine(t.left + t.width, {}, 'b-right', { kind: 'boundary-right', tableId: t.tableId }, 'ew-resize')}
      {hLine(t.top, {}, 'b-top', { kind: 'boundary-top', tableId: t.tableId }, 'ns-resize')}
      {hLine(t.top + t.height, {}, 'b-bottom', { kind: 'boundary-bottom', tableId: t.tableId }, 'ns-resize')}
      {/* Internal vertical dividers: index k is 1-based, sitting between column k-1 and k. */}
      {vInner.map((x, i) =>
        vLine(
          x,
          {},
          `gv${i}`,
          { kind: 'grid-v', tableId: t.tableId, k: i + 1 },
          'ew-resize'
        )
      )}
      {/* Internal horizontal dividers: index k is 1-based, sitting between row k-1 and k. */}
      {hInner.map((y, i) =>
        hLine(
          y,
          {},
          `gh${i}`,
          { kind: 'grid-h', tableId: t.tableId, k: i + 1 },
          'ns-resize'
        )
      )}
    </>
  );
}

// A mouse gesture that moves less than this many SCREEN pixels between mouse-down and
// mouse-up is treated as a CLICK (open a menu); at or beyond it, the gesture is a DRAG
// (resize). The gate applies to BOTH internal grid dividers and outer boundary edges: a
// sub-threshold boundary click opens the boundary "Add" menu rather than resizing.
const CLICK_DRAG_THRESHOLD_PX = 4;

// Margin in rendered/screen pixels: a table is hovered when the pointer is within
// its area, or up to this many pixels outside the area's outer boundary.
const HOVER_PROXIMITY_PX = 2;

// Presentational: a base64 PNG with a read-only blue overlay (table rectangles,
// plus an internal column/row grid when withGrid is true). The overlay render is
// gated on the image's natural dimensions discovered on load. When onHoverTable
// is supplied (centre panel only), a table is treated as hovered when the pointer
// is within its area (or up to HOVER_PROXIMITY_PX outside it); the hovered tableId
// is reported via onHoverTable and a label is drawn above its top-left corner.
//
// Two DIFFERENT table props, in two different coordinate spaces:
//   `tables`          — viewBox pixels; the legacy centre editor's overlay geometry.
//   `thumbnailTables` — page fractions; the right column's LIVE metadata tables for this
//                       thumbnail's page, scaled to viewBox pixels here (see below). Only
//                       thumbnails supply it, and only their borders/names/ticks come
//                       from it, so the centre panel is untouched by it.
//
// `thumbnailMergeRoles` accompanies `thumbnailTables` (right column only): a plain object
// keyed by tableId holding each table's part in a merge. It has to be supplied rather than
// derived here, because whether a table sits inside another's `next` map is a
// document-wide fact and this component only ever sees one page's tables.
export function PageImageWithOverlay({
  image,
  tables,
  thumbnailTables,
  thumbnailMergeRoles = null,
  // Supplied only while a linking session is open: makes each thumbnail table clickable so
  // it can be picked to join the group. Absent, the thumbnails behave exactly as before —
  // the overlay takes no pointer events and the click reaches the page behind it.
  onThumbnailTableClick = null,
  withGrid,
  onHoverTable,
  metadataTables,
  page,
  pixelWidth,
  pixelHeight,
  onEditTables,
  deletedPreview,
  pdfId,
  onActionBusyChange,
  editableTableId = null,
}) {
  const [dims, setDims] = useState(null);
  const imgRef = useRef(null);
  // The hovered table plus its top-left position in rendered pixels, kept for the
  // absolutely-positioned HTML label (the SVG's preserveAspectRatio="none" would
  // distort text, so the label lives outside it).
  const [hovered, setHovered] = useState(null);

  // The image's live rendered size in screen px ({ width, height }), or null before it is
  // measured. Confidence-square/cell-text overlays are HTML siblings of the SVG positioned
  // in screen px, so they need the rendered size to convert page fractions (see the
  // sx/sy derivation below). Measured on load and kept fresh with a ResizeObserver.
  const [renderedSize, setRenderedSize] = useState(null);

  // The confidence square currently hovered ({ tableId, r, c }), driving the cell-text
  // overlay; null when none.
  const [cellHover, setCellHover] = useState(null);

  // The cell-text box element and its measured screen size ({ width, height }), used to
  // place the box beside the cell (below/right/above) rather than over it. Measured with a
  // layout effect after each hover so the placement decision knows the real box size.
  const cellTextRef = useRef(null);
  const [cellTextSize, setCellTextSize] = useState(null);

  // Cell-content editor popup. `cellEditor` names the cell under edit ({ tableId, r, c })
  // or null when closed; `editorText` is the working text (the textarea is controlled);
  // `editorPos` is the popup's top-left in overlay-local screen px (draggable). The DOM
  // node is measured (editorRef) to decide above/below placement; `editorDragRef` holds
  // the live header-bar drag; `editorInitRef` caches the one-off initial textarea size
  // (width in ch, row count) computed from the seeded text so native resize is not reset
  // by re-renders.
  const [cellEditor, setCellEditor] = useState(null);
  const [editorText, setEditorText] = useState('');
  const [editorPos, setEditorPos] = useState(null);
  const editorRef = useRef(null);
  const editorDragRef = useRef(null);
  const editorInitRef = useRef({ widthCh: MIN_CH, rows: 1 });

  // The overlay is interactive only when the parent supplied a commit callback
  // (mirroring how hover is gated on onHoverTable). Thumbnails pass none of these,
  // so interactive is false there and nothing below changes their behaviour.
  const interactive = Boolean(onEditTables);

  // Live boundary-drag gesture, or null when idle. Records what edge of which table is
  // being dragged and the pointer-down screen position; `moved` flips true on the first
  // move. The window move/up listeners are attached imperatively on down and removed on
  // up, so the drag continues even when the pointer leaves the SVG.
  const dragRef = useRef(null); // { kind, tableId, startClientX, startClientY, moved } | null

  // Transient popup-menu state for a clicked grid line or boundary edge. Not persisted: the
  // menu actions commit through commitTableEdit; this only drives the open MUI Menu.
  // Two variants, both anchored at clientX/clientY:
  //   internal divider: { clientX, clientY, orientation: 'vertical'|'horizontal', tableId,
  //     lineIndex } — orientation 'vertical' is a grid-v (column divider), 'horizontal' a
  //     grid-h (row divider); lineIndex is the 1-based divider index k. Renders
  //     Delete / Add Left|Right (vertical) or Delete / Add Above|Below (horizontal).
  //   boundary edge: { clientX, clientY, boundaryKind, tableId } — boundaryKind is one of
  //     boundary-left/right/top/bottom. Renders a SINGLE inward "Add" item that half-splits
  //     the nearest cell (axis sum, hence bounds, unchanged).
  const [menu, setMenu] = useState(null);

  // Delete-table confirmation dialog target, or null when closed. { tableId }.
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Calculate dialog target ({ tableId }) or null when closed, its two OPTIONAL numeric
  // field values (blank string == unset), and a busy flag covering the find-tables poll
  // latency. The dialog is offered only for a border-only (1×1) table (see calcAvailable).
  const [calcDialog, setCalcDialog] = useState(null);
  const [calcRows, setCalcRows] = useState('');
  const [calcCols, setCalcCols] = useState('');
  const [calcBusy, setCalcBusy] = useState(false);

  // Surface the Calculate/Recalculate busy flag to the parent so it can show the
  // shared middle-panel loading overlay (the same one used while the page image
  // loads) for the duration of the find-tables poll. The cleanup reports `false`
  // on unmount, so if this overlay is torn down mid-poll (e.g. the user switches
  // page) the parent's busy flag is cleared and the overlay does not stick on.
  useEffect(() => {
    if (onActionBusyChange) onActionBusyChange(calcBusy);
    return () => {
      if (onActionBusyChange) onActionBusyChange(false);
    };
  }, [calcBusy, onActionBusyChange]);

  // The browser fires a synthesized `click` (which bubbles to the <svg>) at the end of
  // every hit-line gesture — the common ancestor of the mouse-down hit line and the
  // mouse-up target is the svg. That trailing click must NOT be treated as an
  // empty-area click (it would pop the "Add table" menu after a boundary drag that was
  // released outside the table). handleDragEnd sets this on mouse-up; handleBackgroundClick
  // consumes and ignores exactly that one click. A ref (not state) so it is current the
  // instant the click fires.
  const suppressNextClickRef = useRef(false);

  // Convert a pointer event's screen coordinates to page fractions (0..1), matching
  // handleMouseMove's two-step screen -> viewbox -> fraction conversion. Returns null
  // when the geometry needed for the conversion is not yet available. X and Y scale
  // independently (preserveAspectRatio="none").
  const eventToFraction = (e) => {
    const img = imgRef.current;
    if (!img || !dims || !pixelWidth || !pixelHeight) return null;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const sx = rect.width / dims.w; // screen px per viewbox px, X
    const sy = rect.height / dims.h; // screen px per viewbox px, Y
    const vx = (e.clientX - rect.left) / sx; // viewbox X
    const vy = (e.clientY - rect.top) / sy; // viewbox Y
    const fx = vx / pixelWidth; // page fraction X
    const fy = vy / pixelHeight; // page fraction Y
    return { fx, fy };
  };

  // Empty-area click on the interactive overlay: open a one-item "Add table" menu
  // anchored at the pointer, carrying the click's page-fraction position as the new
  // table's top-left corner. Guards ensure it fires ONLY for genuine empty-area
  // clicks: a hit-line CLICK has already set `menu` in handleDragEnd (swallowed by
  // the menu-open guard), and a drag mid-flight leaves dragRef set.
  const handleBackgroundClick = (e) => {
    if (!interactive) return; // defensive; onClick is only wired when interactive
    if (suppressNextClickRef.current) {
      // Swallow the click that trails a just-completed hit-line drag/click gesture.
      suppressNextClickRef.current = false;
      return;
    }
    if (dragRef.current) return; // a hit-line drag gesture is in flight
    if (menu) return; // a menu is already open — let its onClose/backdrop own the click
    const frac = eventToFraction(e);
    if (!frac) return; // geometry not ready
    // Reject clicks that land inside any same-page table (the hit-line/hover logic owns those).
    const samePage = (metadataTables ?? []).filter(
      (t) => t.pdfPage === page && !t.deleted
    );
    const insideATable = samePage.some(
      (t) =>
        frac.fx >= t.bounds.left &&
        frac.fx <= t.bounds.left + t.bounds.width &&
        frac.fy >= t.bounds.top &&
        frac.fy <= t.bounds.top + t.bounds.height
    );
    if (insideATable) {
      // A click inside a table body opens the cell-content editor for the editable cell
      // under the pointer (same page, not deleted, not saved-grid/locked). If no editable
      // cell resolves (a locked or saved-grid table, or a square with no cell) this is a
      // no-op — the click stays inert, exactly as it was before the editor existed.
      openCellEditorAt(frac);
      return;
    }
    // Also reject clicks inside a locked (linked) table: it is not in metadataTables,
    // but it occupies page area and is not a place to add a new table. The overlay
    // `tables` prop is in viewbox px, so compare in that space.
    const vx = frac.fx * pixelWidth;
    const vy = frac.fy * pixelHeight;
    const insideLocked = (tables ?? []).some(
      (t) =>
        t.locked &&
        vx >= t.left &&
        vx <= t.left + t.width &&
        vy >= t.top &&
        vy <= t.top + t.height
    );
    if (insideLocked) return;
    // Empty area: open the new addTable menu variant. frac.fx/fy ARE the page
    // fractions L/T (eventToFraction already divides by pixelWidth/pixelHeight).
    setMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      addTable: true,
      T: frac.fy, // page-fraction top (new table's top-left corner)
      L: frac.fx, // page-fraction left
    });
  };

  // One rendered/screen or page pixel expressed as a page fraction, per axis. Used to
  // clamp minimum cell sizes and to keep a 1px gap to neighbouring tables. Guarded so it
  // returns 0 rather than NaN/Infinity before pixel dims are known.
  const onePxFractionX = pixelWidth ? 1 / pixelWidth : 0;
  const onePxFractionY = pixelHeight ? 1 / pixelHeight : 0;

  // Map a mouse event to the hovered table: the grid containing the pointer, or —
  // when outside all grids — a grid within HOVER_PROXIMITY_PX only if exactly one
  // qualifies (two nearby grids are ambiguous, so nothing is selected). Reports the
  // hovered tableId via onHoverTable and positions the label.
  const handleMouseMove = (e) => {
    if (!onHoverTable || !dims) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const sx = rect.width / dims.w;
    const sy = rect.height / dims.h;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Grids never overlap (they may only touch), so at most one grid contains the
    // pointer — if one does, it is unambiguously the selection. Otherwise select a
    // grid only when the pointer is within HOVER_PROXIMITY_PX of exactly one grid;
    // if two grids are that close (e.g. just outside a pair of touching grids) the
    // choice is ambiguous, so select nothing. Distances are measured in screen px.
    let inside = null;
    const near = [];
    for (const t of tables ?? []) {
      const dViewbox = distanceOutsideTable(px / sx, py / sy, t);
      if (dViewbox === 0) {
        inside = t;
        break;
      }
      // Approximate screen-pixel distance using the mean axis scale.
      if (dViewbox * ((sx + sy) / 2) <= HOVER_PROXIMITY_PX) {
        near.push(t);
      }
    }
    const best = inside ?? (near.length === 1 ? near[0] : null);
    if (best) {
      setHovered({
        table: best,
        x: best.left * sx,
        y: best.top * sy,
      });
      onHoverTable(best.tableId);
    } else {
      setHovered(null);
      onHoverTable(null);
    }
  };

  const handleMouseLeave = () => {
    if (!onHoverTable) return;
    setHovered(null);
    onHoverTable(null);
  };

  // Commit exactly one edited table back to the parent: map the metadata tables
  // immutably, replacing the entry whose tableId matches with newTable, and hand the
  // new list to onEditTables (which sets tables + dirty). Mirrors the parent's
  // commitTableEdit but reads metadataTables (the parent's tables) passed to the overlay.
  const commitTableEdit = (tableId, newTable) => {
    onEditTables(
      (metadataTables ?? []).map((t) => (t.tableId === tableId ? newTable : t))
    );
  };

  // Recompute the dragged edge from the current pointer position and commit it. Always
  // works from the *original* snapshot of the dragged table's fractional metadata taken
  // at mouse-down (so the maths never integrates per-frame deltas): computes the edge's
  // absolute TARGET p in fraction space, clamps it (page bounds + 1px gap to same-page
  // tables), then runs the grow/shrink/min-clamp maths. Commit-on-each-move.
  const handleDragMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    const { kind, tableId } = drag;
    const t = (metadataTables ?? []).find((x) => x.tableId === tableId);
    if (!t) return;

    // Click-vs-drag gate for ALL kinds (internal dividers AND boundary edges): until the
    // gesture moves past the threshold it may still resolve to a click (a menu opened in
    // handleDragEnd). Only once past it do we set moved and start applying resize maths, so
    // a sub-threshold boundary gesture never resizes and stays a click.
    if (!drag.moved) {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.hypot(dx, dy) <= CLICK_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }

    // Internal grid dividers move two adjacent cells equal-and-opposite (or squeeze a
    // crossed cell to 0) without ever touching bounds. All maths is on the metadata cells.
    if (kind === 'grid-v' || kind === 'grid-h') {
      const { k } = drag;
      const vertical = kind === 'grid-v';
      const cells = (vertical ? t.columnWidths : t.rowHeights) ?? [];
      const origin = vertical ? t.bounds.left : t.bounds.top;
      const span = vertical ? t.bounds.width : t.bounds.height;
      const minFrac = vertical ? onePxFractionX : onePxFractionY;
      // Clamp the divider strictly inside the table area, one rendered pixel from each edge.
      const raw = vertical ? frac.fx : frac.fy;
      const p = Math.max(
        origin + minFrac,
        Math.min(origin + span - minFrac, raw)
      );
      const moved = moveDivider(cells, k, p, origin);
      const newTable = vertical
        ? { ...t, columnWidths: moved }
        : { ...t, rowHeights: moved };
      // Remember the latest interim table so release cleanup works from the moved
      // geometry, not the stale metadataTables snapshot captured when the drag began.
      drag.last = newTable;
      commitTableEdit(tableId, newTable);
      return;
    }

    const xAxis = kind === 'boundary-left' || kind === 'boundary-right';
    let p = xAxis ? frac.fx : frac.fy;

    const others = (metadataTables ?? []).filter(
      (o) => o.tableId !== tableId && o.pdfPage === t.pdfPage && !o.deleted
    );
    p = clampBoundaryTarget(
      kind,
      p,
      t,
      others,
      onePxFractionX,
      onePxFractionY
    );
    const newTable = resizeBoundary(kind, p, t, onePxFractionX, onePxFractionY);
    // Remember the latest interim geometry so the drag-end reconcile (handleDragEnd) works
    // from the final resized table rather than the stale mouse-down snapshot.
    drag.last = newTable;
    commitTableEdit(tableId, newTable);
  };

  const handleDragEnd = (e) => {
    const drag = dragRef.current;
    // A hit-line gesture just ended; the browser will now fire a `click` on the svg.
    // Flag it so handleBackgroundClick ignores that one click rather than treating it
    // as an empty-area "Add table" click. Self-clears on the next tick in case no click
    // follows (e.g. the pointer was released off the overlay), so a later genuine
    // empty-area click is not swallowed.
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    // On release of an internal-line gesture, disambiguate click vs drag by drag.moved
    // (set in handleDragMove once the pointer passed CLICK_DRAG_THRESHOLD_PX):
    //   - moved === false -> a CLICK: open the popup menu for that divider; make NO
    //     metadata change (no commit, no dirty). The menu is anchored at the mouse-up
    //     screen position so it appears where the pointer ended.
    //   - moved === true  -> a DRAG: run the release cleanup (drop any <=0 cell) and
    //     commit. Never open the menu.
    if (drag && (drag.kind === 'grid-v' || drag.kind === 'grid-h')) {
      if (!drag.moved) {
        setMenu({
          clientX: e ? e.clientX : drag.startClientX,
          clientY: e ? e.clientY : drag.startClientY,
          orientation: drag.kind === 'grid-v' ? 'vertical' : 'horizontal',
          tableId: drag.tableId,
          lineIndex: drag.k, // 1-based divider index
        });
        dragRef.current = null;
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        return;
      }
      // Drag: build the final axis from the last interim table this drag committed
      // (drag.last). `orig` is the PRE-DRAG snapshot (metadataTables in this listener
      // closure is the pre-drag list) — reconcileCells must compare against it, not against
      // the already-moved drag.last, or every cell's "old" grid square would equal its new
      // one and no confidence would ever reset.
      const orig = (metadataTables ?? []).find((x) => x.tableId === drag.tableId);
      const t = drag.last ?? orig;
      if (t) {
        const vertical = drag.kind === 'grid-v';
        const axis = (vertical ? t.columnWidths : t.rowHeights) ?? [];
        // Treat anything at or below half a rendered pixel as a squeezed 0.
        const epsilon = (vertical ? onePxFractionX : onePxFractionY) * 0.5;
        const cleaned = cleanupAxis(axis, epsilon);
        // Index map for the cleaned axis: survivors are the entries above epsilon, in
        // order; if cleanup would empty the axis it keeps the single largest entry
        // (mirroring cleanupAxis) so the map matches the array it produced. moveDivider
        // preserves the entry count, so these indices also address the pre-drag axis.
        const kept = [];
        axis.forEach((c, i) => {
          if (c.value > epsilon) kept.push(i);
        });
        let changedMap = kept;
        if (kept.length === 0) {
          let best = 0;
          axis.forEach((c, i) => {
            if (c.value > axis[best].value) best = i;
          });
          changedMap = [best];
        }
        // Reconcile at this FINAL release commit (mid-drag previews did not) against the
        // PRE-DRAG geometry (`prev`): its grid squares are the ones a moved divider actually
        // shifted, so only cells whose square changed reset confidence. The move keeps bounds
        // fixed. Commit onto `t` (the final interim table) so its untouched axis is kept.
        const prev = orig ?? t;
        commitTableEdit(
          drag.tableId,
          reconcileAxisEdit(
            prev,
            t,
            vertical ? 'columnWidths' : 'rowHeights',
            cleaned,
            changedMap,
            prev.bounds
          )
        );
      }
    }
    // Boundary DRAG release: the per-move commits updated bounds/axes but did NOT reconcile
    // cells (mid-drag previews skip it). Reconcile once here from the final resized table
    // (drag.last) so any cascade-deleted line's cells are dropped and every surviving cell's
    // bounds track the shifted grid. A sub-threshold boundary gesture (moved === false) is a
    // click, handled below, and must not reconcile.
    if (
      drag &&
      (drag.kind === 'boundary-left' ||
        drag.kind === 'boundary-right' ||
        drag.kind === 'boundary-top' ||
        drag.kind === 'boundary-bottom') &&
      drag.moved &&
      drag.last
    ) {
      // The mouse-down snapshot carries the ORIGINAL (pre-drag) cells; drag.last carries the
      // final geometry. Both come from the listener closures, so metadataTables here is the
      // pre-drag list.
      const prev = (metadataTables ?? []).find((x) => x.tableId === drag.tableId);
      const finalTable = drag.last;
      if (prev) {
        const xAxis =
          drag.kind === 'boundary-left' || drag.kind === 'boundary-right';
        const fromFront =
          drag.kind === 'boundary-left' || drag.kind === 'boundary-top';
        const axisKey = xAxis ? 'columnWidths' : 'rowHeights';
        const newAxis = finalTable[axisKey] ?? [];
        const oldLen = (prev[axisKey] ?? []).length;
        // A boundary cascade removes a PREFIX (front edge) or SUFFIX (back edge) run of
        // lines; growing removes none. Survivors compact: for a front cascade new j <- old
        // (j + removed); for a back cascade (or grow) it is identity over the survivors.
        const removed = oldLen - newAxis.length;
        const axisMap =
          removed > 0 && fromFront
            ? Array.from({ length: newAxis.length }, (_, j) => j + removed)
            : identityMap(newAxis.length);
        // Reconcile against the pre-drag geometry; commit onto the final resized table so its
        // shifted bounds/untouched axis are kept.
        commitTableEdit(
          drag.tableId,
          reconcileAxisEdit(
            prev,
            finalTable,
            axisKey,
            newAxis,
            axisMap,
            finalTable.bounds
          )
        );
      }
    }
    // Boundary edges: a sub-threshold gesture (moved === false) is a CLICK -> open the
    // boundary "Add" menu, anchored at the mouse-up position; make NO metadata change (no
    // commit, no dirty). A boundary DRAG (moved === true) already committed its resize on
    // each move and needs no release cleanup — just fall through to clear the drag.
    if (
      drag &&
      (drag.kind === 'boundary-left' ||
        drag.kind === 'boundary-right' ||
        drag.kind === 'boundary-top' ||
        drag.kind === 'boundary-bottom') &&
      !drag.moved
    ) {
      setMenu({
        clientX: e ? e.clientX : drag.startClientX,
        clientY: e ? e.clientY : drag.startClientY,
        boundaryKind: drag.kind,
        tableId: drag.tableId,
      });
      dragRef.current = null;
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      return;
    }
    dragRef.current = null;
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  };

  // Hit-line mouse-down. Boundary edges and internal grid dividers are interactive;
  // internal dividers carry a 1-based index k (between cell k-1 and k) retained on the
  // drag. Ignored entirely on a read-only overlay (no onEditTables). Starts a
  // window-level drag using the mouse event family; the move/up listeners live on window
  // so the drag survives the pointer leaving the SVG.
  const handleHit = (identity, e) => {
    if (!interactive) return;
    const { kind, tableId, k } = identity;
    if (
      kind !== 'boundary-left' &&
      kind !== 'boundary-right' &&
      kind !== 'boundary-top' &&
      kind !== 'boundary-bottom' &&
      kind !== 'grid-v' &&
      kind !== 'grid-h'
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      tableId,
      k,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // Build the next table for a menu action, commit it, and close the menu. `action`
  // mutates a chosen axis (columnWidths for a vertical divider, rowHeights for a
  // horizontal one) immutably and returns the new array; every action keeps the axis SUM
  // unchanged (Delete folds a cell into its neighbour; Add half-splits a cell), so bounds
  // is preserved (I1/I2). No-ops if the clicked table has gone.
  // Build and insert a new single-cell table anchored at the clicked point (its
  // top-left corner), if it fits the page and does not overlap any same-page table.
  // On failure: close the menu and show a "Not enough room" toast; create nothing,
  // don't mark dirty. On success: splice it just after the last same-page table (or
  // append when the page had none) and commit via onEditTables.
  const handleAddTable = () => {
    if (!menu || !menu.addTable) return;
    const T = menu.T;
    const L = menu.L;
    const W = 100 / pixelWidth; // page-fraction width of the default 1 column
    const H = 20 / pixelHeight; // page-fraction height of the default 1 row
    const P = page; // 0-based
    const list = metadataTables ?? [];

    // Room check 1: fits on the page.
    const fitsOnPage = L >= 0 && T >= 0 && L + W <= 1 && T + H <= 1;

    // Room check 2: strict (edge-touching allowed) non-overlap with same-page tables.
    const candidate = { left: L, top: T, width: W, height: H };
    const overlapsExisting = list
      .filter((o) => o.pdfPage === P && !o.deleted)
      .some((o) => overlaps(candidate, o.bounds));

    if (!fitsOnPage || overlapsExisting) {
      setMenu(null);
      // Surface via the same snackbar mechanism as the toolbar's Export button.
      toast('Not enough room');
      return;
    }

    const Tabs = list.filter((t) => t.pdfPage === P).length;

    // Compute tableInPage: a float position index derived from where this table's top
    // falls among every other same-page table's top. "Every other" is exhaustive — it
    // includes deleted tables and tables nested inside any table's `next` map (joined
    // tables), not just the live top-level list. Neighbours are the table immediately
    // above (greatest top < T) and immediately below (least top > T) by bounds.top:
    //   - between two: average their tableInPage values
    //   - at the end (only an above neighbour): that table's tableInPage + 1
    //   - at the start (only a below neighbour): that table's tableInPage - 1 (often < 0)
    //   - page otherwise empty: 0
    const allTables = [];
    const collect = (arr) => {
      (arr ?? []).forEach((t) => {
        allTables.push(t);
        if (t.next) collect(Object.values(t.next));
      });
    };
    collect(list);
    let above = null; // greatest top strictly above the new top
    let below = null; // least top at or below the new top
    allTables
      .filter((t) => t.pdfPage === P)
      .forEach((t) => {
        const top = t.bounds.top;
        if (top < T) {
          if (above === null || top > above.bounds.top) above = t;
        } else if (below === null || top < below.bounds.top) below = t;
      });
    let tableInPage;
    if (above && below) tableInPage = ((above.tableInPage ?? 0) + (below.tableInPage ?? 0)) / 2;
    else if (above) tableInPage = (above.tableInPage ?? 0) + 1;
    else if (below) tableInPage = (below.tableInPage ?? 0) - 1;
    else tableInPage = 0;

    const newTable = {
      tableId: newUUID(),
      name: `Page ${P + 1} Table ${Tabs + 1}`, // 1-based for humans; pdfPage stays 0-based
      next: null,
      pdfPage: P, // 0-based
      tableInPage,
      headerCount: 0,
      confidence: 100, // 0-100 percent; 100 = full
      bounds: { top: T, left: L, width: W, height: H },
      // The 1×1 grid's single cell (its square IS the whole table). confidence 0 -> red;
      // header false (per-cell header is a back-end concern).
      cells: [makeDefaultCell(0, 0, { top: T, left: L, width: W, height: H })],
      title: null,
      sectionTitles: null,
      footer: null,
      columnWidths: [{ value: W, confidence: 100 }], // single column
      rowHeights: [{ value: H, confidence: 100 }], // single row
      extractionMechanism: 'MANUAL',
    };

    // Splice just after the last same-page table (preserve order + every field; the
    // parent Save PUT replaces metadata.tables wholesale). Append when page P is empty.
    let lastIdx = -1;
    list.forEach((t, i) => {
      if (t.pdfPage === P) lastIdx = i;
    });
    const insertAt = lastIdx >= 0 ? lastIdx + 1 : list.length;
    const next = [...list.slice(0, insertAt), newTable, ...list.slice(insertAt)];

    onEditTables(next); // adopts the table AND sets dirty
    setMenu(null);
  };

  // Run a Calculate on the border table the dialog targets: build ONE hint (plus the two
  // optional counts), send it through the async find-tables endpoint, and — on a returned
  // table — REPLACE the whole target table with the finder's result (keeping the original
  // tableId/pdfPage, normalised like a fresh metadata load). A response with no table
  // leaves the border table unchanged with an informational toast; a thrown error surfaces
  // via toast.error and changes nothing. The busy flag is cleared and the dialog closed in
  // every case. Shares its request-building/replacement with the later Recalculate flow via
  // the module-scope helpers.
  const handleCalculate = async () => {
    const t = (metadataTables ?? []).find(
      (x) => x.tableId === calcDialog?.tableId
    );
    if (!t) {
      setCalcDialog(null);
      return;
    }
    const hint = buildCalcHint(t, calcRows, calcCols);
    setCalcBusy(true);
    try {
      const { tables: resultTables } =
        (await findTables(pdfId, [{ pdfPage: t.pdfPage, tables: [hint] }])) ??
        {};
      const resultTable = pickCalcResultTable(t, resultTables);
      if (!resultTable) {
        toast('No table found');
      } else {
        commitTableEdit(t.tableId, buildCalcReplacement(t, resultTable));
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCalcBusy(false);
      setCalcDialog(null);
    }
  };

  // Recalculate the low-confidence (RED) cells of a multi-cell table. Selects the red cells
  // (selectLowConfidenceCells); if none qualify, shows an informational toast and makes NO
  // request. Otherwise builds ONE hint carrying those cells (grid-line region bounds), sends
  // it through the async find-tables endpoint, and MERGES the returned cells back into the
  // table by (row, column) — every other cell and all table geometry preserved. A thrown
  // error surfaces via toast.error and changes nothing; the busy flag is cleared either way.
  // Shares its request-building/merge with the module-scope helpers (mirroring Calculate).
  const handleRecalculate = async (tableId) => {
    setMenu(null);
    const t = (metadataTables ?? []).find((x) => x.tableId === tableId);
    if (!t) return;
    const redCells = selectLowConfidenceCells(t.cells);
    if (redCells.length === 0) {
      toast('No low-confidence cells to recalculate');
      return;
    }
    const requestedHints = [buildRecalcHint(t, redCells)];
    setCalcBusy(true);
    try {
      const { tables: resultTables } =
        (await findTables(pdfId, [
          { pdfPage: t.pdfPage, tables: requestedHints },
        ])) ?? {};
      const resultTable = pickCalcResultTable(t, resultTables);
      const returnedCells = resultTable?.cells ?? [];
      if (returnedCells.length > 0) {
        commitTableEdit(t.tableId, mergeRecalcCells(t, returnedCells));
      }
      // The finder is best-effort: warn when a whole requested table, or some of a
      // table's requested cells, came back missing (also catches an upstream error
      // the API route collapses to an empty result).
      const shortfall = recalcShortfallMessage(requestedHints, resultTables);
      if (shortfall) toast(shortfall);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCalcBusy(false);
    }
  };

  const runMenuAction = (axisKey, action, axisMap) => {
    if (!menu) return;
    const t = (metadataTables ?? []).find((x) => x.tableId === menu.tableId);
    if (t) {
      const oldAxis = (t[axisKey] ?? []).map((c) => ({ ...c }));
      const nextAxis = action(oldAxis);
      // This is the FINAL committed structural change, so reconcile cells. axisMap(oldLen)
      // is the index transform for the edited axis (an Add half-splits a line -> a NEW
      // line; a Delete folds one away). Both Add and Delete keep the axis sum, so bounds is
      // unchanged (t.bounds).
      commitTableEdit(
        menu.tableId,
        reconcileAxisEdit(t, t, axisKey, nextAxis, axisMap(oldAxis.length), t.bounds)
      );
    }
    setMenu(null);
  };

  // The table the open menu targets and the axis array it operates on (columns for a
  // vertical divider, rows for a horizontal one), used to decide which items to render.
  const menuTable = menu
    ? (metadataTables ?? []).find((x) => x.tableId === menu.tableId)
    : null;
  const menuVertical = menu && menu.orientation === 'vertical';
  const menuAxis = menuTable
    ? (menuVertical ? menuTable.columnWidths : menuTable.rowHeights) ?? []
    : [];

  // A boundary-edge menu offers a single inward "Add" item that adds a grid line just
  // inside the clicked edge, half-splitting the nearest cell (axis sum, hence bounds,
  // unchanged). The label is named relative to the clicked edge and always points inward.
  const boundaryMenuItem = menu && menu.boundaryKind
    ? {
        'boundary-bottom': {
          label: 'Add Above',
          axisKey: 'rowHeights',
          action: (arr) => splitEntry(arr, arr.length - 1),
          map: (len) => splitMap(len, len - 1),
        },
        'boundary-top': {
          label: 'Add Below',
          axisKey: 'rowHeights',
          action: (arr) => splitEntry(arr, 0),
          map: (len) => splitMapBelow(len, 0),
        },
        'boundary-left': {
          label: 'Add Right',
          axisKey: 'columnWidths',
          action: (arr) => splitEntry(arr, 0),
          map: (len) => splitMapBelow(len, 0),
        },
        'boundary-right': {
          label: 'Add Left',
          axisKey: 'columnWidths',
          action: (arr) => splitEntry(arr, arr.length - 1),
          map: (len) => splitMap(len, len - 1),
        },
      }[menu.boundaryKind]
    : null;

  // "Just a border": exactly one column and one row. Such a table offers Calculate on its
  // boundary menu; a multi-cell table offers Recalculate instead. The two
  // are mutually exclusive on this 1×1 test.
  const calcAvailable =
    !!menuTable &&
    (menuTable.columnWidths ?? []).length === 1 &&
    (menuTable.rowHeights ?? []).length === 1;

  // A multi-cell table (more than one column and/or row) offers Recalculate instead of
  // Calculate — the two are mutually exclusive on the 1×1 test above.
  const recalcAvailable =
    !!menuTable &&
    ((menuTable.columnWidths ?? []).length > 1 ||
      (menuTable.rowHeights ?? []).length > 1);

  // Remove any lingering window listeners if the overlay unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure the image's rendered screen size for the HTML confidence-square/cell-text
  // overlays, keeping it fresh across layout changes with a ResizeObserver. Only the
  // interactive centre panel needs it (thumbnails draw no overlays), and only once the
  // image has loaded (dims set). Pixel-perfect tracking mid-drag is not required.
  useEffect(() => {
    if (!interactive || !dims) return undefined;
    const img = imgRef.current;
    if (!img) return undefined;
    const measure = () => {
      const rect = img.getBoundingClientRect();
      setRenderedSize({ width: rect.width, height: rect.height });
    };
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(img);
    }
    return () => {
      if (observer) observer.disconnect();
    };
  }, [interactive, dims]);

  // Screen px per page fraction on each axis, derived from the rendered size and the
  // natural image dims exactly as eventToFraction/handleMouseMove do (sx = rect.width /
  // dims.w). null until both are known. To place an overlay at page fraction (fx, fy):
  //   screenX = fx * pixelWidth * sx ; screenY = fy * pixelHeight * sy. Memoised so it is a
  // stable reference across cellHover-driven re-renders (letting the overlay geometry memos
  // below skip recompute on every hover mousemove).
  const overlayScale = useMemo(
    () =>
      dims && renderedSize && pixelWidth && pixelHeight
        ? { sx: renderedSize.width / dims.w, sy: renderedSize.height / dims.h }
        : null,
    [dims, renderedSize, pixelWidth, pixelHeight]
  );

  // Same-page, non-deleted metadata tables carrying cells — the source for the HTML
  // confidence-square and cell-text overlays. Deleted tables draw no grid, so they get no
  // squares; a table locked by its saved link grid is display-only, so its edit markers
  // (confidence squares, header markers) are suppressed too; only the interactive centre
  // panel supplies metadataTables at all. Memoised so hover re-renders reuse the same
  // reference.
  const overlayCellTables = useMemo(
    () =>
      interactive
        ? (metadataTables ?? []).filter(
            (t) =>
              t.pdfPage === page &&
              !t.deleted &&
              !hasSavedGrid(t) &&
              (editableTableId == null || t.tableId === editableTableId)
          )
        : [],
    [interactive, metadataTables, page, editableTableId]
  );

  // The cell for the hovered confidence square, or null. Its text is shown in a box placed
  // beside the cell (see hoveredCellRect + chooseCellTextPlacement) so the cell stays visible.
  const hoveredCell =
    cellHover && overlayScale
      ? (() => {
          const t = overlayCellTables.find(
            (x) => x.tableId === cellHover.tableId
          );
          if (!t) return null;
          return cellAt(t, cellHover.r, cellHover.c) ?? null;
        })()
      : null;

  // Screen-px rect { left, top, width, height } of grid cell (r, c) of table `t` in the
  // overlay space, extended across the cell's row/column span. Null when the cell/geometry
  // is unavailable. Shared by the hovered-cell text box and the cell editor so both anchor
  // to the exact same rect. Stable across hover re-renders (deps: the scale/pixel dims).
  const cellScreenRect = useCallback(
    (t, r, c) => {
      if (!t || !overlayScale) return null;
      const cell = cellAt(t, r, c);
      if (!cell) return null;
      const cols = t.columnWidths ?? [];
      const rows = t.rowHeights ?? [];
      if (r < 0 || c < 0 || r >= rows.length || c >= cols.length) return null;
      const colOffsets = cumulative(cols.map((v) => v.value));
      const rowOffsets = cumulative(rows.map((v) => v.value));
      const left = t.bounds.left + (c > 0 ? colOffsets[c - 1] : 0);
      const top = t.bounds.top + (r > 0 ? rowOffsets[r - 1] : 0);
      const cEnd = Math.min(cols.length, c + Math.max(1, cell.columnSpan ?? 1));
      const rEnd = Math.min(rows.length, r + Math.max(1, cell.rowSpan ?? 1));
      let wFrac = 0;
      for (let i = c; i < cEnd; i += 1) wFrac += cols[i].value;
      let hFrac = 0;
      for (let i = r; i < rEnd; i += 1) hFrac += rows[i].value;
      return {
        left: left * pixelWidth * overlayScale.sx,
        top: top * pixelHeight * overlayScale.sy,
        width: wFrac * pixelWidth * overlayScale.sx,
        height: hFrac * pixelHeight * overlayScale.sy,
      };
    },
    [overlayScale, pixelWidth, pixelHeight]
  );

  // Screen-px rect of the hovered cell, used to anchor the cell-text box beside the cell
  // rather than over it. Null when nothing is hovered or the geometry is unavailable.
  const hoveredCellRect = useMemo(() => {
    if (!cellHover) return null;
    const t = overlayCellTables.find((x) => x.tableId === cellHover.tableId);
    return cellScreenRect(t, cellHover.r, cellHover.c);
  }, [cellHover, overlayCellTables, cellScreenRect]);

  // Measure the rendered cell-text box after each distinct hover so its placement (below /
  // right / above) can be decided from the box's real size. Keyed on the text and the
  // container width (which caps the box via maxWidth), not the pointer, so it re-measures
  // only when the content or available width changes. Layout effect → runs before paint,
  // so the box never flashes at a stale position.
  const hoveredCellText = hoveredCell?.text ?? null;
  useLayoutEffect(() => {
    const el = cellTextRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCellTextSize((prev) =>
      prev && prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height }
    );
  }, [hoveredCellText, renderedSize]);

  // Screen-px geometry for the per-cell confidence squares, computed ONCE per table (the
  // cumulative axis offsets are built once and reused for all the table's cells, rather
  // than rebuilt per cell) and memoised so a hover mousemove — which only changes cellHover
  // — does not recompute it. Only the geometry/colour is memoised; the event handlers are
  // attached at render time (below) with live closures, avoiding stale commit callbacks.
  const confidenceSquares = useMemo(() => {
    if (!overlayScale) return [];
    const size = 8; // screen px
    const inset = 1; // screen px inside the drawn grid lines
    const out = [];
    for (const t of overlayCellTables) {
      const cols = t.columnWidths ?? [];
      const rows = t.rowHeights ?? [];
      const colOffsets = cumulative(cols.map((v) => v.value));
      const rowOffsets = cumulative(rows.map((v) => v.value));
      for (const cell of t.cells ?? []) {
        const { row: r, column: c } = cell;
        if (r < 0 || c < 0 || r >= rows.length || c >= cols.length) continue;
        const left = t.bounds.left + (c > 0 ? colOffsets[c - 1] : 0);
        const top = t.bounds.top + (r > 0 ? rowOffsets[r - 1] : 0);
        const scrLeft = left * pixelWidth * overlayScale.sx;
        const scrTop = top * pixelHeight * overlayScale.sy;
        const scrW = cols[c].value * pixelWidth * overlayScale.sx;
        const scrH = rows[r].value * pixelHeight * overlayScale.sy;
        out.push({
          tableId: t.tableId,
          r,
          c,
          colour: confidenceColour(cell.confidence),
          left: scrLeft + scrW - inset - size,
          top: scrTop + scrH - inset - size,
          size,
        });
      }
    }
    return out;
  }, [overlayCellTables, overlayScale, pixelWidth, pixelHeight]);

  // Screen-px geometry + variant for the header-row markers, memoised on the same terms as
  // the confidence squares (see above). Driven solely by headerCount (null -> 0).
  const headerMarkers = useMemo(() => {
    if (!overlayScale) return [];
    const out = [];
    for (const t of overlayCellTables) {
      const rows = t.rowHeights ?? [];
      const R = rows.length;
      const h = t.headerCount ?? 0;
      const rowOffsets = cumulative(rows.map((v) => v.value));
      const leftPx =
        (t.bounds.left + t.bounds.width) * pixelWidth * overlayScale.sx;
      const push = (r, variant) => {
        const top = t.bounds.top + (r > 0 ? rowOffsets[r - 1] : 0);
        const centre = top + (rows[r]?.value ?? 0) / 2;
        out.push({
          tableId: t.tableId,
          r,
          variant,
          glyph: variant === '+H' ? '+ H' : variant === 'H-' ? 'H -' : 'H',
          clickable: variant !== 'H',
          left: leftPx,
          top: centre * pixelHeight * overlayScale.sy,
        });
      };
      for (let r = 0; r < h && r < R; r += 1) push(r, r === h - 1 ? 'H-' : 'H');
      if (h < R) push(h, '+H');
    }
    return out;
  }, [overlayCellTables, overlayScale, pixelWidth, pixelHeight]);

  // Screen-px geometry + colour for the per-row confidence squares. One ~8×8 display-only
  // marker per row, placed 10px beyond the table's right-hand edge and vertically level
  // with the BOTTOM of the row it refers to (top = rowBottom - size), coloured by the
  // row's confidence (rowHeights[i].confidence). Memoised on the same terms as the cell
  // confidence squares. Empty rowHeights -> no squares.
  const rowConfidenceSquares = useMemo(() => {
    if (!overlayScale) return [];
    const size = 8; // screen px
    const gap = 10; // screen px beyond the right edge
    const out = [];
    for (const t of overlayCellTables) {
      const rows = t.rowHeights ?? [];
      const rowOffsets = cumulative(rows.map((v) => v.value));
      const left =
        (t.bounds.left + t.bounds.width) * pixelWidth * overlayScale.sx + gap;
      for (let i = 0; i < rows.length; i += 1) {
        const bottom = (t.bounds.top + rowOffsets[i]) * pixelHeight * overlayScale.sy;
        out.push({
          tableId: t.tableId,
          r: i,
          colour: confidenceColour(rows[i].confidence),
          left,
          top: bottom - size,
          size,
        });
      }
    }
    return out;
  }, [overlayCellTables, overlayScale, pixelWidth, pixelHeight]);

  // Toggle one cell's confidence (below highConfidence() -> 100, else -> 0), committed
  // against the LIVE table so no stale closure is captured by the memoised square list.
  const toggleCellConfidence = (tableId, r, c) => {
    const t = (metadataTables ?? []).find((x) => x.tableId === tableId);
    if (!t) return;
    commitTableEdit(tableId, {
      ...t,
      cells: (t.cells ?? []).map((x) =>
        x.row === r && x.column === c
          ? { ...x, confidence: (x.confidence ?? 0) < highConfidence() ? 100 : 0 }
          : x
      ),
    });
  };

  // Adjust a table's headerCount by delta, clamped to [0, R]; committed against the live
  // table (see toggleCellConfidence).
  const adjustHeaderCount = (tableId, delta) => {
    const t = (metadataTables ?? []).find((x) => x.tableId === tableId);
    if (!t) return;
    const R = (t.rowHeights ?? []).length;
    const h = t.headerCount ?? 0;
    commitTableEdit(tableId, {
      ...t,
      headerCount: Math.max(0, Math.min(R, h + delta)),
    });
  };

  // Open the cell-content editor for the editable cell whose grid square contains the
  // page-fraction point `frac`. Walks the same-page editable tables (overlayCellTables:
  // not deleted, not saved-grid/locked), finds the one containing the point, resolves the
  // grid square via the cumulative axis offsets (the inverse of cellScreenRect's maths),
  // then the anchored cell via cellAt. No-op when nothing editable resolves.
  const openCellEditorAt = (frac) => {
    for (const t of overlayCellTables) {
      const { left, top, width, height } = t.bounds;
      if (
        frac.fx < left ||
        frac.fx > left + width ||
        frac.fy < top ||
        frac.fy > top + height
      ) {
        continue;
      }
      const cols = t.columnWidths ?? [];
      const rows = t.rowHeights ?? [];
      if (!cols.length || !rows.length) return;
      const colOffsets = cumulative(cols.map((v) => v.value));
      const rowOffsets = cumulative(rows.map((v) => v.value));
      const relX = frac.fx - left;
      const relY = frac.fy - top;
      let c = colOffsets.findIndex((o) => relX <= o);
      if (c === -1) c = cols.length - 1;
      let r = rowOffsets.findIndex((o) => relY <= o);
      if (r === -1) r = rows.length - 1;
      const cell = cellAt(t, r, c);
      if (!cell) return; // spanning/covered square with no anchored cell: leave inert
      const rect = cellScreenRect(t, r, c);
      const text = cell.text ?? '';
      editorInitRef.current = {
        widthCh: Math.min(
          EDITOR_MAX_CH,
          Math.max(text.length + EDITOR_WIDTH_PADDING_CH, MIN_CH)
        ),
        rows: Math.max(1, text.split(/\r?\n/).length),
      };
      setCellHover(null);
      setEditorText(text);
      // Seed at the BELOW position; a layout effect lifts it above if the measured popup
      // fits there. (Its rendered height is unknown until after paint.)
      setEditorPos(
        rect
          ? { left: rect.left, top: rect.top + rect.height }
          : { left: 0, top: 0 }
      );
      setCellEditor({ tableId: t.tableId, r, c });
      return;
    }
  };

  // After the editor mounts, measure it and — if it fits above the cell — move it there;
  // otherwise it stays at the seeded below position. Single initial placement (deps:
  // cellEditor), so dragging/resizing afterwards is never overridden.
  useLayoutEffect(() => {
    if (!cellEditor) return;
    const el = editorRef.current;
    if (!el) return;
    const t = overlayCellTables.find((x) => x.tableId === cellEditor.tableId);
    const rect = cellScreenRect(t, cellEditor.r, cellEditor.c);
    if (!rect) return;
    const measuredHeight = el.getBoundingClientRect().height;
    if (rect.top - measuredHeight >= 0) {
      setEditorPos({ left: rect.left, top: rect.top - measuredHeight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellEditor]);

  // Save the editor: collapse newlines to single spaces, then commit the target cell with
  // the new text and full confidence (100 — the same value the confidence-square toggle
  // uses). Routes through commitTableEdit so `dirty` is raised. Closes the editor.
  const handleEditorSave = () => {
    if (!cellEditor) return;
    const t = (metadataTables ?? []).find(
      (x) => x.tableId === cellEditor.tableId
    );
    if (t) {
      const text = editorText.replace(/\r?\n/g, ' ');
      commitTableEdit(cellEditor.tableId, {
        ...t,
        cells: (t.cells ?? []).map((x) =>
          x.row === cellEditor.r && x.column === cellEditor.c
            ? { ...x, text, confidence: 100 }
            : x
        ),
      });
    }
    setCellEditor(null);
  };

  // Cancel the editor: close it, committing nothing (dirty untouched).
  const handleEditorCancel = () => {
    setCellEditor(null);
  };

  // Header-bar drag: move the popup by the pointer delta, clamped inside the container so
  // it always stays reachable. Listeners live on window (mirroring the boundary drag) so
  // the drag survives the pointer leaving the popup.
  const handleEditorDragMove = (e) => {
    const d = editorDragRef.current;
    if (!d) return;
    let left = d.startLeft + (e.clientX - d.startX);
    let top = d.startTop + (e.clientY - d.startY);
    const el = editorRef.current;
    if (renderedSize && el) {
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      left = Math.max(0, Math.min(left, renderedSize.width - w));
      top = Math.max(0, Math.min(top, renderedSize.height - h));
    }
    setEditorPos({ left, top });
  };

  const handleEditorDragEnd = () => {
    editorDragRef.current = null;
    window.removeEventListener('mousemove', handleEditorDragMove);
    window.removeEventListener('mouseup', handleEditorDragEnd);
  };

  const handleEditorDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    editorDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: editorPos ? editorPos.left : 0,
      startTop: editorPos ? editorPos.top : 0,
    };
    window.addEventListener('mousemove', handleEditorDragMove);
    window.addEventListener('mouseup', handleEditorDragEnd);
  };

  // Remove any lingering editor-drag window listeners if the overlay unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleEditorDragMove);
      window.removeEventListener('mouseup', handleEditorDragEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the editor on any mousedown outside its popup — the middle-panel
  // background, a hit line, or the left/right columns (hence a document-level
  // listener, not one scoped to this overlay). Clicks inside the popup (textarea,
  // buttons, drag handle) are ignored via editorRef.contains. mousedown (not click)
  // so it settles before the click that might otherwise reopen on another cell.
  // Closing discards, like Cancel — the tick still commits. Attached only while
  // open, so the opening click (fired before this effect runs) never self-closes.
  useEffect(() => {
    if (!cellEditor) return undefined;
    const onOutsideMouseDown = (e) => {
      const el = editorRef.current;
      if (el && !el.contains(e.target)) setCellEditor(null);
    };
    document.addEventListener('mousedown', onOutsideMouseDown);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown);
  }, [cellEditor]);

  // Right column only: the host's live page-fraction metadata tables for this thumbnail's
  // page, converted to viewBox pixels. `dims` IS the thumbnail's pixel width/height (the
  // image's natural size, discovered on load), so the conversion needs nothing from the
  // server — and because the source is the LIVE metadata rather than the fetched thumbnail
  // list, an edit shows on the thumbnail immediately, without waiting for a save. `confirmed`
  // comes off the SOURCE table: the converter returns geometry and name only. `mergeRole`
  // comes from the host's document-wide role map. Empty for the centre panel, which never
  // supplies thumbnailTables.
  const thumbnailOverlayTables = useMemo(
    () =>
      dims
        ? (thumbnailTables ?? []).map((t) => ({
            ...metadataTableToThumbnailOverlay(t, dims.w, dims.h),
            confirmed: (t.confirmationStage ?? 0) >= confirmedTableStage(),
            mergeRole: thumbnailMergeRoles?.[t.tableId] ?? null,
          }))
        : [],
    [thumbnailTables, thumbnailMergeRoles, dims]
  );

  // Everything the overlay SVG draws a border for. The two sources are mutually exclusive
  // in practice (the centre panel passes only `tables`, a thumbnail only `thumbnailTables`),
  // so concatenating them leaves each caller's rendering exactly as it was.
  const drawnTables = useMemo(
    () => [...(tables ?? []), ...thumbnailOverlayTables],
    [tables, thumbnailOverlayTables]
  );

  return (
    <Box
      sx={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}
      onMouseMove={onHoverTable ? handleMouseMove : undefined}
      onMouseLeave={onHoverTable ? handleMouseLeave : undefined}
    >
      <img
        ref={imgRef}
        src={`data:image/png;base64,${image}`}
        onLoad={(e) =>
          setDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })
        }
        style={{ display: 'block', width: '100%', height: 'auto' }}
        alt={''}
      />
      {dims && (
        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio={'none'}
          onClick={interactive ? handleBackgroundClick : undefined}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents:
              interactive || onThumbnailTableClick ? 'auto' : 'none',
          }}
        >
          {drawnTables.map((t, i) => (
            <g key={i}>
              <rect
                x={t.left}
                y={t.top}
                width={t.width}
                height={t.height}
                fill={'none'}
                stroke={gridLineColour()}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
              {withGrid && gridLines(t)}
              {/* A transparent hit rect over the table, present only while a linking session
                  wants one, so a click can pick this table rather than change the page. */}
              {onThumbnailTableClick && t.tableId ? (
                <rect
                  data-testid={'thumbnail-table-hit'}
                  data-tableid={t.tableId}
                  x={t.left}
                  y={t.top}
                  width={t.width}
                  height={t.height}
                  fill={'transparent'}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onThumbnailTableClick(t.tableId);
                  }}
                />
              ) : null}
              {/* Locked (linked) tables are display-only: no hit lines, so no drag,
                  resize, or menu gesture can ever start on them. */}
              {interactive && !t.locked && hitLines(t, handleHit)}
            </g>
          ))}
          {deletedPreview && (
            <g data-testid={'deleted-preview'}>
              <rect
                x={deletedPreview.left}
                y={deletedPreview.top}
                width={deletedPreview.width}
                height={deletedPreview.height}
                fill={'none'}
                stroke={deletedGridLineColour()}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
              {gridLines(deletedPreview, deletedGridLineColour())}
            </g>
          )}
        </svg>
      )}
      {/* Right column only: each table's NAME lifted just above its top-left corner, in the
          same blue as its border. The SVG uses preserveAspectRatio="none", so the label lives
          outside it as an absolutely-positioned HTML sibling, placed by percentage of the
          natural image size (dims) since the <img> is width:100%/height:auto. */}
      {dims &&
        thumbnailOverlayTables.map((t) => (
          <div
            key={`name-${t.tableId}`}
            data-testid={'thumbnail-table-name'}
            style={{
              position: 'absolute',
              left: `${(t.left / dims.w) * 100}%`,
              top: `${(t.top / dims.h) * 100}%`,
              transform: 'translateY(-100%)',
              fontFamily: 'sans-serif',
              fontSize: 10,
              lineHeight: '10px',
              color: gridLineColour(),
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {t.name}
          </div>
        ))}
      {/* Right column only: the confirmed-table tick badge, just above each fully confirmed
          table's top-RIGHT corner. Positioned by percentage of the natural image size for the
          same preserveAspectRatio reason as the name label above. */}
      {dims &&
        thumbnailOverlayTables
          .filter((t) => t.confirmed)
          .map((t) => (
            <ConfirmedTickBadge
              key={`tick-${t.tableId}`}
              left={`${((t.left + t.width) / dims.w) * 100}%`}
              top={`${(t.top / dims.h) * 100}%`}
            />
          ))}
      {/* Right column only: the linked-group ring, drawn around every member of a linked
          group — the root as well as the tables joined under it. Placed by percentage of the
          natural image size for the same preserveAspectRatio reason as the labels above. */}
      {dims &&
        thumbnailOverlayTables
          .filter((t) => t.mergeRole)
          .map((t) => (
            <LinkedGroupOutline
              key={`linked-${t.tableId}`}
              left={`${(t.left / dims.w) * 100}%`}
              top={`${(t.top / dims.h) * 100}%`}
              width={`${(t.width / dims.w) * 100}%`}
              height={`${(t.height / dims.h) * 100}%`}
            />
          ))}
      {/* Right column only: the merge link badge, marking a table's part in a merge — one
          joined into another table's grid, or the root of such a grid. Positioned off the
          same top-RIGHT corner as the tick, in a fixed slot immediately to its left. */}
      {dims &&
        thumbnailOverlayTables
          .filter((t) => t.mergeRole)
          .map((t) => (
            <MergeLinkBadge
              key={`merge-${t.tableId}`}
              left={`${((t.left + t.width) / dims.w) * 100}%`}
              top={`${(t.top / dims.h) * 100}%`}
              role={t.mergeRole}
            />
          ))}
      {onHoverTable && hovered && (
        <div
          data-testid={'hover-label'}
          style={{
            position: 'absolute',
            left: hovered.x,
            // Sit just above the table top-left: the label is 12px text + 2px
            // padding all round, so lift it by that full height. If that would push
            // the label off the top of the image, clamp it down to 0 so it stays
            // visible (rare — only a table flush against the top edge).
            top: Math.max(0, hovered.y - (12 + 2 * 2)),
            backgroundColor: gridLineColour(),
            color: 'white',
            fontFamily: 'sans-serif',
            fontSize: 12,
            lineHeight: '12px',
            // 2px larger all round than the contained text.
            padding: 2,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            // Name and size are separated by a 1px vertical divider for clarity.
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          <span data-testid={'hover-label-name'}>{hovered.table.name}</span>
          <span
            data-testid={'hover-label-divider'}
            style={{
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: 'white',
              margin: '0 6px',
            }}
          />
          <span data-testid={'hover-label-size'}>
            {`${hovered.table.columnWidths.length} × ${hovered.table.rowHeights.length} cells`}
          </span>
          {hovered.table.locked && (
            <>
              <span
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  backgroundColor: 'white',
                  margin: '0 6px',
                }}
              />
              <span data-testid={'hover-label-locked'}>
                {hovered.table.lockedMessage}
              </span>
            </>
          )}
        </div>
      )}
      {/* Per-cell confidence squares: one ~8×8 screen-px marker in the bottom-right corner
          (inset 1px inside the drawn grid lines) of every OCCUPIED grid square, coloured by
          the cell's confidence. HTML siblings of the SVG (which uses preserveAspectRatio
          "none" and would distort fixed-size shapes), positioned in screen px via
          overlayScale. Iterating cells yields exactly the occupied squares, tolerating a
          sparse/missing list; a spanning cell is placed at its top-left square. */}
      {confidenceSquares.map((sq) => (
        <div
          key={`${sq.tableId}-${sq.r}-${sq.c}`}
          data-testid={`confidence-square-${sq.tableId}-${sq.r}-${sq.c}`}
          data-colour={sq.colour}
          onMouseEnter={() =>
            setCellHover({ tableId: sq.tableId, r: sq.r, c: sq.c })
          }
          onMouseMove={(e) => {
            // Track the pointer x (overlay-local screen px) so the cell-text overlay can
            // slide clear of the mouse. Origin matches eventToFraction (imgRef rect).
            const img = imgRef.current;
            if (!img) return;
            const mouseX = e.clientX - img.getBoundingClientRect().left;
            setCellHover({ tableId: sq.tableId, r: sq.r, c: sq.c, mouseX });
          }}
          onMouseLeave={() => setCellHover(null)}
          onClick={() => toggleCellConfidence(sq.tableId, sq.r, sq.c)}
          style={{
            position: 'absolute',
            left: sq.left,
            top: sq.top,
            width: sq.size,
            height: sq.size,
            backgroundColor: CONFIDENCE_COLOUR_VARS[sq.colour],
            cursor: 'pointer',
          }}
        />
      ))}
      {/* Per-row confidence squares: one ~8×8 screen-px marker 10px beyond the table's
          right-hand edge, its BOTTOM level with the bottom of the row it refers to, coloured
          by that row's confidence (rowHeights[i].confidence). Display-only — no click or
          hover handlers. HTML siblings of the SVG (which uses preserveAspectRatio "none" and
          would distort fixed-size shapes), positioned in screen px via overlayScale. */}
      {rowConfidenceSquares.map((sq) => (
        <div
          key={`row-confidence-square-${sq.tableId}-${sq.r}`}
          data-testid={`row-confidence-square-${sq.tableId}-${sq.r}`}
          data-colour={sq.colour}
          style={{
            position: 'absolute',
            left: sq.left,
            top: sq.top,
            width: sq.size,
            height: sq.size,
            backgroundColor: CONFIDENCE_COLOUR_VARS[sq.colour],
          }}
        />
      ))}
      {/* Header-row indication markers: one HTML marker just outside the table grid to
          the right, vertically centred on each relevant row (row centre = midpoint of the
          row's cumulative band). Driven solely by headerCount (null -> 0): header rows
          0..h-1 show an "H"; the last header row (h-1) shows "H -" and DECREMENTS on click
          (floor 0); the first non-header row h (only when h < R) shows "+ H" and INCREMENTS
          on click (ceiling R). HTML siblings of the SVG (which uses preserveAspectRatio
          "none" and would distort fixed shapes), positioned in screen px via overlayScale
          exactly like the confidence squares. Each marker carries a stable testid
          header-marker-<tableId>-<row> plus a data-variant of 'H' | 'H-' | '+H'. */}
      {headerMarkers.map((m) => (
        <div
          key={`header-marker-${m.tableId}-${m.r}`}
          data-testid={`header-marker-${m.tableId}-${m.r}`}
          data-variant={m.variant}
          onClick={
            m.clickable
              ? () =>
                  adjustHeaderCount(m.tableId, m.variant === '+H' ? 1 : -1)
              : undefined
          }
          style={{
            position: 'absolute',
            left: m.left,
            top: m.top,
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            marginLeft: 3,
            cursor: m.clickable ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {/* Left-facing point of the box. */}
          <span
            style={{
              width: 0,
              height: 0,
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderRight: `5px solid ${gridLineColour()}`,
            }}
          />
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 14,
              padding: '0 4px',
              border: `1px solid ${gridLineColour()}`,
              borderLeft: 'none',
              backgroundColor: 'white',
              color: gridLineColour(),
              fontFamily: 'sans-serif',
              fontSize: 11,
              lineHeight: '14px',
              whiteSpace: 'nowrap',
            }}
          >
            {m.glyph}
          </span>
        </div>
      ))}
      {/* Cell-text overlay for the hovered confidence square: shows the cell's text in a
          box placed BESIDE the cell so the cell stays visible — directly below the cell if
          it fits within the image, otherwise to its right, otherwise above (see
          chooseCellTextPlacement). Positioned by its own top-left corner (no translate).
          pointerEvents:'none' so it never interferes with drag / hit-line handling
          underneath. */}
      {hoveredCell && hoveredCellRect && renderedSize && (
        <div
          ref={cellTextRef}
          data-testid={'cell-text-overlay'}
          style={{
            position: 'absolute',
            ...(() => {
              const { left, top } = chooseCellTextPlacement(
                hoveredCellRect,
                cellTextSize ?? { width: 0, height: 0 },
                { width: renderedSize.width, height: renderedSize.height },
                cellHover.mouseX
              );
              return { left, top };
            })(),
            maxWidth: '80%',
            backgroundColor: 'white',
            color: 'black',
            fontFamily: 'sans-serif',
            fontSize: 12,
            lineHeight: 1.3,
            padding: 4,
            boxSizing: 'border-box',
            textAlign: 'center',
            pointerEvents: 'none',
            border: `1px solid ${gridLineColour()}`,
          }}
        >
          {hoveredCell.text}
        </div>
      )}
      {/* Cell-content editor popup: a draggable/resizable box seeded with the clicked
          cell's text. Absolutely positioned inside the relative Box, pointerEvents 'auto'
          so it is interactive. stopPropagation on its own clicks so they never bubble to
          the SVG's handleBackgroundClick (which would re-resolve/reopen). Placement seeded
          below the cell, lifted above by the layout effect when it fits. */}
      {cellEditor && editorPos && (
        <div
          ref={editorRef}
          data-testid={'cell-editor'}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: editorPos.left,
            top: editorPos.top,
            backgroundColor: 'white',
            border: `1px solid ${gridLineColour()}`,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            zIndex: 10,
          }}
        >
          {/* Grab handle: drag to move the popup. */}
          <div
            data-testid={'cell-editor-handle'}
            onMouseDown={handleEditorDragStart}
            style={{
              height: 16,
              cursor: 'move',
              backgroundColor: gridLineColour(),
              flexShrink: 0,
            }}
          />
          {/* Entry field with the commit/cancel buttons stacked to its right. */}
          <div
            style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' }}
          >
            <textarea
              data-testid={'cell-editor-text'}
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              rows={editorInitRef.current.rows}
              style={{
                width: `${editorInitRef.current.widthCh}ch`,
                resize: 'both',
                overflow: 'auto',
                boxSizing: 'border-box',
                fontFamily: 'sans-serif',
                fontSize: 12,
                padding: 4,
              }}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 4,
                gap: 4,
              }}
            >
              {/* Tick: white on a green disk. */}
              <IconButton
                data-testid={'cell-editor-save'}
                size={'small'}
                onClick={handleEditorSave}
                sx={{
                  backgroundColor: 'success.main',
                  color: 'common.white',
                  '&:hover': { backgroundColor: 'success.dark' },
                }}
              >
                <Check fontSize={'small'} />
              </IconButton>
              {/* Cross: white on a red disk. */}
              <IconButton
                data-testid={'cell-editor-cancel'}
                size={'small'}
                onClick={handleEditorCancel}
                sx={{
                  backgroundColor: 'error.main',
                  color: 'common.white',
                  '&:hover': { backgroundColor: 'error.dark' },
                }}
              >
                <Close fontSize={'small'} />
              </IconButton>
            </div>
          </div>
        </div>
      )}
      {/* Popup menu for a clicked internal grid line OR outer boundary edge, anchored at
          the mouse-up screen position. Every action commits through commitTableEdit
          (keeping the axis SUM, hence bounds, fixed) then closes the menu. An internal
          divider's items depend on its orientation (Delete only while the axis has >= 2
          cells so the last cell survives); a boundary edge shows a single inward "Add". */}
      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorReference={'anchorPosition'}
        anchorPosition={
          menu ? { top: menu.clientY, left: menu.clientX } : undefined
        }
      >
        {menu && menu.addTable
          ? [
              <MenuItem key={'add-table'} onClick={handleAddTable}>
                {'Add table'}
              </MenuItem>,
            ]
          : boundaryMenuItem
          ? [
              <MenuItem
                key={'boundary-add'}
                onClick={() =>
                  runMenuAction(
                    boundaryMenuItem.axisKey,
                    boundaryMenuItem.action,
                    boundaryMenuItem.map
                  )
                }
              >
                {boundaryMenuItem.label}
              </MenuItem>,
              calcAvailable && (
                <MenuItem
                  key={'calculate'}
                  onClick={() => {
                    setCalcDialog({ tableId: menu.tableId });
                    setCalcRows('');
                    setCalcCols('');
                    setMenu(null);
                  }}
                >
                  {'Calculate'}
                </MenuItem>
              ),
              recalcAvailable && (
                <MenuItem
                  key={'recalculate'}
                  onClick={() => handleRecalculate(menu.tableId)}
                >
                  {'Recalculate'}
                </MenuItem>
              ),
              <MenuItem
                key={'delete-table'}
                onClick={() => {
                  setConfirmDelete({ tableId: menu.tableId });
                  setMenu(null);
                }}
              >
                {'Delete Table'}
              </MenuItem>,
            ]
          : menu && menuVertical
          ? [
              menuAxis.length >= 2 && (
                <MenuItem
                  key={'delete'}
                  onClick={() =>
                    runMenuAction(
                      'columnWidths',
                      (arr) => mergeCells(arr, menu.lineIndex),
                      (len) => mergeMap(len, menu.lineIndex)
                    )
                  }
                >
                  {'Delete'}
                </MenuItem>
              ),
              <MenuItem
                key={'add-left'}
                onClick={() =>
                  runMenuAction(
                    'columnWidths',
                    (arr) => splitEntry(arr, menu.lineIndex - 1),
                    (len) => splitMap(len, menu.lineIndex - 1)
                  )
                }
              >
                {'Add Left'}
              </MenuItem>,
              <MenuItem
                key={'add-right'}
                onClick={() =>
                  runMenuAction(
                    'columnWidths',
                    (arr) => splitEntry(arr, menu.lineIndex),
                    (len) => splitMapBelow(len, menu.lineIndex)
                  )
                }
              >
                {'Add Right'}
              </MenuItem>,
            ]
          : menu
          ? [
              menuAxis.length >= 2 && (
                <MenuItem
                  key={'delete'}
                  onClick={() =>
                    runMenuAction(
                      'rowHeights',
                      (arr) => mergeCells(arr, menu.lineIndex),
                      (len) => mergeMap(len, menu.lineIndex)
                    )
                  }
                >
                  {'Delete'}
                </MenuItem>
              ),
              <MenuItem
                key={'add-above'}
                onClick={() =>
                  runMenuAction(
                    'rowHeights',
                    (arr) => splitEntry(arr, menu.lineIndex - 1),
                    (len) => splitMap(len, menu.lineIndex - 1)
                  )
                }
              >
                {'Add Above'}
              </MenuItem>,
              <MenuItem
                key={'add-below'}
                onClick={() =>
                  runMenuAction(
                    'rowHeights',
                    (arr) => splitEntry(arr, menu.lineIndex),
                    (len) => splitMapBelow(len, menu.lineIndex)
                  )
                }
              >
                {'Add Below'}
              </MenuItem>,
            ]
          : null}
      </Menu>
      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>{'Are you sure?'}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>{'Cancel'}</Button>
          <Button
            onClick={() => {
              const t = (metadataTables ?? []).find(
                (x) => x.tableId === confirmDelete.tableId
              );
              if (t) commitTableEdit(confirmDelete.tableId, { ...t, deleted: true });
              setConfirmDelete(null);
            }}
          >
            {'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(calcDialog)}
        onClose={() => {
          if (!calcBusy) setCalcDialog(null);
        }}
      >
        <DialogTitle>{'Calculate table'}</DialogTitle>
        <DialogContent>
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
          >
            <TextField
              label={'Number of rows'}
              type={'number'}
              value={calcRows}
              onChange={(e) => setCalcRows(e.target.value)}
              disabled={calcBusy}
            />
            <TextField
              label={'Number of columns'}
              type={'number'}
              value={calcCols}
              onChange={(e) => setCalcCols(e.target.value)}
              disabled={calcBusy}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button disabled={calcBusy} onClick={() => setCalcDialog(null)}>
            {'Cancel'}
          </Button>
          <Button disabled={calcBusy} onClick={handleCalculate}>
            {'Calculate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
