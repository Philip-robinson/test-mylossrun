'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import toast from 'react-hot-toast';
import {
  colourSpecialToolKeys,
  documentDimOpacity,
  hitLineWidthPx,
  layerBorderColour,
  layerColoursBackgroundColour,
  layerColoursColour,
  layerColumnsColour,
  layerGrey,
  layerRowsColour,
  layerSpecialCellsColour,
  sectionTitleMarkerColour,
  sectionTitleMarkerDash,
  sectionTitlePlaceholderColumnName,
  selectedColouredAreaHighlight,
  selectedColumnHighlight,
  selectedRowHighlight,
  selectedSectionTitleHighlight,
} from 'config';
import { newUUID } from 'common/utils';
import {
  analysePeakColours,
  rgbToHex,
  rgbaToPixels,
} from 'components/pdfTableViewer/colourUtils';
import {
  clampBoundaryTarget,
  cleanupAxis,
  cumulative,
  findTableById,
  identityMap,
  makeDefaultCell,
  mergeCells,
  mergeMap,
  moveDivider,
  overlaps,
  reconcileAxisEdit,
  replaceTableById,
  resizeBoundary,
  splitEntryAt,
  splitMap,
  tablesOnPage,
} from 'components/pdfTableViewer/tableSupportUtils';
import {
  cellBounds,
  columnBounds,
  columnIndexAtFraction,
  rowBounds,
  rowIndexAtFraction,
  rowNearestCentre,
} from 'components/pdfTableViewer/gridToolUtils';

// A mouse gesture that moves less than this many SCREEN pixels between mouse-down and
// mouse-up is treated as a CLICK, not a resize DRAG. Mirrors the existing interactive
// editor so a stray click on a boundary edge never nudges the geometry.
const CLICK_DRAG_THRESHOLD_PX = 4;

// data-testid on the transparent wide-stroke hit lines that receive the boundary drag
// pointer events. The visible <rect> border never carries it, so tests can count the
// two independently.
const HIT_LINE_TESTID = 'hit-line';

// data-testids for the Rows / Columns mode grid lines. Each internal divider draws a
// visible coloured line (…-line), a transparent wide-stroke hit line that receives the
// click/drag pointer events (…-hit-line), and — when selected — a transparent highlight
// line on each side (…-selected-highlight).
const ROW_LINE_TESTID = 'row-line';
const ROW_HIT_TESTID = 'row-hit-line';
const ROW_HIGHLIGHT_TESTID = 'row-selected-highlight';
const COLUMN_LINE_TESTID = 'column-line';
const COLUMN_HIT_TESTID = 'column-hit-line';
const COLUMN_HIGHLIGHT_TESTID = 'column-selected-highlight';

// data-testids for the Special Cells mode overlays: the dotted title rectangle, the black
// dotted header rectangle, and the four transparent hit lines drawn on the title's sides
// while the Set-Title sub-mode is active (so its bounds can be resized by dragging).
const TITLE_RECT_TESTID = 'title-rect';
const HEADER_RECT_TESTID = 'header-rect';
const TITLE_HIT_TESTID = 'title-hit-line';

// Screen-px margin drawn OUTSIDE the first headerCount rows for the header rectangle.
const HEADER_MARGIN_PX = 3;

// Upper bound on the number of pixels handed to analysePeakColours when sampling a
// coloured area's region — a large selection is sub-sampled down to roughly this many
// so the histogram stays cheap.
const COLOUR_SAMPLE_MAX_PIXELS = 4000;

// Build a fresh manually-created 1×1 table anchored at page-fraction bounds `b`
// ({left, top, width, height}), spliced into `list` just after the last same-page table.
// Returns { table, list } on success or null when it does not fit the page or overlaps an
// existing same-page table (edge-touching allowed). tableInPage is interpolated from where
// the new top falls among every same-page table's top (including deleted and nested `next`
// tables), matching the existing editor's handleAddTable.
function buildManualTable(list, page, b, pixelWidth, pixelHeight) {
  const { left: L, top: T, width: W, height: H } = b;
  if (W <= 0 || H <= 0) return null;
  const fitsOnPage = L >= 0 && T >= 0 && L + W <= 1 && T + H <= 1;
  if (!fitsOnPage) return null;

  const candidate = { left: L, top: T, width: W, height: H };
  const overlapsExisting = (list ?? [])
    .filter((o) => o.pdfPage === page && !o.deleted)
    .some((o) => overlaps(candidate, o.bounds));
  if (overlapsExisting) return null;

  const tabs = (list ?? []).filter((t) => t.pdfPage === page).length;

  // Exhaustive top-position collection: top-level list plus every nested `next` table.
  const allTables = [];
  const collect = (arr) => {
    (arr ?? []).forEach((t) => {
      allTables.push(t);
      if (t.next) collect(Object.values(t.next));
    });
  };
  collect(list);
  let above = null;
  let below = null;
  allTables
    .filter((t) => t.pdfPage === page)
    .forEach((t) => {
      const top = t.bounds.top;
      if (top < T) {
        if (above === null || top > above.bounds.top) above = t;
      } else if (below === null || top < below.bounds.top) below = t;
    });
  let tableInPage;
  if (above && below) {
    tableInPage = ((above.tableInPage ?? 0) + (below.tableInPage ?? 0)) / 2;
  } else if (above) {
    tableInPage = (above.tableInPage ?? 0) + 1;
  } else if (below) {
    tableInPage = (below.tableInPage ?? 0) - 1;
  } else {
    tableInPage = 0;
  }

  const bounds = { top: T, left: L, width: W, height: H };
  const table = {
    tableId: newUUID(),
    name: `Page ${page + 1} Table ${tabs + 1}`,
    next: null,
    pdfPage: page,
    tableInPage,
    headerCount: 0,
    confidence: 100,
    bounds,
    cells: [makeDefaultCell(0, 0, bounds)],
    title: null,
    sectionTitles: null,
    footer: null,
    columnWidths: [{ value: W, confidence: 100 }],
    rowHeights: [{ value: H, confidence: 100 }],
    extractionMechanism: 'MANUAL',
    confirmationStage: null,
  };

  let lastIdx = -1;
  (list ?? []).forEach((t, i) => {
    if (t.pdfPage === page) lastIdx = i;
  });
  const insertAt = lastIdx >= 0 ? lastIdx + 1 : (list ?? []).length;
  const next = [
    ...(list ?? []).slice(0, insertAt),
    table,
    ...(list ?? []).slice(insertAt),
  ];
  return { table, list: next };
}

// The staged interactive canvas: a base64 page image under an SVG overlay, drawn for one of
// the editor's two passes. In borderMode the selected table's boundary is drawn and
// draggable, with no grid inside it; in gridMode the boundary is frozen, each axis is drawn
// in its layer's colour or grey according to that layer's flag, and the armed tool decides
// what a click on the page does.
export function StagedPageGridEditor({
  image,
  pixelWidth,
  pixelHeight,
  page,
  metadataTables,
  selectedTableId,
  onSelectTable,
  // 'border' (the boundary pass) or 'grid' (the contents pass).
  editorMode = 'border',
  // The armed grid tool ('rows' | 'columns' | 'special' | null) and, for the Special tool,
  // which of its entries is armed. Both are null in borderMode.
  tool = null,
  specialTool = null,
  // Which layers are drawn in gridMode: { rows, columns, special, colours }. A missing key
  // reads as on. Every layer is treated as off in borderMode.
  layerVisibility = {},
  dim = false,
  onEditTables,
  onCreatedTable,
  pdfId, // eslint-disable-line no-unused-vars -- reserved for Calculate wiring (Task 13)
  onRequestCreate,
  onRequestDelete,
  onSelectedLineChange,
  onSelectedSectionRowChange,
  colouredAreas = [],
  selectedColouredIndex = null,
  onSelectColouredArea,
  onColouredAreasChange,
  // The coloured-area tools' draft: which rows / columns / rectangle are picked but not yet
  // written out. Owned by the host; this reports every change to it.
  pendingSelection = null,
  onPendingSelectionChange,
  // Reports the colours sampled from under a selection the moment it becomes non-empty, so
  // the host's swatches open on a sensible guess.
  onColourSeed,
  colourPickMode = null,
  onColourPicked,
  onColourPreview,
  onClearColourPick,
}) {
  const [dims, setDims] = useState(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [renderedSize, setRenderedSize] = useState(null);

  // Colours mode colour-pick drag: true while dragging to pick a pixel colour for the
  // selected area's foreground/background. The pixel under the cursor is previewed live
  // (onColourPreview) as the pointer moves and committed (onColourPicked) on release.
  const colourPickDragRef = useRef(false);

  // Rubber-band "create table" mode, entered imperatively via startCreate (handed up
  // through onRequestCreate). While true, an empty-area drag draws a new border.
  const [creating, setCreating] = useState(false);
  const [createRect, setCreateRect] = useState(null); // page-fraction {left,top,width,height}

  // The selected internal grid line in Rows / Columns mode: { orientation: 'row' | 'column',
  // index } (index is the 1-based divider index k) or null. Reported up via
  // onSelectedLineChange so the Options block (Task 13) can enable/disable its buttons.
  const [selectedLine, setSelectedLine] = useState(null);

  // The Rows / Columns tools' new-line gesture: a press in empty space draws a line that
  // follows the pointer and is written where it is released. `newLine` is the live preview
  // ({ orientation, position } in page fractions); the ref carries the gesture itself.
  const [newLine, setNewLine] = useState(null);
  const newLineDragRef = useRef(null);

  // The selected section-title row's `tableRow` (its 0-based row band in the selected
  // table), or null. `sectionAreaRect` is the live rubber-band preview (page fractions)
  // while the Section Title Row tool drags out a title's data area.
  const [selectedSectionRow, setSelectedSectionRow] = useState(null);
  const [sectionAreaRect, setSectionAreaRect] = useState(null);
  const sectionAreaDragRef = useRef(null);

  // Live boundary-drag gesture, or null when idle (a ref so the window listeners see the
  // current value without re-subscribing). The rubber-band gestures use their own refs.
  const dragRef = useRef(null);
  const createDragRef = useRef(null);

  // The browser fires a trailing `click` on the svg after any drag mouseup. Suppress that
  // one click so it is not mistaken for a select/create gesture.
  const suppressNextClickRef = useRef(false);

  // This page's tables: those in the top-level list, plus those joined under another table's
  // grid. A saved link grid moves the joined tables off the top-level list, but they are on
  // the page and are selected and edited like any other.
  const samePage = useMemo(
    () => tablesOnPage(metadataTables, page),
    [metadataTables, page]
  );

  // The selected table: the one whose id matches, else the first same-page non-deleted table.
  const selected = useMemo(
    () =>
      samePage.find((t) => t.tableId === selectedTableId) ?? samePage[0] ?? null,
    [samePage, selectedTableId]
  );

  // What the two passes draw. borderMode is about boundaries alone, so every layer flag
  // reads off there whatever the host holds; gridMode honours the flags, a missing key
  // reading as on. The Header tool draws the header rectangle whatever the Special flag
  // says, and suppresses the other special areas while it is armed.
  const gridMode = editorMode === 'grid';
  const showRows = gridMode && layerVisibility.rows !== false;
  const showColumns = gridMode && layerVisibility.columns !== false;
  const showSpecial = gridMode && layerVisibility.special !== false;
  const headerToolArmed = gridMode && tool === 'special' && specialTool === 'header';
  const showHeader = showSpecial || headerToolArmed;
  const showOtherSpecial = showSpecial && !headerToolArmed;

  // Grid lines are draggable throughout the contents pass. An armed Rows or Columns tool
  // does not take the drag away — it decides what a press that does NOT move means, which
  // handleDragEnd settles on release.
  const linesDraggable = gridMode;

  // The axis a tool is armed for, or null: 'row' for the Rows tool, 'column' for Columns.
  const toolFor = (orientation) =>
    (orientation === 'row' && tool === 'rows') ||
    (orientation === 'column' && tool === 'columns');

  // Convert a pointer event's screen coordinates to page fractions (0..1). Null when the
  // geometry is not ready. X and Y scale independently (preserveAspectRatio="none").
  const eventToFraction = useCallback(
    (e) => {
      const img = imgRef.current;
      if (!img || !dims || !pixelWidth || !pixelHeight) return null;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const sx = rect.width / dims.w;
      const sy = rect.height / dims.h;
      const vx = (e.clientX - rect.left) / sx;
      const vy = (e.clientY - rect.top) / sy;
      return { fx: vx / pixelWidth, fy: vy / pixelHeight };
    },
    [dims, pixelWidth, pixelHeight]
  );

  const onePxFractionX = pixelWidth ? 1 / pixelWidth : 0;
  const onePxFractionY = pixelHeight ? 1 / pixelHeight : 0;

  // Commit exactly one edited table back to the parent (immutable replace by tableId,
  // reaching into a root's `next` for a table joined into its grid).
  const commitTableEdit = useCallback(
    (tableId, newTable) => {
      onEditTables(replaceTableById(metadataTables ?? [], tableId, newTable));
    },
    [metadataTables, onEditTables]
  );

  // ---- Coloured-area pixel sampling ---------------------------------------------------

  // Draw the loaded page image onto a hidden canvas at its natural size so the coloured-area
  // tools can read back pixel colours. Guarded for jsdom / browsers without a 2d context —
  // the sampling helpers below simply return null / [] when the draw never happened.
  useEffect(() => {
    if (!dims || !image) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    try {
      canvas.width = dims.w;
      canvas.height = dims.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, dims.w, dims.h);
    } catch {
      // No usable 2d context (jsdom); sampling degrades to the analyse-colours defaults.
    }
  }, [dims, image]);

  // The hex colour of a single page pixel at page fractions (fx, fy), or null when no
  // pixel data is available (jsdom, tainted canvas, no context).
  const samplePixelHex = useCallback(
    (fx, fy) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas || !dims) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx || !ctx.getImageData) return null;
        const x = Math.round(fx * dims.w);
        const y = Math.round(fy * dims.h);
        const { data } = ctx.getImageData(x, y, 1, 1);
        return rgbToHex({ r: data[0], g: data[1], b: data[2] });
      } catch {
        return null;
      }
    },
    [dims]
  );

  // Every {r,g,b} pixel inside a page-fraction bounds rectangle, sub-sampled to at most
  // COLOUR_SAMPLE_MAX_PIXELS. Returns [] when no pixel data is available (jsdom).
  const sampleRegionPixels = useCallback(
    (bounds) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas || !dims) return [];
        const ctx = canvas.getContext('2d');
        if (!ctx || !ctx.getImageData) return [];
        const x = Math.round(bounds.left * dims.w);
        const y = Math.round(bounds.top * dims.h);
        const w = Math.max(1, Math.round(bounds.width * dims.w));
        const h = Math.max(1, Math.round(bounds.height * dims.h));
        const { data } = ctx.getImageData(x, y, w, h);
        const all = rgbaToPixels(data);
        if (all.length <= COLOUR_SAMPLE_MAX_PIXELS) return all;
        const step = Math.ceil(all.length / COLOUR_SAMPLE_MAX_PIXELS);
        const out = [];
        for (let i = 0; i < all.length; i += step) out.push(all[i]);
        return out;
      } catch {
        return [];
      }
    },
    [dims]
  );

  // ---- Boundary resize drag (Border mode) ---------------------------------------------

  const handleDragMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    const { kind, tableId } = drag;
    // Coloured-area side resize (Colours mode): move exactly one edge of the dragged
    // area, keeping the opposite edge fixed, clamped inside the page. Reads the ORIGINAL
    // area from the mouse-down closure so the maths is absolute, not incremental.
    if (
      kind === 'carea-left' ||
      kind === 'carea-right' ||
      kind === 'carea-top' ||
      kind === 'carea-bottom'
    ) {
      const areas = colouredAreas ?? [];
      const a = areas[drag.areaIndex];
      if (!a) return;
      const b = { ...a };
      if (kind === 'carea-left') {
        const right = a.left + a.width;
        const nl = Math.max(0, Math.min(frac.fx, right));
        b.left = nl;
        b.width = right - nl;
      } else if (kind === 'carea-right') {
        const nr = Math.min(1, Math.max(frac.fx, a.left));
        b.width = nr - a.left;
      } else if (kind === 'carea-top') {
        const bottom = a.top + a.height;
        const nt = Math.max(0, Math.min(frac.fy, bottom));
        b.top = nt;
        b.height = bottom - nt;
      } else {
        const nb = Math.min(1, Math.max(frac.fy, a.top));
        b.height = nb - a.top;
      }
      const next = areas.map((x, idx) => (idx === drag.areaIndex ? b : x));
      drag.last = next;
      if (onColouredAreasChange) onColouredAreasChange(next);
      return;
    }
    // Section-title data-area side resize (Special Cells): move exactly one edge of the
    // selected section-title row's data rectangle, keeping the opposite edge fixed.
    if (
      kind === 'sarea-left' ||
      kind === 'sarea-right' ||
      kind === 'sarea-top' ||
      kind === 'sarea-bottom'
    ) {
      const st = (metadataTables ?? []).find((x) => x.tableId === tableId);
      if (!st) return;
      const list = st.sectionTitles ?? [];
      const entry = list.find((s) => s.tableRow === drag.sectionRow);
      if (!entry || !entry.data) return;
      const b = { ...entry.data.bounds };
      if (kind === 'sarea-left') {
        const right = b.left + b.width;
        const nl = Math.max(0, Math.min(frac.fx, right));
        b.left = nl;
        b.width = right - nl;
      } else if (kind === 'sarea-right') {
        const nr = Math.min(1, Math.max(frac.fx, b.left));
        b.width = nr - b.left;
      } else if (kind === 'sarea-top') {
        const bottom = b.top + b.height;
        const nt = Math.max(0, Math.min(frac.fy, bottom));
        b.top = nt;
        b.height = bottom - nt;
      } else {
        const nb = Math.min(1, Math.max(frac.fy, b.top));
        b.height = nb - b.top;
      }
      const nextList = list.map((s) =>
        s.tableRow === drag.sectionRow
          ? { ...s, data: { ...s.data, bounds: b } }
          : s
      );
      const newTable = { ...st, sectionTitles: nextList };
      drag.last = newTable;
      commitTableEdit(tableId, newTable);
      return;
    }
    const t = findTableById(metadataTables, tableId);
    if (!t) return;
    if (!drag.moved) {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.hypot(dx, dy) <= CLICK_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    // Internal grid dividers (Rows / Columns modes) move two adjacent cells
    // equal-and-opposite (or squeeze a crossed cell to 0) without touching bounds.
    if (kind === 'grid-v' || kind === 'grid-h') {
      const { k } = drag;
      const vertical = kind === 'grid-v';
      const cells = (vertical ? t.columnWidths : t.rowHeights) ?? [];
      const origin = vertical ? t.bounds.left : t.bounds.top;
      const span = vertical ? t.bounds.width : t.bounds.height;
      const minFrac = vertical ? onePxFractionX : onePxFractionY;
      const raw = vertical ? frac.fx : frac.fy;
      // Clamp the divider strictly inside the table area, one rendered pixel from each edge.
      const p = Math.max(
        origin + minFrac,
        Math.min(origin + span - minFrac, raw)
      );
      const moved = moveDivider(cells, k, p, origin);
      const newTable = vertical
        ? { ...t, columnWidths: moved }
        : { ...t, rowHeights: moved };
      drag.last = newTable;
      commitTableEdit(tableId, newTable);
      return;
    }
    const xAxis = kind === 'boundary-left' || kind === 'boundary-right';
    let p = xAxis ? frac.fx : frac.fy;
    const others = (metadataTables ?? []).filter(
      (o) => o.tableId !== tableId && o.pdfPage === t.pdfPage && !o.deleted
    );
    p = clampBoundaryTarget(kind, p, t, others, onePxFractionX, onePxFractionY);
    const newTable = resizeBoundary(kind, p, t, onePxFractionX, onePxFractionY);
    drag.last = newTable;
    commitTableEdit(tableId, newTable);
  };

  const handleDragEnd = () => {
    const drag = dragRef.current;
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    // Coloured-area side resize (Colours mode): interim edits committed during the move are
    // the final state (bounds only), so just tear down the listeners.
    if (
      drag &&
      (drag.kind === 'carea-left' ||
        drag.kind === 'carea-right' ||
        drag.kind === 'carea-top' ||
        drag.kind === 'carea-bottom')
    ) {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      return;
    }
    // Section-title data-area side resize (Special Cells): interim edits committed during
    // the move are the final state (bounds only), so just tear down the listeners.
    if (
      drag &&
      (drag.kind === 'sarea-left' ||
        drag.kind === 'sarea-right' ||
        drag.kind === 'sarea-top' ||
        drag.kind === 'sarea-bottom')
    ) {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      return;
    }
    // Internal grid-line gesture. A sub-threshold gesture is a press-and-release: with the
    // matching tool armed that DELETES the line, and otherwise it selects it. A real drag
    // reconciles the moved divider either way.
    if (drag && (drag.kind === 'grid-v' || drag.kind === 'grid-h')) {
      const orientation = drag.kind === 'grid-v' ? 'column' : 'row';
      if (!drag.moved && toolFor(orientation)) {
        dragRef.current = null;
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        deleteDividerAt(
          orientation === 'column' ? 'columnWidths' : 'rowHeights',
          drag.k
        );
        return;
      }
      if (!drag.moved) {
        setSelectedLine({
          orientation,
          index: drag.k,
        });
      } else {
        const orig = (metadataTables ?? []).find(
          (x) => x.tableId === drag.tableId
        );
        const finalTable = drag.last ?? orig;
        if (finalTable) {
          const vertical = drag.kind === 'grid-v';
          const axis = (vertical ? finalTable.columnWidths : finalTable.rowHeights) ?? [];
          // Treat anything at or below half a rendered pixel as a squeezed 0.
          const epsilon = (vertical ? onePxFractionX : onePxFractionY) * 0.5;
          const cleaned = cleanupAxis(axis, epsilon);
          // Index map for the cleaned axis: survivors are the entries above epsilon, in
          // order; if cleanup would empty the axis it keeps the single largest entry
          // (mirroring cleanupAxis). moveDivider preserves the entry count, so these
          // indices also address the pre-drag axis.
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
          // Reconcile against the PRE-DRAG geometry (`prev`) so only cells whose grid square
          // actually shifted reset confidence; commit onto the final interim table so its
          // untouched axis is kept. The move keeps bounds fixed.
          const prev = orig ?? finalTable;
          commitTableEdit(
            drag.tableId,
            reconcileAxisEdit(
              prev,
              finalTable,
              vertical ? 'columnWidths' : 'rowHeights',
              cleaned,
              changedMap,
              prev.bounds
            )
          );
        }
      }
      dragRef.current = null;
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      return;
    }
    // Only a boundary DRAG (moved past the threshold) reconciles; a sub-threshold click
    // makes no change (no menus in the staged editor).
    if (drag && drag.moved && drag.last) {
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
        const removed = oldLen - newAxis.length;
        const axisMap =
          removed > 0 && fromFront
            ? Array.from({ length: newAxis.length }, (_, j) => j + removed)
            : identityMap(newAxis.length);
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
    dragRef.current = null;
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  };

  const handleHit = (identity, e) => {
    if (!onEditTables) return;
    const { kind, tableId } = identity;
    if (
      kind !== 'boundary-left' &&
      kind !== 'boundary-right' &&
      kind !== 'boundary-top' &&
      kind !== 'boundary-bottom'
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      tableId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // Begin an internal grid-line gesture (Rows / Columns modes). `orientation` is 'row' (a
  // horizontal divider on rowHeights) or 'column' (a vertical divider on columnWidths); `k`
  // is the 1-based divider index. A sub-threshold release selects the line; a drag moves it.
  const handleLineHit = (orientation, k, e) => {
    if (!onEditTables || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: orientation === 'column' ? 'grid-v' : 'grid-h',
      tableId: selected.tableId,
      k,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // Begin a coloured-area side resize (Colours mode). `kind` is one of
  // 'carea-left' | 'carea-right' | 'carea-top' | 'carea-bottom'; `index` is the area's
  // position in `colouredAreas`. Any displayed area is resizable, selected or not.
  const handleColouredSideHit = (kind, index, e) => {
    if (!onColouredAreasChange) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      areaIndex: index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // Begin a section-title data-area side resize (Special Cells). `kind` is one of
  // 'sarea-left' | 'sarea-right' | 'sarea-top' | 'sarea-bottom'; `sectionRow` is the
  // owning section-title's `tableRow`.
  const handleSectionAreaSideHit = (kind, sectionRow, e) => {
    if (!onEditTables || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      tableId: selected.tableId,
      sectionRow,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // ---- Rubber-band create drag --------------------------------------------------------

  const handleCreateMove = (e) => {
    const c = createDragRef.current;
    if (!c) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    c.curX = frac.fx;
    c.curY = frac.fy;
    setCreateRect({
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    });
  };

  const handleCreateEnd = () => {
    window.removeEventListener('mousemove', handleCreateMove);
    window.removeEventListener('mouseup', handleCreateEnd);
    const c = createDragRef.current;
    createDragRef.current = null;
    setCreating(false);
    setCreateRect(null);
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    if (!c) return;
    const b = {
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    };
    const built = buildManualTable(
      metadataTables ?? [],
      page,
      b,
      pixelWidth,
      pixelHeight
    );
    if (!built) return;
    onEditTables(built.list);
    if (onSelectTable) onSelectTable(built.table.tableId);
    if (onCreatedTable) onCreatedTable(built.table.tableId);
  };

  // ---- Section-title rows (Special Cells) ---------------------------------------------

  // The 0-based row band of the selected table that page-fraction point `frac` falls in,
  // or null when it is outside the table (matching renderHorizontalLines' cumulative math).
  const sectionRowBandAt = (frac) => {
    if (!selected) return null;
    const { left, top, width } = selected.bounds;
    if (frac.fx < left || frac.fx > left + width) return null;
    const rows = (selected.rowHeights ?? []).map((v) => v.value);
    const offsets = cumulative(rows);
    for (let r = 0; r < rows.length; r += 1) {
      const bandTop = top + (r === 0 ? 0 : offsets[r - 1]);
      const bandBottom = top + offsets[r];
      if (frac.fy >= bandTop && frac.fy <= bandBottom) return r;
    }
    return null;
  };

  // Rubber-band drag that sets the selected section-title row's data area. A gesture that
  // moves less than the click threshold is a CLICK (handled by the click handler as a row
  // selection); a real drag sets `data` (a PDFBoundedText-shaped bounds) and clears `delete`.
  const handleSectionAreaMove = (e) => {
    const c = sectionAreaDragRef.current;
    if (!c) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    c.curX = frac.fx;
    c.curY = frac.fy;
    setSectionAreaRect({
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    });
  };

  const handleSectionAreaEnd = (e) => {
    window.removeEventListener('mousemove', handleSectionAreaMove);
    window.removeEventListener('mouseup', handleSectionAreaEnd);
    const c = sectionAreaDragRef.current;
    sectionAreaDragRef.current = null;
    setSectionAreaRect(null);
    if (!c || !selected) return;
    const dx = e ? e.clientX - c.startClientX : 0;
    const dy = e ? e.clientY - c.startClientY : 0;
    // A sub-threshold gesture is a CLICK: leave the trailing click to the click handler so
    // it selects the clicked row. A real drag sets the area and suppresses that click.
    if (Math.hypot(dx, dy) <= CLICK_DRAG_THRESHOLD_PX) return;
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    const bounds = {
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    };
    if (bounds.width <= 0 || bounds.height <= 0) return;
    // The Coloured Area tool's drag picks a free-form rectangle to colour; nothing is
    // written until Submit.
    if (c.forColour) {
      reportPending({ kind: 'area', rows: [], columns: [], rect: bounds }, bounds);
      return;
    }
    // The Section Title Row tool's drag names the row nearest the drawn area's vertical
    // centre as a section title, with the drawn area as the value it supplies. The column
    // name is a placeholder: naming it properly is later work.
    const row = rowNearestCentre(selected, bounds);
    if (row == null) return;
    const list = selected.sectionTitles ?? [];
    const entry = {
      tableRow: row,
      delete: false,
      columnName: sectionTitlePlaceholderColumnName(),
      data: { bounds, text: null, confidence: null },
    };
    const nextList = list.some((s) => s.tableRow === row)
      ? list.map((s) => (s.tableRow === row ? { ...s, ...entry } : s))
      : [...list, entry];
    commitTableEdit(selected.tableId, { ...selected, sectionTitles: nextList });
    setSelectedSectionRow(row);
  };

  // ---- Colour-pick drag (a Foreground / Background swatch is armed) -------------------

  // A gesture that started in the selected area or outside every area samples a colour (for the
  // armed swatch); one that started in an unselected area does not.
  const colourGestureCanPick = (g) =>
    g.overIndexAtStart == null || g.overIndexAtStart === selectedColouredIndex;

  const handleColourPickMove = (e) => {
    const g = colourPickDragRef.current;
    if (!g) return;
    // Below the click threshold this is still a potential click; do not sample yet.
    if (
      Math.hypot(e.clientX - g.startClientX, e.clientY - g.startClientY) <=
      CLICK_DRAG_THRESHOLD_PX
    ) {
      return;
    }
    g.moved = true;
    if (!colourGestureCanPick(g) || !colourPickMode) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    const hex = samplePixelHex(frac.fx, frac.fy);
    if (hex && onColourPreview) {
      onColourPreview(hex);
      g.previewed = true;
    }
  };

  const handleColourPickEnd = (e) => {
    window.removeEventListener('mousemove', handleColourPickMove);
    window.removeEventListener('mouseup', handleColourPickEnd);
    const g = colourPickDragRef.current;
    colourPickDragRef.current = null;
    if (!g) return;
    if (g.previewed && onColourPreview) onColourPreview(null);
    // A sub-threshold gesture is a CLICK: leave it to the click handler.
    if (!g.moved) return;
    // A real drag: suppress the trailing click so it does not also select.
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    // Only a drag that started in the selected area or outside samples a colour (for the armed
    // swatch); a drag that started in an unselected area does nothing.
    if (!colourGestureCanPick(g) || !colourPickMode) return;
    const frac = e ? eventToFraction(e) : null;
    const hex = frac ? samplePixelHex(frac.fx, frac.fy) : null;
    if (hex && onColourPicked) onColourPicked(hex);
  };

  // Index of the top-most coloured area containing a fractional point, or null.
  const colouredAreaIndexAt = (frac) => {
    const areas = colouredAreas ?? [];
    for (let i = areas.length - 1; i >= 0; i -= 1) {
      const a = areas[i];
      if (
        frac.fx >= a.left &&
        frac.fx <= a.left + a.width &&
        frac.fy >= a.top &&
        frac.fy <= a.top + a.height
      ) {
        return i;
      }
    }
    return null;
  };

  const colourToolArmed =
    gridMode &&
    tool === 'special' &&
    colourSpecialToolKeys().includes(specialTool);
  // The gestures that rubber-band a rectangle rather than acting on a click.
  const armedForDrag =
    gridMode &&
    tool === 'special' &&
    (specialTool === 'sectionTitle' || specialTool === 'colouredArea');

  // Report a changed pending selection, seeding the draft colours from the page pixels
  // under it the first time it becomes non-empty — the swatches then open on a guess
  // rather than on nothing.
  const reportPending = (next, seedBounds) => {
    if (onPendingSelectionChange) onPendingSelectionChange(next);
    if (!seedBounds || !onColourSeed) return;
    const { background, foreground } = analysePeakColours(
      sampleRegionPixels(seedBounds)
    );
    onColourSeed({ foreground, background });
  };

  // Toggle one index in a pending list of rows or columns.
  const togglePending = (kind, index, boundsOf) => {
    const key = kind === 'rows' ? 'rows' : 'columns';
    const current = pendingSelection?.[key] ?? [];
    const has = current.includes(index);
    const nextList = has
      ? current.filter((i) => i !== index)
      : [...current, index];
    const next = {
      kind: nextList.length ? kind : null,
      rows: key === 'rows' ? nextList : [],
      columns: key === 'columns' ? nextList : [],
      rect: null,
    };
    reportPending(next, has || current.length ? null : boundsOf(index));
  };

  // ---- New grid line: press in empty space, drag, release -----------------------------

  const handleNewLineMove = (e) => {
    const g = newLineDragRef.current;
    if (!g) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    g.cur = frac;
    setNewLine({
      orientation: g.orientation,
      position: g.orientation === 'row' ? frac.fy : frac.fx,
    });
  };

  const handleNewLineEnd = () => {
    window.removeEventListener('mousemove', handleNewLineMove);
    window.removeEventListener('mouseup', handleNewLineEnd);
    const g = newLineDragRef.current;
    newLineDragRef.current = null;
    setNewLine(null);
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    if (!g || !selected) return;
    // The line is written where the pointer was released, which is where the user last saw
    // the preview — a press with no movement releases where it was pressed, so the two
    // cases are one.
    const frac = g.cur;
    if (g.orientation === 'row') {
      const row = rowIndexAtFraction(selected, frac);
      if (row == null) return;
      const band = rowBounds(selected, row);
      if (band) addDividerAt('rowHeights', row, frac.fy - band.top);
      return;
    }
    const column = columnIndexAtFraction(selected, frac);
    if (column == null) return;
    const band = columnBounds(selected, column);
    if (band) addDividerAt('columnWidths', column, frac.fx - band.left);
  };

  const handleOverlayMouseDown = (e) => {
    // The Rows and Columns tools: a press inside the table but not on a line begins a new
    // line, which follows the pointer until it is released. A press ON a line is taken by
    // that line's own hit line, which starts a move instead.
    if (gridMode && (tool === 'rows' || tool === 'columns') && selected) {
      const frac = eventToFraction(e);
      if (!frac) return;
      const orientation = tool === 'rows' ? 'row' : 'column';
      const inside =
        rowIndexAtFraction(selected, frac) != null &&
        columnIndexAtFraction(selected, frac) != null;
      if (!inside) return;
      newLineDragRef.current = { orientation, cur: frac };
      setNewLine({
        orientation,
        position: orientation === 'row' ? frac.fy : frac.fx,
      });
      window.addEventListener('mousemove', handleNewLineMove);
      window.addEventListener('mouseup', handleNewLineEnd);
      return;
    }
    // The Section Title Row and Coloured Area tools rubber-band a rectangle; every other
    // tool acts on the click, which the click handler takes.
    if (armedForDrag && selected) {
      const frac = eventToFraction(e);
      if (!frac) return;
      sectionAreaDragRef.current = {
        startX: frac.fx,
        startY: frac.fy,
        curX: frac.fx,
        curY: frac.fy,
        startClientX: e.clientX,
        startClientY: e.clientY,
        forColour: specialTool === 'colouredArea',
      };
      setSectionAreaRect({ left: frac.fx, top: frac.fy, width: 0, height: 0 });
      window.addEventListener('mousemove', handleSectionAreaMove);
      window.addEventListener('mouseup', handleSectionAreaEnd);
      return;
    }
    // A swatch is armed: the gesture samples a colour rather than editing anything. The
    // outcome is decided on release, so a click is left to the click handler.
    if (colourToolArmed && colourPickMode) {
      const frac = eventToFraction(e);
      if (!frac) return;
      colourPickDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        overIndexAtStart: colouredAreaIndexAt(frac),
        moved: false,
        previewed: false,
      };
      window.addEventListener('mousemove', handleColourPickMove);
      window.addEventListener('mouseup', handleColourPickEnd);
      return;
    }
    if (!creating) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    createDragRef.current = {
      startX: frac.fx,
      startY: frac.fy,
      curX: frac.fx,
      curY: frac.fy,
    };
    setCreateRect({ left: frac.fx, top: frac.fy, width: 0, height: 0 });
    window.addEventListener('mousemove', handleCreateMove);
    window.addEventListener('mouseup', handleCreateEnd);
  };

  // ---- Tool clicks ---------------------------------------------------------------------

  // Add a divider exactly where the click landed: the band it fell in is split at that
  // point — not in the middle — so the new line appears under the pointer. `index` is the
  // 0-based band, not the 1-based divider index the delete path uses, and `firstPart` is
  // how much of the band lies before the click.
  //
  // What follows the split is the existing "Add above" behaviour: the existing cells keep
  // the near part, a new empty row/column appears beyond them, and every cell whose drawn
  // square moved loses its confidence so the page-exit recalculation re-reads it.
  const addDividerAt = (axisKey, index, firstPart) => {
    runAxisAction(
      axisKey,
      (arr) => splitEntryAt(arr, index, firstPart),
      (len) => splitMap(len, index)
    );
  };

  // Delete the divider with 1-based index `k`: the two bands either side fold into one,
  // the near band's cells survive (their confidence zeroed, their square having grown)
  // and the far band's are dropped.
  const deleteDividerAt = (axisKey, k) => {
    runAxisAction(
      axisKey,
      (arr) => mergeCells(arr, k),
      (len) => mergeMap(len, k)
    );
    setSelectedLine(null);
  };

  // The Special tool's row actions: the header's last row, a hidden row, or removing an
  // existing section-title row.
  const applySpecialRowClick = (row) => {
    const t = findTableById(metadataTables, selected.tableId);
    if (!t) return;
    const existing = t.sectionTitles ?? [];
    if (specialTool === 'header') {
      commitTableEdit(t.tableId, { ...t, headerCount: row + 1 });
      return;
    }
    if (specialTool === 'hideRow') {
      const already = existing.some((s) => s.tableRow === row);
      commitTableEdit(t.tableId, {
        ...t,
        sectionTitles: already
          ? existing.filter((s) => s.tableRow !== row)
          : [
              ...existing,
              { tableRow: row, delete: true, columnName: null, data: null },
            ],
      });
      setSelectedSectionRow(already ? null : row);
      return;
    }
    if (specialTool === 'sectionTitle') {
      // A click (rather than a drag) removes an existing entry; drawing a new one is the
      // rubber-band gesture.
      if (existing.some((s) => s.tableRow === row)) {
        commitTableEdit(t.tableId, {
          ...t,
          sectionTitles: existing.filter((s) => s.tableRow !== row),
        });
        setSelectedSectionRow(null);
      }
    }
  };

  // ---- Selection click ----------------------------------------------------------------

  const handleOverlayClick = (e) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (creating || createDragRef.current || dragRef.current) return;
    const frac = eventToFraction(e);

    // A swatch is armed: the click samples that pixel and changes no selection.
    if (colourToolArmed && colourPickMode && frac) {
      const hex = samplePixelHex(frac.fx, frac.fy);
      if (hex && onColourPicked) onColourPicked(hex);
      return;
    }

    if (gridMode && tool && selected && frac) {
      // A click inside a saved coloured area selects it for editing, whichever colour
      // tool is armed.
      if (colourToolArmed) {
        const overIndex = colouredAreaIndexAt(frac);
        if (overIndex != null) {
          if (onClearColourPick) onClearColourPick();
          if (onSelectColouredArea) onSelectColouredArea(overIndex);
          return;
        }
      }
      const row = rowIndexAtFraction(selected, frac);
      const column = columnIndexAtFraction(selected, frac);
      if (row != null && column != null) {
        // The Rows and Columns tools do all their work on the press/release gesture above.
        if (tool === 'rows' || tool === 'columns') return;
        if (specialTool === 'colouredRows') {
          togglePending('rows', row, (i) => rowBounds(selected, i));
          return;
        }
        if (specialTool === 'colouredColumns') {
          togglePending('columns', column, (i) => columnBounds(selected, i));
          return;
        }
        if (specialTool === 'colouredCell') {
          // One cell at a time: a fresh cell replaces whatever was picked, and the picked
          // cell clicked again clears. Identity is the row/column pair, not the rectangle,
          // which is a pair of floating-point fractions recomputed on every click.
          const picked = pendingSelection?.cell;
          const same =
            picked != null && picked.row === row && picked.column === column;
          const bounds = cellBounds(selected, row, column);
          const next = same
            ? { kind: null, rows: [], columns: [], rect: null, cell: null }
            : {
                kind: 'cell',
                rows: [],
                columns: [],
                rect: bounds,
                cell: { row, column },
              };
          // Seed the swatches only when arriving from nothing, as togglePending does.
          reportPending(next, same || picked != null ? null : bounds);
          return;
        }
        if (
          specialTool === 'header' ||
          specialTool === 'hideRow' ||
          specialTool === 'sectionTitle'
        ) {
          applySpecialRowClick(row);
          return;
        }
        // Coloured Table and Coloured Area take no row/column click.
        return;
      }
    }

    // Outside every tool gesture a click selects the table it landed in.
    if (!onSelectTable || !frac) return;
    const hit = samePage.find(
      (t) =>
        frac.fx >= t.bounds.left &&
        frac.fx <= t.bounds.left + t.bounds.width &&
        frac.fy >= t.bounds.top &&
        frac.fy <= t.bounds.top + t.bounds.height
    );
    if (hit) onSelectTable(hit.tableId);
  };


  // ---- Imperative handles handed up to the parent (Options block, Task 13) ------------

  const startCreate = useCallback(() => setCreating(true), []);
  const startDelete = useCallback(
    (tableId) => {
      const t = findTableById(metadataTables, tableId);
      if (t) commitTableEdit(tableId, { ...t, deleted: true });
    },
    [metadataTables, commitTableEdit]
  );

  // Run one FINAL axis-only structural edit (menu add/delete) on the selected table and
  // commit it: transform the axis with `action` and reconcile cells with `mapFn` (Add
  // half-splits a line -> a NEW line; Delete folds one away). Both keep the axis sum so
  // bounds is unchanged.
  const runAxisAction = useCallback(
    (axisKey, action, mapFn) => {
      if (!selected) return;
      const t = findTableById(metadataTables, selected.tableId);
      if (!t) return;
      const oldAxis = (t[axisKey] ?? []).map((c) => ({ ...c }));
      const nextAxis = action(oldAxis);
      commitTableEdit(
        selected.tableId,
        reconcileAxisEdit(
          t,
          t,
          axisKey,
          nextAxis,
          mapFn(oldAxis.length),
          t.bounds
        )
      );
    },
    [selected, metadataTables, commitTableEdit]
  );

  useEffect(() => {
    if (onRequestCreate) onRequestCreate(startCreate);
  }, [onRequestCreate, startCreate]);

  useEffect(() => {
    if (onRequestDelete) onRequestDelete(startDelete);
  }, [onRequestDelete, startDelete]);

  // Report the selected grid line up so the Options block can enable/disable its buttons.
  useEffect(() => {
    if (onSelectedLineChange) onSelectedLineChange(selectedLine);
  }, [onSelectedLineChange, selectedLine]);

  // Report the selected section-title row up so the Options block can bind the "Column
  // name" combo and enable/disable "Delete Section Title Row".
  useEffect(() => {
    if (onSelectedSectionRowChange) onSelectedSectionRowChange(selectedSectionRow);
  }, [onSelectedSectionRowChange, selectedSectionRow]);

  // A line or section-title selection belongs to the table and the tool it was made under,
  // so both are dropped when either changes.
  useEffect(() => {
    setSelectedLine(null);
    setSelectedSectionRow(null);
    setSectionAreaRect(null);
  }, [editorMode, tool, specialTool, selected?.tableId]);

  // Remove any lingering window listeners if the editor unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('mousemove', handleCreateMove);
      window.removeEventListener('mouseup', handleCreateEnd);
      window.removeEventListener('mousemove', handleColourPickMove);
      window.removeEventListener('mouseup', handleColourPickEnd);
      window.removeEventListener('mousemove', handleSectionAreaMove);
      window.removeEventListener('mouseup', handleSectionAreaEnd);
      window.removeEventListener('mousemove', handleNewLineMove);
      window.removeEventListener('mouseup', handleNewLineEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure the image's rendered screen size, kept fresh with a ResizeObserver, once the
  // image has loaded (dims set). Drives overlayScale for the HTML overlays (selection label).
  useEffect(() => {
    if (!dims) return undefined;
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
  }, [dims]);

  // Screen px per page fraction on each axis, derived exactly as PageImageWithOverlay does.
  const overlayScale = useMemo(
    () =>
      dims && renderedSize && pixelWidth && pixelHeight
        ? { sx: renderedSize.width / dims.w, sy: renderedSize.height / dims.h }
        : null,
    [dims, renderedSize, pixelWidth, pixelHeight]
  );

  // The selected table's outer border in viewbox px, plus — in the boundary pass alone —
  // its four draggable edge hit lines. gridMode freezes the boundary, so it draws the rect
  // and nothing to grab.
  const renderBorder = () => {
    if (!selected) return null;
    if (gridMode) return staticBorderRect();
    const x = selected.bounds.left * pixelWidth;
    const y = selected.bounds.top * pixelHeight;
    const w = selected.bounds.width * pixelWidth;
    const h = selected.bounds.height * pixelHeight;
    const common = {
      stroke: 'transparent',
      strokeWidth: hitLineWidthPx(),
      vectorEffect: 'non-scaling-stroke',
      'data-testid': HIT_LINE_TESTID,
      style: { pointerEvents: 'stroke' },
    };
    const edge = (id, x1, y1, x2, y2, kind, cursor) => (
      <line
        key={id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        {...common}
        cursor={cursor}
        onMouseDown={(e) =>
          handleHit({ kind, tableId: selected.tableId }, e)
        }
      />
    );
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={'none'}
          style={{ stroke: layerBorderColour() }}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        />
        {edge('b-left', x, y, x, y + h, 'boundary-left', 'ew-resize')}
        {edge('b-right', x + w, y, x + w, y + h, 'boundary-right', 'ew-resize')}
        {edge('b-top', x, y, x + w, y, 'boundary-top', 'ns-resize')}
        {edge('b-bottom', x, y + h, x + w, y + h, 'boundary-bottom', 'ns-resize')}
      </g>
    );
  };

  // The selected table's outer border rect, drawn NOT draggable — used by gridMode, which
  // shows the boundary but forbids resizing it.
  const staticBorderRect = () => {
    if (!selected) return null;
    return (
      <rect
        x={selected.bounds.left * pixelWidth}
        y={selected.bounds.top * pixelHeight}
        width={selected.bounds.width * pixelWidth}
        height={selected.bounds.height * pixelHeight}
        fill={'none'}
        style={{ stroke: layerBorderColour() }}
        strokeWidth={1}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // The selected table's internal horizontal grid lines (row dividers), drawn in
  // layerRowsColour() when the Rows layer is on and layerGrey() when it is off. When
  // `interactive`, each carries a transparent wide-stroke hit line (click selects, drag
  // moves) and the selected divider is flanked by a highlight line immediately above and
  // below.
  const renderHorizontalLines = (interactive) => {
    if (!selected) return null;
    const x = selected.bounds.left * pixelWidth;
    const w = selected.bounds.width * pixelWidth;
    const rows = (selected.rowHeights ?? []).map((v) => v.value);
    const offsets = cumulative(rows); // the last is the total height (far edge; skipped)
    const out = [];
    for (let k = 1; k < rows.length; k += 1) {
      const offset = selected.bounds.top + offsets[k - 1];
      const ly = offset * pixelHeight;
      out.push(
        <line
          key={`row-${k}`}
          data-testid={ROW_LINE_TESTID}
          x1={x}
          y1={ly}
          x2={x + w}
          y2={ly}
          style={{ stroke: showRows ? layerRowsColour() : layerGrey() }}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        />
      );
      if (interactive) {
        out.push(
          <line
            key={`row-hit-${k}`}
            data-testid={ROW_HIT_TESTID}
            x1={x}
            y1={ly}
            x2={x + w}
            y2={ly}
            stroke={'transparent'}
            strokeWidth={hitLineWidthPx()}
            vectorEffect={'non-scaling-stroke'}
            cursor={'ns-resize'}
            style={{ pointerEvents: 'stroke' }}
            onMouseDown={(e) => handleLineHit('row', k, e)}
          />
        );
        if (
          selectedLine &&
          selectedLine.orientation === 'row' &&
          selectedLine.index === k
        ) {
          const yAbove = (offset - onePxFractionY) * pixelHeight;
          const yBelow = (offset + onePxFractionY) * pixelHeight;
          out.push(
            <line
              key={`row-hl-a-${k}`}
              data-testid={ROW_HIGHLIGHT_TESTID}
              x1={x}
              y1={yAbove}
              x2={x + w}
              y2={yAbove}
              style={{ stroke: selectedRowHighlight() }}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />,
            <line
              key={`row-hl-b-${k}`}
              data-testid={ROW_HIGHLIGHT_TESTID}
              x1={x}
              y1={yBelow}
              x2={x + w}
              y2={yBelow}
              style={{ stroke: selectedRowHighlight() }}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />
          );
        }
      }
    }
    return out;
  };

  // The selected table's internal vertical grid lines (column dividers), drawn in
  // layerColumnsColour() when the Columns layer is on and layerGrey() when it is off;
  // interactive with a highlight line on each side of the selected divider.
  const renderVerticalLines = (interactive) => {
    if (!selected) return null;
    const y = selected.bounds.top * pixelHeight;
    const h = selected.bounds.height * pixelHeight;
    const cols = (selected.columnWidths ?? []).map((v) => v.value);
    const offsets = cumulative(cols); // the last is the total width (far edge; skipped)
    const out = [];
    for (let k = 1; k < cols.length; k += 1) {
      const offset = selected.bounds.left + offsets[k - 1];
      const lx = offset * pixelWidth;
      out.push(
        <line
          key={`col-${k}`}
          data-testid={COLUMN_LINE_TESTID}
          x1={lx}
          y1={y}
          x2={lx}
          y2={y + h}
          style={{ stroke: showColumns ? layerColumnsColour() : layerGrey() }}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        />
      );
      if (interactive) {
        out.push(
          <line
            key={`col-hit-${k}`}
            data-testid={COLUMN_HIT_TESTID}
            x1={lx}
            y1={y}
            x2={lx}
            y2={y + h}
            stroke={'transparent'}
            strokeWidth={hitLineWidthPx()}
            vectorEffect={'non-scaling-stroke'}
            cursor={'ew-resize'}
            style={{ pointerEvents: 'stroke' }}
            onMouseDown={(e) => handleLineHit('column', k, e)}
          />
        );
        if (
          selectedLine &&
          selectedLine.orientation === 'column' &&
          selectedLine.index === k
        ) {
          const xLeft = (offset - onePxFractionX) * pixelWidth;
          const xRight = (offset + onePxFractionX) * pixelWidth;
          out.push(
            <line
              key={`col-hl-l-${k}`}
              data-testid={COLUMN_HIGHLIGHT_TESTID}
              x1={xLeft}
              y1={y}
              x2={xLeft}
              y2={y + h}
              style={{ stroke: selectedColumnHighlight() }}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />,
            <line
              key={`col-hl-r-${k}`}
              data-testid={COLUMN_HIGHLIGHT_TESTID}
              x1={xRight}
              y1={y}
              x2={xRight}
              y2={y + h}
              style={{ stroke: selectedColumnHighlight() }}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />
          );
        }
      }
    }
    return out;
  };

  // Both axes of the selected table's grid. Each is drawn in its layer's colour or in grey,
  // and both are draggable in gridMode while no tool is armed — the boundary pass draws
  // them display-only, as context for the border being resized.
  const renderGridLines = () => {
    if (!selected) return null;
    // The boundary pass draws no grid at all: it is about where a table starts and ends,
    // and the interior belongs to the pass that follows it.
    if (!gridMode) return null;
    // A hit line is rendered when the divider can be dragged OR when its own tool is
    // armed: the armed tool's click on that line is what "very close to a grid line"
    // means, so the same 8px stroke serves both.
    return (
      <g>
        {renderHorizontalLines(linesDraggable || tool === 'rows')}
        {renderVerticalLines(linesDraggable || tool === 'columns')}
      </g>
    );
  };

  // The black dotted header rectangle (Special Cells mode): drawn HEADER_MARGIN_PX screen
  // px outside the first `headerCount` rows of the selected table, with the word "Header" in
  // its top-right corner.
  const renderHeaderRect = () => {
    if (!selected || !(selected.headerCount > 0)) return null;
    const rows = (selected.rowHeights ?? []).map((v) => v.value);
    if (rows.length === 0) return null;
    const n = Math.min(selected.headerCount, rows.length);
    const offsets = cumulative(rows); // offsets[n-1] = sum of the first n row heights
    const topFrac = selected.bounds.top;
    const bottomFrac = selected.bounds.top + offsets[n - 1];
    // Convert the screen-px margin into drawn (×pixel) units on each axis via overlayScale.
    const mx = overlayScale ? HEADER_MARGIN_PX / overlayScale.sx : HEADER_MARGIN_PX;
    const my = overlayScale ? HEADER_MARGIN_PX / overlayScale.sy : HEADER_MARGIN_PX;
    const x = selected.bounds.left * pixelWidth - mx;
    const y = topFrac * pixelHeight - my;
    const w = selected.bounds.width * pixelWidth + 2 * mx;
    const h = (bottomFrac - topFrac) * pixelHeight + 2 * my;
    return (
      <g>
        <rect
          data-testid={HEADER_RECT_TESTID}
          x={x}
          y={y}
          width={w}
          height={h}
          fill={'none'}
          stroke={'black'}
          strokeWidth={1}
          strokeDasharray={'2 2'}
          vectorEffect={'non-scaling-stroke'}
        />
        <text
          x={x + w}
          y={y}
          dy={'-2'}
          textAnchor={'end'}
          fontFamily={'sans-serif'}
          fontSize={12}
          fill={'black'}
        >
          {'Header'}
        </text>
      </g>
    );
  };

  // The selected table's section-title rows (Special Cells mode). Each row in
  // `sectionTitles` is drawn as a dotted rectangle spanning its row band (full
  // table width with "Section Title" in the top-right — the renderHeaderRect
  // pattern. The selected row adds a translucent highlight just inside and just
  // outside its dotted boundary. A row that has a `data` area draws that area as
  // a dotted rectangle with draggable sides.
  const renderSectionTitles = () => {
    if (!selected) return null;
    const list = selected.sectionTitles ?? [];
    if (list.length === 0) return null;
    const rows = (selected.rowHeights ?? []).map((v) => v.value);
    const offsets = cumulative(rows);
    const dx = overlayScale ? 1 / overlayScale.sx : 1;
    const dy = overlayScale ? 1 / overlayScale.sy : 1;
    const bx = selected.bounds.left * pixelWidth;
    const bw = selected.bounds.width * pixelWidth;
    const hitCommon = {
      stroke: 'transparent',
      strokeWidth: hitLineWidthPx(),
      vectorEffect: 'non-scaling-stroke',
      style: { pointerEvents: 'stroke' },
    };
    return (
      <g>
        {list.map((st, i) => {
          const r = st.tableRow;
          if (r < 0 || r >= rows.length) return null;
          const topFrac = selected.bounds.top + (r === 0 ? 0 : offsets[r - 1]);
          const y = topFrac * pixelHeight;
          const h = rows[r] * pixelHeight;
          const parts = [
            <rect
              key={`st-${i}`}
              data-testid={`section-title-${i}`}
              x={bx}
              y={y}
              width={bw}
              height={h}
              fill={'none'}
              style={{ stroke: sectionTitleMarkerColour() }}
              strokeWidth={1}
              strokeDasharray={sectionTitleMarkerDash()}
              vectorEffect={'non-scaling-stroke'}
            />,
            <text
              key={`st-cap-${i}`}
              x={bx + bw}
              y={y}
              dy={'-2'}
              textAnchor={'end'}
              fontFamily={'sans-serif'}
              fontSize={12}
              style={{ fill: sectionTitleMarkerColour() }}
            >
              {st.columnName?'Section Title': 'Hidden Row'}
            </text>,
          ];
          if (r === selectedSectionRow) {
            parts.push(
              <rect
                key={`st-out-${i}`}
                data-testid={`section-title-selected-outer-${i}`}
                x={bx - dx}
                y={y - dy}
                width={bw + 2 * dx}
                height={h + 2 * dy}
                fill={'none'}
                style={{ stroke: selectedSectionTitleHighlight() }}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />,
              <rect
                key={`st-in-${i}`}
                data-testid={`section-title-selected-inner-${i}`}
                x={bx + dx}
                y={y + dy}
                width={bw - 2 * dx}
                height={h - 2 * dy}
                fill={'none'}
                style={{ stroke: selectedSectionTitleHighlight() }}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
            );
          }
          if (st.data && st.data.bounds) {
            const ax = st.data.bounds.left * pixelWidth;
            const ay = st.data.bounds.top * pixelHeight;
            const aw = st.data.bounds.width * pixelWidth;
            const ah = st.data.bounds.height * pixelHeight;
            const side = (id, x1, y1, x2, y2, kind, cursor) => (
              <line
                key={id}
                data-testid={id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                {...hitCommon}
                cursor={cursor}
                onMouseDown={(e) => handleSectionAreaSideHit(kind, r, e)}
              />
            );
            parts.push(
              <rect
                key={`st-area-${i}`}
                data-testid={`section-area-${i}`}
                x={ax}
                y={ay}
                width={aw}
                height={ah}
                fill={'none'}
                style={{ stroke: sectionTitleMarkerColour() }}
                strokeWidth={1}
                strokeDasharray={sectionTitleMarkerDash()}
                vectorEffect={'non-scaling-stroke'}
              />,
              side(`section-area-${i}-left`, ax, ay, ax, ay + ah, 'sarea-left', 'ew-resize'),
              side(`section-area-${i}-right`, ax + aw, ay, ax + aw, ay + ah, 'sarea-right', 'ew-resize'),
              side(`section-area-${i}-top`, ax, ay, ax + aw, ay, 'sarea-top', 'ns-resize'),
              side(`section-area-${i}-bottom`, ax, ay + ah, ax + aw, ay + ah, 'sarea-bottom', 'ns-resize')
            );
          }
          return <g key={`st-g-${i}`}>{parts}</g>;
        })}
      </g>
    );
  };

  // Rubber-band preview rectangle while dragging out a section-title row's data area.
  const renderSectionAreaPreview = () => {
    if (!sectionAreaRect) return null;
    return (
      <rect
        data-testid={'section-area-preview'}
        x={sectionAreaRect.left * pixelWidth}
        y={sectionAreaRect.top * pixelHeight}
        width={sectionAreaRect.width * pixelWidth}
        height={sectionAreaRect.height * pixelHeight}
        fill={'none'}
        style={{ stroke: sectionTitleMarkerColour() }}
        strokeWidth={1}
        strokeDasharray={sectionTitleMarkerDash()}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // The special areas of the selected table: its header rectangle and its section-title
  // rows and the coloured areas. The header rectangle is also drawn while the Header tool
  // is armed, whatever the flag says, and that tool suppresses the other two so the row
  // being chosen is the only thing emphasised.
  const renderSpecial = () => {
    if (!selected) return null;
    return (
      <g>
        {showHeader ? renderHeaderRect() : null}
        {showOtherSpecial ? renderSectionTitles() : null}
      </g>
    );
  };

  // Rubber-band preview rectangle while creating a new table.
  const renderCreatePreview = () => {
    if (!createRect) return null;
    return (
      <rect
        data-testid={'create-preview'}
        x={createRect.left * pixelWidth}
        y={createRect.top * pixelHeight}
        width={createRect.width * pixelWidth}
        height={createRect.height * pixelHeight}
        fill={'none'}
        style={{ stroke: layerBorderColour() }}
        strokeWidth={1}
        strokeDasharray={'4 3'}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // Colours mode: a dotted rectangle per coloured area, plus (for the selected area) a
  // highlight line just outside and just inside its dotted boundary.
  const renderColours = () => {
    if (!showOtherSpecial && !colourToolArmed) return null;
    const dx = overlayScale ? 1 / overlayScale.sx : 1;
    const dy = overlayScale ? 1 / overlayScale.sy : 1;
    return (
      <g>
        {(colouredAreas ?? []).map((area, i) => {
          const x = area.left * pixelWidth;
          const y = area.top * pixelHeight;
          const w = area.width * pixelWidth;
          const h = area.height * pixelHeight;
          const parts = [
            <rect
              key={`ca-${i}`}
              data-testid={`coloured-area-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={'none'}
              style={{ stroke: layerColoursColour() }}
              strokeWidth={1}
              strokeDasharray={'4 3'}
              vectorEffect={'non-scaling-stroke'}
            />,
          ];
          if (i === selectedColouredIndex) {
            parts.push(
              <rect
                key={`ca-out-${i}`}
                data-testid={`coloured-selected-outer-${i}`}
                x={x - dx}
                y={y - dy}
                width={w + 2 * dx}
                height={h + 2 * dy}
                fill={'none'}
                style={{ stroke: selectedColouredAreaHighlight() }}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />,
              <rect
                key={`ca-in-${i}`}
                data-testid={`coloured-selected-inner-${i}`}
                x={x + dx}
                y={y + dy}
                width={w - 2 * dx}
                height={h - 2 * dy}
                fill={'none'}
                style={{ stroke: selectedColouredAreaHighlight() }}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
            );
          }
          // Transparent wide-stroke side hit lines so any displayed area's edges can be
          // dragged to resize it (mirroring the boundary resize), but only while a
          // coloured-area tool is armed: outside those tools an area is drawn, not edited.
          const hitCommon = {
            stroke: 'transparent',
            strokeWidth: hitLineWidthPx(),
            vectorEffect: 'non-scaling-stroke',
            style: { pointerEvents: 'stroke' },
          };
          const side = (id, x1, y1, x2, y2, kind, cursor) => (
            <line
              key={id}
              data-testid={id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              {...hitCommon}
              cursor={cursor}
              onMouseDown={(e) => handleColouredSideHit(kind, i, e)}
            />
          );
          if (colourToolArmed) {
            parts.push(
              side(`coloured-side-${i}-left`, x, y, x, y + h, 'carea-left', 'ew-resize'),
              side(`coloured-side-${i}-right`, x + w, y, x + w, y + h, 'carea-right', 'ew-resize'),
              side(`coloured-side-${i}-top`, x, y, x + w, y, 'carea-top', 'ns-resize'),
              side(`coloured-side-${i}-bottom`, x, y + h, x + w, y + h, 'carea-bottom', 'ns-resize')
            );
          }
          return <g key={`ca-g-${i}`}>{parts}</g>;
        })}
      </g>
    );
  };

  // The line the new-line gesture is about to write, drawn in its layer's colour so it
  // reads as the line it will become.
  const renderNewLinePreview = () => {
    if (!newLine || !selected) return null;
    const b = selected.bounds;
    const horizontal = newLine.orientation === 'row';
    return (
      <line
        data-testid={'new-line-preview'}
        x1={horizontal ? b.left * pixelWidth : newLine.position * pixelWidth}
        y1={horizontal ? newLine.position * pixelHeight : b.top * pixelHeight}
        x2={
          horizontal
            ? (b.left + b.width) * pixelWidth
            : newLine.position * pixelWidth
        }
        y2={
          horizontal
            ? newLine.position * pixelHeight
            : (b.top + b.height) * pixelHeight
        }
        style={{
          stroke: horizontal ? layerRowsColour() : layerColumnsColour(),
        }}
        strokeWidth={1}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // The coloured-area tools' pending selection: the rows, columns or rectangle picked but
  // not yet written out. Drawn as a wash inside a dotted outline, which is what
  // distinguishes it from a saved area (dotted outline, no wash).
  const renderPendingSelection = () => {
    if (!colourToolArmed || !selected || !pendingSelection) return null;
    const rects = [];
    (pendingSelection.rows ?? []).forEach((r) => {
      const b = rowBounds(selected, r);
      if (b) rects.push({ key: `pending-row-${r}`, b });
    });
    (pendingSelection.columns ?? []).forEach((c) => {
      const b = columnBounds(selected, c);
      if (b) rects.push({ key: `pending-column-${c}`, b });
    });
    if (pendingSelection.rect) {
      rects.push({ key: 'pending-area', b: pendingSelection.rect });
    }
    return (
      <g>
        {rects.map(({ key, b }) => (
          <rect
            key={key}
            data-testid={key}
            x={b.left * pixelWidth}
            y={b.top * pixelHeight}
            width={b.width * pixelWidth}
            height={b.height * pixelHeight}
            style={{
              fill: layerColoursBackgroundColour(),
              stroke: layerColoursColour(),
            }}
            strokeWidth={1}
            strokeDasharray={'4 3'}
            vectorEffect={'non-scaling-stroke'}
          />
        ))}
      </g>
    );
  };

  return (
    <Box sx={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <img
        ref={imgRef}
        src={`data:image/png;base64,${image}`}
        onLoad={(e) =>
          setDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })
        }
        // Displayed pixel-for-pixel at the fetched image's natural size (driven by the
        // scale selector's requested width); the scroll container provides horizontal and
        // vertical scrollbars when it exceeds the available area.
        style={{ display: 'block' }}
        alt={''}
      />
      {/* Hidden off-screen canvas used only to read back page pixel colours in Colours
          tools; never displayed. */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {dim && (
        <div
          data-testid={'dim-layer'}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: `rgba(255,255,255,${documentDimOpacity()})`,
            pointerEvents: 'none',
          }}
        />
      )}
      {dims && (
        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio={'none'}
          onMouseDown={handleOverlayMouseDown}
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
            cursor: creating || armedForDrag ? 'crosshair' : 'default',
          }}
        >
          {renderBorder()}
          {renderGridLines()}
          {renderSpecial()}
          {renderColours()}
          {renderPendingSelection()}
          {renderNewLinePreview()}
          {renderCreatePreview()}
          {renderSectionAreaPreview()}
        </svg>
      )}
      {/* Selected-table label: name + "cols × rows", lifted above the selected table's
          top-left corner. An absolutely-positioned HTML sibling (the SVG's
          preserveAspectRatio="none" would distort text). Independent of mouse movement. */}
      {selected && overlayScale && (
        <div
          data-testid={'selected-label'}
          style={{
            position: 'absolute',
            left: selected.bounds.left * pixelWidth * overlayScale.sx,
            top: Math.max(
              0,
              selected.bounds.top * pixelHeight * overlayScale.sy - (12 + 2 * 2)
            ),
            backgroundColor: layerBorderColour(),
            color: 'white',
            fontFamily: 'sans-serif',
            fontSize: 12,
            lineHeight: '12px',
            padding: 2,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          <span data-testid={'selected-label-name'}>{selected.name}</span>
          <span
            style={{
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: 'white',
              margin: '0 6px',
            }}
          />
          <span data-testid={'selected-label-size'}>
            {`${(selected.columnWidths ?? []).length} × ${
              (selected.rowHeights ?? []).length
            }`}
          </span>
        </div>
      )}
    </Box>
  );
}

export default StagedPageGridEditor;
