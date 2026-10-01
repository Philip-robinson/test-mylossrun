import {
  separationBands,
  tableSpans,
  unwarpY,
  warpSpan,
  warpY,
} from 'components/pdfTableViewer/tableSeparationUtils';

// A 1000px page with fractions that are exact in binary, so page px compare exactly.
const PAGE = 1000;
const GAP = 15;

const box = (top, height, left = 0, width = 0.25) => ({ left, top, width, height });

describe('tableSpans', () => {
  it('returns each table’s vertical extent in page px, sorted by top', () => {
    expect(tableSpans([box(0.5, 0.125), box(0.125, 0.25)], PAGE)).toEqual([
      { top: 125, bottom: 375 },
      { top: 500, bottom: 625 },
    ]);
  });

  it('merges tables whose extents overlap into one span', () => {
    expect(
      tableSpans([box(0.125, 0.25, 0), box(0.25, 0.25, 0.5)], PAGE)
    ).toEqual([{ top: 125, bottom: 500 }]);
  });

  it('keeps a table wholly inside another’s extent within that span', () => {
    expect(tableSpans([box(0.125, 0.5), box(0.25, 0.125, 0.5)], PAGE)).toEqual([
      { top: 125, bottom: 625 },
    ]);
  });

  it('keeps tables that only touch as separate spans', () => {
    expect(tableSpans([box(0.125, 0.125), box(0.25, 0.125)], PAGE)).toEqual([
      { top: 125, bottom: 250 },
      { top: 250, bottom: 375 },
    ]);
  });

  it('treats an overlap within the tolerance as touching, sharing the upper edge', () => {
    // 250.5px bottom against a 250px top: half a pixel of overlap.
    expect(
      tableSpans([box(0.125, 0.1255), box(0.25, 0.125)], PAGE, 1)
    ).toEqual([
      { top: 125, bottom: 250.5 },
      { top: 250.5, bottom: 375 },
    ]);
  });

  it('merges an overlap larger than the tolerance', () => {
    expect(
      tableSpans([box(0.125, 0.1275), box(0.25, 0.125)], PAGE, 1)
    ).toEqual([{ top: 125, bottom: 375 }]);
  });

  it('separates tables whose summed fractions leave a floating-point overlap', () => {
    // 0.1 + 0.2 is 0.30000000000000004, a hair past the next table's 0.3 top.
    const spans = tableSpans([box(0.1, 0.2), box(0.3, 0.2)], PAGE, 1);
    expect(spans).toHaveLength(2);
  });

  it('clamps extents to the page and drops empty or missing bounds', () => {
    expect(
      tableSpans([box(-0.125, 0.25), box(0.5, 0), null, box(0.875, 0.25)], PAGE)
    ).toEqual([
      { top: 0, bottom: 125 },
      { top: 875, bottom: 1000 },
    ]);
  });
});

describe('separationBands', () => {
  it('is one unshifted band with no gap when there are no tables', () => {
    expect(separationBands([], PAGE, GAP)).toEqual({
      bands: [{ start: 0, end: 1000, offset: 0 }],
      totalGap: 0,
    });
  });

  it('shifts each band by a gap for every table edge at or above its start', () => {
    expect(
      separationBands([box(0.125, 0.125), box(0.5, 0.25)], PAGE, GAP)
    ).toEqual({
      bands: [
        { start: 0, end: 125, offset: 0 },
        { start: 125, end: 250, offset: 15 },
        { start: 250, end: 500, offset: 30 },
        { start: 500, end: 750, offset: 45 },
        { start: 750, end: 1000, offset: 60 },
      ],
      totalGap: 60,
    });
  });

  it('puts two gaps between tables that touch', () => {
    const { bands } = separationBands(
      [box(0.125, 0.125), box(0.25, 0.125)],
      PAGE,
      GAP
    );
    const upper = bands.find((b) => b.start === 125);
    const lower = bands.find((b) => b.start === 250);
    expect(lower.offset - upper.offset).toBe(2 * GAP);
  });

  it('gives a table at the very top of the page its gap above', () => {
    const { bands } = separationBands([box(0, 0.25)], PAGE, GAP);
    expect(bands[0]).toEqual({ start: 0, end: 250, offset: 15 });
  });

  it('adds no gap within tables that overlap vertically', () => {
    const { bands, totalGap } = separationBands(
      [box(0.125, 0.5, 0), box(0.25, 0.125, 0.5)],
      PAGE,
      GAP
    );
    expect(bands.map((b) => b.start)).toEqual([0, 125, 625]);
    expect(totalGap).toBe(30);
  });

  it('covers the whole page with contiguous bands', () => {
    const { bands } = separationBands(
      [box(0.125, 0.125), box(0.25, 0.125), box(0.625, 0.25)],
      PAGE,
      GAP
    );
    expect(bands[0].start).toBe(0);
    expect(bands[bands.length - 1].end).toBe(PAGE);
    bands.slice(1).forEach((b, i) => expect(b.start).toBe(bands[i].end));
  });
});

describe('warpY', () => {
  const { bands } = separationBands(
    [box(0.125, 0.125), box(0.25, 0.125)],
    PAGE,
    GAP
  );

  it('returns y unchanged with no bands', () => {
    expect(warpY(null, 400)).toBe(400);
    expect(warpY([], 400, 'bottom')).toBe(400);
  });

  it('shifts y by the offset of the band it falls in', () => {
    expect(warpY(bands, 50)).toBe(50);
    expect(warpY(bands, 200)).toBe(215);
    expect(warpY(bands, 300)).toBe(345);
    expect(warpY(bands, 500)).toBe(560);
  });

  it('places a y on a cut in the band below by default, as a table’s top edge', () => {
    expect(warpY(bands, 250)).toBe(250 + 45);
  });

  it('places a y on a cut in the band above for the bottom side, as a table’s bottom edge', () => {
    expect(warpY(bands, 250, 'bottom')).toBe(250 + 15);
  });

  it('maps the page’s last row and first row onto the end bands', () => {
    expect(warpY(bands, 1000)).toBe(1060);
    expect(warpY(bands, 0, 'bottom')).toBe(0);
  });

  it('gives a y off the page the offset of the nearest end band, whichever side', () => {
    expect(warpY(bands, 1000.5, 'bottom')).toBe(1060.5);
    expect(warpY(bands, 1000.5)).toBe(1060.5);
    expect(warpY(bands, -0.5)).toBe(-0.5);
    expect(warpY(bands, -0.5, 'bottom')).toBe(-0.5);
  });
});

describe('warpSpan', () => {
  const { bands } = separationBands(
    [box(0.125, 0.125), box(0.25, 0.125)],
    PAGE,
    GAP
  );

  it('gives the display y and height of a span within one band', () => {
    expect(warpSpan(bands, 300, 350)).toEqual({ y: 345, h: 50 });
  });

  it('keeps the height of a span running past the page bottom', () => {
    expect(warpSpan(bands, 950, 1000.5)).toEqual({ y: 1010, h: 50.5 });
  });

  it('gives a zero-height span on a cut a height of zero', () => {
    expect(warpSpan(bands, 250, 250).h).toBe(0);
  });

  it('returns spans unchanged with no bands', () => {
    expect(warpSpan(null, 100, 150)).toEqual({ y: 100, h: 50 });
  });
});

describe('unwarpY', () => {
  const { bands } = separationBands(
    [box(0.125, 0.125), box(0.25, 0.125)],
    PAGE,
    GAP
  );

  it('returns y unchanged with no bands', () => {
    expect(unwarpY(null, 400)).toBe(400);
  });

  it('undoes warpY for every page y', () => {
    [0, 50, 124, 125, 200, 249, 250, 300, 374, 375, 600, 999].forEach((y) =>
      expect(unwarpY(bands, warpY(bands, y))).toBe(y)
    );
  });

  it('maps a display y inside a gap onto the cut the gap sits on', () => {
    // Band [125, 250) is drawn from 140; the gap above it is 125..140 on screen.
    expect(unwarpY(bands, 130)).toBe(125);
    // Between the touching tables the gap is 265..295 on screen.
    expect(unwarpY(bands, 265)).toBe(250);
    expect(unwarpY(bands, 294)).toBe(250);
  });

  it('carries a display y past the page end through the last band’s offset', () => {
    expect(unwarpY(bands, 1100)).toBe(1040);
  });
});
