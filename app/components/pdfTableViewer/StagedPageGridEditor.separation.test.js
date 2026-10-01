import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StagedPageGridEditor } from 'components/pdfTableViewer/StagedPageGridEditor';
import { tableSeparationGapPx } from 'config';

jest.mock('react-hot-toast', () => {
  const toastMock = jest.fn();
  toastMock.error = jest.fn();
  toastMock.dismiss = jest.fn();
  return { __esModule: true, default: toastMock };
});

// A 1000x1000 image shown pixel-for-pixel at the origin, so a screen px is a page px.
const PIXELS = 1000;
const GAP = tableSeparationGapPx();

function gridCells(rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({
        row: r,
        column: c,
        rowSpan: 1,
        columnSpan: 1,
        bounds: { left: 0, top: 0, width: 0, height: 0 },
        text: '',
        confidence: 90,
        header: false,
      });
    }
  }
  return cells;
}

// Alpha spans page px 0..100 with a row divider at 50; Beta spans 300..400. The cuts are
// 0, 100, 300 and 400, so Alpha is shifted one gap and Beta three.
function alpha(overrides = {}) {
  return {
    tableId: 't1',
    name: 'Alpha',
    next: null,
    pdfPage: 0,
    tableInPage: 0,
    confidence: 100,
    headerCount: 0,
    bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
    columnWidths: [
      { value: 0.05, confidence: 90 },
      { value: 0.05, confidence: 90 },
    ],
    rowHeights: [
      { value: 0.05, confidence: 90 },
      { value: 0.05, confidence: 90 },
    ],
    cells: gridCells(2, 2),
    title: null,
    extractionMechanism: 'HEURISTIC',
    confirmationStage: null,
    ...overrides,
  };
}

function beta(overrides = {}) {
  return {
    tableId: 't2',
    name: 'Beta',
    next: null,
    pdfPage: 0,
    tableInPage: 1,
    confidence: 100,
    headerCount: 0,
    bounds: { left: 0.3, top: 0.3, width: 0.1, height: 0.1 },
    columnWidths: [{ value: 0.1, confidence: 90 }],
    rowHeights: [
      { value: 0.05, confidence: 90 },
      { value: 0.05, confidence: 90 },
    ],
    cells: gridCells(2, 1),
    title: null,
    extractionMechanism: 'HEURISTIC',
    confirmationStage: null,
    ...overrides,
  };
}

const ALPHA_SHIFT = GAP;
const BETA_SHIFT = 3 * GAP;

function baseProps(overrides = {}) {
  return {
    image: 'AAAA',
    pixelWidth: PIXELS,
    pixelHeight: PIXELS,
    page: 0,
    metadataTables: [alpha(), beta()],
    selectedTableId: 't1',
    onSelectTable: jest.fn(),
    editorMode: 'grid',
    tool: null,
    specialTool: null,
    layerVisibility: { rows: true, columns: true, special: true, colours: true },
    dim: false,
    onEditTables: jest.fn(),
    onCreatedTable: jest.fn(),
    pdfId: 'pdf-1',
    ...overrides,
  };
}

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: PIXELS,
      height: PIXELS,
      top: 0,
      left: 0,
      right: PIXELS,
      bottom: PIXELS,
      x: 0,
      y: 0,
    }),
  });
});

async function renderLoaded(props) {
  const utils = render(<StagedPageGridEditor {...props} />);
  const img = utils.container.querySelector('img');
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: PIXELS });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: PIXELS });
  fireEvent.load(img);
  await waitFor(() =>
    expect(utils.container.querySelector('svg')).not.toBeNull()
  );
  return utils;
}

const borderY = (container, tableId) =>
  Number(
    container
      .querySelector(`[data-testid="table-boundary"][data-tableid="${tableId}"]`)
      .getAttribute('y')
  );

const lastList = (onEditTables) =>
  onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];

describe('StagedPageGridEditor table separation', () => {
  describe('in the Validate tables pass', () => {
    it('draws each table’s border shifted down by the gaps above it', async () => {
      const { container } = await renderLoaded(baseProps());
      expect(borderY(container, 't1')).toBe(0 + ALPHA_SHIFT);
      expect(borderY(container, 't2')).toBe(300 + BETA_SHIFT);
    });

    it('draws the page image as one strip per band, each at its shifted top', async () => {
      await renderLoaded(baseProps());
      const strips = screen.getAllByTestId('separation-band-image');
      expect(strips.map((s) => s.style.top)).toEqual([
        `${0 + GAP}px`,
        `${100 + 2 * GAP}px`,
        `${300 + 3 * GAP}px`,
        `${400 + 4 * GAP}px`,
      ]);
      expect(strips.map((s) => s.style.height)).toEqual([
        '100px',
        '200px',
        '100px',
        '600px',
      ]);
    });

    it('lengthens the overlay by every gap on the page', async () => {
      const { container } = await renderLoaded(baseProps());
      expect(container.querySelector('svg').getAttribute('viewBox')).toBe(
        `0 0 ${PIXELS} ${PIXELS + 4 * GAP}`
      );
    });

    it('moves the selected table’s grid lines with it, leaving them in page coordinates', async () => {
      await renderLoaded(baseProps({ selectedTableId: 't2' }));
      const line = screen.getByTestId('row-line');
      expect(line.getAttribute('y1')).toBe('350');
      expect(line.closest('g[transform]').getAttribute('transform')).toBe(
        `translate(0 ${BETA_SHIFT})`
      );
    });

    it('moves the header rectangle with its table rather than with the band above', async () => {
      await renderLoaded(
        baseProps({
          selectedTableId: 't2',
          metadataTables: [alpha(), beta({ headerCount: 1 })],
        })
      );
      const header = screen.getByTestId('header-rect');
      expect(header.closest('g[transform]').getAttribute('transform')).toBe(
        `translate(0 ${BETA_SHIFT})`
      );
    });

    it('draws a coloured area where its part of the page image is drawn', async () => {
      await renderLoaded(
        baseProps({
          selectedTableId: 't2',
          colouredAreas: [
            {
              left: 0.3,
              top: 0.32,
              width: 0.05,
              height: 0.05,
              foreground: '#000000',
              background: '#ffffff',
            },
          ],
        })
      );
      const area = screen.getByTestId('coloured-area-0');
      expect(Number(area.getAttribute('y'))).toBe(320 + BETA_SHIFT);
      expect(Number(area.getAttribute('height'))).toBeCloseTo(50, 6);
    });

    it('lifts each table’s name label above its shifted top', async () => {
      await renderLoaded(baseProps());
      const label = screen
        .getAllByTestId('selected-label')
        .find((l) => l.getAttribute('data-tableid') === 't2');
      expect(label.style.top).toBe(`${300 + BETA_SHIFT - 16}px`);
    });

    it('places the help frame over the selected table’s shifted box', async () => {
      await renderLoaded(baseProps({ selectedTableId: 't2' }));
      const frame = screen.getByTestId('table-help-frame');
      expect(frame.style.top).toBe(`${300 + BETA_SHIFT}px`);
      expect(frame.style.height).toBe('100px');
    });

    it('reports a dragged grid line in page coordinates', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(baseProps({ selectedTableId: 't2', onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      // The divider at page 350 is on screen at 350 + BETA_SHIFT; drag it 20px down.
      fireEvent.mouseDown(hit, { clientX: 350, clientY: 350 + BETA_SHIFT });
      fireEvent.mouseMove(window, { clientX: 350, clientY: 370 + BETA_SHIFT });
      fireEvent.mouseUp(window, { clientX: 350, clientY: 370 + BETA_SHIFT });
      const edited = lastList(onEditTables).find((t) => t.tableId === 't2');
      expect(edited.rowHeights[0].value).toBeCloseTo(0.07, 5);
      expect(edited.rowHeights[1].value).toBeCloseTo(0.03, 5);
      expect(edited.bounds).toEqual(beta().bounds);
    });

    it('leaves the tables it hands back with their bounds untouched', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(baseProps({ onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 + ALPHA_SHIFT });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 60 + ALPHA_SHIFT });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 60 + ALPHA_SHIFT });
      const list = lastList(onEditTables);
      expect(list.find((t) => t.tableId === 't1').bounds).toEqual(alpha().bounds);
      expect(list.find((t) => t.tableId === 't2').bounds).toEqual(beta().bounds);
    });
  });

  describe('in the Validate borders pass', () => {
    it('draws every table at its page position', async () => {
      const { container } = await renderLoaded(baseProps({ editorMode: 'border' }));
      expect(borderY(container, 't1')).toBe(0);
      expect(borderY(container, 't2')).toBe(300);
    });

    it('draws the page image whole, with no strips or extra height', async () => {
      const { container } = await renderLoaded(baseProps({ editorMode: 'border' }));
      expect(screen.queryAllByTestId('separation-band-image')).toHaveLength(0);
      expect(container.querySelector('svg').getAttribute('viewBox')).toBe(
        `0 0 ${PIXELS} ${PIXELS}`
      );
    });
  });

  it('draws the page unseparated in the Validate tables pass when there are no tables', async () => {
    const { container } = await renderLoaded(baseProps({ metadataTables: [] }));
    expect(screen.queryAllByTestId('separation-band-image')).toHaveLength(0);
    expect(container.querySelector('svg').getAttribute('viewBox')).toBe(
      `0 0 ${PIXELS} ${PIXELS}`
    );
  });
});
