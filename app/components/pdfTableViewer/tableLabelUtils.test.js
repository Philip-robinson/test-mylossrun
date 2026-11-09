import {
  tableLabelTops,
  tableLabelsOverlap,
} from 'components/pdfTableViewer/tableLabelUtils';

describe('tableLabelsOverlap', () => {
  test('labels that fit side by side do not overlap', () => {
    expect(tableLabelsOverlap(100, 300, 120, 80)).toBe(false);
  });

  test('labels wider together than the table overlap', () => {
    expect(tableLabelsOverlap(100, 300, 120, 81)).toBe(true);
  });
});

describe('tableLabelTops', () => {
  test('side by side both labels sit at the given top', () => {
    expect(tableLabelTops(50, 16, false)).toEqual({ nameTop: 50, linkTop: 50 });
  });

  test('stacked, the Link label sits one label height above the name label', () => {
    expect(tableLabelTops(50, 16, true)).toEqual({ nameTop: 50, linkTop: 34 });
  });

  test('stacked at the page top, the name label is pushed down below the Link label', () => {
    expect(tableLabelTops(5, 16, true)).toEqual({ nameTop: 16, linkTop: 0 });
  });
});
