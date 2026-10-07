// Pure utilities for cutting a table into horizontal pieces at page-fraction cut lines.

import { newUUID } from 'common/utils';
import { comesAfter } from 'components/pdfTableViewer/gridUtilities';
import {
  findTableById,
  identityMap,
  insertInDocumentOrder,
  pageTableName,
  reconcileAxisEdit,
  replaceTableById,
  resizeBoundary,
  sumValues,
} from 'components/pdfTableViewer/tableSupportUtils';

const ascending = (a, b) => a - b;

// `y` clamped to lie at least `minFraction` inside the top and bottom of `bounds`.
export function clampCutPosition(y, bounds, minFraction) {
  const low = bounds.top + minFraction;
  const high = bounds.top + bounds.height - minFraction;
  return Math.min(high, Math.max(low, y));
}

// A new ascending array holding `lines` and `y`.
export function addCutLine(lines, y) {
  return [...lines, y].sort(ascending);
}

// A new ascending array with `lines[index]` replaced by `y`.
export function moveCutLine(lines, index, y) {
  return lines.map((line, i) => (i === index ? y : line)).sort(ascending);
}

// A new array without `lines[index]`.
export function removeCutLine(lines, index) {
  return lines.filter((_, i) => i !== index);
}

// The cut lines that would actually split `bounds`, ascending, near-duplicates dropped.
export function effectiveCuts(bounds, lines, minFraction) {
  const low = bounds.top + minFraction;
  const high = bounds.top + bounds.height - minFraction;
  const kept = [];
  [...lines].sort(ascending).forEach((y) => {
    if (y < low || y > high) return;
    if (kept.length && y - kept[kept.length - 1] < minFraction) return;
    kept.push(y);
  });
  return kept;
}

// Every table in `tables`, at the top level and at any depth inside a `next` map.
const allTablesDeep = (tables) => {
  const out = [];
  const collect = (arr) => {
    (arr ?? []).forEach((t) => {
      out.push(t);
      if (t.next) collect(Object.values(t.next));
    });
  };
  collect(tables);
  return out;
};

// Whether `tableId` is held in some table's `next` map with no other member of that map
// coming after it in document order.
export function isLastInLinkGroup(tables, tableId) {
  for (const parent of allTablesDeep(tables)) {
    const member = parent.next?.[tableId];
    if (member) {
      return !Object.values(parent.next).some(
        (other) => other.tableId !== tableId && comesAfter(other, member)
      );
    }
  }
  return false;
}

// tableInPage for a table whose top is `top` on `page`, interpolated among every table there.
export function tableInPageAt(tables, page, top) {
  const allTables = allTablesDeep(tables);
  let above = null;
  let below = null;
  allTables
    .filter((t) => t.pdfPage === page)
    .forEach((t) => {
      const tTop = t.bounds.top;
      if (tTop < top) {
        if (above === null || tTop > above.bounds.top) above = t;
      } else if (below === null || tTop < below.bounds.top) below = t;
    });
  if (above && below) {
    return ((above.tableInPage ?? 0) + (below.tableInPage ?? 0)) / 2;
  }
  if (above) return (above.tableInPage ?? 0) + 1;
  if (below) return (below.tableInPage ?? 0) - 1;
  return 0;
}

const cutBottom = (piece, y, minFraction) => {
  const r = resizeBoundary('boundary-bottom', y, piece, minFraction, minFraction);
  return reconcileAxisEdit(
    piece,
    r,
    'rowHeights',
    r.rowHeights,
    identityMap(r.rowHeights.length),
    r.bounds
  );
};

// Cuts the top at `y`, placing the new top exactly on the previous piece's bottom.
const cutTop = (piece, y, previousPiece, minFraction) => {
  const r = resizeBoundary('boundary-top', y, piece, minFraction, minFraction);
  const removed = piece.rowHeights.length - r.rowHeights.length;
  const axisMap =
    removed > 0
      ? Array.from({ length: r.rowHeights.length }, (_, j) => j + removed)
      : identityMap(r.rowHeights.length);
  const bounds = {
    ...r.bounds,
    top: previousPiece.bounds.top + sumValues(previousPiece.rowHeights),
  };
  return reconcileAxisEdit(piece, r, 'rowHeights', r.rowHeights, axisMap, bounds);
};

// `piece` without the footer and section title on its last row.
const dropLastRowMarkers = (piece) => {
  const lastRow = piece.rowHeights.length - 1;
  const out = { ...piece };
  if (piece.sectionTitles) {
    out.sectionTitles = piece.sectionTitles.filter((s) => s.tableRow !== lastRow);
  }
  if (piece.footer && piece.footer.row === lastRow) out.footer = null;
  return out;
};

// Split `tableId` at `lines`, returning a new list, or `tables` when nothing is cut. Only a
// table holding no `next` members, either top-level or the last member of a linked group, is
// split; anything else comes back by reference. A last member's top piece stays in its
// parent's `next` map; every new piece is a top-level table placed in document order.
export function splitTableAtCuts(tables, tableId, lines, minFraction, newId = newUUID) {
  const index = tables.findIndex((t) => t.tableId === tableId);
  const lastMember = index < 0 && isLastInLinkGroup(tables, tableId);
  if (index < 0 && !lastMember) return tables;
  const original = lastMember ? findTableById(tables, tableId) : tables[index];
  if (Object.keys(original.next ?? {}).length > 0) return tables;
  const cuts = effectiveCuts(original.bounds, lines, minFraction);
  if (cuts.length === 0) return tables;

  const { top, height } = original.bounds;
  const edges = [top, ...cuts, top + height];
  const bandCount = edges.length - 1;
  const last = bandCount - 1;
  const bands = [];
  const firstRows = [];
  for (let i = 0; i < bandCount; i += 1) {
    let piece = original;
    if (i < last) piece = cutBottom(piece, edges[i + 1], minFraction);
    const rowsAboveCut = piece.rowHeights.length;
    if (i > 0) piece = cutTop(piece, edges[i], bands[i - 1], minFraction);
    firstRows.push(rowsAboveCut - piece.rowHeights.length);
    const splitBottomRow = i === last ? original.splitBottomRow ?? false : false;
    bands.push({ ...piece, splitBottomRow });
  }
  // A row crossed by a cut keeps its footer and section title on the lowest piece only.
  for (let i = 0; i < last; i += 1) {
    const lastOriginalRow = firstRows[i] + bands[i].rowHeights.length - 1;
    if (firstRows[i + 1] <= lastOriginalRow) bands[i] = dropLastRowMarkers(bands[i]);
  }

  const topPiece = {
    ...bands[0],
    headerCount: Math.min(original.headerCount ?? 0, bands[0].rowHeights.length),
  };

  const page = original.pdfPage;
  const withTop = replaceTableById(tables, tableId, topPiece);
  const working = [...withTop];
  const others = [];
  bands.slice(1).forEach((band) => {
    const n = allTablesDeep(working).filter((t) => t.pdfPage === page).length;
    const piece = {
      ...band,
      tableId: newId(),
      name: pageTableName(page, n),
      tableInPage: tableInPageAt(working, page, band.bounds.top),
      title: null,
      headerCount: 0,
      next: null,
      confirmationStage: null,
    };
    delete piece.grid;
    working.push(piece);
    others.push(piece);
  });

  if (lastMember) return others.reduce(insertInDocumentOrder, withTop);
  return [...tables.slice(0, index), topPiece, ...others, ...tables.slice(index + 1)];
}
