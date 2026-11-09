import { render, screen } from '@testing-library/react';
import CellImageWithOverlay from 'components/pdfTableViewer/CellImageWithOverlay';

// Two columns and two rows; vertical divider 1 is staggered at row 1.
const table = {
  bounds: { left: 0.2, top: 0.2, width: 0.4, height: 0.4 },
  columnWidths: [{ value: 0.2, segments: [{ offset: 0.05, start: 1 }] }, { value: 0.2 }],
  rowHeights: [{ value: 0.2 }, { value: 0.2 }],
};

const bounds = { left: 0.1, top: 0.15, width: 0.6, height: 0.5 };

const squares = [
  { left: 0.2, top: 0.2, width: 0.2, height: 0.2 },
  { left: 0.2, top: 0.4, width: 0.25, height: 0.2 },
];

const renderOverlay = (props = {}) =>
  render(
    <CellImageWithOverlay image={'abc'} bounds={bounds} table={table} squares={squares} {...props} />
  );

const subpaths = (d) =>
  d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean);

const rectPath = ({ left, top, width, height }) =>
  `M${left} ${top}H${left + width}V${top + height}H${left}Z`;

describe('CellImageWithOverlay', () => {
  it('keeps the cell-edit-image test id on the image', () => {
    renderOverlay();
    expect(screen.getByTestId('cell-edit-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,abc'
    );
  });

  it('sets the overlay viewBox to the given bounds', () => {
    renderOverlay();
    const svg = screen.getByTestId('cell-edit-image-overlay');
    expect(svg.getAttribute('viewBox')).toBe('0.1 0.15 0.6 0.5');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('draws one line or polyline per divider of both axes, borders included', () => {
    renderOverlay();
    const columns = screen.getAllByTestId('cell-edit-image-column-line');
    const rows = screen.getAllByTestId('cell-edit-image-row-line');
    expect(columns).toHaveLength(3);
    expect(rows).toHaveLength(3);
    expect(columns.map((el) => el.tagName.toLowerCase())).toEqual([
      'line',
      'polyline',
      'line',
    ]);
    expect(rows.every((el) => el.tagName.toLowerCase() === 'line')).toBe(true);
  });

  it('draws a vertical divider at x = position along y', () => {
    renderOverlay();
    const [left] = screen.getAllByTestId('cell-edit-image-column-line');
    expect(Number(left.getAttribute('x1'))).toBeCloseTo(0.2);
    expect(Number(left.getAttribute('x2'))).toBeCloseTo(0.2);
    expect(Number(left.getAttribute('y1'))).toBeCloseTo(0.2);
    expect(Number(left.getAttribute('y2'))).toBeCloseTo(0.6);
  });

  it('draws the staggered divider through each piece', () => {
    renderOverlay();
    const staggered = screen.getAllByTestId('cell-edit-image-column-line')[1];
    const points = staggered
      .getAttribute('points')
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number));
    const expected = [
      [0.4, 0.2],
      [0.4, 0.4],
      [0.45, 0.4],
      [0.45, 0.6],
    ];
    expect(points).toHaveLength(expected.length);
    points.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i][0]);
      expect(y).toBeCloseTo(expected[i][1]);
    });
    expect(staggered.getAttribute('fill')).toBe('none');
  });

  it('builds the dim path from the viewBox rectangle and one rectangle per square', () => {
    renderOverlay();
    const dim = screen.getByTestId('cell-edit-image-dim');
    expect(dim.getAttribute('fill-rule')).toBe('evenodd');
    expect(subpaths(dim.getAttribute('d'))).toEqual([
      rectPath(bounds),
      ...squares.map(rectPath),
    ]);
  });
});
