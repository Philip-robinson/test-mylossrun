import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { StagedPageGridEditor } from 'components/pdfTableViewer/StagedPageGridEditor';
import toast from 'react-hot-toast';
import {
  documentDimOpacity,
  layerColumnsColour,
  layerGrey,
  layerRowsColour,
  sectionTitlePlaceholderColumnName,
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
    editorMode: 'border',
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
  // Alpha spans page fractions [0..0.1] on both axes with two 0.05 rows and two 0.05
  // columns, so on the mocked 100x100 image its internal dividers sit at screen 50 and a
  // click at (25, 25) lands in row 0, column 0.
  const gridProps = (overrides = {}) =>
    baseProps({ editorMode: 'grid', selectedTableId: 't1', ...overrides });

  const lastList = (onEditTables) =>
    onEditTables.mock.calls[onEditTables.mock.calls.length - 1][0];
  const editedAlpha = (onEditTables) =>
    lastList(onEditTables).find((t) => t.tableId === 't1');

  describe('scaffold', () => {
    it('renders the <img>, and the overlay SVG only after the image load', async () => {
      const { container } = render(<StagedPageGridEditor {...baseProps()} />);
      expect(container.querySelector('img')).not.toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      loadImage(container.querySelector('img'));
      await waitFor(() =>
        expect(container.querySelector('svg')).not.toBeNull()
      );
    });

    it('renders the dim layer with the configured opacity only when dim is true', async () => {
      await renderLoaded(baseProps({ dim: true }));
      expect(screen.getByTestId('dim-layer')).toHaveStyle({
        backgroundColor: `rgba(255, 255, 255, ${documentDimOpacity()})`,
      });
    });

    it('shows the selected table label (name + cols × rows)', async () => {
      await renderLoaded(baseProps({ selectedTableId: 't1' }));
      expect(screen.getByTestId('selected-label-name')).toHaveTextContent('Alpha');
      expect(screen.getByTestId('selected-label-size')).toHaveTextContent('2 × 2');
    });

    it('calls onSelectTable with the id of a clicked table', async () => {
      const onSelectTable = jest.fn();
      const { container } = await renderLoaded(baseProps({ onSelectTable }));
      fireEvent.click(container.querySelector('svg'), {
        clientX: 350,
        clientY: 350,
      });
      expect(onSelectTable).toHaveBeenCalledWith('t2');
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
      act(() => {
        triggerDelete('t1');
      });
      expect(editedAlpha(onEditTables).deleted).toBe(true);
    });
  });

  describe('borderMode', () => {
    it('draws the boundary with its four draggable edges', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      expect(
        container.querySelectorAll('[data-testid="hit-line"]')
      ).toHaveLength(4);
    });

    it('draws no grid lines and no special areas, whatever the flags hold', async () => {
      const table = {
        ...alpha(),
        headerCount: 1,
        sectionTitles: [
          { tableRow: 1, delete: true, columnName: null, data: null },
        ],
      };
      await renderLoaded(
        baseProps({
          selectedTableId: 't1',
          metadataTables: [table, beta()],
          colouredAreas: [{ left: 0.5, top: 0.5, width: 0.1, height: 0.1 }],
        })
      );
      expect(screen.queryByTestId('row-line')).toBeNull();
      expect(screen.queryByTestId('column-line')).toBeNull();
      expect(screen.queryByTestId('header-rect')).toBeNull();
      expect(screen.queryByTestId('coloured-area-0')).toBeNull();
    });

    it('dragging the right edge outward widens the selected table', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1', onEditTables })
      );
      const hitLines = container.querySelectorAll('[data-testid="hit-line"]');
      fireEvent.mouseDown(hitLines[1], { clientX: 100, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 120, clientY: 50 });
      fireEvent.mouseUp(window, { clientX: 120, clientY: 50 });
      expect(editedAlpha(onEditTables).bounds.width).toBeCloseTo(0.12, 6);
    });

    it('a rubber-band drag in empty space adds a 1x1 MANUAL table', async () => {
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
      act(() => {
        triggerCreate();
      });
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
      fireEvent.mouseMove(window, { clientX: 700, clientY: 700 });
      fireEvent.mouseUp(window, { clientX: 700, clientY: 700 });

      const created = lastList(onEditTables).find(
        (t) => t.tableId === onCreatedTable.mock.calls[0][0]
      );
      expect(created.extractionMechanism).toBe('MANUAL');
      expect(created.confirmationStage).toBeNull();
    });
  });

  describe('gridMode rendering', () => {
    const specialTable = () => ({
      ...alpha(),
      headerCount: 1,
      sectionTitles: [
        { tableRow: 1, delete: true, columnName: null, data: null },
      ],
    });

    it('freezes the boundary: the rect is drawn but nothing can be dragged', async () => {
      const { container } = await renderLoaded(gridProps());
      expect(
        container.querySelectorAll('[data-testid="hit-line"]')
      ).toHaveLength(0);
    });

    it('draws each axis in its layer colour when that layer is on', async () => {
      await renderLoaded(gridProps());
      expect(screen.getByTestId('row-line').style.stroke).toBe(layerRowsColour());
      expect(screen.getByTestId('column-line').style.stroke).toBe(
        layerColumnsColour()
      );
    });

    it('greys the horizontal dividers alone when the Rows layer is off', async () => {
      await renderLoaded(
        gridProps({
          layerVisibility: { rows: false, columns: true, special: true, colours: true },
        })
      );
      expect(screen.getByTestId('row-line').style.stroke).toBe(layerGrey());
      expect(screen.getByTestId('column-line').style.stroke).toBe(
        layerColumnsColour()
      );
    });

    it('greys the vertical dividers alone when the Columns layer is off', async () => {
      await renderLoaded(
        gridProps({
          layerVisibility: { rows: true, columns: false, special: true, colours: true },
        })
      );
      expect(screen.getByTestId('column-line').style.stroke).toBe(layerGrey());
      expect(screen.getByTestId('row-line').style.stroke).toBe(layerRowsColour());
    });

    it('draws the header, the section-title rows and the coloured areas when Special is on', async () => {
      await renderLoaded(
        gridProps({
          metadataTables: [specialTable(), beta()],
          colouredAreas: [{ left: 0.5, top: 0.5, width: 0.1, height: 0.1 }],
        })
      );
      expect(screen.getByTestId('header-rect')).toBeInTheDocument();
      expect(screen.getByTestId('coloured-area-0')).toBeInTheDocument();
      expect(screen.getAllByTestId('section-title-0').length).toBeGreaterThan(0);
    });

    it('draws none of them when Special is off', async () => {
      await renderLoaded(
        gridProps({
          metadataTables: [specialTable(), beta()],
          colouredAreas: [{ left: 0.5, top: 0.5, width: 0.1, height: 0.1 }],
          layerVisibility: { rows: true, columns: true, special: false, colours: true },
        })
      );
      expect(screen.queryByTestId('header-rect')).toBeNull();
      expect(screen.queryByTestId('coloured-area-0')).toBeNull();
      expect(screen.queryAllByTestId('section-title-0')).toHaveLength(0);
    });

    it('draws the header while the Header tool is armed even with Special off, and suppresses the rest', async () => {
      await renderLoaded(
        gridProps({
          metadataTables: [specialTable(), beta()],
          colouredAreas: [{ left: 0.5, top: 0.5, width: 0.1, height: 0.1 }],
          layerVisibility: { rows: true, columns: true, special: false, colours: true },
          tool: 'special',
          specialTool: 'header',
        })
      );
      expect(screen.getByTestId('header-rect')).toBeInTheDocument();
      expect(screen.queryAllByTestId('section-title-0')).toHaveLength(0);
      expect(screen.queryByTestId('coloured-area-0')).toBeNull();
    });

    it('never draws a title rectangle or a merged-cell block', async () => {
      const withTitleAndMerge = {
        ...alpha(),
        title: {
          bounds: { left: 0, top: 0.2, width: 0.1, height: 0.02 },
          text: 'T',
          confidence: 90,
        },
        cells: alpha().cells.map((c, i) =>
          i === 0 ? { ...c, columnSpan: 2 } : c
        ),
      };
      await renderLoaded(
        gridProps({ metadataTables: [withTitleAndMerge, beta()] })
      );
      expect(screen.queryByTestId('title-rect')).toBeNull();
      expect(screen.queryByTestId('merged-cell-0')).toBeNull();
    });

    it('moves a grid line while no tool is armed', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });
      expect(editedAlpha(onEditTables).rowHeights[0].value).toBeCloseTo(0.07, 5);
    });
  });

  describe('the Rows tool', () => {
    it('deletes the divider a click lands on, keeping the cells above', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'rows', onEditTables }));
      fireEvent.click(screen.getByTestId('row-hit-line'));
      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights).toHaveLength(1);
      expect(edited.rowHeights[0].value).toBeCloseTo(0.1, 6);
    });

    it('adds a divider exactly where the click landed, not half way', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      // Row 0 spans fractions 0..0.05; a click at screen y 10 is fraction 0.01.
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 10,
      });
      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights).toHaveLength(3);
      expect(edited.rowHeights[0].value).toBeCloseTo(0.01, 6);
      expect(edited.rowHeights[1].value).toBeCloseTo(0.04, 6);
      // The table itself is unchanged: the two parts occupy the old row's span.
      expect(edited.bounds.height).toBeCloseTo(0.1, 6);
    });

    it('splits the row the click fell in, not the first one', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      // Row 1 spans fractions 0.05..0.1; a click at screen y 90 is fraction 0.09.
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 90,
      });
      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights.map((r) => r.value)).toEqual([
        expect.closeTo(0.05, 6),
        expect.closeTo(0.04, 6),
        expect.closeTo(0.01, 6),
      ]);
    });

    it('does not drag a divider while it is armed', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'rows', onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });
      const moved = onEditTables.mock.calls.some(
        ([list]) =>
          list.find((t) => t.tableId === 't1').rowHeights[0].value !== 0.05
      );
      expect(moved).toBe(false);
    });

    it('edits nothing when the click falls outside the table', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 800,
        clientY: 800,
      });
      expect(onEditTables).not.toHaveBeenCalled();
    });
  });

  describe('the Columns tool', () => {
    it('deletes the divider a click lands on, keeping the cells to the left', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'columns', onEditTables }));
      fireEvent.click(screen.getByTestId('column-hit-line'));
      expect(editedAlpha(onEditTables).columnWidths).toHaveLength(1);
    });

    it('adds a divider exactly where the click landed, not half way', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'columns', onEditTables })
      );
      // Column 0 spans fractions 0..0.05; a click at screen x 10 is fraction 0.01.
      fireEvent.click(container.querySelector('svg'), {
        clientX: 10,
        clientY: 25,
      });
      const edited = editedAlpha(onEditTables);
      expect(edited.columnWidths).toHaveLength(3);
      expect(edited.columnWidths[0].value).toBeCloseTo(0.01, 6);
      expect(edited.columnWidths[1].value).toBeCloseTo(0.04, 6);
      expect(edited.bounds.width).toBeCloseTo(0.1, 6);
    });
  });

  describe('the Special tool', () => {
    it('Header: a click makes the clicked row the last header row', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'special', specialTool: 'header', onEditTables })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(editedAlpha(onEditTables).headerCount).toBe(2);
    });

    it('Hide Row: a click hides the row, and a second click un-hides it', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'special', specialTool: 'hideRow', onEditTables })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(editedAlpha(onEditTables).sectionTitles).toEqual([
        { tableRow: 1, delete: true, columnName: null, data: null },
      ]);

      const hidden = {
        ...alpha(),
        sectionTitles: [
          { tableRow: 1, delete: true, columnName: null, data: null },
        ],
      };
      const onEditAgain = jest.fn();
      const second = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'hideRow',
          metadataTables: [hidden, beta()],
          onEditTables: onEditAgain,
        })
      );
      fireEvent.click(second.container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(editedAlpha(onEditAgain).sectionTitles).toEqual([]);
    });

    it('Section Title Row: a drag names the nearest row with the placeholder column', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'special', specialTool: 'sectionTitle', onEditTables })
      );
      const svg = container.querySelector('svg');
      // Drag inside row 1 (screen y 50..100), which is the row nearest the drawn centre.
      fireEvent.mouseDown(svg, { clientX: 10, clientY: 60 });
      fireEvent.mouseMove(window, { clientX: 60, clientY: 90 });
      fireEvent.mouseUp(window, { clientX: 60, clientY: 90 });

      const [entry] = editedAlpha(onEditTables).sectionTitles;
      expect(entry.tableRow).toBe(1);
      expect(entry.delete).toBe(false);
      expect(entry.columnName).toBe(sectionTitlePlaceholderColumnName());
      expect(entry.data.bounds.left).toBeCloseTo(0.01, 6);
      expect(entry.data.bounds.height).toBeCloseTo(0.03, 6);
    });

    it('Section Title Row: a click on an existing entry removes it', async () => {
      const withEntry = {
        ...alpha(),
        sectionTitles: [
          {
            tableRow: 1,
            delete: false,
            columnName: 'X',
            data: {
              bounds: { left: 0, top: 0.05, width: 0.05, height: 0.05 },
              text: null,
              confidence: null,
            },
          },
        ],
      };
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'sectionTitle',
          metadataTables: [withEntry, beta()],
          onEditTables,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(editedAlpha(onEditTables).sectionTitles).toEqual([]);
    });
  });

  describe('the coloured-area tools', () => {
    it('Coloured Rows: a click adds the row to the pending selection', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          pendingSelection: null,
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(onPendingSelectionChange).toHaveBeenCalledWith({
        kind: 'rows',
        rows: [1],
        columns: [],
        rect: null,
      });
    });

    it('Coloured Rows: clicking a pending row takes it out again', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          pendingSelection: { kind: 'rows', rows: [1], columns: [], rect: null },
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(onPendingSelectionChange).toHaveBeenCalledWith({
        kind: null,
        rows: [],
        columns: [],
        rect: null,
      });
    });

    it('Coloured Rows: a pending row is drawn as a wash', async () => {
      await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          pendingSelection: { kind: 'rows', rows: [1], columns: [], rect: null },
        })
      );
      expect(screen.getByTestId('pending-row-1')).toBeInTheDocument();
    });

    it('Coloured Columns: a click adds the column to the pending selection', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredColumns',
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 75,
        clientY: 25,
      });
      expect(onPendingSelectionChange).toHaveBeenCalledWith({
        kind: 'columns',
        rows: [],
        columns: [1],
        rect: null,
      });
    });

    it('Coloured Area: a drag reports the drawn rectangle', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredArea',
          onPendingSelectionChange,
        })
      );
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 260 });
      fireEvent.mouseUp(window, { clientX: 300, clientY: 260 });

      const reported =
        onPendingSelectionChange.mock.calls[
          onPendingSelectionChange.mock.calls.length - 1
        ][0];
      expect(reported.kind).toBe('area');
      expect(reported.rect.left).toBeCloseTo(0.2, 6);
      expect(reported.rect.width).toBeCloseTo(0.1, 6);
    });

    it('seeds the draft colours from the pixels under a new selection', async () => {
      const onColourSeed = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          onColourSeed,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      // Under jsdom the sample is empty, so analysePeakColours returns its defaults.
      expect(onColourSeed).toHaveBeenCalledWith({
        foreground: '#000000',
        background: '#ffffff',
      });
    });

    it('a click inside a saved area selects it rather than picking a row', async () => {
      const onSelectColouredArea = jest.fn();
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          colouredAreas: [{ left: 0, top: 0.05, width: 0.1, height: 0.05 }],
          onSelectColouredArea,
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(onSelectColouredArea).toHaveBeenCalledWith(0);
      expect(onPendingSelectionChange).not.toHaveBeenCalled();
    });

    it('with a swatch armed, a click samples that pixel and changes no selection', async () => {
      const onColourPicked = jest.fn();
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredRows',
          colourPickMode: 'foreground',
          onColourPicked,
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(onPendingSelectionChange).not.toHaveBeenCalled();
    });
  });

  describe('tables joined under a root', () => {
    // A saved link grid moves the joined tables off the top-level list and into the
    // root's `next`, so both the lookup and the commit have to reach in there.
    const joinedPair = () => [
      { ...alpha(), grid: [['t1', 't2']], next: { t2: beta() } },
    ];

    it('selects a table joined under a root, not the root it is joined to', async () => {
      await renderLoaded(
        baseProps({ metadataTables: joinedPair(), selectedTableId: 't2' })
      );
      expect(await screen.findByTestId('selected-label')).toHaveTextContent('Beta');
    });

    it('commits an edit to a joined table back inside its root', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        baseProps({
          metadataTables: joinedPair(),
          selectedTableId: 't2',
          onEditTables,
        })
      );
      const hitLines = container.querySelectorAll('[data-testid="hit-line"]');
      fireEvent.mouseDown(hitLines[1], { clientX: 400, clientY: 350 });
      fireEvent.mouseMove(window, { clientX: 420, clientY: 350 });
      fireEvent.mouseUp(window, { clientX: 420, clientY: 350 });

      const list = lastList(onEditTables);
      expect(list.map((t) => t.tableId)).toEqual(['t1']);
      expect(list[0].next.t2.bounds.width).toBeCloseTo(0.12, 5);
    });

    it('runs a Rows tool edit on a joined table and writes it back inside its root', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        baseProps({
          metadataTables: joinedPair(),
          selectedTableId: 't2',
          editorMode: 'grid',
          tool: 'rows',
          onEditTables,
        })
      );
      // Beta spans [0.3..0.4]: a click at (350, 350) is inside its single row.
      fireEvent.click(container.querySelector('svg'), {
        clientX: 350,
        clientY: 350,
      });
      const list = lastList(onEditTables);
      expect(list.map((t) => t.tableId)).toEqual(['t1']);
      expect(list[0].next.t2.rowHeights).toHaveLength(2);
    });
  });
});
