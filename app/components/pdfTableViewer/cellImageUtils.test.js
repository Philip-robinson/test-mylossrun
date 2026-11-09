import {
  cellImageDefaultPageAspect,
  cellImageMarginMaxPx,
  cellImageMarginMinPx,
} from 'config';
import {
  dividerPointToXY,
  enlargedCellImageBounds,
  rectanglePath,
} from 'components/pdfTableViewer/cellImageUtils';

const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 9);

describe('enlargedCellImageBounds', () => {
  it('grows each side by the minimum when 10% of the cell is below it', () => {
    // sx = 200 / 0.2 = 1000; 10% of 200 = 20px, 10% of 0.05 * 1000 = 5px: both below 30.
    const { bounds } = enlargedCellImageBounds(
      { left: 0.4, top: 0.4, width: 0.2, height: 0.05 },
      200,
      1
    );
    const grow = cellImageMarginMinPx() / 1000;
    close(bounds.left, 0.4 - grow);
    close(bounds.width, 0.2 + 2 * grow);
    close(bounds.top, 0.4 - grow);
    close(bounds.height, 0.05 + 2 * grow);
  });

  it('grows each side by 10% of the cell when that lies between the minimum and maximum', () => {
    // sx = 500 / 0.25 = 2000; 50px across; 10% of 0.3 * 2000 = 60px down.
    const { bounds } = enlargedCellImageBounds(
      { left: 0.3, top: 0.3, width: 0.25, height: 0.3 },
      500,
      1
    );
    close(bounds.left, 0.3 - 0.025);
    close(bounds.width, 0.25 + 0.05);
    close(bounds.top, 0.3 - 0.03);
    close(bounds.height, 0.3 + 0.06);
  });

  it('grows each side by the maximum when 10% of the cell is above it', () => {
    // sx = 1500 / 0.5 = 3000; 150px across; 10% of 0.4 * 3000 = 120px down: both above 100.
    const { bounds } = enlargedCellImageBounds(
      { left: 0.25, top: 0.3, width: 0.5, height: 0.4 },
      1500,
      1
    );
    const grow = cellImageMarginMaxPx() / 3000;
    close(bounds.left, 0.25 - grow);
    close(bounds.width, 0.5 + 2 * grow);
    close(bounds.top, 0.3 - grow);
    close(bounds.height, 0.4 + 2 * grow);
  });

  it('scales the vertical margin by the page aspect', () => {
    // sx = 1000, sy = 2000; 10% of 0.2 * 2000 = 40px down -> 0.02 page height.
    const { bounds } = enlargedCellImageBounds(
      { left: 0.4, top: 0.4, width: 0.2, height: 0.2 },
      200,
      2
    );
    close(bounds.top, 0.4 - 0.02);
    close(bounds.height, 0.2 + 0.04);
    // The horizontal margin is untouched by the aspect: 20px -> 30px minimum.
    close(bounds.left, 0.4 - 0.03);
  });

  it.each([undefined, null, 0, -1, Number.NaN, Infinity])(
    'falls back to the default aspect when the aspect is %p',
    (aspect) => {
      const cell = { left: 0.4, top: 0.4, width: 0.2, height: 0.2 };
      expect(enlargedCellImageBounds(cell, 200, aspect)).toEqual(
        enlargedCellImageBounds(cell, 200, cellImageDefaultPageAspect())
      );
    }
  );

  it('clamps at the left and top page edges', () => {
    const { bounds } = enlargedCellImageBounds(
      { left: 0.01, top: 0.01, width: 0.2, height: 0.2 },
      200,
      1
    );
    expect(bounds.left).toBe(0);
    expect(bounds.top).toBe(0);
    close(bounds.width, 0.01 + 0.2 + 0.03);
    close(bounds.height, 0.01 + 0.2 + 0.03);
  });

  it('clamps at the right and bottom page edges', () => {
    const { bounds } = enlargedCellImageBounds(
      { left: 0.79, top: 0.79, width: 0.2, height: 0.2 },
      200,
      1
    );
    close(bounds.left, 0.76);
    close(bounds.top, 0.76);
    close(bounds.left + bounds.width, 1);
    close(bounds.top + bounds.height, 1);
  });

  it('returns a width that keeps the cell scale', () => {
    const cell = { left: 0.3, top: 0.3, width: 0.17, height: 0.13 };
    const displayWidth = 333;
    const { bounds, width } = enlargedCellImageBounds(cell, displayWidth, 1.3);
    expect(Number.isInteger(width)).toBe(true);
    expect(Math.abs(width - bounds.width * (displayWidth / cell.width))).toBeLessThanOrEqual(0.5);
  });
});

describe('enlargedCellImageBounds with nothing to scale by', () => {
  test('a zero-width cell is requested unenlarged at the display width', () => {
    const bounds = { left: 0.2, top: 0.3, width: 0, height: 0.1 };
    expect(enlargedCellImageBounds(bounds, 200, 1)).toEqual({ bounds, width: 200 });
  });

  test('a zero display width is requested unenlarged at that width', () => {
    const bounds = { left: 0.2, top: 0.3, width: 0.1, height: 0.1 };
    expect(enlargedCellImageBounds(bounds, 0, 1)).toEqual({ bounds, width: 0 });
  });
});

describe('rectanglePath', () => {
  test('traces the rectangle clockwise from its top-left corner', () => {
    expect(rectanglePath({ left: 1, top: 2, width: 3, height: 4 })).toBe('M1 2H4V6H1Z');
  });
});

describe('dividerPointToXY', () => {
  test('a column divider point runs down the page', () => {
    expect(dividerPointToXY('columnWidths', [0.2, 0.7])).toEqual([0.7, 0.2]);
  });

  test('a row divider point runs across the page', () => {
    expect(dividerPointToXY('rowHeights', [0.2, 0.7])).toEqual([0.2, 0.7]);
  });
});
