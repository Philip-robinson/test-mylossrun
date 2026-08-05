'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import toast from 'react-hot-toast';
import {
  documentDimOpacity,
  hitLineWidthPx,
  layerBorderColour,
  layerColoursColour,
  layerColumnsColour,
  layerRowsColour,
  layerSpecialCellsColour,
  mergedCellFill,
  mergedCellMarkerColour,
  sectionTitleMarkerColour,
  sectionTitleMarkerDash,
  selectedColouredAreaHighlight,
  selectedColumnHighlight,
  selectedMergedCellHighlight,
  selectedRowHighlight,
  selectedSectionTitleHighlight,
  sectionTitleAreaColumnSpan,
} from 'config';
import { newUUID } from 'common/utils';
import {
  analysePeakColours,
  rgbToHex,
  rgbaToPixels,
} from 'components/pdfTableViewer/colourUtils';
import {
  cellAt,
  clampBoundaryTarget,
  cleanupAxis,
  cumulative,
  findTableById,
  gridSquareAtFraction,
  identityMap,
  makeDefaultCell,
  mergeCells,
  mergeMap,
  mergeTargetSpan,
  mergedCellCovering,
  mergedCells,
  moveDivider,
  overlaps,
  reconcileAxisEdit,
  replaceTableById,
  resizeBoundary,
  splitEntry,
  splitMap,
  splitMapBelow,
  tablesOnPage,
  withCellSpan,
  leadingSquaresBounds,
} from 'components/pdfTableViewer/tableSupportUtils';

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

// The new staged interactive canvas: a base64 page image with a single-mode overlay driven
// by the right-hand Layers panel. This task implements the scaffold (image + overlay + dim
// layer + selection label) and the Border mode (draw and resize the selected table's outer
// border, plus rubber-band create). Rows / Columns / Special-Cells / Colours modes are added
// by later tasks via the mode-scoped render/handler branches. No MUI menus, no confidence
// squares, no header markers, no cell editor.
export function StagedPageGridEditor({
  image,
  pixelWidth,
  pixelHeight,
  page,
  metadataTables,
  selectedTableId,
  onSelectTable,
  mode = 'border',
  // True when the active mode is display-only for the selected table (the host locks the
  // Colours, Borders and Columns layers of a table amalgamated into a grid). The overlay is
  // still drawn; nothing in it can be dragged, added or picked.
  locked = false,
  dim = false,
  onEditTables,
  onCreatedTable,
  pdfId, // eslint-disable-line no-unused-vars -- reserved for Calculate wiring (Task 13)
  onRequestCreate,
  onRequestDelete,
  onSelectedLineChange,
  onRequestRowsAction,
  onRequestColumnsAction,
  onRequestSpecialAction,
  onSelectedSectionRowChange,
  // The column name a newly drawn section title starts with, decided by the host (it reads the
  // column names collected across the linked group) so this editor holds no config of its own.
  newSectionTitleColumnName = null,
  selectedMergedCell = null,
  onSelectedMergedCellChange,
  colouredAreas = [],
  selectedColouredIndex = null,
  onSelectColouredArea,
  onColouredAreasChange,
  colourAddMode = false,
  onColourAdded,
  colourPickMode = null,
  onColourPicked,
  onColourPreview,
  onClearColourPick,
}) {
  const [dims, setDims] = useState(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [renderedSize, setRenderedSize] = useState(null);

  // Colours mode rubber-band ("Add" a new coloured area): mirrors the Border-mode
  // create gesture. `colourCreateRect` is the live preview in page fractions.
  const [colourCreateRect, setColourCreateRect] = useState(null);
  const colourCreateDragRef = useRef(null);

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

  // Set-Title sub-mode (Special Cells): while true, an existing title's four sides become
  // draggable, or — when the selected table has no title — an empty-area drag rubber-bands a
  // new one. `titleRect` is the live rubber-band preview in page fractions.
  const [titleSelecting, setTitleSelecting] = useState(false);
  const [titleRect, setTitleRect] = useState(null); // page-fraction {left,top,width,height}

  // Special Cells section-title rows. `selectedSectionRow` is the selected section-title's
  // `tableRow` (its 0-based row band in the selected table) or null. `addSubTitleMode` is
  // true while "Add Section Title Row" is armed — the next in-table row click becomes a new
  // section-title row. `sectionAreaRect` is the live rubber-band preview (page fractions)
  // while dragging out the selected row's data area.
  const [selectedSectionRow, setSelectedSectionRow] = useState(null);
  const [addSubTitleMode, setAddSubTitleMode] = useState(false);
  // True while "Add Hidden Row" is armed. A hidden row is a section-title row with NO column
  // name and no data area: it names no column, so it is simply dropped from the output rather
  // than supplying a value to one. Kept separate from `addSubTitleMode` because the two Adds
  // build different things from the same click.
  const [addHiddenRowMode, setAddHiddenRowMode] = useState(false);
  const [sectionAreaRect, setSectionAreaRect] = useState(null);
  const sectionAreaDragRef = useRef(null);

  // Special Cells merged cells. `mergedSelection` is the selected merged cell's anchor
  // ({ row, column }) or null — the section-row arrangement, held locally and reported up
  // through onSelectedMergedCellChange so the Options block can gate its Extend / Reduce
  // buttons (which is why the host also feeds it back as the `selectedMergedCell` prop).
  // `mergeCellMode` is true while "Merge Cell" is armed — the next in-table click merges
  // the square it lands in.
  const [mergedSelection, setMergedSelection] = useState(null);
  const [mergeCellMode, setMergeCellMode] = useState(false);

  // Live boundary-drag gesture, or null when idle (a ref so the window listeners see the
  // current value without re-subscribing). The rubber-band gestures use their own refs.
  const dragRef = useRef(null);
  const createDragRef = useRef(null);
  const titleDragRef = useRef(null);

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

  // ---- Colours mode pixel sampling ----------------------------------------------------

  // Draw the loaded page image onto a hidden canvas at its natural size so the Colours
  // mode can read back pixel colours. Guarded for jsdom / browsers without a 2d context —
  // the sampling helpers below simply return null / [] when the draw never happened.
  useEffect(() => {
    if (mode !== 'colours' || !dims || !image) return;
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
  }, [mode, dims, image]);

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
    // Title-side drag (Special Cells Set-Title sub-mode): move exactly one edge of the
    // title's rectangle, keeping the opposite edge fixed. Bounds may lie outside the table.
    if (
      kind === 'title-left' ||
      kind === 'title-right' ||
      kind === 'title-top' ||
      kind === 'title-bottom'
    ) {
      if (!t.title) return;
      const b = { ...t.title.bounds };
      if (kind === 'title-left') {
        const right = b.left + b.width;
        const nl = Math.min(frac.fx, right);
        b.left = nl;
        b.width = right - nl;
      } else if (kind === 'title-right') {
        b.width = Math.max(0, frac.fx - b.left);
      } else if (kind === 'title-top') {
        const bottom = b.top + b.height;
        const nt = Math.min(frac.fy, bottom);
        b.top = nt;
        b.height = bottom - nt;
      } else {
        b.height = Math.max(0, frac.fy - b.top);
      }
      const newTable = { ...t, title: { ...t.title, bounds: b } };
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
    // Title-side gesture (Special Cells Set-Title sub-mode): the interim edits committed
    // during the move are the final state (bounds only, no axis reconciliation needed), so
    // just leave the sub-mode and tear down the listeners.
    if (
      drag &&
      (drag.kind === 'title-left' ||
        drag.kind === 'title-right' ||
        drag.kind === 'title-top' ||
        drag.kind === 'title-bottom')
    ) {
      dragRef.current = null;
      setTitleSelecting(false);
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      return;
    }
    // Internal grid-line gesture (Rows / Columns modes): a sub-threshold gesture is a CLICK
    // that SELECTS the line (no metadata change); a drag reconciles the moved divider.
    if (drag && (drag.kind === 'grid-v' || drag.kind === 'grid-h')) {
      if (!drag.moved) {
        setSelectedLine({
          orientation: drag.kind === 'grid-v' ? 'column' : 'row',
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

  // Begin a title-side resize gesture (Special Cells Set-Title sub-mode). `kind` is one of
  // 'title-left' | 'title-right' | 'title-top' | 'title-bottom'.
  const handleTitleSideHit = (kind, e) => {
    if (!onEditTables || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      tableId: selected.tableId,
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

  // ---- Rubber-band title create drag (Special Cells Set-Title sub-mode, no title yet) --

  const handleTitleCreateMove = (e) => {
    const c = titleDragRef.current;
    if (!c) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    c.curX = frac.fx;
    c.curY = frac.fy;
    setTitleRect({
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    });
  };

  const handleTitleCreateEnd = () => {
    window.removeEventListener('mousemove', handleTitleCreateMove);
    window.removeEventListener('mouseup', handleTitleCreateEnd);
    const c = titleDragRef.current;
    titleDragRef.current = null;
    setTitleRect(null);
    setTitleSelecting(false);
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    if (!c || !selected) return;
    const b = {
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    };
    if (b.width <= 0 || b.height <= 0) return;
    commitTableEdit(selected.tableId, {
      ...selected,
      title: { bounds: b, text: null, confidence: null },
    });
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
    const list = selected.sectionTitles ?? [];
    const nextList = list.map((s) =>
      s.tableRow === c.tableRow
        ? { ...s, delete: false, data: { bounds, text: null, confidence: null } }
        : s
    );
    commitTableEdit(selected.tableId, { ...selected, sectionTitles: nextList });
  };

  // ---- Rubber-band coloured-area create drag (Colours mode, Add) ----------------------

  const handleColourCreateMove = (e) => {
    const c = colourCreateDragRef.current;
    if (!c) return;
    const frac = eventToFraction(e);
    if (!frac) return;
    c.curX = frac.fx;
    c.curY = frac.fy;
    setColourCreateRect({
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    });
  };

  const handleColourCreateEnd = () => {
    window.removeEventListener('mousemove', handleColourCreateMove);
    window.removeEventListener('mouseup', handleColourCreateEnd);
    const c = colourCreateDragRef.current;
    colourCreateDragRef.current = null;
    setColourCreateRect(null);
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    if (!c) return;
    const bounds = {
      left: Math.min(c.startX, c.curX),
      top: Math.min(c.startY, c.curY),
      width: Math.abs(c.curX - c.startX),
      height: Math.abs(c.curY - c.startY),
    };
    if (bounds.width <= 0 || bounds.height <= 0) return;
    // Sample the enclosed region and guess its background / foreground. Under jsdom the
    // sample is empty and analysePeakColours returns the white/black defaults.
    const { background, foreground } = analysePeakColours(
      sampleRegionPixels(bounds)
    );
    const newArea = { ...bounds, foreground, background };
    const current = colouredAreas ?? [];
    if (onColouredAreasChange) onColouredAreasChange([...current, newArea]);
    if (onSelectColouredArea) onSelectColouredArea(current.length);
    if (onColourAdded) onColourAdded();
  };

  // ---- Colour-pick drag (Colours mode, Foreground/Background swatch armed) -------------

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

  const handleOverlayMouseDown = (e) => {
    // Colours mode has its own gestures and never falls through to the table gestures.
    // A locked Colours layer has none of them: no add rubber-band and no pixel pick.
    if (mode === 'colours') {
      if (locked) return;
      if (colourAddMode) {
        const frac = eventToFraction(e);
        if (!frac) return;
        colourCreateDragRef.current = {
          startX: frac.fx,
          startY: frac.fy,
          curX: frac.fx,
          curY: frac.fy,
        };
        setColourCreateRect({ left: frac.fx, top: frac.fy, width: 0, height: 0 });
        window.addEventListener('mousemove', handleColourCreateMove);
        window.addEventListener('mouseup', handleColourCreateEnd);
      } else {
        // Start a gesture, recording which area (if any) it began in. The outcome is decided on
        // release: a DRAG that started in the selected area or outside any area samples a colour
        // (when a swatch is armed); a drag that started in an unselected area does nothing; a
        // click (no drag) is left to the click handler.
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
      }
      return;
    }
    // Set-Title sub-mode with no existing title: an empty-area drag rubber-bands a new one.
    if (titleSelecting && selected && !selected.title) {
      const frac = eventToFraction(e);
      if (!frac) return;
      titleDragRef.current = {
        startX: frac.fx,
        startY: frac.fy,
        curX: frac.fx,
        curY: frac.fy,
      };
      setTitleRect({ left: frac.fx, top: frac.fy, width: 0, height: 0 });
      window.addEventListener('mousemove', handleTitleCreateMove);
      window.addEventListener('mouseup', handleTitleCreateEnd);
      return;
    }
    // Special Cells with a section-title row selected (and not arming
    // "Add Section Title Row"):
    // an in-row drag rubber-bands that row's data area. A zero-move gesture is a click and
    // falls through to row selection (handleSectionAreaEnd suppresses the click only on a
    // real drag).
    if (
      mode === 'special' &&
      selected &&
      selectedSectionRow != null &&
      !addSubTitleMode
    ) {
      const frac = eventToFraction(e);
      if (!frac) return;
      sectionAreaDragRef.current = {
        startX: frac.fx,
        startY: frac.fy,
        curX: frac.fx,
        curY: frac.fy,
        startClientX: e.clientX,
        startClientY: e.clientY,
        tableRow: selectedSectionRow,
      };
      setSectionAreaRect({ left: frac.fx, top: frac.fy, width: 0, height: 0 });
      window.addEventListener('mousemove', handleSectionAreaMove);
      window.addEventListener('mouseup', handleSectionAreaEnd);
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

  // ---- Selection click ----------------------------------------------------------------

  const handleOverlayClick = (e) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    // Colours mode: select an area. Add and colour-pick are drag gestures handled on
    // mouse-down/up (a colour pick commits on release), so a click never picks or adds.
    if (mode === 'colours') {
      // Add drags are handled on mouse-down/up; a real drag suppresses this click (above).
      if (colourCreateDragRef.current || colourAddMode) {
        return;
      }
      // Locked: an area may still be selected so its colours can be read, but no pick.
      if (locked) {
        const frac = eventToFraction(e);
        const overIndex = frac ? colouredAreaIndexAt(frac) : null;
        if (overIndex != null && onSelectColouredArea) {
          onSelectColouredArea(overIndex);
        }
        return;
      }
      const frac = eventToFraction(e);
      if (!frac) return;
      const overIndex = colouredAreaIndexAt(frac);
      if (overIndex != null && overIndex !== selectedColouredIndex) {
        // Click in an UNSELECTED area: clear any armed swatch (without setting it) and select it.
        if (onClearColourPick) onClearColourPick();
        if (onSelectColouredArea) onSelectColouredArea(overIndex);
        return;
      }
      // Click in the already-selected area, or outside every area: set the swatch if one is
      // armed (sampling the pixel under the click); otherwise nothing changes.
      if (colourPickMode) {
        const hex = samplePixelHex(frac.fx, frac.fy);
        if (hex && onColourPicked) onColourPicked(hex);
      }
      return;
    }
    if (creating || createDragRef.current || dragRef.current) return;
    // Special Cells section-title and merged-cell interactions take priority over table
    // selection.
    if (mode === 'special' && selected) {
      const frac = eventToFraction(e);
      // "Merge Cell": the clicked grid square is merged with its neighbour — to the right
      // when there is one, else downwards (mergeTargetSpan). Clicking a square that is
      // already part of a merged cell just selects that cell, so an accidental second
      // click never grows the span. Armed for exactly one click, whatever the outcome.
      if (mergeCellMode) {
        if (frac) {
          const square = gridSquareAtFraction(selected, frac);
          if (square) {
            const covering = mergedCellCovering(
              selected,
              square.row,
              square.column
            );
            if (covering) {
              setMergedSelection({ row: covering.row, column: covering.column });
            } else {
              const spans = mergeTargetSpan(selected, square.row, square.column);
              if (spans) {
                commitTableEdit(
                  selected.tableId,
                  withCellSpan(selected, square.row, square.column, spans)
                );
                setMergedSelection({ row: square.row, column: square.column });
              } else {
                // The bottom-right square: nothing to merge into, so the table and the
                // current selection are both left exactly as they were.
                toast('Nothing to merge into');
              }
            }
          }
        }
        setMergeCellMode(false);
        return;
      }
      // "Add Hidden Row": the clicked in-table row becomes a section-title row with no column
      // name and no data area — nothing to read, so the row is simply dropped from the output.
      if (addHiddenRowMode) {
        if (frac) {
          const r = sectionRowBandAt(frac);
          if (r != null) {
            const existing = selected.sectionTitles ?? [];
            if (!existing.some((s) => s.tableRow === r)) {
              commitTableEdit(selected.tableId, {
                ...selected,
                sectionTitles: [
                  ...existing,
                  { tableRow: r, delete: true, columnName: null, data: null },
                ],
              });
            }
            setSelectedSectionRow(r);
          }
        }
        setAddHiddenRowMode(false);
        return;
      }
      // "Add Section Title Row": the clicked in-table row becomes a new section-title row,
      // arriving complete — its data area drawn across the leading squares of the row and its
      // column name already chosen. Both used to be left to the user: the area rubber-banded
      // out by hand, the name picked from the combo afterwards. Section titles sit at the left
      // of their row in these documents and take the name of whichever column was last used, so
      // both are now defaults the user can correct rather than steps they must perform.
      if (addSubTitleMode) {
        if (frac) {
          const r = sectionRowBandAt(frac);
          if (r != null) {
            const existing = selected.sectionTitles ?? [];
            if (!existing.some((s) => s.tableRow === r)) {
              const bounds = leadingSquaresBounds(
                selected,
                r,
                sectionTitleAreaColumnSpan()
              );
              commitTableEdit(selected.tableId, {
                ...selected,
                sectionTitles: [
                  ...existing,
                  {
                    tableRow: r,
                    // `delete` false only once there is an area to read: a table with no
                    // columns yields no bounds, and such a row is a hidden row by default.
                    delete: bounds == null,
                    columnName: newSectionTitleColumnName ?? null,
                    data:
                      bounds == null
                        ? null
                        : { bounds, text: null, confidence: null },
                  },
                ],
              });
            }
            setSelectedSectionRow(r);
          }
        }
        setAddSubTitleMode(false);
        return;
      }
      // Outside add mode: clicking inside an existing section-title row selects it. This
      // deliberately outranks merged-cell selection below — a sub-title row spans the full
      // table width, so a merged cell inside one would otherwise make the row unselectable
      // and break "Delete Suection Title Row" and the column-name combo.
      if (frac) {
        const r = sectionRowBandAt(frac);
        const hitRow = (selected.sectionTitles ?? []).find(
          (s) => s.tableRow === r
        );
        if (hitRow) {
          setSelectedSectionRow(hitRow.tableRow);
          setMergedSelection(null);
          return;
        }
        // A click anywhere inside an existing merged cell's spanned block selects that
        // cell (by its anchor, not the clicked square).
        const square = gridSquareAtFraction(selected, frac);
        const covering = square
          ? mergedCellCovering(selected, square.row, square.column)
          : null;
        if (covering) {
          setMergedSelection({ row: covering.row, column: covering.column });
          setSelectedSectionRow(null);
          return;
        }
      }
      // A click that hit neither a section-title row nor a merged cell clears both
      // selections, then falls through to the normal table-selection behaviour.
      setSelectedSectionRow(null);
      setMergedSelection(null);
    }
    if (!onSelectTable) return;
    const frac = eventToFraction(e);
    if (!frac) return;
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

  // Options-block actions for Rows mode. Add/Delete act on the selected horizontal divider
  // (`selectedLine.index`, a 1-based divider index k); addRow half-splits the single row of
  // a table with no internal row lines (like the old border "Add Below").
  const performRowsAction = useCallback(
    (name) => {
      if (name === 'addRow') {
        runAxisAction(
          'rowHeights',
          (arr) => splitEntry(arr, 0),
          (len) => splitMapBelow(len, 0)
        );
        return;
      }
      const k =
        selectedLine && selectedLine.orientation === 'row'
          ? selectedLine.index
          : null;
      if (k == null) return;
      if (name === 'addAbove') {
        runAxisAction(
          'rowHeights',
          (arr) => splitEntry(arr, k - 1),
          (len) => splitMap(len, k - 1)
        );
      } else if (name === 'addBelow') {
        runAxisAction(
          'rowHeights',
          (arr) => splitEntry(arr, k),
          (len) => splitMapBelow(len, k)
        );
      } else if (name === 'deleteLine') {
        runAxisAction(
          'rowHeights',
          (arr) => mergeCells(arr, k),
          (len) => mergeMap(len, k)
        );
        setSelectedLine(null);
      }
    },
    [runAxisAction, selectedLine]
  );

  // Options-block actions for Columns mode, mirroring performRowsAction on the selected
  // vertical divider.
  const performColumnsAction = useCallback(
    (name) => {
      const k =
        selectedLine && selectedLine.orientation === 'column'
          ? selectedLine.index
          : null;
      if (k == null) return;
      if (name === 'addLeft') {
        runAxisAction(
          'columnWidths',
          (arr) => splitEntry(arr, k - 1),
          (len) => splitMap(len, k - 1)
        );
      } else if (name === 'addRight') {
        runAxisAction(
          'columnWidths',
          (arr) => splitEntry(arr, k),
          (len) => splitMapBelow(len, k)
        );
      } else if (name === 'deleteLine') {
        runAxisAction(
          'columnWidths',
          (arr) => mergeCells(arr, k),
          (len) => mergeMap(len, k)
        );
        setSelectedLine(null);
      }
    },
    [runAxisAction, selectedLine]
  );

  // Options-block actions for Special Cells mode. `setTitle` enters the Set-Title sub-mode
  // (draggable title sides, or a rubber-band when there is no title yet); the others commit
  // an immediate edit to the selected table.
  const performSpecialAction = useCallback(
    (name) => {
      if (name === 'setTitle') {
        setTitleSelecting(true);
        return;
      }
      if (name === 'addSubTitleRow') {
        setAddSubTitleMode(true);
        return;
      }
      if (name === 'addHiddenRow') {
        setAddHiddenRowMode(true);
        return;
      }
      if (name === 'mergeCell') {
        setMergeCellMode(true);
        return;
      }
      if (!selected) return;
      const t = findTableById(metadataTables, selected.tableId);
      if (!t) return;
      const spanEdits = {
        extendColumn: (cell) => ({ columnSpan: (cell.columnSpan ?? 1) + 1 }),
        reduceColumn: (cell) => ({ columnSpan: (cell.columnSpan ?? 1) - 1 }),
        extendRow: (cell) => ({ rowSpan: (cell.rowSpan ?? 1) + 1 }),
        reduceRow: (cell) => ({ rowSpan: (cell.rowSpan ?? 1) - 1 }),
      };
      if (spanEdits[name]) {
        if (!mergedSelection) return;
        const { row, column } = mergedSelection;
        const cell = cellAt(t, row, column);
        if (!cell) return;
        // withCellSpan clamps into [1, remaining grid], so ±1 needs no bounds check.
        const edited = withCellSpan(t, row, column, spanEdits[name](cell));
        commitTableEdit(selected.tableId, edited);
        // A reduction that leaves both spans at 1 is no longer a merged cell, so the
        // selection goes with it — otherwise Extend/Reduce would stay enabled against a
        // cell the Special Areas layer no longer draws.
        const after = cellAt(edited, row, column);
        if ((after?.rowSpan ?? 1) === 1 && (after?.columnSpan ?? 1) === 1) {
          setMergedSelection(null);
        }
        return;
      }
      if (name === 'deleteSubTitleRow') {
        if (selectedSectionRow == null) return;
        commitTableEdit(selected.tableId, {
          ...t,
          sectionTitles: (t.sectionTitles ?? []).filter(
            (s) => s.tableRow !== selectedSectionRow
          ),
        });
        setSelectedSectionRow(null);
      } else if (name === 'deleteTitle') {
        commitTableEdit(selected.tableId, { ...t, title: null });
      } else if (name === 'removeHeader') {
        // Header rows come off one at a time, mirroring addHeader — so the pair steps a
        // multi-row header up and down. Floored at zero, as addHeader is capped at the
        // row count, keeping headerCount within [0, rows] however often either is used.
        const next = Math.max((t.headerCount ?? 0) - 1, 0);
        commitTableEdit(selected.tableId, { ...t, headerCount: next });
      } else if (name === 'addHeader') {
        const rows = (t.rowHeights ?? []).length;
        const next = Math.min((t.headerCount ?? 0) + 1, rows);
        commitTableEdit(selected.tableId, { ...t, headerCount: next });
      }
    },
    [
      selected,
      metadataTables,
      commitTableEdit,
      selectedSectionRow,
      mergedSelection,
    ]
  );

  useEffect(() => {
    if (onRequestCreate) onRequestCreate(startCreate);
  }, [onRequestCreate, startCreate]);

  useEffect(() => {
    if (onRequestDelete) onRequestDelete(startDelete);
  }, [onRequestDelete, startDelete]);

  useEffect(() => {
    if (onRequestRowsAction) onRequestRowsAction(performRowsAction);
  }, [onRequestRowsAction, performRowsAction]);

  useEffect(() => {
    if (onRequestColumnsAction) onRequestColumnsAction(performColumnsAction);
  }, [onRequestColumnsAction, performColumnsAction]);

  useEffect(() => {
    if (onRequestSpecialAction) onRequestSpecialAction(performSpecialAction);
  }, [onRequestSpecialAction, performSpecialAction]);

  // Report the selected grid line up so the Options block can enable/disable its buttons.
  useEffect(() => {
    if (onSelectedLineChange) onSelectedLineChange(selectedLine);
  }, [onSelectedLineChange, selectedLine]);

  // Report the selected section-title row up so the Options block can bind the "Column
  // name" combo and enable/disable "Delete Section Title Row".
  useEffect(() => {
    if (onSelectedSectionRowChange) onSelectedSectionRowChange(selectedSectionRow);
  }, [onSelectedSectionRowChange, selectedSectionRow]);

  // Report the selected merged cell up so the Options block can enable/disable its
  // Extend / Reduce buttons.
  useEffect(() => {
    if (onSelectedMergedCellChange) onSelectedMergedCellChange(mergedSelection);
  }, [onSelectedMergedCellChange, mergedSelection]);

  // A merged-cell selection, and an armed "Merge Cell", mean nothing once the layer, the
  // displayed page or the selected table changes.
  useEffect(() => {
    setMergedSelection(null);
    setMergeCellMode(false);
  }, [mode, page, selected?.tableId]);

  // A stale line selection, Set-Title sub-mode, or section-title selection / add mode has
  // no meaning after the mode or the selected table changes.
  useEffect(() => {
    setSelectedLine(null);
    setTitleSelecting(false);
    setTitleRect(null);
    setSelectedSectionRow(null);
    setAddSubTitleMode(false);
    setAddHiddenRowMode(false);
    setSectionAreaRect(null);
  }, [mode, selected?.tableId]);

  // Remove any lingering window listeners if the editor unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('mousemove', handleCreateMove);
      window.removeEventListener('mouseup', handleCreateEnd);
      window.removeEventListener('mousemove', handleTitleCreateMove);
      window.removeEventListener('mouseup', handleTitleCreateEnd);
      window.removeEventListener('mousemove', handleColourCreateMove);
      window.removeEventListener('mouseup', handleColourCreateEnd);
      window.removeEventListener('mousemove', handleColourPickMove);
      window.removeEventListener('mouseup', handleColourPickEnd);
      window.removeEventListener('mousemove', handleSectionAreaMove);
      window.removeEventListener('mouseup', handleSectionAreaEnd);
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

  // The selected table's outer border in viewbox px, plus its four boundary hit lines.
  // A locked Borders layer draws the border alone — no hit lines, so no edge can be dragged.
  const renderBorder = () => {
    if (mode !== 'border' || !selected) return null;
    if (locked) return staticBorderRect();
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
          stroke={layerBorderColour()}
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

  // The selected table's outer border rect (blue), drawn NOT draggable — used by the
  // Rows and Columns modes (which show the border but forbid resizing it).
  const staticBorderRect = () => {
    if (!selected) return null;
    return (
      <rect
        x={selected.bounds.left * pixelWidth}
        y={selected.bounds.top * pixelHeight}
        width={selected.bounds.width * pixelWidth}
        height={selected.bounds.height * pixelHeight}
        fill={'none'}
        stroke={layerBorderColour()}
        strokeWidth={1}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // The selected table's internal horizontal grid lines (row dividers), drawn in
  // layerRowsColour(). When `interactive`, each carries a transparent wide-stroke hit line
  // (click selects, drag moves) and the selected divider is flanked by a highlight line
  // immediately above and below. In Columns mode these are display-only (interactive false).
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
          stroke={layerRowsColour()}
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
              stroke={selectedRowHighlight()}
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
              stroke={selectedRowHighlight()}
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
  // layerColumnsColour(); interactive in Columns mode (click selects, drag moves) with a
  // highlight line on each side of the selected divider.
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
          stroke={layerColumnsColour()}
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
              stroke={selectedColumnHighlight()}
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
              stroke={selectedColumnHighlight()}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />
          );
        }
      }
    }
    return out;
  };

  // Rows mode: static border + interactive horizontal (row) dividers.
  const renderRows = () => {
    if (mode !== 'rows' || !selected) return null;
    return (
      <g>
        {staticBorderRect()}
        {renderHorizontalLines(true)}
      </g>
    );
  };

  // Columns mode: static border + display-only horizontal dividers + interactive vertical
  // (column) dividers. When locked the vertical dividers are display-only too, which also
  // leaves no line selectable — so the Options block's Add / Delete stay unusable.
  const renderColumns = () => {
    if (mode !== 'columns' || !selected) return null;
    return (
      <g>
        {staticBorderRect()}
        {renderHorizontalLines(false)}
        {renderVerticalLines(!locked)}
      </g>
    );
  };

  // The selected table's title rectangle (Special Cells mode): a dotted rectangle at
  // title.bounds (page fractions, may be outside the table) with the word "title" in its
  // top-right corner. While the Set-Title sub-mode is active, its four sides carry
  // transparent hit lines so the bounds can be resized by dragging.
  const renderTitle = () => {
    if (!selected || !selected.title) return null;
    const b = selected.title.bounds;
    const x = b.left * pixelWidth;
    const y = b.top * pixelHeight;
    const w = b.width * pixelWidth;
    const h = b.height * pixelHeight;
    const hitCommon = {
      stroke: 'transparent',
      strokeWidth: hitLineWidthPx(),
      vectorEffect: 'non-scaling-stroke',
      'data-testid': TITLE_HIT_TESTID,
      style: { pointerEvents: 'stroke' },
    };
    const side = (id, x1, y1, x2, y2, kind, cursor) => (
      <line
        key={id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        {...hitCommon}
        cursor={cursor}
        onMouseDown={(e) => handleTitleSideHit(kind, e)}
      />
    );
    return (
      <g>
        <rect
          data-testid={TITLE_RECT_TESTID}
          x={x}
          y={y}
          width={w}
          height={h}
          fill={'none'}
          stroke={layerSpecialCellsColour()}
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
          fill={layerSpecialCellsColour()}
        >
          {'title'}
        </text>
        {/* The title's sides are always draggable to resize it whenever the title is
            displayed (not only in Set-Title sub-mode). */}
        <g>
          {side('t-left', x, y, x, y + h, 'title-left', 'ew-resize')}
          {side('t-right', x + w, y, x + w, y + h, 'title-right', 'ew-resize')}
          {side('t-top', x, y, x + w, y, 'title-top', 'ns-resize')}
          {side('t-bottom', x, y + h, x + w, y + h, 'title-bottom', 'ns-resize')}
        </g>
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
              stroke={sectionTitleMarkerColour()}
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
              fill={sectionTitleMarkerColour()}
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
                stroke={selectedSectionTitleHighlight()}
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
                stroke={selectedSectionTitleHighlight()}
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
                stroke={sectionTitleMarkerColour()}
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

  // The selected table's merged cells (Special Cells mode): one stroked, translucently
  // filled rect per entry of mergedCells(), covering the whole spanned block. The selected
  // one adds a highlight rect just inside its boundary, as the selected section-title row
  // does. Interior grid lines are deliberately NOT suppressed: the row and column lines
  // crossing a merged block are shared geometry owned by the Rows and Columns layers, and
  // hiding them from this layer alone would make the same table draw differently per layer.
  const renderMergedCells = () => {
    if (!selected) return null;
    const list = mergedCells(selected);
    if (list.length === 0) return null;
    const cols = (selected.columnWidths ?? []).map((v) => v.value);
    const rows = (selected.rowHeights ?? []).map((v) => v.value);
    const colOffsets = cumulative(cols);
    const rowOffsets = cumulative(rows);
    const dx = overlayScale ? 1 / overlayScale.sx : 1;
    const dy = overlayScale ? 1 / overlayScale.sy : 1;
    // The host mirrors the local selection back down as `selectedMergedCell`; either
    // matching marks the block as selected, so the highlight does not wait a round trip.
    const isSelected = (cell) =>
      [selectedMergedCell, mergedSelection].some(
        (ref) => ref && ref.row === cell.row && ref.column === cell.column
      );
    return (
      <g>
        {list.map((cell, i) => {
          if (cell.row >= rows.length || cell.column >= cols.length) return null;
          // The far edge is clamped to the grid, so a span reaching past the last line
          // (a stale saved span, or an axis line since deleted) still draws inside it.
          const lastCol = Math.min(
            cell.column + (cell.columnSpan ?? 1) - 1,
            cols.length - 1
          );
          const lastRow = Math.min(
            cell.row + (cell.rowSpan ?? 1) - 1,
            rows.length - 1
          );
          const leftFrac =
            selected.bounds.left +
            (cell.column === 0 ? 0 : colOffsets[cell.column - 1]);
          const topFrac =
            selected.bounds.top + (cell.row === 0 ? 0 : rowOffsets[cell.row - 1]);
          const x = leftFrac * pixelWidth;
          const y = topFrac * pixelHeight;
          const w =
            (selected.bounds.left + colOffsets[lastCol] - leftFrac) * pixelWidth;
          const h =
            (selected.bounds.top + rowOffsets[lastRow] - topFrac) * pixelHeight;
          const parts = [
            <rect
              key={`mc-${i}`}
              data-testid={`merged-cell-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={mergedCellFill()}
              stroke={mergedCellMarkerColour()}
              strokeWidth={1}
              vectorEffect={'non-scaling-stroke'}
            />,
          ];
          if (isSelected(cell)) {
            parts.push(
              <rect
                key={`mc-sel-${i}`}
                data-testid={`merged-cell-selected-${i}`}
                x={x + dx}
                y={y + dy}
                width={w - 2 * dx}
                height={h - 2 * dy}
                fill={'none'}
                stroke={selectedMergedCellHighlight()}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
            );
          }
          return <g key={`mc-g-${i}`}>{parts}</g>;
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
        stroke={sectionTitleMarkerColour()}
        strokeWidth={1}
        strokeDasharray={sectionTitleMarkerDash()}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // Special Cells mode: the whole grid drawn non-editable (static border + display-only
  // horizontal and vertical dividers), plus the header/title rectangles, the merged-cell
  // blocks and the section-title rows.
  const renderSpecial = () => {
    if (mode !== 'special' || !selected) return null;
    return (
      <g>
        {staticBorderRect()}
        {renderHorizontalLines(false)}
        {renderVerticalLines(false)}
        {renderMergedCells()}
        {renderHeaderRect()}
        {renderTitle()}
        {renderSectionTitles()}
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
        stroke={layerBorderColour()}
        strokeWidth={1}
        strokeDasharray={'4 3'}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // Rubber-band preview rectangle while creating a new title (Set-Title sub-mode, no title).
  const renderTitlePreview = () => {
    if (!titleRect) return null;
    return (
      <rect
        data-testid={'title-preview'}
        x={titleRect.left * pixelWidth}
        y={titleRect.top * pixelHeight}
        width={titleRect.width * pixelWidth}
        height={titleRect.height * pixelHeight}
        fill={'none'}
        stroke={layerSpecialCellsColour()}
        strokeWidth={1}
        strokeDasharray={'2 2'}
        vectorEffect={'non-scaling-stroke'}
      />
    );
  };

  // Colours mode: a dotted rectangle per coloured area, plus (for the selected area) a
  // highlight line just outside and just inside its dotted boundary.
  const renderColours = () => {
    if (mode !== 'colours') return null;
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
              stroke={layerColoursColour()}
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
                stroke={selectedColouredAreaHighlight()}
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
                stroke={selectedColouredAreaHighlight()}
                strokeWidth={1}
                vectorEffect={'non-scaling-stroke'}
              />
            );
          }
          // Transparent wide-stroke side hit lines so any displayed area's edges can be
          // dragged to resize it (mirrors the title-side / boundary resize). A locked
          // Colours layer omits them: the area is drawn, but its edges do not move.
          if (locked) return <g key={`ca-g-${i}`}>{parts}</g>;
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
          parts.push(
            side(`coloured-side-${i}-left`, x, y, x, y + h, 'carea-left', 'ew-resize'),
            side(`coloured-side-${i}-right`, x + w, y, x + w, y + h, 'carea-right', 'ew-resize'),
            side(`coloured-side-${i}-top`, x, y, x + w, y, 'carea-top', 'ns-resize'),
            side(`coloured-side-${i}-bottom`, x, y + h, x + w, y + h, 'carea-bottom', 'ns-resize')
          );
          return <g key={`ca-g-${i}`}>{parts}</g>;
        })}
      </g>
    );
  };

  // Rubber-band preview rectangle while adding a new coloured area (Colours mode, Add).
  const renderColourCreatePreview = () => {
    if (!colourCreateRect) return null;
    return (
      <rect
        data-testid={'coloured-create-preview'}
        x={colourCreateRect.left * pixelWidth}
        y={colourCreateRect.top * pixelHeight}
        width={colourCreateRect.width * pixelWidth}
        height={colourCreateRect.height * pixelHeight}
        fill={'none'}
        stroke={layerColoursColour()}
        strokeWidth={1}
        strokeDasharray={'4 3'}
        vectorEffect={'non-scaling-stroke'}
      />
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
          mode; never displayed. */}
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
            cursor:
              creating ||
              (titleSelecting && selected && !selected.title) ||
              (mode === 'special' && (addSubTitleMode || mergeCellMode)) ||
              (mode === 'colours' && colourAddMode)
                ? 'crosshair'
                : 'default',
          }}
        >
          {renderBorder()}
          {renderRows()}
          {renderColumns()}
          {renderSpecial()}
          {renderColours()}
          {renderCreatePreview()}
          {renderTitlePreview()}
          {renderSectionAreaPreview()}
          {renderColourCreatePreview()}
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
