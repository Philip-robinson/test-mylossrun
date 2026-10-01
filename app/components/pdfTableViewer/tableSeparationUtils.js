// Display-only vertical separation of a page's tables. The page is cut into horizontal bands
// at the top and bottom of every run of vertically overlapping tables, and each band is shown
// shifted down by `gap` for every cut above it. All values are in page pixels.

// The vertical extents of `boundsList` (page fractions) in page px, with overlapping extents
// merged into one. Extents that overlap by no more than `tolerance` px count as touching: they
// stay separate and share one edge.
export function tableSpans(boundsList, pixelHeight, tolerance = 0) {
  const spans = (boundsList ?? [])
    .filter(Boolean)
    .map((b) => ({
      top: Math.max(0, b.top * pixelHeight),
      bottom: Math.min(pixelHeight, (b.top + b.height) * pixelHeight),
    }))
    .filter((s) => s.bottom > s.top)
    .sort((a, b) => a.top - b.top);
  const merged = [];
  spans.forEach((s) => {
    const last = merged[merged.length - 1];
    if (last && s.top < last.bottom - tolerance) {
      last.bottom = Math.max(last.bottom, s.bottom);
    } else if (last && s.top < last.bottom) {
      merged.push({ top: last.bottom, bottom: Math.max(last.bottom, s.bottom) });
    } else {
      merged.push({ ...s });
    }
  });
  return merged;
}

// The bands for `boundsList` on a page `pixelHeight` tall: [{ start, end, offset }] covering
// 0..pixelHeight, plus `totalGap`, the extra display height they add.
export function separationBands(boundsList, pixelHeight, gap, tolerance = 0) {
  const spans = tableSpans(boundsList, pixelHeight, tolerance);
  const cuts = spans.flatMap((s) => [s.top, s.bottom]);
  const edges = [...new Set([0, ...cuts, pixelHeight])].sort((a, b) => a - b);
  const bands = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end <= start) continue;
    bands.push({
      start,
      end,
      offset: gap * cuts.filter((c) => c <= start).length,
    });
  }
  return { bands, totalGap: gap * cuts.length };
}

// Display y for page y. `side` 'top' places a y on a cut in the band below it (a table's top
// edge); 'bottom' places it in the band above (a table's bottom edge). A y off the page takes
// the offset of the end band nearest it.
export function warpY(bands, y, side = 'top') {
  if (!bands || bands.length === 0) return y;
  const found =
    side === 'bottom'
      ? bands.find((b) => y > b.start && y <= b.end)
      : bands.find((b) => y >= b.start && y < b.end);
  const band = found ?? (y <= bands[0].start ? bands[0] : bands[bands.length - 1]);
  return y + band.offset;
}

// Display y and height for the page span top..bottom, the height never below zero.
export function warpSpan(bands, top, bottom) {
  const y = warpY(bands, top);
  return { y, h: Math.max(0, warpY(bands, bottom, 'bottom') - y) };
}

// Page y for display y. A y inside a gap maps to the cut the gap sits on.
export function unwarpY(bands, displayY) {
  if (!bands || bands.length === 0) return displayY;
  for (let i = 0; i < bands.length; i += 1) {
    const b = bands[i];
    if (displayY < b.start + b.offset) return b.start;
    if (displayY < b.end + b.offset) return displayY - b.offset;
  }
  const last = bands[bands.length - 1];
  return displayY - last.offset;
}
