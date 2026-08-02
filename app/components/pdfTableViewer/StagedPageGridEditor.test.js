import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { StagedPageGridEditor } from 'components/pdfTableViewer/StagedPageGridEditor';
import toast from 'react-hot-toast';
import { leadingSquaresBounds } from 'components/pdfTableViewer/tableSupportUtils';
import {
  documentDimOpacity,
  layerColumnsColour,
  layerRowsColour,
  sectionTitleAreaColumnSpan,
} from 'config';

// Messages use react-hot-toast; the <Toaster/> lives in the app layout, not this
// component, so assert on the mocked calls rather than rendered DOM text.
jest.mock('react-hot-toast', () => {
  const toastMock = jest.fn();
  toastMock.error = jest.fn();
  toastMock.dismiss = jest.fn();
  return { __esModule: true, default: toastMock };
});

// jsdom does not lay out SVG/HTML, so the component's geometry maths depends
// entirely on the mocked <img> getBoundingClientRect. We report a 100x100 box at
// the origin; with pixelWidth/pixelHeight = 1000 a screen coordinate X maps to
// page fraction X/1000 (sx = rect.width / dims.w = 100 / 100 = 1). A fraction f is
// therefore at screen px f * 1000.
const PIXELS = 1000;

// A minimal set of cells for an R x C grid (bounds are tight OCR boxes, not the
// grid square — reconcileCells recomputes squares from geometry so any value works).
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

function alpha() {
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
  };
}

function beta() {
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
    rowHeights: [{ value: 0.1, confidence: 90 }],
    cells: gridCells(1, 1),
    title: null,
    extractionMechanism: 'HEURISTIC',
    confirmationStage: null,
  };
}

function loadImage(img, { w = 100, h = 100 } = {}) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
  fireEvent.load(img);
}

function baseProps(overrides = {}) {
  return {
    image: 'AAAA',
    pixelWidth: PIXELS,
    pixelHeight: PIXELS,
    page: 0,
    metadataTables: [alpha(), beta()],
    selectedTableId: null,
    onSelectTable: jest.fn(),
    mode: 'border',
    dim: false,
    onEditTables: jest.fn(),
    onCreatedTable: jest.fn(),
    pdfId: 'pdf-1',
    ...overrides,
  };
}

beforeEach(() => {
  toast.mockClear();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
    }),
  });
});

// Render, load a 100x100 image, and wait for the SVG overlay to appear.
async function renderLoaded(props) {
  const utils = render(<StagedPageGridEditor {...props} />);
  const img = utils.container.querySelector('img');
  loadImage(img);
  await waitFor(() =>
    expect(utils.container.querySelector('svg')).not.toBeNull()
  );
  return utils;
}

describe('StagedPageGridEditor', () => {
  it('renders the <img>, and the overlay SVG only after the image load', () => {
    const { container } = render(<StagedPageGridEditor {...baseProps()} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('AAAA');
    // Before load: no overlay.
    expect(container.querySelector('svg')).toBeNull();
    loadImage(img);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the dim layer with the configured opacity only when dim is true', async () => {
    const { container, rerender } = await renderLoaded(
      baseProps({ dim: true })
    );
    const dimLayer = screen.getByTestId('dim-layer');
    expect(dimLayer.style.backgroundColor).toContain(
      String(documentDimOpacity())
    );

    rerender(<StagedPageGridEditor {...baseProps({ dim: false })} />);
    loadImage(container.querySelector('img'));
    expect(screen.queryByTestId('dim-layer')).toBeNull();
  });

  it('shows the selected table label (name + cols × rows) and updates on selection change', async () => {
    const { rerender } = await renderLoaded(
      baseProps({ selectedTableId: 't1' })
    );
    const label = await screen.findByTestId('selected-label');
    expect(label).toHaveTextContent('Alpha');
    expect(label).toHaveTextContent('2 × 2');

    rerender(<StagedPageGridEditor {...baseProps({ selectedTableId: 't2' })} />);
    const label2 = await screen.findByTestId('selected-label');
    expect(label2).toHaveTextContent('Beta');
    expect(label2).toHaveTextContent('1 × 1');
  });

  it('calls onSelectTable with the id of a clicked table', async () => {
    const onSelectTable = jest.fn();
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1', onSelectTable })
    );
    const svg = container.querySelector('svg');
    // Click at fraction (0.35, 0.35): inside Beta [0.3..0.4].
    fireEvent.click(svg, { clientX: 350, clientY: 350 });
    expect(onSelectTable).toHaveBeenCalledWith('t2');
  });

  it('border mode: dragging the right edge outward widens the selected table', async () => {
    const onEditTables = jest.fn();
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1', onEditTables })
    );
    // Boundary hit lines render in [left, right, top, bottom] order.
    const hitLines = container.querySelectorAll('[data-testid="hit-line"]');
    expect(hitLines).toHaveLength(4);
    const rightEdge = hitLines[1];
    // Right edge is at fraction 0.1 => screen x 100. Drag to x 120 => fraction 0.12.
    fireEvent.mouseDown(rightEdge, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 120, clientY: 50 });

    expect(onEditTables).toHaveBeenCalled();
    const lastList = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.bounds.width).toBeCloseTo(0.12, 6);
    expect(edited.bounds.left).toBeCloseTo(0, 6);
  });

  it('create mode: a rubber-band drag in empty space adds a 1×1 MANUAL table', async () => {
    const onEditTables = jest.fn();
    const onCreatedTable = jest.fn();
    let triggerCreate;
    const { container } = await renderLoaded(
      baseProps({
        selectedTableId: 't1',
        onEditTables,
        onCreatedTable,
        onRequestCreate: (fn) => {
          triggerCreate = fn;
        },
      })
    );
    expect(typeof triggerCreate).toBe('function');
    act(() => {
      triggerCreate();
    });
    const svg = container.querySelector('svg');
    // Rubber-band from (0.6, 0.6) to (0.7, 0.7): empty area, does not overlap.
    fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 700 });
    fireEvent.mouseUp(window, { clientX: 700, clientY: 700 });

    expect(onCreatedTable).toHaveBeenCalledTimes(1);
    const newId = onCreatedTable.mock.calls[0][0];
    expect(onEditTables).toHaveBeenCalled();
    const lastList = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const created = lastList.find((t) => t.tableId === newId);
    expect(created).toBeTruthy();
    expect(created.extractionMechanism).toBe('MANUAL');
    expect(created.columnWidths).toHaveLength(1);
    expect(created.rowHeights).toHaveLength(1);
    expect(created.confirmationStage).toBeNull();
    expect(created.bounds.width).toBeCloseTo(0.1, 6);
    expect(created.bounds.height).toBeCloseTo(0.1, 6);
  });

  it('border mode draws no internal grid lines, confidence squares, or header markers', async () => {
    const { container } = await renderLoaded(baseProps({ selectedTableId: 't1' }));
    // Only the 4 boundary hit lines exist — no internal grid dividers.
    const allLines = container.querySelectorAll('line');
    expect(allLines).toHaveLength(4);
    expect(
      container.querySelectorAll('[data-testid^="confidence-square"]')
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid^="row-confidence-square"]')
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid^="header-marker"]')
    ).toHaveLength(0);
  });

  // ---- Rows mode --------------------------------------------------------------------

  it('rows mode: draws the horizontal internal grid lines in the orange colour', async () => {
    const { container } = await renderLoaded(
      baseProps({ mode: 'rows', selectedTableId: 't1' })
    );
    // Alpha is 2×2: one internal row divider.
    const rowLines = screen.getAllByTestId('row-line');
    expect(rowLines).toHaveLength(1);
    rowLines.forEach((l) =>
      expect(l.getAttribute('stroke')).toBe(layerRowsColour())
    );
    // The border is NOT draggable in rows mode: no boundary hit lines.
    expect(
      container.querySelectorAll('[data-testid="hit-line"]')
    ).toHaveLength(0);
  });

  it('rows mode: clicking a horizontal line selects it (highlight above and below)', async () => {
    const onSelectedLineChange = jest.fn();
    await renderLoaded(
      baseProps({ mode: 'rows', selectedTableId: 't1', onSelectedLineChange })
    );
    // No highlight before selection.
    expect(screen.queryAllByTestId('row-selected-highlight')).toHaveLength(0);
    const hit = screen.getByTestId('row-hit-line');
    // A click (no movement past the threshold) selects the line.
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
    // One highlight line immediately above and one immediately below.
    expect(screen.getAllByTestId('row-selected-highlight')).toHaveLength(2);
    expect(onSelectedLineChange).toHaveBeenCalledWith({
      orientation: 'row',
      index: 1,
    });
  });

  it('rows mode: dragging a line commits a moved divider via onEditTables', async () => {
    const onEditTables = jest.fn();
    await renderLoaded(
      baseProps({ mode: 'rows', selectedTableId: 't1', onEditTables })
    );
    const hit = screen.getByTestId('row-hit-line');
    // Divider at fraction 0.05 => screen y 50. Drag to y 70 => fraction 0.07.
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });

    expect(onEditTables).toHaveBeenCalled();
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.rowHeights).toHaveLength(2);
    expect(edited.rowHeights[0].value).toBeCloseTo(0.07, 6);
    expect(edited.rowHeights[1].value).toBeCloseTo(0.03, 6);
  });

  it('rows mode: addRow adds a row line when there are no internal row lines', async () => {
    const onEditTables = jest.fn();
    let rowsAction;
    await renderLoaded(
      baseProps({
        mode: 'rows',
        selectedTableId: 't2', // Beta is 1×1: no internal row lines.
        onEditTables,
        onRequestRowsAction: (fn) => {
          rowsAction = fn;
        },
      })
    );
    expect(typeof rowsAction).toBe('function');
    act(() => {
      rowsAction('addRow');
    });
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't2');
    expect(edited.rowHeights).toHaveLength(2);
  });

  it('rows mode: addAbove / addBelow / deleteLine act on the selected line', async () => {
    const onEditTables = jest.fn();
    let rowsAction;
    await renderLoaded(
      baseProps({
        mode: 'rows',
        selectedTableId: 't1', // Alpha is 2×2.
        onEditTables,
        onRequestRowsAction: (fn) => {
          rowsAction = fn;
        },
      })
    );
    // Select the single internal divider.
    const hit = screen.getByTestId('row-hit-line');
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });

    act(() => rowsAction('addAbove'));
    let last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').rowHeights).toHaveLength(3);

    act(() => rowsAction('addBelow'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').rowHeights).toHaveLength(3);

    act(() => rowsAction('deleteLine'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').rowHeights).toHaveLength(1);
  });

  // ---- Columns mode -----------------------------------------------------------------

  it('columns mode: draws vertical grid lines purple; horizontal lines and border are not interactive', async () => {
    const { container } = await renderLoaded(
      baseProps({ mode: 'columns', selectedTableId: 't1' })
    );
    const colLines = screen.getAllByTestId('column-line');
    expect(colLines).toHaveLength(1);
    colLines.forEach((l) =>
      expect(l.getAttribute('stroke')).toBe(layerColumnsColour())
    );
    // Vertical lines are interactive; horizontal lines and the border are not.
    expect(screen.getAllByTestId('column-hit-line')).toHaveLength(1);
    expect(screen.queryAllByTestId('row-hit-line')).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid="hit-line"]')
    ).toHaveLength(0);
    // The horizontal row line is still drawn (non-interactive).
    expect(screen.getAllByTestId('row-line')).toHaveLength(1);
  });

  it('columns mode: clicking a vertical line selects it (highlight each side) and dragging commits', async () => {
    const onEditTables = jest.fn();
    await renderLoaded(
      baseProps({ mode: 'columns', selectedTableId: 't1', onEditTables })
    );
    expect(screen.queryAllByTestId('column-selected-highlight')).toHaveLength(0);
    const hit = screen.getByTestId('column-hit-line');
    // Click selects.
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
    expect(screen.getAllByTestId('column-selected-highlight')).toHaveLength(2);

    // Drag from fraction 0.05 (x 50) to fraction 0.07 (x 70).
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 70, clientY: 50 });
    expect(onEditTables).toHaveBeenCalled();
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.columnWidths).toHaveLength(2);
    expect(edited.columnWidths[0].value).toBeCloseTo(0.07, 6);
    expect(edited.columnWidths[1].value).toBeCloseTo(0.03, 6);
  });

  it('columns mode: addLeft / addRight / deleteLine act on the selected line', async () => {
    const onEditTables = jest.fn();
    let columnsAction;
    await renderLoaded(
      baseProps({
        mode: 'columns',
        selectedTableId: 't1', // Alpha is 2×2.
        onEditTables,
        onRequestColumnsAction: (fn) => {
          columnsAction = fn;
        },
      })
    );
    const hit = screen.getByTestId('column-hit-line');
    fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });

    act(() => columnsAction('addLeft'));
    let last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').columnWidths).toHaveLength(3);

    act(() => columnsAction('addRight'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').columnWidths).toHaveLength(3);

    act(() => columnsAction('deleteLine'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').columnWidths).toHaveLength(1);
  });

  // ---- Special Cells mode -----------------------------------------------------------

  function titled() {
    return {
      ...alpha(),
      title: {
        bounds: { left: 0.2, top: 0.02, width: 0.3, height: 0.03 },
        text: 'Foo',
        confidence: 80,
      },
    };
  }

  it('special mode: draws the whole grid (border + internal lines), non-editable', async () => {
    const { container } = await renderLoaded(
      baseProps({ mode: 'special', selectedTableId: 't1' })
    );
    // Alpha is 2×2: one internal row divider and one internal column divider.
    expect(screen.getAllByTestId('row-line')).toHaveLength(1);
    expect(screen.getAllByTestId('column-line')).toHaveLength(1);
    // Nothing interactive: no boundary hit lines and no grid hit lines.
    expect(container.querySelectorAll('[data-testid="hit-line"]')).toHaveLength(
      0
    );
    expect(screen.queryAllByTestId('row-hit-line')).toHaveLength(0);
    expect(screen.queryAllByTestId('column-hit-line')).toHaveLength(0);
  });

  it('special mode: a click/drag on a grid line does not change geometry', async () => {
    const onEditTables = jest.fn();
    await renderLoaded(
      baseProps({ mode: 'special', selectedTableId: 't1', onEditTables })
    );
    const rowLine = screen.getByTestId('row-line');
    fireEvent.mouseDown(rowLine, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });
    const colLine = screen.getByTestId('column-line');
    fireEvent.mouseDown(colLine, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 70, clientY: 50 });
    expect(onEditTables).not.toHaveBeenCalled();
  });

  it('special mode: renders neither title-rect nor header-rect for a plain table', async () => {
    await renderLoaded(baseProps({ mode: 'special', selectedTableId: 't1' }));
    expect(screen.queryByTestId('title-rect')).toBeNull();
    expect(screen.queryByTestId('header-rect')).toBeNull();
  });

  it('special mode: renders the title-rect at the title bounds with the "title" caption', async () => {
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [titled(), beta()],
      })
    );
    const rect = screen.getByTestId('title-rect');
    // Title bounds {0.2, 0.02, 0.3, 0.03} in drawn (×pixel) units.
    expect(Number(rect.getAttribute('x'))).toBeCloseTo(0.2 * PIXELS, 3);
    expect(Number(rect.getAttribute('y'))).toBeCloseTo(0.02 * PIXELS, 3);
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(0.3 * PIXELS, 3);
    expect(Number(rect.getAttribute('height'))).toBeCloseTo(0.03 * PIXELS, 3);
    // Dotted (a dash array), not solid.
    expect(rect.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('special mode: renders the header-rect around the first headerCount rows with the "Header" caption', async () => {
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [{ ...alpha(), headerCount: 1 }, beta()],
      })
    );
    const rect = screen.getByTestId('header-rect');
    // Black, dotted, 3 screen px outside the first row (rows are 0.05 tall).
    expect(rect.getAttribute('stroke')).toBe('black');
    expect(rect.getAttribute('stroke-dasharray')).toBeTruthy();
    // With sx = sy = 1 the 3px margin is 3 drawn units: y just above the top,
    // height covering the first row (0.05 × 1000 = 50) plus the two margins.
    expect(Number(rect.getAttribute('y'))).toBeCloseTo(-3, 3);
    expect(Number(rect.getAttribute('height'))).toBeCloseTo(50 + 6, 3);
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('special mode: setTitle sub-mode rubber-band creates a title when none exists', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    expect(typeof specialAction).toBe('function');
    act(() => specialAction('setTitle'));
    const svg = container.querySelector('svg');
    // Rubber-band from (0.2, 0.05) to (0.4, 0.12).
    fireEvent.mouseDown(svg, { clientX: 200, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 120 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 120 });
    expect(onEditTables).toHaveBeenCalled();
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.title).toBeTruthy();
    expect(edited.title.text).toBeNull();
    expect(edited.title.confidence).toBeNull();
    expect(edited.title.bounds.left).toBeCloseTo(0.2, 6);
    expect(edited.title.bounds.top).toBeCloseTo(0.05, 6);
    expect(edited.title.bounds.width).toBeCloseTo(0.2, 6);
    expect(edited.title.bounds.height).toBeCloseTo(0.07, 6);
  });

  it('special mode: setTitle sub-mode drags a side to resize an existing title', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [titled(), beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('setTitle'));
    // Four draggable sides: [left, right, top, bottom].
    const sides = screen.getAllByTestId('title-hit-line');
    expect(sides).toHaveLength(4);
    const rightSide = sides[1];
    // Right edge at fraction 0.5 (x 500). Drag to x 600 => fraction 0.6.
    fireEvent.mouseDown(rightSide, { clientX: 500, clientY: 35 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 35 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 35 });
    expect(onEditTables).toHaveBeenCalled();
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.title.bounds.left).toBeCloseTo(0.2, 6);
    expect(edited.title.bounds.width).toBeCloseTo(0.4, 6);
  });

  it('special mode: an existing title is resizable by its sides without entering Set-Title', async () => {
    const onEditTables = jest.fn();
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [titled(), beta()],
        onEditTables,
      })
    );
    // No setTitle call: the sides are always present when a title is displayed.
    const sides = screen.getAllByTestId('title-hit-line');
    expect(sides).toHaveLength(4);
    const rightSide = sides[1];
    fireEvent.mouseDown(rightSide, { clientX: 500, clientY: 35 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 35 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 35 });
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    const edited = lastList.find((t) => t.tableId === 't1');
    expect(edited.title.bounds.width).toBeCloseTo(0.4, 6);
  });

  it('special mode: deleteTitle clears the title', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [titled(), beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('deleteTitle'));
    const lastList =
      onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(lastList.find((t) => t.tableId === 't1').title).toBeNull();
  });

  it('special mode: removeHeader decrements headerCount by one', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [{ ...alpha(), headerCount: 3 }, beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('removeHeader'));
    const last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(2);
  });

  it('special mode: removeHeader will not take headerCount below zero', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [{ ...alpha(), headerCount: 0 }, beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('removeHeader'));
    const last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(0);
  });

  it('special mode: addHeader leaves headerCount alone once it equals the row count', async () => {
    const onEditTables = jest.fn();
    let specialAction;
    // Alpha has two rows, so a headerCount of 2 is already the ceiling.
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [{ ...alpha(), headerCount: 2 }, beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('addHeader'));
    const last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(2);
  });

  it('special mode: removeHeader steps headerCount down and addHeader increments it (clamped)', async () => {
    // The component is stateless w.r.t. metadataTables (edits flow up through
    // onEditTables); each action here reads whatever headerCount the current props carry,
    // so the fixture is re-supplied via rerender to model the parent applying the edit.
    const onEditTables = jest.fn();
    let specialAction;
    const propsWith = (headerCount) =>
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [{ ...alpha(), headerCount }, beta()],
        onEditTables,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      });

    const { rerender } = await renderLoaded(propsWith(1));
    act(() => specialAction('removeHeader'));
    let last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(0);

    rerender(<StagedPageGridEditor {...propsWith(0)} />);
    act(() => specialAction('addHeader'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(1);

    // Alpha has 2 rows, so addHeader clamps headerCount at 2.
    rerender(<StagedPageGridEditor {...propsWith(2)} />);
    act(() => specialAction('addHeader'));
    last = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(last.find((t) => t.tableId === 't1').headerCount).toBe(2);
  });

  // ---- Colours mode -----------------------------------------------------------------

  // Two coloured areas: one small square near the origin, one further down the page.
  const AREA_A = {
    left: 0.1,
    top: 0.1,
    width: 0.1,
    height: 0.1,
    foreground: '#111111',
    background: '#eeeeee',
  };
  const AREA_B = {
    left: 0.5,
    top: 0.5,
    width: 0.2,
    height: 0.2,
    foreground: '#222222',
    background: '#dddddd',
  };

  it('colours mode: renders one dotted rect per area', async () => {
    await renderLoaded(
      baseProps({ mode: 'colours', colouredAreas: [AREA_A, AREA_B] })
    );
    expect(screen.getByTestId('coloured-area-0')).toBeInTheDocument();
    expect(screen.getByTestId('coloured-area-1')).toBeInTheDocument();
    // Dotted, not solid.
    expect(
      screen.getByTestId('coloured-area-0').getAttribute('stroke-dasharray')
    ).toBeTruthy();
    // No selection => no inner/outer highlight rects.
    expect(screen.queryByTestId('coloured-selected-outer-0')).toBeNull();
    expect(screen.queryByTestId('coloured-selected-inner-0')).toBeNull();
  });

  it('colours mode: the selected area also draws the inner and outer highlight rects', async () => {
    await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 1,
      })
    );
    expect(screen.getByTestId('coloured-selected-outer-1')).toBeInTheDocument();
    expect(screen.getByTestId('coloured-selected-inner-1')).toBeInTheDocument();
    // Only the selected area gets them.
    expect(screen.queryByTestId('coloured-selected-outer-0')).toBeNull();
  });

  it('colours mode: clicking inside an area selects it by index', async () => {
    const onSelectColouredArea = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        onSelectColouredArea,
      })
    );
    const svg = container.querySelector('svg');
    // Click at fraction (0.6, 0.6): inside AREA_B [0.5..0.7].
    fireEvent.click(svg, { clientX: 600, clientY: 600 });
    expect(onSelectColouredArea).toHaveBeenCalledWith(1);
  });

  it('colours mode: dragging a coloured area side resizes it', async () => {
    const onColouredAreasChange = jest.fn();
    await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A],
        onColouredAreasChange,
      })
    );
    // AREA_A right edge is at fraction 0.2 (x 200); drag it out to 0.3 (x 300).
    const right = screen.getByTestId('coloured-side-0-right');
    fireEvent.mouseDown(right, { clientX: 200, clientY: 150 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 150 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 150 });

    expect(onColouredAreasChange).toHaveBeenCalled();
    const last = onColouredAreasChange.mock.calls.at(-1)[0];
    expect(last[0].left).toBeCloseTo(0.1, 5);
    expect(last[0].width).toBeCloseTo(0.2, 5); // right edge now at 0.3
    expect(last[0].top).toBeCloseTo(0.1, 5);
  });

  it('colours mode: a non-selected area is still resizable', async () => {
    const onColouredAreasChange = jest.fn();
    await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0, // AREA_B (index 1) is NOT selected
        onColouredAreasChange,
      })
    );
    // AREA_B bottom edge is at fraction 0.7 (y 700); drag it down to 0.8 (y 800).
    const bottom = screen.getByTestId('coloured-side-1-bottom');
    fireEvent.mouseDown(bottom, { clientX: 600, clientY: 700 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 800 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 800 });

    const last = onColouredAreasChange.mock.calls.at(-1)[0];
    expect(last[1].top).toBeCloseTo(0.5, 5);
    expect(last[1].height).toBeCloseTo(0.3, 5); // bottom now at 0.8
  });

  it('colours mode: clicking empty space with no swatch armed does nothing', async () => {
    const onSelectColouredArea = jest.fn();
    const onColourPicked = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0,
        onSelectColouredArea,
        onColourPicked,
      })
    );
    const svg = container.querySelector('svg');
    // Click at fraction (0.9, 0.9): outside every area, no swatch armed.
    fireEvent.click(svg, { clientX: 900, clientY: 900 });
    expect(onSelectColouredArea).not.toHaveBeenCalled();
    expect(onColourPicked).not.toHaveBeenCalled();
  });

  it('colours mode: clicking outside any area with a swatch armed sets that swatch', async () => {
    const getImageData = jest.fn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    }));
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onSelectColouredArea = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0,
        colourPickMode: 'foreground',
        onColourPicked,
        onSelectColouredArea,
      })
    );
    const svg = container.querySelector('svg');
    fireEvent.click(svg, { clientX: 900, clientY: 900 }); // outside every area
    expect(onColourPicked).toHaveBeenCalledWith('#0a141e');
    expect(onSelectColouredArea).not.toHaveBeenCalled();

    getContextSpy.mockRestore();
  });

  it('colours mode: a rubber-band drag in add mode appends a new area and reports it', async () => {
    const onColouredAreasChange = jest.fn();
    const onSelectColouredArea = jest.fn();
    const onColourAdded = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A],
        colourAddMode: true,
        onColouredAreasChange,
        onSelectColouredArea,
        onColourAdded,
      })
    );
    const svg = container.querySelector('svg');
    // Rubber-band from (0.3, 0.3) to (0.4, 0.4).
    fireEvent.mouseDown(svg, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 400 });

    expect(onColouredAreasChange).toHaveBeenCalledTimes(1);
    const next = onColouredAreasChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
    const created = next[1];
    expect(created.left).toBeCloseTo(0.3, 6);
    expect(created.top).toBeCloseTo(0.3, 6);
    expect(created.width).toBeCloseTo(0.1, 6);
    expect(created.height).toBeCloseTo(0.1, 6);
    // Under jsdom (no canvas) analysePeakColours([]) yields the white/black defaults.
    expect(created.background).toBe('#ffffff');
    expect(created.foreground).toBe('#000000');
    // The new area (index 1) is selected and add mode is torn down.
    expect(onSelectColouredArea).toHaveBeenCalledWith(1);
    expect(onColourAdded).toHaveBeenCalledTimes(1);
  });

  it('colours mode: clicking a DIFFERENT area switches selection AND clears the armed swatch (no pick)', async () => {
    const onColourPicked = jest.fn();
    const onColourPreview = jest.fn();
    const onSelectColouredArea = jest.fn();
    const onClearColourPick = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0, // AREA_A is selected; the swatch is armed for it
        colourPickMode: 'foreground',
        onColourPicked,
        onColourPreview,
        onSelectColouredArea,
        onClearColourPick,
      })
    );
    const svg = container.querySelector('svg');
    // Press inside AREA_B (fraction 0.6,0.6), which is NOT the selected area (index 0).
    fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 600 });
    fireEvent.click(svg, { clientX: 600, clientY: 600 });

    // The selection switched to the new area and the swatch was cleared; nothing was picked.
    expect(onSelectColouredArea).toHaveBeenCalledWith(1);
    expect(onClearColourPick).toHaveBeenCalledTimes(1);
    expect(onColourPicked).not.toHaveBeenCalled();
    expect(onColourPreview).not.toHaveBeenCalled();
  });

  it('colours mode: clicking the already-selected area with a swatch armed sets that swatch (picks the pixel)', async () => {
    const getImageData = jest.fn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    }));
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onSelectColouredArea = jest.fn();
    const onClearColourPick = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 1, // AREA_B is the selected area
        colourPickMode: 'foreground',
        onColourPicked,
        onSelectColouredArea,
        onClearColourPick,
      })
    );
    const svg = container.querySelector('svg');
    // Click (no drag) inside AREA_B (0.6,0.6) — the already-selected area — sets the swatch.
    fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 600 });
    fireEvent.click(svg, { clientX: 600, clientY: 600 });

    expect(onColourPicked).toHaveBeenCalledWith('#0a141e');
    expect(onSelectColouredArea).not.toHaveBeenCalled();
    expect(onClearColourPick).not.toHaveBeenCalled();

    getContextSpy.mockRestore();
  });

  it('colours mode: with a swatch armed and no area selected, clicking an area selects it and clears the swatch', async () => {
    const onSelectColouredArea = jest.fn();
    const onColourPicked = jest.fn();
    const onClearColourPick = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: null, // e.g. the previously selected area was just deleted
        colourPickMode: 'foreground',
        onSelectColouredArea,
        onColourPicked,
        onClearColourPick,
      })
    );
    const svg = container.querySelector('svg');
    fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 600 });
    fireEvent.click(svg, { clientX: 600, clientY: 600 });

    expect(onSelectColouredArea).toHaveBeenCalledWith(1);
    expect(onClearColourPick).toHaveBeenCalledTimes(1);
    expect(onColourPicked).not.toHaveBeenCalled();
  });

  it('colours mode: in pick mode a drag previews pixels live and commits on mouse-up', async () => {
    // getImageData yields a different known pixel on each call so the live preview and the
    // committed (release-point) colour can be told apart.
    const getImageData = jest
      .fn()
      .mockReturnValueOnce({ data: new Uint8ClampedArray([40, 50, 60, 255]) }) // move (preview)
      .mockReturnValueOnce({ data: new Uint8ClampedArray([70, 80, 90, 255]) }); // up (commit)
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onColourPreview = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A],
        selectedColouredIndex: 0,
        colourPickMode: 'foreground',
        onColourPicked,
        onColourPreview,
      })
    );
    const svg = container.querySelector('svg');
    // A real drag (past the click threshold): mouse-down does not sample; the first move
    // beyond the threshold previews, and the release point is committed.
    fireEvent.mouseDown(svg, { clientX: 120, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(window, { clientX: 180, clientY: 180 });

    // Preview reflected the pixel under the cursor while dragging...
    expect(onColourPreview).toHaveBeenCalledWith('#28323c');
    // ...was cleared on release, and only the release-point pixel was committed.
    expect(onColourPreview).toHaveBeenLastCalledWith(null);
    expect(onColourPicked).toHaveBeenCalledTimes(1);
    expect(onColourPicked).toHaveBeenCalledWith('#46505a');

    getContextSpy.mockRestore();
  });

  it('colours mode: a bare click on the selected area with a swatch armed sets that swatch', async () => {
    const getImageData = jest.fn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    }));
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onSelectColouredArea = jest.fn();
    const onClearColourPick = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A],
        selectedColouredIndex: 0, // clicking inside AREA_A (0.15,0.15) — the selected area
        colourPickMode: 'foreground',
        onColourPicked,
        onSelectColouredArea,
        onClearColourPick,
      })
    );
    const svg = container.querySelector('svg');
    fireEvent.click(svg, { clientX: 150, clientY: 150 });
    expect(onColourPicked).toHaveBeenCalledWith('#0a141e');
    expect(onClearColourPick).not.toHaveBeenCalled();
    expect(onSelectColouredArea).not.toHaveBeenCalled();

    getContextSpy.mockRestore();
  });

  it('colours mode: a drag starting in an unselected area does nothing', async () => {
    const getImageData = jest.fn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    }));
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onColourPreview = jest.fn();
    const onSelectColouredArea = jest.fn();
    const onClearColourPick = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0, // AREA_B (index 1) is unselected
        colourPickMode: 'foreground',
        onColourPicked,
        onColourPreview,
        onSelectColouredArea,
        onClearColourPick,
      })
    );
    const svg = container.querySelector('svg');
    // Drag begins inside AREA_B (unselected) and moves.
    fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 650 });
    fireEvent.mouseUp(window, { clientX: 650, clientY: 650 });
    fireEvent.click(svg, { clientX: 650, clientY: 650 });

    expect(onColourPicked).not.toHaveBeenCalled();
    expect(onColourPreview).not.toHaveBeenCalled();
    expect(onSelectColouredArea).not.toHaveBeenCalled();
    expect(onClearColourPick).not.toHaveBeenCalled();

    getContextSpy.mockRestore();
  });

  it('colours mode: a drag starting outside any area sets the swatch', async () => {
    const getImageData = jest
      .fn()
      .mockReturnValueOnce({ data: new Uint8ClampedArray([40, 50, 60, 255]) }) // move (preview)
      .mockReturnValueOnce({ data: new Uint8ClampedArray([70, 80, 90, 255]) }); // up (commit)
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn(), getImageData });

    const onColourPicked = jest.fn();
    const onColourPreview = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        colouredAreas: [AREA_A, AREA_B],
        selectedColouredIndex: 0,
        colourPickMode: 'foreground',
        onColourPicked,
        onColourPreview,
      })
    );
    const svg = container.querySelector('svg');
    // Drag begins outside every area (0.9,0.9) and moves.
    fireEvent.mouseDown(svg, { clientX: 900, clientY: 900 });
    fireEvent.mouseMove(window, { clientX: 920, clientY: 920 });
    fireEvent.mouseUp(window, { clientX: 940, clientY: 940 });

    expect(onColourPreview).toHaveBeenCalledWith('#28323c');
    expect(onColourPreview).toHaveBeenLastCalledWith(null);
    expect(onColourPicked).toHaveBeenCalledWith('#46505a');

    getContextSpy.mockRestore();
  });

  // ---- Special Cells: section-title rows --------------------------------------------

  // Alpha is a 2×2 table, bounds {0,0,0.1,0.1}, rowHeights [0.05, 0.05]. Row band 0
  // spans page-fraction y 0..0.05 (screen 0..50), band 1 spans 0.05..0.1 (screen 50..100).
  function withSection(sectionTitles) {
    return { ...alpha(), sectionTitles };
  }

  it('special mode: renders a dotted "Section Title" rect at each section-title row band', async () => {
    await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [
          withSection([
            { tableRow: 1, delete: true, columnName: null, data: null },
          ]),
          beta(),
        ],
      })
    );
    const rect = screen.getByTestId('section-title-0');
    // Row band 1: top 0.05, height 0.05.
    expect(Number(rect.getAttribute('y'))).toBeCloseTo(0.05 * PIXELS, 3);
    expect(Number(rect.getAttribute('height'))).toBeCloseTo(0.05 * PIXELS, 3);
    expect(rect.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(screen.getByText('Hidden Row')).toBeInTheDocument();
  });

  // A section title now arrives complete: its data area drawn across the leading squares of the
  // clicked row and its column name already chosen. Both used to be left to the user — the area
  // rubber-banded out, the name picked from the combo afterwards.
  it('special mode: Add Section Title Row draws the area and names the column', async () => {
    const onEditTables = jest.fn();
    const onSelectedSectionRowChange = jest.fn();
    let specialAction;
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        newSectionTitleColumnName: 'Branch',
        onEditTables,
        onSelectedSectionRowChange,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    expect(typeof specialAction).toBe('function');
    act(() => specialAction('addSubTitleRow'));
    const svg = container.querySelector('svg');
    // Click inside row band 1: y 70 (0.07), x 30 (0.03) is inside the table.
    fireEvent.click(svg, { clientX: 30, clientY: 70 });
    expect(onEditTables).toHaveBeenCalled();
    const last = onEditTables.mock.calls.at(-1)[0];
    const edited = last.find((t) => t.tableId === 't1');
    expect(edited.sectionTitles).toHaveLength(1);
    expect(edited.sectionTitles[0]).toMatchObject({
      tableRow: 1,
      // There is an area to read, so the row is not dropped from the output.
      delete: false,
      columnName: 'Branch',
    });
    // The area is derived, not written out here: whatever the configured span, it is the
    // leading squares of that row.
    const source = baseProps().metadataTables.find((t) => t.tableId === 't1');
    expect(edited.sectionTitles[0].data).toEqual({
      bounds: leadingSquaresBounds(source, 1, sectionTitleAreaColumnSpan()),
      text: null,
      confidence: null,
    });
    expect(onSelectedSectionRowChange).toHaveBeenCalledWith(1);
  });

  // A hidden row is the other half of the pair: a section-title row with no column name and no
  // area, so the row is simply dropped from the output rather than supplying a value to one.
  it('special mode: Add Hidden Row adds an unnamed, area-less row and selects it', async () => {
    const onEditTables = jest.fn();
    const onSelectedSectionRowChange = jest.fn();
    let specialAction;
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        newSectionTitleColumnName: 'Branch',
        onEditTables,
        onSelectedSectionRowChange,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    act(() => specialAction('addHiddenRow'));
    const svg = container.querySelector('svg');
    fireEvent.click(svg, { clientX: 30, clientY: 70 });
    const last = onEditTables.mock.calls.at(-1)[0];
    const edited = last.find((t) => t.tableId === 't1');
    expect(edited.sectionTitles).toHaveLength(1);
    // Unnamed even though a name was on offer: that is what makes it a hidden row.
    expect(edited.sectionTitles[0]).toMatchObject({
      tableRow: 1,
      delete: true,
      columnName: null,
      data: null,
    });
    expect(onSelectedSectionRowChange).toHaveBeenCalledWith(1);
  });

  it('special mode: clicking an existing section-title row selects it; Delete '+
     'Section Title Row removes it', async () => {
    const onEditTables = jest.fn();
    const onSelectedSectionRowChange = jest.fn();
    let specialAction;
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [
          withSection([
            { tableRow: 1, delete: true, columnName: null, data: null },
          ]),
          beta(),
        ],
        onEditTables,
        onSelectedSectionRowChange,
        onRequestSpecialAction: (fn) => {
          specialAction = fn;
        },
      })
    );
    const svg = container.querySelector('svg');
    // Click inside row band 1 selects that section-title row.
    fireEvent.click(svg, { clientX: 30, clientY: 70 });
    expect(onSelectedSectionRowChange).toHaveBeenCalledWith(1);

    act(() => specialAction('deleteSubTitleRow'));
    const last = onEditTables.mock.calls.at(-1)[0];
    expect(last.find((t) => t.tableId === 't1').sectionTitles).toHaveLength(0);
  });

  it('special mode: rubber-band within the selected row sets data and clears delete', async () => {
    const onEditTables = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [
          withSection([
            { tableRow: 1, delete: true, columnName: null, data: null },
          ]),
          beta(),
        ],
        onEditTables,
      })
    );
    const svg = container.querySelector('svg');
    // Select the section-title row (band 1) first.
    fireEvent.click(svg, { clientX: 30, clientY: 70 });
    // Rubber-band an area inside the row: (0.02, 0.06) -> (0.08, 0.09).
    fireEvent.mouseDown(svg, { clientX: 20, clientY: 60 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 90 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 90 });

    expect(onEditTables).toHaveBeenCalled();
    const last = onEditTables.mock.calls.at(-1)[0];
    const st = last.find((t) => t.tableId === 't1').sectionTitles[0];
    expect(st.delete).toBe(false);
    expect(st.data).toBeTruthy();
    expect(st.data.text).toBeNull();
    expect(st.data.confidence).toBeNull();
    expect(st.data.bounds.left).toBeCloseTo(0.02, 6);
    expect(st.data.bounds.top).toBeCloseTo(0.06, 6);
    expect(st.data.bounds.width).toBeCloseTo(0.06, 6);
    expect(st.data.bounds.height).toBeCloseTo(0.03, 6);
  });

  it('special mode: editing one section title preserves the others and their fields (load->edit->save)', async () => {
    const onEditTables = jest.fn();
    const populated = [
      {
        tableRow: 0,
        delete: false,
        columnName: 'Premium',
        data: {
          bounds: { left: 0.01, top: 0.01, width: 0.02, height: 0.02 },
          text: null,
          confidence: null,
        },
      },
      { tableRow: 1, delete: true, columnName: null, data: null },
    ];
    const { container } = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [withSection(populated), beta()],
        onEditTables,
      })
    );
    // Both section-title rects present on load.
    expect(screen.getByTestId('section-title-0')).toBeInTheDocument();
    expect(screen.getByTestId('section-title-1')).toBeInTheDocument();
    // The row-0 area's draggable sides are present; resize the right edge.
    const right = screen.getByTestId('section-area-0-right');
    // Right edge at fraction 0.03 (x 30); drag to 0.05 (x 50).
    fireEvent.mouseDown(right, { clientX: 30, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 20 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 20 });

    const last = onEditTables.mock.calls.at(-1)[0];
    const list = last.find((t) => t.tableId === 't1').sectionTitles;
    expect(list).toHaveLength(2);
    // Row 0 kept its columnName, its area widened.
    expect(list[0].columnName).toBe('Premium');
    expect(list[0].data.bounds.width).toBeCloseTo(0.04, 5);
    // Row 1 survived untouched.
    expect(list[1]).toMatchObject({
      tableRow: 1,
      delete: true,
      columnName: null,
      data: null,
    });
  });

  // ---- Special Cells: merged cells ---------------------------------------------------

  // Alpha is a 2×2 table, bounds {0,0,0.1,0.1}: grid square (r, c) spans screen
  // x c*50..(c+1)*50 and y r*50..(r+1)*50, so (25, 25) is square (0,0), (75, 25) is
  // (0,1) — the last column — and (75, 75) is the bottom-right square.
  //
  // merged3x3 is a 3×3 table on the same origin (three 0.05 columns and rows, screen
  // 0..150 on each axis) carrying `spans` on the cell anchored at (0,0), so the
  // Extend/Reduce actions have room to move in both directions.
  function merged3x3(spans, extra = {}) {
    return {
      ...alpha(),
      bounds: { left: 0, top: 0, width: 0.15, height: 0.15 },
      columnWidths: [0, 1, 2].map(() => ({ value: 0.05, confidence: 90 })),
      rowHeights: [0, 1, 2].map(() => ({ value: 0.05, confidence: 90 })),
      cells: gridCells(3, 3).map((cell) =>
        cell.row === 0 && cell.column === 0 ? { ...cell, ...spans } : cell
      ),
      ...extra,
    };
  }

  // The table with `tableId` as the last onEditTables call left it.
  function lastEdit(onEditTables, tableId = 't1') {
    return onEditTables.mock.calls.at(-1)[0].find((t) => t.tableId === tableId);
  }

  function cellOf(table, row, column) {
    return table.cells.find((c) => c.row === row && c.column === column);
  }

  // Render in Special Areas mode with the given tables and capture the special-action
  // dispatcher the component publishes.
  async function renderSpecial(overrides = {}) {
    const captured = {};
    const utils = await renderLoaded(
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        onRequestSpecialAction: (fn) => {
          captured.action = fn;
        },
        ...overrides,
      })
    );
    return { ...utils, captured };
  }

  it('special mode: Merge Cell then a cell click sets columnSpan 2 and zeroes confidence', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({ onEditTables });
    expect(typeof captured.action).toBe('function');
    act(() => captured.action('mergeCell'));
    // Square (0,0) of Alpha.
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    const cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.columnSpan).toBe(2);
    expect(cell.rowSpan).toBe(1);
    // The fixture cell starts at confidence 90; the merge must zero it so the page-exit
    // recalculation re-reads the widened region.
    expect(cell.confidence).toBe(0);
  });

  it('special mode: Merge Cell on a square with no cell creates one with columnSpan 2', async () => {
    const onEditTables = jest.fn();
    const bare = {
      ...alpha(),
      cells: gridCells(2, 2).filter((c) => !(c.row === 0 && c.column === 0)),
    };
    const { container, captured } = await renderSpecial({
      metadataTables: [bare, beta()],
      onEditTables,
    });
    act(() => captured.action('mergeCell'));
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    const cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell).toBeTruthy();
    expect(cell.columnSpan).toBe(2);
    expect(cell.rowSpan).toBe(1);
    expect(cell.confidence).toBe(0);
  });

  it('special mode: Merge Cell in the last column falls back to rowSpan 2', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({ onEditTables });
    act(() => captured.action('mergeCell'));
    // Square (0,1): the last column, so there is nothing to the right.
    fireEvent.click(container.querySelector('svg'), {
      clientX: 75,
      clientY: 25,
    });
    const cell = cellOf(lastEdit(onEditTables), 0, 1);
    expect(cell.rowSpan).toBe(2);
    expect(cell.columnSpan).toBe(1);
  });

  it('special mode: Merge Cell on the bottom-right square changes nothing and warns', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({ onEditTables });
    act(() => captured.action('mergeCell'));
    // Square (1,1): the bottom-right square, with nothing to merge into.
    fireEvent.click(container.querySelector('svg'), {
      clientX: 75,
      clientY: 75,
    });
    expect(onEditTables).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Nothing to merge into');
  });

  it('special mode: extendColumn and extendRow each widen the selection by one', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 1, columnSpan: 2 }), beta()],
      onEditTables,
    });
    // Select the merged cell by clicking its anchor square (0,0).
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    act(() => captured.action('extendColumn'));
    let cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.columnSpan).toBe(3);
    expect(cell.rowSpan).toBe(1);
    expect(cell.confidence).toBe(0);

    act(() => captured.action('extendRow'));
    cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.rowSpan).toBe(2);
    // The component reads the table from its props, so each action starts from the
    // unchanged fixture: columnSpan is still the fixture's 2 here.
    expect(cell.columnSpan).toBe(2);
  });

  it('special mode: extendColumn and extendRow clamp at the grid edge', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 3, columnSpan: 3 }), beta()],
      onEditTables,
    });
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    act(() => captured.action('extendColumn'));
    expect(cellOf(lastEdit(onEditTables), 0, 0).columnSpan).toBe(3);
    act(() => captured.action('extendRow'));
    expect(cellOf(lastEdit(onEditTables), 0, 0).rowSpan).toBe(3);
  });

  it('special mode: reduceColumn and reduceRow narrow the selection by one, floored at 1', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 3, columnSpan: 3 }), beta()],
      onEditTables,
    });
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    act(() => captured.action('reduceColumn'));
    let cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.columnSpan).toBe(2);
    expect(cell.confidence).toBe(0);

    act(() => captured.action('reduceRow'));
    cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.rowSpan).toBe(2);
  });

  it('special mode: reduceColumn will not take a span below 1', async () => {
    const onEditTables = jest.fn();
    const { container, captured } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 2, columnSpan: 1 }), beta()],
      onEditTables,
    });
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    act(() => captured.action('reduceColumn'));
    const cell = cellOf(lastEdit(onEditTables), 0, 0);
    expect(cell.columnSpan).toBe(1);
    expect(cell.rowSpan).toBe(2);
  });

  it('special mode: a reduction that leaves both spans at 1 clears the merged-cell selection', async () => {
    const onEditTables = jest.fn();
    const onSelectedMergedCellChange = jest.fn();
    const { container, captured } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 2, columnSpan: 1 }), beta()],
      onEditTables,
      onSelectedMergedCellChange,
    });
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });
    act(() => captured.action('reduceRow'));
    expect(cellOf(lastEdit(onEditTables), 0, 0).rowSpan).toBe(1);
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith(null);
  });

  it('special mode: clicking a merged cell (anchor or a covered square) reports it up', async () => {
    const onSelectedMergedCellChange = jest.fn();
    const { container } = await renderSpecial({
      metadataTables: [merged3x3({ rowSpan: 1, columnSpan: 2 }), beta()],
      onSelectedMergedCellChange,
    });
    const svg = container.querySelector('svg');
    // The anchor square (0,0).
    fireEvent.click(svg, { clientX: 25, clientY: 25 });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });
    // Clear it by clicking an unmerged square, then click the covered square (0,1):
    // the anchor is reported, not the clicked square.
    fireEvent.click(svg, { clientX: 25, clientY: 125 });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(svg, { clientX: 75, clientY: 25 });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });
  });

  it('special mode: a click in a sub-title row selects the row, not a merged cell inside it', async () => {
    const onSelectedMergedCellChange = jest.fn();
    const onSelectedSectionRowChange = jest.fn();
    const { container } = await renderSpecial({
      metadataTables: [
        merged3x3(
          { rowSpan: 1, columnSpan: 2 },
          {
            sectionTitles: [
              { tableRow: 0, delete: true, columnName: null, data: null },
            ],
          }
        ),
        beta(),
      ],
      onSelectedMergedCellChange,
      onSelectedSectionRowChange,
    });
    // Square (0,0) is both the merged cell's anchor and inside sub-title row 0.
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    expect(onSelectedSectionRowChange).toHaveBeenLastCalledWith(0);
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith(null);
  });

  it('special mode: draws one rect per merged cell, distinguishing the selected one', async () => {
    const twoMerged = {
      ...merged3x3({ rowSpan: 1, columnSpan: 2 }),
    };
    twoMerged.cells = twoMerged.cells.map((cell) =>
      cell.row === 1 && cell.column === 1 ? { ...cell, rowSpan: 2 } : cell
    );
    await renderSpecial({
      metadataTables: [twoMerged, beta()],
      selectedMergedCell: { row: 0, column: 0 },
    });
    const first = screen.getByTestId('merged-cell-0');
    const second = screen.getByTestId('merged-cell-1');
    expect(screen.queryByTestId('merged-cell-2')).toBeNull();
    // Block 0: columns 0..1 of row 0 => x 0..100, y 0..50.
    expect(Number(first.getAttribute('x'))).toBeCloseTo(0, 3);
    expect(Number(first.getAttribute('width'))).toBeCloseTo(0.1 * PIXELS, 3);
    expect(Number(first.getAttribute('height'))).toBeCloseTo(0.05 * PIXELS, 3);
    // Block 1: column 1, rows 1..2 => x 50..100, y 50..150.
    expect(Number(second.getAttribute('y'))).toBeCloseTo(0.05 * PIXELS, 3);
    expect(Number(second.getAttribute('height'))).toBeCloseTo(0.1 * PIXELS, 3);
    // Both blocks are drawn the same way; only the selected one carries the highlight.
    expect(first.getAttribute('fill')).toBe(second.getAttribute('fill'));
    expect(first.getAttribute('stroke')).toBe(second.getAttribute('stroke'));
    expect(screen.getByTestId('merged-cell-selected-0')).toBeInTheDocument();
    expect(screen.queryByTestId('merged-cell-selected-1')).toBeNull();
  });

  it('does not draw merged-cell rects outside Special Areas mode', async () => {
    await renderLoaded(
      baseProps({
        mode: 'rows',
        selectedTableId: 't1',
        metadataTables: [merged3x3({ rowSpan: 1, columnSpan: 2 }), beta()],
        selectedMergedCell: { row: 0, column: 0 },
      })
    );
    expect(screen.queryByTestId('merged-cell-0')).toBeNull();
  });

  it('special mode: clears the merged-cell selection on a table change and on a page change', async () => {
    const onSelectedMergedCellChange = jest.fn();
    const propsFor = (overrides) =>
      baseProps({
        mode: 'special',
        selectedTableId: 't1',
        metadataTables: [merged3x3({ rowSpan: 1, columnSpan: 2 }), beta()],
        onSelectedMergedCellChange,
        ...overrides,
      });
    const { container, rerender } = await renderLoaded(propsFor({}));
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });

    rerender(
      <StagedPageGridEditor {...propsFor({ selectedTableId: 't2' })} />
    );
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith(null);

    // Re-select, then move the displayed page.
    rerender(<StagedPageGridEditor {...propsFor({})} />);
    fireEvent.click(container.querySelector('svg'), {
      clientX: 25,
      clientY: 25,
    });
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });
    rerender(<StagedPageGridEditor {...propsFor({ page: 1 })} />);
    expect(onSelectedMergedCellChange).toHaveBeenLastCalledWith(null);
  });

  // ---- tables joined under a root's grid ---------------------------------------------
  //
  // A saved link grid moves the joined tables off the top-level list and into the root's
  // `next`, so both the lookup that finds the selected table and the commit that writes an
  // edit back have to reach in there.

  // Beta joined under Alpha: only Alpha is in the top-level list.
  const joinedPair = () => [
    { ...alpha(), grid: [['t1', 't2']], next: { t2: beta() } },
  ];

  it('selects a table joined under a root, not the root it is joined to', async () => {
    await renderLoaded(
      baseProps({ metadataTables: joinedPair(), selectedTableId: 't2' })
    );
    const label = await screen.findByTestId('selected-label');
    expect(label).toHaveTextContent('Beta');
  });

  it('commits an edit to a joined table back inside its root', async () => {
    const onEditTables = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        metadataTables: joinedPair(),
        selectedTableId: 't2',
        mode: 'border',
        onEditTables,
      })
    );
    // Beta spans [0.3..0.4]: its right edge is at screen x 400. Drag it out to 0.42.
    const hitLines = container.querySelectorAll('[data-testid="hit-line"]');
    fireEvent.mouseDown(hitLines[1], { clientX: 400, clientY: 350 });
    fireEvent.mouseMove(window, { clientX: 420, clientY: 350 });
    fireEvent.mouseUp(window, { clientX: 420, clientY: 350 });

    expect(onEditTables).toHaveBeenCalled();
    const list = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    // The top level still holds the root alone, with the edit inside its `next`.
    expect(list.map((t) => t.tableId)).toEqual(['t1']);
    expect(list[0].next.t2.bounds.width).toBeCloseTo(0.12, 5);
    expect(list[0].grid).toEqual([['t1', 't2']]);
  });

  // Rows is one of the layers a joined table keeps, so its Options actions have to find
  // the table in `next` as well as commit back into it.
  it('runs a Rows action on a joined table and writes it back inside its root', async () => {
    const onEditTables = jest.fn();
    let rowsAction;
    await renderLoaded(
      baseProps({
        metadataTables: joinedPair(),
        selectedTableId: 't2',
        mode: 'rows',
        onEditTables,
        onRequestRowsAction: (fn) => {
          rowsAction = fn;
        },
      })
    );
    // Beta is a single row, so "Add row" half-splits it into two.
    act(() => {
      rowsAction('addRow');
    });

    const list = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(list.map((t) => t.tableId)).toEqual(['t1']);
    expect(list[0].next.t2.rowHeights).toHaveLength(2);
    // The root it is joined to is untouched.
    expect(list[0].rowHeights).toHaveLength(2);
  });

  // ---- locked (the selected table is amalgamated into a grid of tables) --------------
  //
  // The host locks the Colours, Borders and Columns modes of such a table. Each stays
  // drawn — the geometry is still worth seeing — but carries no hit lines, so there is
  // nothing to drag, select or pick.

  it('locked border mode: draws the border with no draggable edges', async () => {
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1', mode: 'border', locked: true })
    );
    expect(container.querySelectorAll('[data-testid="hit-line"]')).toHaveLength(
      0
    );
    // The border itself is still there.
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('locked columns mode: draws the column lines but none of their hit lines', async () => {
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1', mode: 'columns', locked: true })
    );
    expect(
      container.querySelectorAll('[data-testid="column-line"]').length
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-testid="column-hit-line"]')
    ).toHaveLength(0);
  });

  it('unlocked columns mode still carries its hit lines', async () => {
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1', mode: 'columns' })
    );
    expect(
      container.querySelectorAll('[data-testid="column-hit-line"]').length
    ).toBeGreaterThan(0);
  });

  it('locked colours mode: draws each area without its resize sides', async () => {
    const colouredAreas = [{ left: 0, top: 0, width: 0.2, height: 0.2 }];
    await renderLoaded(
      baseProps({ mode: 'colours', locked: true, colouredAreas })
    );
    expect(screen.getByTestId('coloured-area-0')).toBeInTheDocument();
    expect(screen.queryByTestId('coloured-side-0-left')).toBeNull();
  });

  it('locked colours mode: an Add drag draws no rubber-band and adds nothing', async () => {
    const onColouredAreasChange = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        locked: true,
        colourAddMode: true,
        colouredAreas: [],
        onColouredAreasChange,
      })
    );
    const svg = container.querySelector('svg');
    fireEvent.mouseDown(svg, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 300 });
    expect(screen.queryByTestId('coloured-create-preview')).toBeNull();
    expect(onColouredAreasChange).not.toHaveBeenCalled();
  });

  // Reading an area's colours is not editing, so a click still selects one — but with a
  // swatch armed it must not sample a pixel.
  it('locked colours mode: a click selects an area but never picks a colour', async () => {
    const onSelectColouredArea = jest.fn();
    const onColourPicked = jest.fn();
    const { container } = await renderLoaded(
      baseProps({
        mode: 'colours',
        locked: true,
        colouredAreas: [{ left: 0, top: 0, width: 0.2, height: 0.2 }],
        selectedColouredIndex: 0,
        colourPickMode: 'foreground',
        onSelectColouredArea,
        onColourPicked,
      })
    );
    fireEvent.click(container.querySelector('svg'), {
      clientX: 100,
      clientY: 100,
    });
    expect(onSelectColouredArea).toHaveBeenCalledWith(0);
    expect(onColourPicked).not.toHaveBeenCalled();
  });

  it('deletes the table immediately via onRequestDelete', async () => {
    const onEditTables = jest.fn();
    let triggerDelete;
    await renderLoaded(
      baseProps({
        selectedTableId: 't1',
        onEditTables,
        onRequestDelete: (fn) => {
          triggerDelete = fn;
        },
      })
    );
    expect(typeof triggerDelete).toBe('function');
    act(() => {
      triggerDelete('t1');
    });
    expect(screen.queryByTestId('confirm-delete')).not.toBeInTheDocument();
    expect(onEditTables).toHaveBeenCalled();
    const lastList = onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
    expect(lastList.find((t) => t.tableId === 't1').deleted).toBe(true);
  });
});
