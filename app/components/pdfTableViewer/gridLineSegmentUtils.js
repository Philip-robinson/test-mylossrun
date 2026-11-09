// Pure geometry for staggered grid lines: an axis entry's optional `segments` list of
// { offset, start } displaces the divider at that entry's far edge, per cell along the line.
// Offsets are page fractions relative to the divider's nominal position; nothing mutates its argument.

import { gridLineOffsetEpsilon, gridLineMoveLimitFraction } from 'config';

const otherAxisKey = (axisKey) => (axisKey === 'columnWidths' ? 'rowHeights' : 'columnWidths');

const axisOrigin = (table, axisKey) =>
  axisKey === 'columnWidths' ? table.bounds.left : table.bounds.top;

const cellCountAlong = (table, axisKey) => (table?.[otherAxisKey(axisKey)] ?? []).length;

const isZero = (v) => Math.abs(v) < gridLineOffsetEpsilon();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The offset of every cell along the entry's divider; starts outside 0 .. cellCount-1 are ignored.
export function expandOffsets(entry, cellCount) {
  const offsets = new Array(cellCount).fill(0);
  const segments = (entry?.segments ?? [])
    .filter((s) => s.start >= 0 && s.start < cellCount)
    .sort((a, b) => a.start - b.start);
  segments.forEach((s, j) => {
    const end = j + 1 < segments.length ? segments[j + 1].start : cellCount;
    for (let n = s.start; n < end; n += 1) offsets[n] = s.offset;
  });
  return offsets;
}

// The segments describing per-cell offsets: one per change of offset, empty when all zero.
export function compressOffsets(offsets) {
  const segments = [];
  let previous = 0;
  offsets.forEach((offset, start) => {
    if (!isZero(offset - previous)) {
      segments.push({ offset, start });
      previous = offset;
    }
  });
  return segments;
}

// A copy of the entry carrying `segments`, or with no `segments` key when there are none.
export function withSegments(entry, segments) {
  const { segments: _dropped, ...rest } = entry;
  return segments && segments.length ? { ...rest, segments } : rest;
}

export function isStaggered(entry) {
  return Array.isArray(entry?.segments) && entry.segments.length > 0;
}

export function axisHasSegments(axis) {
  return (axis ?? []).some(isStaggered);
}

// The axis in canonical form: no start-0 segment, no near-zero or repeated offsets, no
// out-of-range starts, and no segments on the last entry.
export function canonicaliseAxis(axis, cellCount) {
  const out = (axis ?? []).map((e) => ({ ...e }));
  for (let i = 0; i < out.length - 1; i += 1) {
    let offsets = expandOffsets(out[i], cellCount).map((o) => (isZero(o) ? 0 : o));
    if (cellCount > 0 && offsets[0] !== 0) {
      const base = offsets[0];
      out[i].value += base;
      out[i + 1].value -= base;
      offsets = offsets.map((o) => (isZero(o - base) ? 0 : o - base));
    }
    out[i] = withSegments(out[i], compressOffsets(offsets));
  }
  if (out.length) out[out.length - 1] = withSegments(out[out.length - 1], null);
  return out;
}

export function canonicaliseTable(table) {
  return {
    ...table,
    columnWidths: canonicaliseAxis(table.columnWidths, (table.rowHeights ?? []).length),
    rowHeights: canonicaliseAxis(table.rowHeights, (table.columnWidths ?? []).length),
  };
}

// The divider's position ignoring segments: the axis origin plus values[0 .. k-1].
export function nominalDividerPosition(table, axisKey, k) {
  const axis = table[axisKey] ?? [];
  let position = axisOrigin(table, axisKey);
  for (let i = 0; i < k && i < axis.length; i += 1) position += axis[i].value;
  return position;
}

// The divider's effective position at `cell`; dividers 0 and len are the borders.
export function dividerPositionAt(table, axisKey, k, cell) {
  const axis = table[axisKey] ?? [];
  const nominal = nominalDividerPosition(table, axisKey, k);
  if (k <= 0 || k >= axis.length) return nominal;
  const offset = expandOffsets(axis[k - 1], cellCountAlong(table, axisKey))[cell] ?? 0;
  return nominal + offset;
}

// One piece per cell along divider k: its position, and the extent between the
// perpendicular dividers in the band the piece has moved into.
export function linePieces(table, axisKey, k) {
  const other = otherAxisKey(axisKey);
  const bandCount = (table[axisKey] ?? []).length;
  const nominal = nominalDividerPosition(table, axisKey, k);
  const pieces = [];
  for (let cell = 0; cell < cellCountAlong(table, axisKey); cell += 1) {
    const position = dividerPositionAt(table, axisKey, k, cell);
    const band = clamp(position - nominal >= 0 ? k : k - 1, 0, Math.max(bandCount - 1, 0));
    pieces.push({
      cell,
      start: dividerPositionAt(table, other, cell, band),
      end: dividerPositionAt(table, other, cell + 1, band),
      position,
    });
  }
  return pieces;
}

// Divider k's drawn path as [along, position] page-fraction points, k in 0 .. axis length:
// both ends of every linePieces piece when staggered, else the two ends of the straight line.
export function dividerPolyline(table, axisKey, k) {
  const axis = table[axisKey] ?? [];
  if (k > 0 && k < axis.length && isStaggered(axis[k - 1])) {
    return linePieces(table, axisKey, k).flatMap((piece) => [
      [piece.start, piece.position],
      [piece.end, piece.position],
    ]);
  }
  const { left, top, width, height } = table.bounds;
  const vertical = axisKey === 'columnWidths';
  const alongStart = vertical ? top : left;
  const alongExtent = vertical ? height : width;
  const position = nominalDividerPosition(table, axisKey, k);
  return [
    [alongStart, position],
    [alongStart + alongExtent, position],
  ];
}

// The axis with segment starts remapped through the perpendicular axis's new-to-old index
// map; a non-number entry is a new line taking its predecessor's offset.
export function remapAxisSegments(axis, oldCellCount, crossMap) {
  return (axis ?? []).map((entry) => {
    if (!isStaggered(entry)) return entry;
    const old = expandOffsets(entry, oldCellCount);
    const remapped = [];
    crossMap.forEach((oldIndex, m) => {
      if (typeof oldIndex === 'number') remapped.push(old[oldIndex] ?? 0);
      else remapped.push(m > 0 ? remapped[m - 1] : 0);
    });
    return withSegments(entry, compressOffsets(remapped));
  });
}

// The cells a split press at `cell` on divider k moves: up to the next segment start.
export function splitRun(axis, k, cell, cellCount) {
  const next = (axis?.[k - 1]?.segments ?? [])
    .map((s) => s.start)
    .filter((start) => start > cell && start < cellCount);
  return { start: cell, end: next.length ? Math.min(...next) : cellCount };
}

const moveLimitsOver = (table, axisKey, k, start, end) => {
  if (end <= start) return { min: 0, max: 0 };
  let positive = Infinity;
  let negative = Infinity;
  for (let n = start; n < end; n += 1) {
    const here = dividerPositionAt(table, axisKey, k, n);
    positive = Math.min(positive, dividerPositionAt(table, axisKey, k + 1, n) - here);
    negative = Math.min(negative, here - dividerPositionAt(table, axisKey, k - 1, n));
  }
  const f = gridLineMoveLimitFraction();
  return { min: -f * negative, max: f * positive };
};

export function splitMoveLimits(table, axisKey, k, cell) {
  const { start, end } = splitRun(table[axisKey], k, cell, cellCountAlong(table, axisKey));
  return moveLimitsOver(table, axisKey, k, start, end);
}

// The canonical axis after moving the run pressed at `cell` by the clamped displacement.
export function applySplitMove(table, axisKey, k, cell, displacement) {
  const axis = table[axisKey];
  const cellCount = cellCountAlong(table, axisKey);
  const { min, max } = splitMoveLimits(table, axisKey, k, cell);
  const d = clamp(displacement, min, max);
  const { start, end } = splitRun(axis, k, cell, cellCount);
  const offsets = expandOffsets(axis[k - 1], cellCount);
  for (let n = start; n < end; n += 1) offsets[n] += d;
  const moved = axis.map((e, i) => (i === k - 1 ? withSegments(e, compressOffsets(offsets)) : e));
  return canonicaliseAxis(moved, cellCount);
}

export function wholeLineMoveLimits(table, axisKey, k) {
  return moveLimitsOver(table, axisKey, k, 0, cellCountAlong(table, axisKey));
}

// The canonical axis after joining divider k: each piece moves to the nominal position when
// that lies strictly between its neighbours there, otherwise towards it by at most the move
// limit of the gap to the neighbour in the way, so the line may stay staggered.
export function joinLineBetweenNeighbours(table, axisKey, k) {
  const axis = table[axisKey];
  const cellCount = cellCountAlong(table, axisKey);
  const nominal = nominalDividerPosition(table, axisKey, k);
  const f = gridLineMoveLimitFraction();
  const offsets = expandOffsets(axis[k - 1], cellCount).map((offset, n) => {
    const before = dividerPositionAt(table, axisKey, k - 1, n);
    const after = dividerPositionAt(table, axisKey, k + 1, n);
    if (before < nominal && nominal < after) return 0;
    const here = nominal + offset;
    if (nominal > here) return Math.min(nominal, here + f * (after - here)) - nominal;
    return Math.max(nominal, here - f * (here - before)) - nominal;
  });
  const joined = axis.map((e, i) => (i === k - 1 ? withSegments(e, compressOffsets(offsets)) : e));
  return canonicaliseAxis(joined, cellCount);
}

// True when a straight line at `position` lies strictly inside band `band` at every cell.
export function lineFitsInBand(table, axisKey, band, position) {
  const cells = Math.max(cellCountAlong(table, axisKey), 1);
  for (let n = 0; n < cells; n += 1) {
    if (!(dividerPositionAt(table, axisKey, band, n) < position)) return false;
    if (!(position < dividerPositionAt(table, axisKey, band + 1, n))) return false;
  }
  return true;
}
