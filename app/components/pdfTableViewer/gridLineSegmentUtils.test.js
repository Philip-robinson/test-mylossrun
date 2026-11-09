import {
  expandOffsets,
  compressOffsets,
  withSegments,
  isStaggered,
  axisHasSegments,
  canonicaliseAxis,
  canonicaliseTable,
  nominalDividerPosition,
  dividerPositionAt,
  linePieces,
  dividerPolyline,
  remapAxisSegments,
  splitRun,
  splitMoveLimits,
  applySplitMove,
  wholeLineMoveLimits,
  joinLineBetweenNeighbours,
  lineFitsInBand,
} from 'components/pdfTableViewer/gridLineSegmentUtils';

const NEW = Symbol('new-line');

const entry = (value, segments) =>
  segments === undefined ? { value } : { value, segments };

const table = (columnWidths, rowHeights) => ({
  bounds: { left: 0.1, top: 0.2, width: 0.6, height: 0.4 },
  columnWidths,
  rowHeights,
});

const fourRows = () => [entry(0.1), entry(0.1), entry(0.1), entry(0.1)];

const expectOffsetsClose = (actual, expected) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 9));
};

const expectSegmentsClose = (actual, expected) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((s, i) => {
    expect(actual[i].start).toBe(s.start);
    expect(actual[i].offset).toBeCloseTo(s.offset, 9);
  });
};

describe('expandOffsets / compressOffsets', () => {
  const staggered = entry(0.2, [
    { offset: 0.01, start: 1 },
    { offset: -0.02, start: 3 },
  ]);

  it('expands segments to one offset per cell', () => {
    expect(expandOffsets(staggered, 4)).toEqual([0, 0.01, 0.01, -0.02]);
  });

  it('round trips through compressOffsets', () => {
    expect(compressOffsets(expandOffsets(staggered, 4))).toEqual(staggered.segments);
  });

  it('treats null, [] and absent segments as all zero', () => {
    expect(expandOffsets(entry(0.2, null), 3)).toEqual([0, 0, 0]);
    expect(expandOffsets(entry(0.2, []), 3)).toEqual([0, 0, 0]);
    expect(expandOffsets(entry(0.2), 3)).toEqual([0, 0, 0]);
  });

  it('ignores starts at or beyond the cell count', () => {
    const e = entry(0.2, [
      { offset: 0.01, start: 2 },
      { offset: 0.03, start: 5 },
    ]);
    expect(expandOffsets(e, 4)).toEqual([0, 0, 0.01, 0.01]);
  });

  it('compresses all-zero offsets to an empty list', () => {
    expect(compressOffsets([0, 0, 0])).toEqual([]);
  });

  it('starts at 0 only when the first offset is non-zero', () => {
    expect(compressOffsets([0.01, 0.01, 0])).toEqual([
      { offset: 0.01, start: 0 },
      { offset: 0, start: 2 },
    ]);
  });
});

describe('withSegments / isStaggered / axisHasSegments', () => {
  it('removes the segments key when given empty, null or undefined', () => {
    const e = entry(0.2, [{ offset: 0.01, start: 1 }]);
    for (const empty of [[], null, undefined]) {
      const out = withSegments(e, empty);
      expect(out).toEqual({ value: 0.2 });
      expect('segments' in out).toBe(false);
    }
    expect(e.segments).toHaveLength(1);
  });

  it('sets the segments when non-empty', () => {
    const segs = [{ offset: 0.01, start: 1 }];
    expect(withSegments(entry(0.2), segs)).toEqual({ value: 0.2, segments: segs });
  });

  it('reports staggered entries and axes', () => {
    expect(isStaggered(entry(0.2, [{ offset: 0.01, start: 1 }]))).toBe(true);
    expect(isStaggered(entry(0.2, []))).toBe(false);
    expect(isStaggered(entry(0.2))).toBe(false);
    expect(axisHasSegments([entry(0.2), entry(0.2, [{ offset: 0.01, start: 1 }])])).toBe(true);
    expect(axisHasSegments([entry(0.2), entry(0.2, null)])).toBe(false);
  });
});

describe('canonicaliseAxis', () => {
  it('rebases a non-zero cell 0 into the values, compensating later offsets', () => {
    const axis = [
      entry(0.2, [
        { offset: 0.01, start: 0 },
        { offset: 0.03, start: 2 },
      ]),
      entry(0.2),
      entry(0.2),
    ];
    const before = table(axis, fourRows());
    const out = canonicaliseAxis(axis, 4);
    expect(out[0].value).toBeCloseTo(0.21, 9);
    expect(out[1].value).toBeCloseTo(0.19, 9);
    expectSegmentsClose(out[0].segments, [{ offset: 0.02, start: 2 }]);
    const after = table(out, fourRows());
    for (const k of [1, 2]) {
      for (let n = 0; n < 4; n += 1) {
        expect(dividerPositionAt(after, 'columnWidths', k, n)).toBeCloseTo(
          dividerPositionAt(before, 'columnWidths', k, n),
          9
        );
      }
    }
  });

  it('zeros near-zero offsets', () => {
    const out = canonicaliseAxis([entry(0.2, [{ offset: 1e-9, start: 1 }]), entry(0.2)], 4);
    expect('segments' in out[0]).toBe(false);
  });

  it('coalesces adjacent runs equal within the epsilon', () => {
    const out = canonicaliseAxis(
      [
        entry(0.2, [
          { offset: 0.01, start: 1 },
          { offset: 0.01 + 1e-8, start: 2 },
        ]),
        entry(0.2),
      ],
      4
    );
    expectSegmentsClose(out[0].segments, [{ offset: 0.01, start: 1 }]);
  });

  it('drops segments starting at or beyond the cell count', () => {
    const out = canonicaliseAxis(
      [
        entry(0.2, [
          { offset: 0.01, start: 1 },
          { offset: 0.02, start: 4 },
        ]),
        entry(0.2),
      ],
      4
    );
    expect(out[0].segments).toEqual([{ offset: 0.01, start: 1 }]);
  });

  it('strips segments from the last entry', () => {
    const out = canonicaliseAxis([entry(0.2), entry(0.2, [{ offset: 0.01, start: 1 }])], 4);
    expect('segments' in out[1]).toBe(false);
  });

  it('returns an unstaggered axis with no segments keys', () => {
    const out = canonicaliseAxis([entry(0.2, []), entry(0.2, null), entry(0.2)], 4);
    expect(out).toEqual([{ value: 0.2 }, { value: 0.2 }, { value: 0.2 }]);
  });
});

describe('canonicaliseTable', () => {
  it('canonicalises each axis against the other axis length', () => {
    const t = table(
      [entry(0.3, [{ offset: 0.01, start: 3 }]), entry(0.3)],
      [entry(0.2, [{ offset: 0.01, start: 1 }]), entry(0.2, [{ offset: 0.01, start: 2 }])]
    );
    const out = canonicaliseTable(t);
    expect('segments' in out.columnWidths[0]).toBe(false);
    expect(out.rowHeights[0].segments).toEqual([{ offset: 0.01, start: 1 }]);
    expect('segments' in out.rowHeights[1]).toBe(false);
    expect(out.bounds).toEqual(t.bounds);
  });
});

describe('nominalDividerPosition / dividerPositionAt', () => {
  const t = table(
    [
      entry(0.2, [
        { offset: 0.01, start: 1 },
        { offset: -0.02, start: 3 },
      ]),
      entry(0.2),
      entry(0.2),
    ],
    fourRows()
  );

  it('gives the origin plus the preceding values', () => {
    expect(nominalDividerPosition(t, 'columnWidths', 2)).toBeCloseTo(0.5, 9);
    expect(nominalDividerPosition(t, 'rowHeights', 2)).toBeCloseTo(0.4, 9);
  });

  it('never offsets the borders', () => {
    expect(dividerPositionAt(t, 'columnWidths', 0, 3)).toBeCloseTo(0.1, 9);
    expect(dividerPositionAt(t, 'columnWidths', 3, 3)).toBeCloseTo(0.7, 9);
  });

  it('gives the nominal position at an unstaggered cell and the offset one at a staggered cell', () => {
    expect(dividerPositionAt(t, 'columnWidths', 1, 0)).toBeCloseTo(0.3, 9);
    expect(dividerPositionAt(t, 'columnWidths', 1, 1)).toBeCloseTo(0.31, 9);
    expect(dividerPositionAt(t, 'columnWidths', 1, 3)).toBeCloseTo(0.28, 9);
    expect(dividerPositionAt(t, 'columnWidths', 2, 2)).toBeCloseTo(0.5, 9);
  });
});

describe('linePieces', () => {
  it('gives one piece per cell for a straight line', () => {
    const t = table([entry(0.2), entry(0.2), entry(0.2)], fourRows());
    const pieces = linePieces(t, 'rowHeights', 2);
    expect(pieces.map((p) => p.cell)).toEqual([0, 1, 2]);
    pieces.forEach((p) => expect(p.position).toBeCloseTo(0.4, 9));
    expectOffsetsClose(
      pieces.map((p) => p.start),
      [0.1, 0.3, 0.5]
    );
    expectOffsetsClose(
      pieces.map((p) => p.end),
      [0.3, 0.5, 0.7]
    );
  });

  it('takes a positive piece’s ends from the far band and a negative piece’s from the near band', () => {
    const t = table(
      [
        entry(0.2, [
          { offset: -0.02, start: 1 },
          { offset: 0.01, start: 2 },
        ]),
        entry(0.2),
        entry(0.2),
      ],
      [
        entry(0.1, [{ offset: 0.03, start: 1 }]),
        entry(0.1, [{ offset: 0.02, start: 1 }]),
        entry(0.1),
        entry(0.1),
      ]
    );
    const pieces = linePieces(t, 'columnWidths', 1);
    expect(pieces.map((p) => p.cell)).toEqual([0, 1, 2, 3]);
    expectOffsetsClose(
      pieces.map((p) => p.position),
      [0.3, 0.28, 0.31, 0.31]
    );
    expectOffsetsClose(
      pieces.map((p) => p.start),
      [0.2, 0.3, 0.42, 0.5]
    );
    expectOffsetsClose(
      pieces.map((p) => p.end),
      [0.33, 0.4, 0.5, 0.6]
    );
  });
});

describe('dividerPolyline', () => {
  const expectPointsClose = (actual, expected) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach(([a, p], i) => {
      expect(actual[i][0]).toBeCloseTo(a, 9);
      expect(actual[i][1]).toBeCloseTo(p, 9);
    });
  };

  it('gives two points for a straight internal divider on each axis', () => {
    const t = table([entry(0.2), entry(0.2), entry(0.2)], fourRows());
    expectPointsClose(dividerPolyline(t, 'columnWidths', 1), [
      [0.2, 0.3],
      [0.6, 0.3],
    ]);
    expectPointsClose(dividerPolyline(t, 'rowHeights', 2), [
      [0.1, 0.4],
      [0.7, 0.4],
    ]);
  });

  it('gives two points for each border on both axes', () => {
    const t = table([entry(0.2), entry(0.2), entry(0.2)], fourRows());
    expectPointsClose(dividerPolyline(t, 'columnWidths', 0), [
      [0.2, 0.1],
      [0.6, 0.1],
    ]);
    expectPointsClose(dividerPolyline(t, 'columnWidths', 3), [
      [0.2, 0.7],
      [0.6, 0.7],
    ]);
    expectPointsClose(dividerPolyline(t, 'rowHeights', 0), [
      [0.1, 0.2],
      [0.7, 0.2],
    ]);
    expectPointsClose(dividerPolyline(t, 'rowHeights', 4), [
      [0.1, 0.6],
      [0.7, 0.6],
    ]);
  });

  it('gives each piece’s end points in cell order for a staggered divider', () => {
    const t = table(
      [
        entry(0.2, [
          { offset: -0.02, start: 1 },
          { offset: 0.01, start: 2 },
        ]),
        entry(0.2),
        entry(0.2),
      ],
      [
        entry(0.1, [{ offset: 0.03, start: 1 }]),
        entry(0.1, [{ offset: 0.02, start: 1 }]),
        entry(0.1),
        entry(0.1),
      ]
    );
    expectPointsClose(dividerPolyline(t, 'columnWidths', 1), [
      [0.2, 0.3],
      [0.33, 0.3],
      [0.3, 0.28],
      [0.4, 0.28],
      [0.42, 0.31],
      [0.5, 0.31],
      [0.5, 0.31],
      [0.6, 0.31],
    ]);
  });
});

describe('remapAxisSegments', () => {
  const axis = [
    entry(0.2, [
      { offset: 0.01, start: 1 },
      { offset: -0.02, start: 3 },
    ]),
    entry(0.2),
  ];

  it('remaps through a splitMap-shaped map, the NEW line copying its predecessor', () => {
    const out = remapAxisSegments(axis, 4, [0, 1, NEW, 2, 3]);
    expect(out[0].segments).toEqual([
      { offset: 0.01, start: 1 },
      { offset: -0.02, start: 4 },
    ]);
    expect(out[1]).toEqual(axis[1]);
  });

  it('remaps through a splitMapBelow-shaped map', () => {
    const out = remapAxisSegments(axis, 4, [0, NEW, 1, 2, 3]);
    expect(out[0].segments).toEqual([
      { offset: 0.01, start: 2 },
      { offset: -0.02, start: 4 },
    ]);
  });

  it('remaps through a mergeMap-shaped map, dropping the removed index', () => {
    const out = remapAxisSegments(axis, 4, [0, 1, 3]);
    expect(out[0].segments).toEqual([
      { offset: 0.01, start: 1 },
      { offset: -0.02, start: 2 },
    ]);
  });

  it('gives a leading NEW index offset 0', () => {
    const out = remapAxisSegments(axis, 4, [NEW, 0, 1, 2, 3]);
    expect(out[0].segments).toEqual([
      { offset: 0.01, start: 2 },
      { offset: -0.02, start: 4 },
    ]);
  });
});

describe('splitRun', () => {
  const axis = [
    entry(0.2, [
      { offset: 0.01, start: 1 },
      { offset: -0.02, start: 3 },
    ]),
    entry(0.2),
    entry(0.2),
  ];

  it('runs from the pressed cell to the next segment start or the end', () => {
    expect(splitRun(axis, 1, 0, 4)).toEqual({ start: 0, end: 1 });
    expect(splitRun(axis, 1, 1, 4)).toEqual({ start: 1, end: 3 });
    expect(splitRun(axis, 1, 2, 4)).toEqual({ start: 2, end: 3 });
    expect(splitRun(axis, 1, 3, 4)).toEqual({ start: 3, end: 4 });
    expect(splitRun(axis, 2, 1, 4)).toEqual({ start: 1, end: 4 });
  });
});

describe('split and whole-line moves', () => {
  // Divider 1 sits at 0.3 on rows 0-1 and 0.35 on rows 2-3; divider 2 at 0.4.
  const t = table(
    [entry(0.2, [{ offset: 0.05, start: 2 }]), entry(0.1), entry(0.3)],
    fourRows()
  );

  it('splitMoveLimits allows 90% of the narrowest neighbouring band over the run', () => {
    const top = splitMoveLimits(t, 'columnWidths', 1, 0);
    expect(top.min).toBeCloseTo(-0.18, 9);
    expect(top.max).toBeCloseTo(0.09, 9);
    const bottom = splitMoveLimits(t, 'columnWidths', 1, 2);
    expect(bottom.min).toBeCloseTo(-0.225, 9);
    expect(bottom.max).toBeCloseTo(0.045, 9);
  });

  it('wholeLineMoveLimits takes the minimum over the whole line', () => {
    const one = wholeLineMoveLimits(t, 'columnWidths', 1);
    expect(one.min).toBeCloseTo(-0.18, 9);
    expect(one.max).toBeCloseTo(0.045, 9);
    const two = wholeLineMoveLimits(t, 'columnWidths', 2);
    expect(two.min).toBeCloseTo(-0.045, 9);
    expect(two.max).toBeCloseTo(0.27, 9);
  });

  it('applySplitMove clamps at 90% on the positive side', () => {
    const out = applySplitMove(t, 'columnWidths', 1, 2, 1);
    expect(out[0].value).toBeCloseTo(0.2, 9);
    expectSegmentsClose(out[0].segments, [{ offset: 0.095, start: 2 }]);
  });

  it('applySplitMove clamps at 90% on the negative side', () => {
    const out = applySplitMove(t, 'columnWidths', 1, 2, -1);
    expectSegmentsClose(out[0].segments, [{ offset: -0.175, start: 2 }]);
  });

  it('applySplitMove splits a run at the pressed cell', () => {
    const out = applySplitMove(t, 'columnWidths', 1, 3, 0.01);
    expectSegmentsClose(out[0].segments, [
      { offset: 0.05, start: 2 },
      { offset: 0.06, start: 3 },
    ]);
  });

  it('applySplitMove at cell 0 becomes a nominal move with later offsets compensated', () => {
    const out = applySplitMove(t, 'columnWidths', 1, 0, 0.02);
    expect(out[0].value).toBeCloseTo(0.22, 9);
    expect(out[1].value).toBeCloseTo(0.08, 9);
    expectSegmentsClose(out[0].segments, [{ offset: 0.03, start: 2 }]);
    const moved = { ...t, columnWidths: out };
    expectOffsetsClose(
      [0, 1, 2, 3].map((n) => dividerPositionAt(moved, 'columnWidths', 1, n)),
      [0.32, 0.32, 0.35, 0.35]
    );
  });
});

describe('joinLineBetweenNeighbours', () => {
  // Dividers nominally at 0.3 and 0.5; on row 1 divider 1 is at 0.55 and divider 2 at 0.65.
  const crossed = () =>
    table(
      [
        entry(0.2, [{ offset: 0.25, start: 1 }]),
        entry(0.2, [{ offset: 0.15, start: 1 }]),
        entry(0.2),
      ],
      [entry(0.2), entry(0.2)]
    );

  it('moves every piece to the nominal position when that lies between its neighbours', () => {
    const out = joinLineBetweenNeighbours(crossed(), 'columnWidths', 1);
    expect(out[0]).toEqual({ value: 0.2 });
    expect(out[1]).toEqual(crossed().columnWidths[1]);
  });

  it('stops a piece blocked by a neighbour at 90% of the gap to it', () => {
    const out = joinLineBetweenNeighbours(crossed(), 'columnWidths', 2);
    expect(out[1].value).toBeCloseTo(0.2, 9);
    expectSegmentsClose(out[1].segments, [{ offset: 0.06, start: 1 }]);
    const joined = { ...crossed(), columnWidths: out };
    expect(dividerPositionAt(joined, 'columnWidths', 2, 0)).toBeCloseTo(0.5, 9);
    expect(dividerPositionAt(joined, 'columnWidths', 2, 1)).toBeCloseTo(0.56, 9);
    expect(dividerPositionAt(joined, 'columnWidths', 1, 1)).toBeCloseTo(0.55, 9);
  });

  it('does not mutate its argument', () => {
    const t = crossed();
    joinLineBetweenNeighbours(t, 'columnWidths', 2);
    expect(t).toEqual(crossed());
  });
});

describe('lineFitsInBand', () => {
  const t = table(
    [entry(0.2, [{ offset: 0.05, start: 2 }]), entry(0.1), entry(0.3)],
    fourRows()
  );

  it('is true when the position is strictly inside the band at every cell', () => {
    expect(lineFitsInBand(t, 'columnWidths', 1, 0.37)).toBe(true);
  });

  it('is false when a staggered cell leaves the position outside the band', () => {
    expect(lineFitsInBand(t, 'columnWidths', 1, 0.32)).toBe(false);
    expect(lineFitsInBand(t, 'columnWidths', 0, 0.32)).toBe(false);
  });
});
