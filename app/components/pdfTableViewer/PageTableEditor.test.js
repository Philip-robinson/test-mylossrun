import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import PageTableEditor from 'components/pdfTableViewer/PageTableEditor';
import { makeDefaultCell } from 'components/pdfTableViewer/tableSupportUtils';
import {
  LAYER_KEY_ORDER,
  layerKeyForStage,
} from 'components/pdfTableViewer/layerUtils';
import {
  getImage,
  getThumbnails,
  getMetadata,
  saveTables,
  findTables,
  findGridLines,
  calculateCells,
} from 'services/images';
import {
  stagedGridEditorEnabled,
  baseImageWidthPx,
  entryConfirmationStage,
} from 'config';
import toast from 'react-hot-toast';

// The checkbox belonging to one named Layers row. Named rather than indexed: only Special
// Areas has a tick, so a positional index would drift.
const tickFor = (label) =>
  within(
    screen.getByText(label).closest('[data-testid="layer-row"]'),
  ).getByRole('checkbox');

// Select a Layers row by its label. Every row is selectable now, whatever the stage — and
// selecting one is what fires the grid-lines rebuild owed by the layer being left.
const selectLayerRow = (label) => fireEvent.click(screen.getByText(label));

jest.mock('services/images', () => ({
  getImage: jest.fn(),
  getThumbnails: jest.fn(),
  getMetadata: jest.fn(),
  saveTables: jest.fn(),
  getTableImages: jest.fn(),
  findTables: jest.fn(),
  findGridLines: jest.fn(),
  calculateCells: jest.fn(),
}));

// Mock only the editor-selection flag; every other config value (colours, sizes,
// debounce windows, scale options) is the real one so the toolbar / panel / staged
// editor behave as in production. The flag is set per test; the default (below,
// beforeEach) is false so the pre-existing flag-off tests keep exercising the
// legacy PageImageWithOverlay branch.
jest.mock('config', () => {
  const actual = jest.requireActual('config');
  return {
    __esModule: true,
    ...actual,
    stagedGridEditorEnabled: jest.fn(() => false),
  };
});

// Capture the props StagedPageGridEditor is rendered with so the flag-on wiring
// (mode / dim / geometry) can be asserted without driving the real canvas.
const mockStagedProps = jest.fn();
jest.mock('components/pdfTableViewer/StagedPageGridEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props) => {
      mockStagedProps(props);
      return React.createElement('div', { 'data-testid': 'staged-editor' });
    },
  };
});

// Messages use react-hot-toast; the <Toaster/> lives in the app layout, not this
// component, so assert on the mocked calls rather than rendered DOM text.
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.dismiss = jest.fn();
  return { __esModule: true, default: toast };
});

const PDF_ID = 'test-pdf-id';
const DEFAULT_PANE_WIDTH = 400;

// A single-cell (1×1) editable table at viewbox 0..40, joined to its own cell so a click
// inside it can open the cell editor.
const TABLE_A = {
  tableId: 'A',
  name: 'Alpha',
  pdfPage: 0,
  tableInPage: 0,
  bounds: { left: 0, top: 0, width: 0.04, height: 0.04 },
  columnWidths: [{ value: 0.04, confidence: 90 }],
  rowHeights: [{ value: 0.04, confidence: 90 }],
  cells: [makeDefaultCell(0, 0, { left: 0, top: 0, width: 0.04, height: 0.04 })],
};

// A second 1×1 table, on the same page but well clear of A (viewbox 50..90).
const TABLE_B = {
  tableId: 'B',
  name: 'Beta',
  pdfPage: 0,
  tableInPage: 1,
  bounds: { left: 0.05, top: 0, width: 0.04, height: 0.04 },
  columnWidths: [{ value: 0.04, confidence: 90 }],
  rowHeights: [{ value: 0.04, confidence: 90 }],
  cells: [
    makeDefaultCell(0, 0, { left: 0.05, top: 0, width: 0.04, height: 0.04 }),
  ],
};

// A three-column, two-row editable table for boundary-drag geometry edits.
const EDITABLE = {
  tableId: 't-1',
  name: 'T',
  pdfPage: 0,
  tableInPage: 0,
  bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
  columnWidths: [
    { value: 0.03, confidence: 90 },
    { value: 0.03, confidence: 90 },
    { value: 0.04, confidence: 90 },
  ],
  rowHeights: [
    { value: 0.05, confidence: 90 },
    { value: 0.05, confidence: 90 },
  ],
};

// A border-only 1×1 table whose right edge sits at viewbox x=100 (fraction 0.1).
const BORDER_1X1 = {
  tableId: 't-1',
  name: 'T',
  pdfPage: 0,
  tableInPage: 0,
  bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
  columnWidths: [{ value: 0.1, confidence: 100 }],
  rowHeights: [{ value: 0.1, confidence: 100 }],
  cells: [makeDefaultCell(0, 0, { left: 0, top: 0, width: 0.1, height: 0.1 })],
};

function metadataWith(tables, name = 'losses.pdf') {
  return { pdfId: PDF_ID, name, pages: [{ page: 0, tables: [] }], tables };
}

function imageFixture(page) {
  return {
    image: `PAGE${page}`,
    dpi: 100,
    pixelWidth: 1000,
    pixelHeight: 1000,
    height: 10,
    width: 10,
  };
}

// Fire the load event on an <img> with mocked natural dimensions so the SVG overlay
// (gated on onLoad) renders.
function loadImage(img, { w = 100, h = 100 } = {}) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
  fireEvent.load(img);
}

// The overlay draws its hit lines per table in a fixed order: boundary-left,
// boundary-right, boundary-top, boundary-bottom, then internal dividers.
const BOUNDARY = { left: 0, right: 1, top: 2, bottom: 3 };

function hitLines(middle) {
  return middle.querySelectorAll('[data-testid="hit-line"]');
}

// Drag a boundary edge: mouse-down on its hit line, one move on window to the target,
// then release. Mouse family (not pointer) because jsdom's PointerEvents do not carry
// clientX; the component listens on window with mousemove/up.
function dragBoundary(middle, which, { toX, toY, fromX = 0, fromY = 0 }) {
  const line = hitLines(middle)[BOUNDARY[which]];
  fireEvent.mouseDown(line, { clientX: fromX, clientY: fromY });
  fireEvent.mouseMove(window, { clientX: toX, clientY: toY });
  fireEvent.mouseUp(window, { clientX: toX, clientY: toY });
}

// Sub-threshold click (no drag) on a boundary edge: opens its menu.
function clickBoundary(middle, which, { x, y }) {
  const line = hitLines(middle)[BOUNDARY[which]];
  fireEvent.mouseDown(line, { clientX: x, clientY: y });
  fireEvent.mouseUp(window, { clientX: x, clientY: y });
}

beforeEach(() => {
  jest.clearAllMocks();

  // Default to the legacy interactive editor; flag-on tests opt in explicitly.
  stagedGridEditorEnabled.mockReturnValue(false);

  // First measurement is synchronous, so a no-op observer suffices for non-resize tests.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Report a positive container width so measuredWidth becomes > 0.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function () {
      return {
        width: DEFAULT_PANE_WIDTH,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      };
    },
  });

  getImage.mockImplementation((pdfId, page) =>
    Promise.resolve(imageFixture(page))
  );

  toast.mockClear();
  toast.error.mockClear();
  toast.dismiss.mockClear();
});

// Render the editor, load a 1:1 100x100 image (screen px == viewbox px), and stub the
// img's getBoundingClientRect to a 100x100 box at the origin. With pixelWidth/Height 1000
// a fraction f maps to viewbox f*1000, i.e. a pointer at viewbox x=60 is fraction 0.06.
async function renderEditor(props = {}) {
  const merged = {
    metadata: metadataWith([TABLE_A]),
    page: 0,
    onChange: jest.fn(),
    ...props,
  };
  const view = render(<PageTableEditor {...merged} />);
  const middle = await screen.findByTestId('middle-image');
  const img = middle.querySelector('img');
  Object.defineProperty(img, 'getBoundingClientRect', {
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
  loadImage(img, { w: 100, h: 100 });
  await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());
  return { ...view, middle, img };
}

describe('PageTableEditor', () => {
  test('fetches the page image with (pdfId, page, round(width*0.95)) on mount', async () => {
    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await waitFor(() => expect(getImage).toHaveBeenCalled());
    expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, Math.round(400 * 0.95));
  });

  test('title bar shows the name before load and name — Page N after', async () => {
    let resolveImage;
    getImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImage = () => resolve(imageFixture(0));
        })
    );

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    const bar = await screen.findByTestId('middle-title-bar');
    // Before the image resolves, only the document name is shown.
    expect(bar.textContent).toBe('losses.pdf');

    await act(async () => {
      resolveImage();
    });

    await waitFor(() =>
      expect(bar).toHaveTextContent('losses.pdf — Page 1')
    );
  });

  test('shows the loading overlay while the image is in flight, then hides it', async () => {
    let resolveImage;
    getImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImage = () => resolve(imageFixture(0));
        })
    );

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    expect(
      await screen.findByTestId('image-loading-overlay')
    ).toBeInTheDocument();

    await act(async () => {
      resolveImage();
    });

    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  test('renders middle-image once the image loads', async () => {
    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    const middle = await screen.findByTestId('middle-image');
    await waitFor(() =>
      expect(middle.querySelector('img')).toHaveAttribute(
        'src',
        'data:image/png;base64,PAGE0'
      )
    );
  });

  test('in-flight race guard: a superseded page response never overwrites the current page', async () => {
    const deferred = [];
    getImage.mockImplementation(
      (pdfId, page) =>
        new Promise((resolve) => {
          deferred.push({ page, resolve });
        })
    );

    const metadata = metadataWith([TABLE_A]);
    const { rerender } = render(
      <PageTableEditor metadata={metadata} page={0} onChange={jest.fn()} />
    );
    await waitFor(() => expect(deferred.length).toBe(1));

    // Switch to page 1 while page 0's request is still pending.
    rerender(
      <PageTableEditor metadata={metadata} page={1} onChange={jest.fn()} />
    );
    await waitFor(() => expect(deferred.length).toBe(2));

    // Resolve page 1 first, then the superseded page 0 late.
    await act(async () => {
      deferred[1].resolve(imageFixture(1));
    });
    await act(async () => {
      deferred[0].resolve(imageFixture(0));
    });

    const middle = await screen.findByTestId('middle-image');
    expect(middle.querySelector('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,PAGE1'
    );
  });

  test('a geometry edit calls onChange with the updated tables list and renders no Save button', async () => {
    const onChange = jest.fn();
    const { middle } = await renderEditor({
      metadata: metadataWith([EDITABLE]),
      onChange,
    });

    // Right edge at viewbox x=100 (fraction 0.1); drag out to x=120 (fraction 0.12).
    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 120, toY: 50 });

    expect(onChange).toHaveBeenCalled();
    const nextTables = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Array.isArray(nextTables)).toBe(true);
    const edited = nextTables.find((t) => t.tableId === 't-1');
    expect(edited.bounds.width).toBeCloseTo(0.12, 10);

    // The editor renders no Save button and never persists.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(saveTables).not.toHaveBeenCalled();
    expect(getMetadata).not.toHaveBeenCalled();
    expect(getThumbnails).not.toHaveBeenCalled();
  });

  test('tableId restriction: only the named table is editable', async () => {
    const onHoverTable = jest.fn();
    const { middle } = await renderEditor({
      metadata: metadataWith([TABLE_A, TABLE_B]),
      tableId: 'A',
      onHoverTable,
    });

    // Only A (a 1×1 table) draws hit lines: its four boundary edges. B draws none.
    expect(hitLines(middle)).toHaveLength(4);

    const svg = middle.querySelector('svg');

    // A click inside B (viewbox x=70) opens no cell editor.
    fireEvent.click(svg, { clientX: 70, clientY: 20 });
    expect(screen.queryByTestId('cell-editor')).toBeNull();

    // B shows no confidence squares; A does.
    expect(screen.queryByTestId('confidence-square-B-0-0')).toBeNull();
    expect(screen.getByTestId('confidence-square-A-0-0')).toBeInTheDocument();

    // Hovering B shows the locked hover label with text "Locked".
    const overlayBox = middle.querySelector('img').parentElement;
    fireEvent.mouseMove(overlayBox, { clientX: 70, clientY: 20 });
    await waitFor(() =>
      expect(screen.getByTestId('hover-label-locked')).toHaveTextContent('Locked')
    );

    // A click inside A (viewbox x=20) DOES open the editor.
    fireEvent.click(svg, { clientX: 20, clientY: 20 });
    expect(await screen.findByTestId('cell-editor')).toBeInTheDocument();
  });

  test('with tableId omitted, non-linked tables stay editable', async () => {
    const { middle } = await renderEditor({
      metadata: metadataWith([TABLE_A, TABLE_B]),
    });

    // Both 1×1 tables draw their four boundary hit lines: 8 in total.
    expect(hitLines(middle)).toHaveLength(8);
    // Both tables' confidence squares are present.
    expect(screen.getByTestId('confidence-square-A-0-0')).toBeInTheDocument();
    expect(screen.getByTestId('confidence-square-B-0-0')).toBeInTheDocument();
  });

  test('deletedPreview: draws the preview when on-page, nothing when omitted or off-page', async () => {
    const preview = {
      tableId: 'del',
      name: 'Deleted',
      pdfPage: 0,
      bounds: { left: 0.5, top: 0.5, width: 0.1, height: 0.1 },
      columnWidths: [{ value: 0.1, confidence: 90 }],
      rowHeights: [{ value: 0.1, confidence: 90 }],
    };

    // On the displayed page -> preview drawn.
    const onPage = await renderEditor({
      metadata: metadataWith([TABLE_A]),
      deletedPreview: preview,
    });
    expect(onPage.middle.querySelector('[data-testid="deleted-preview"]')).not.toBeNull();
    onPage.unmount();

    // Omitted -> nothing.
    const omitted = await renderEditor({ metadata: metadataWith([TABLE_A]) });
    expect(
      omitted.middle.querySelector('[data-testid="deleted-preview"]')
    ).toBeNull();
    omitted.unmount();

    // On a different page -> nothing (filtered out by page).
    const offPage = await renderEditor({
      metadata: metadataWith([TABLE_A]),
      deletedPreview: { ...preview, pdfPage: 1 },
    });
    expect(
      offPage.middle.querySelector('[data-testid="deleted-preview"]')
    ).toBeNull();
  });

  test('onHoverTable reports the hovered table id and null on leave', async () => {
    const onHoverTable = jest.fn();
    const { middle } = await renderEditor({
      metadata: metadataWith([TABLE_A]),
      onHoverTable,
    });
    const overlayBox = middle.querySelector('img').parentElement;

    // Pointer inside A's area (viewbox 0..40) -> reports A's id.
    fireEvent.mouseMove(overlayBox, { clientX: 20, clientY: 20 });
    await waitFor(() => expect(onHoverTable).toHaveBeenCalledWith('A'));

    // Leaving the overlay -> reports null.
    fireEvent.mouseLeave(overlayBox);
    await waitFor(() =>
      expect(onHoverTable).toHaveBeenLastCalledWith(null)
    );
  });

  test('action-busy overlay: a Calculate poll shows the overlay via onActionBusyChange', async () => {
    let resolveFind;
    findTables.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );

    const { middle } = await renderEditor({
      metadata: metadataWith([BORDER_1X1]),
    });

    // The initial page image has loaded, so no overlay is showing.
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();

    // Open the border table's boundary menu and start a Calculate.
    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    // The shared loading overlay appears while the find-tables poll is in flight.
    await screen.findByTestId('image-loading-overlay');

    // Resolving the poll clears the overlay.
    await act(async () => {
      resolveFind({ tables: [{ ...BORDER_1X1, tableId: 'backend-id' }] });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });
});

describe('PageTableEditor — staged grid editor selection (config flag)', () => {
  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  test('flag OFF: renders the legacy PageImageWithOverlay UI and no staged chrome', async () => {
    stagedGridEditorEnabled.mockReturnValue(false);

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('middle-image');
    expect(screen.queryByTestId('layers-panel')).toBeNull();
    expect(screen.queryByTestId('scale-value')).toBeNull();
    expect(screen.queryByTestId('dim-document-toggle')).toBeNull();
    expect(screen.queryByTestId('staged-editor')).toBeNull();
  });

  test('flag ON: renders the scale selector, dim toggle, LayersPanel and StagedPageGridEditor', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(screen.getByTestId('scale-value')).toBeInTheDocument();
    expect(screen.getByTestId('dim-document-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('layers-panel')).toBeInTheDocument();
  });

  test('flag ON: initial fetch is at 100% (base width), and a scale change refetches (debounced) at the mapped width', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    // Derive expected widths from config so the test tracks any base-width change.
    const base = baseImageWidthPx();
    const at150 = Math.round(base * 1.5);

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('staged-editor');
    // Initial load: 100% of the base width.
    await waitFor(() => expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, base));

    getImage.mockClear();

    // Zoom in one step: 100% -> 150%.
    fireEvent.click(screen.getByTestId('scale-zoom-in'));

    // Debounced: no immediate refetch.
    expect(getImage).not.toHaveBeenCalled();

    // After the debounce window the image is refetched at 150% of the base width.
    await waitFor(() => expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, at150));
  });

  test('flag ON: toggling Dim Document flips the dim prop reaching StagedPageGridEditor', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('staged-editor');
    // Dim defaults to on.
    expect(lastStagedProps().dim).toBe(true);

    fireEvent.click(screen.getByTestId('dim-document-toggle'));
    await waitFor(() => expect(lastStagedProps().dim).toBe(false));
  });

  test('flag ON: selecting a Layer row updates the mode passed to StagedPageGridEditor', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    // confirmationStage 4 opens the editor on the Columns row (row 4, the first un-ticked one).
    const table = { ...TABLE_A, confirmationStage: 4 };
    render(
      <PageTableEditor
        metadata={metadataWith([table])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    // Mounted layer follows the table's stage: stage 4 -> first un-ticked row is
    // Special Cells (row 5).
    expect(lastStagedProps().mode).toBe('special');

    // Rows are ordered Colours, Border, Rows, Columns, Special Cells.
    const rows = screen.getAllByTestId('layer-row');
    fireEvent.click(rows[3]);

    await waitFor(() => expect(lastStagedProps().mode).toBe('columns'));
  });

  test('flag ON: switching page selects the first un-ticked layer for the new table', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    // Page 0 table is fully confirmed (stage 5 -> last row, Special Cells); page 1 table
    // has only Colours confirmed (stage 1 -> first un-ticked is Border).
    const p0 = { ...TABLE_A, tableId: 'A', pdfPage: 0, confirmationStage: 5 };
    const p1 = { ...TABLE_A, tableId: 'B', pdfPage: 1, confirmationStage: 1 };
    const meta = {
      pdfId: PDF_ID,
      name: 'x.pdf',
      pages: [
        { page: 0, tables: [] },
        { page: 1, tables: [] },
      ],
      tables: [p0, p1],
    };
    const { rerender } = render(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    await waitFor(() => expect(lastStagedProps().mode).toBe('special'));

    rerender(
      <PageTableEditor
        metadata={meta}
        page={1}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );

    await waitFor(() => expect(lastStagedProps().mode).toBe('border'));
  });

  // ---- Amalgamated tables lock three of the five layers ------------------------------
  //
  // A table joined into a grid keeps the page colours, the outer border and the column
  // arrangement its join was built from. Those rows are padlocked and their editing is
  // switched off; Rows and Special Areas are worked on exactly as on any other table.

  // TABLE_A joined to TABLE_B: a two-column grid saved on the root.
  const AMALGAMATED = {
    ...TABLE_A,
    grid: [['A', 'B']],
    next: { B: TABLE_B },
  };

  const lockedRowLabels = () =>
    screen
      .getAllByTestId('layer-row')
      .filter((row) => within(row).queryByTestId('layer-lock') !== null)
      .map((row) => within(row).getAllByText(/./)[0].textContent);

  test('flag ON: an ordinary table padlocks no layer and shows an eye on each', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([TABLE_A])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(screen.queryByTestId('layer-lock')).toBeNull();
    expect(screen.getAllByTestId('layer-eye')).toHaveLength(4);
    expect(lastStagedProps().locked).toBe(false);
  });

  test('flag ON: an amalgamated table padlocks Colours, Borders and Columns only', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([AMALGAMATED])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(lockedRowLabels()).toEqual(['Colours', 'Borders', 'Columns']);
    // Rows keeps its eye; Special Areas keeps its tick.
    expect(screen.getAllByTestId('layer-eye')).toHaveLength(1);
    expect(tickFor('Special Areas')).toBeInTheDocument();
  });

  test('flag ON: the editor is told the mode is locked only on a locked row', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([AMALGAMATED])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');

    selectLayerRow('Columns');
    await waitFor(() => expect(lastStagedProps().mode).toBe('columns'));
    expect(lastStagedProps().locked).toBe(true);

    selectLayerRow('Rows');
    await waitFor(() => expect(lastStagedProps().mode).toBe('rows'));
    expect(lastStagedProps().locked).toBe(false);
  });

  // A joined table is not in the top-level list at all — it lives in the root's `next` —
  // so the panel has to read it back from there to have any table to work with.
  test('flag ON: a table joined under a root is found, padlocked, and named in the panel', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([AMALGAMATED])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );

    await screen.findByTestId('staged-editor');
    // The panel is working with Beta, not the root it is joined to.
    expect(screen.getByTestId('layers-table-name')).toHaveTextContent('Beta');
    expect(lockedRowLabels()).toEqual(['Colours', 'Borders', 'Columns']);
  });

  // The joined table carries its own confirmation stage, and the opening layer follows it.
  test('flag ON: a joined table opens on the layer its confirmationStage names', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    const joined = { ...TABLE_B, confirmationStage: 0 };
    const root = { ...TABLE_A, grid: [['A', 'B']], next: { B: joined } };
    render(
      <PageTableEditor
        metadata={metadataWith([root])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );

    await screen.findByTestId('staged-editor');
    // Stage 0 (nothing recorded) opens at entryConfirmationStage() — Special Areas.
    await waitFor(() =>
      expect(lastStagedProps().mode).toBe(
        layerKeyForStage(entryConfirmationStage())
      )
    );
  });

  test('flag ON: the joined table itself is the one the editor is given', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([AMALGAMATED])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(lastStagedProps().selectedTableId).toBe('B');
  });

  test('flag ON: a locked Borders row switches off its table editing but not Create table', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWith([AMALGAMATED])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    selectLayerRow('Borders');

    await waitFor(() =>
      expect(screen.getByTestId('opt-delete-table')).toBeDisabled()
    );
    expect(screen.getByTestId('opt-create-table')).toBeEnabled();
    expect(screen.getByLabelText('Expected Columns')).toBeDisabled();
  });

  // ---- Colours layer wiring ---------------------------------------------------------

  const COLOURED_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
  };

  function metadataWithColours(areas) {
    return {
      pdfId: PDF_ID,
      name: 'losses.pdf',
      pages: [{ page: 0, tables: [], colouredAreas: areas }],
      tables: [TABLE_A],
    };
  }

  test('flag ON, colours layer: passes the page colouredAreas to StagedPageGridEditor', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWithColours([COLOURED_AREA])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('staged-editor');
    // A table with nothing recorded against it opens on Special Areas, so Colours is chosen
    // rather than assumed — which every row now allows, whatever the stage.
    selectLayerRow('Colours');
    await waitFor(() => expect(lastStagedProps().mode).toBe('colours'));
    expect(lastStagedProps().colouredAreas).toEqual([COLOURED_AREA]);
  });

  test('flag ON, colours layer: clicking Add sets colourAddMode on the editor', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    render(
      <PageTableEditor
        metadata={metadataWithColours([COLOURED_AREA])}
        page={0}
        onChange={jest.fn()}
      />
    );

    await screen.findByTestId('staged-editor');
    selectLayerRow('Colours');
    await waitFor(() => expect(lastStagedProps().mode).toBe('colours'));
    expect(lastStagedProps().colourAddMode).toBe(false);

    fireEvent.click(screen.getByTestId('opt-colour-add'));
    await waitFor(() => expect(lastStagedProps().colourAddMode).toBe(true));
  });

  // A coloured-area edit is PROVISIONAL: it is held here, shown to the editor, and reported to
  // the host with its page only when the layer is left. Writing it into the document at each
  // drag bought nothing — the grid-lines rebuild that leaving fires is what the edit is for.
  test('flag ON, colours layer: an area edit is held, and reaches the host with (displayPage, next) on leaving', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onColouredAreasChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataWithColours([COLOURED_AREA])}
        page={0}
        onChange={jest.fn()}
        onColouredAreasChange={onColouredAreasChange}
      />
    );

    await screen.findByTestId('staged-editor');
    selectLayerRow('Colours');
    await waitFor(() => expect(lastStagedProps().mode).toBe('colours'));

    const next = [COLOURED_AREA, { ...COLOURED_AREA, left: 0.4 }];
    act(() => {
      lastStagedProps().onColouredAreasChange(next);
    });

    // Held, not reported — but shown, so the user sees what they drew.
    expect(onColouredAreasChange).not.toHaveBeenCalled();
    expect(lastStagedProps().colouredAreas).toEqual(next);

    await act(async () => {
      selectLayerRow('Borders');
    });

    expect(onColouredAreasChange).toHaveBeenCalledWith(0, next);
  });

  // Left by a route that is not the Layers panel, what is held is DISCARDED: it was never
  // confirmed by the rebuild that gives it its point, and the document was never told.
  test('flag ON, colours layer: a held area edit is dropped on a page change', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    const onColouredAreasChange = jest.fn();
    const metadata = {
      ...metadataWithColours([COLOURED_AREA]),
      pages: [
        { page: 0, tables: [], colouredAreas: [COLOURED_AREA] },
        { page: 1, tables: [], colouredAreas: [] },
      ],
    };

    const { rerender } = render(
      <PageTableEditor
        metadata={metadata}
        page={0}
        onChange={jest.fn()}
        onColouredAreasChange={onColouredAreasChange}
      />
    );

    await screen.findByTestId('staged-editor');
    act(() => {
      lastStagedProps().onColouredAreasChange([
        COLOURED_AREA,
        { ...COLOURED_AREA, left: 0.4 },
      ]);
    });

    rerender(
      <PageTableEditor
        metadata={metadata}
        page={1}
        onChange={jest.fn()}
        onColouredAreasChange={onColouredAreasChange}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('middle-title-bar')).toHaveTextContent('Page 2')
    );

    expect(onColouredAreasChange).not.toHaveBeenCalled();
  });
});

// A border move and a coloured-area edit are provisional, so the untick they imply travels
// with them: it is held until the layer is left and reported as part of the same list. Each
// test below therefore leaves the layer before reading what the host was told.
describe('PageTableEditor — editing a confirmed layer unticks it and above', () => {
  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  const COLOURED_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
  };

  // Leave the active layer for another row, awaited inside act so the grid-lines rebuild the
  // departure fires settles inside an act scope.
  // eslint-disable-next-line
  const leaveFor = async (label) => {
    await act(async () => {
      fireEvent.click(screen.getByText(label));
    });
  };

  test('flag ON: moving a table border on a fully-confirmed (stage 5) table drops it to 1', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();
    const table = { ...TABLE_A, confirmationStage: 5 };

    render(
      <PageTableEditor
        metadata={metadataWith([table])}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');

    // Select the Border layer (row 2) so a table edit maps to the 'border' key.
    const rows = screen.getAllByTestId('layer-row');
    fireEvent.click(rows[1]);
    await waitFor(() => expect(lastStagedProps().mode).toBe('border'));

    // The editor reports a border move (bounds changed) for table A.
    const moved = {
      ...table,
      bounds: { ...table.bounds, width: table.bounds.width + 0.02 },
    };
    act(() => {
      lastStagedProps().onEditTables([moved]);
    });

    // Held: the document is not told, and is therefore not dirty, until the layer is left.
    expect(onChange).not.toHaveBeenCalled();

    await leaveFor('Rows');

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.find((t) => t.tableId === 'A').confirmationStage).toBe(1);
  });

  test('flag ON: editing a coloured area drops the page table(s) to stage 0', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();
    const table = { ...TABLE_A, confirmationStage: 3 };
    const meta = {
      pdfId: PDF_ID,
      name: 'losses.pdf',
      pages: [{ page: 0, tables: [], colouredAreas: [COLOURED_AREA] }],
      tables: [table],
    };

    render(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    await leaveFor('Colours');
    const nextAreas = [{ ...COLOURED_AREA, width: 0.3 }];
    act(() => {
      lastStagedProps().onColouredAreasChange(nextAreas);
    });

    expect(onChange).not.toHaveBeenCalled();

    await leaveFor('Borders');

    expect(onChange).toHaveBeenCalled();
    const nextTables = onChange.mock.calls[0][0];
    expect(nextTables.find((t) => t.tableId === 'A').confirmationStage).toBe(0);
  });

  test('flag ON: a border edit on an unrelated stage-5 table is untouched when only one table changed', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();
    const a = { ...TABLE_A, tableId: 'A', confirmationStage: 5 };
    const b = { ...TABLE_B, tableId: 'B', confirmationStage: 5 };

    render(
      <PageTableEditor
        metadata={metadataWith([a, b])}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    const rows = screen.getAllByTestId('layer-row');
    fireEvent.click(rows[1]);
    await waitFor(() => expect(lastStagedProps().mode).toBe('border'));

    // Only A's bounds move; B is reported unchanged.
    const before = lastStagedProps().metadataTables;
    const movedA = {
      ...before.find((t) => t.tableId === 'A'),
      bounds: {
        ...before.find((t) => t.tableId === 'A').bounds,
        width: 0.06,
      },
    };
    const unchangedB = before.find((t) => t.tableId === 'B');
    act(() => {
      lastStagedProps().onEditTables([movedA, unchangedB]);
    });

    await leaveFor('Rows');

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.find((t) => t.tableId === 'A').confirmationStage).toBe(1);
    // B did not change, so its stage is left alone.
    expect(next.find((t) => t.tableId === 'B').confirmationStage).toBe(5);
  });
});

// The Borders layer's Expected Columns / Expected Rows hints are transient state owned
// here: keyed by tableId (so they survive a selection or layer change) but dropped
// whenever the displayed page changes.
describe('PageTableEditor — Borders expected column/row hints', () => {
  // Stage 1 (Colours confirmed) makes Borders the first un-ticked row, so the mounted
  // layer is 'border' and the hint fields are on screen.
  const A = { ...TABLE_A, confirmationStage: 1 };
  const B = { ...TABLE_B, confirmationStage: 1 };

  test('a hint typed for one table is kept while the selection moves away and back, and the other table starts blank', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    const { rerender } = render(
      <PageTableEditor
        metadata={metadataWith([A, B])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('opt-expected-columns');
    fireEvent.change(screen.getByTestId('opt-expected-columns'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByTestId('opt-expected-rows'), {
      target: { value: '9' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('7')
    );
    expect(screen.getByTestId('opt-expected-rows')).toHaveValue('9');

    // Table B has no entry of its own, so its fields are blank.
    rerender(
      <PageTableEditor
        metadata={metadataWith([A, B])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('')
    );
    expect(screen.getByTestId('opt-expected-rows')).toHaveValue('');

    // Back to A: what was typed is still there.
    rerender(
      <PageTableEditor
        metadata={metadataWith([A, B])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('7')
    );
    expect(screen.getByTestId('opt-expected-rows')).toHaveValue('9');
  });

  test('changing the displayed page clears both hint fields', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    const p0 = { ...TABLE_A, tableId: 'A', pdfPage: 0, confirmationStage: 1 };
    const p1 = { ...TABLE_A, tableId: 'B', pdfPage: 1, confirmationStage: 1 };
    const meta = {
      pdfId: PDF_ID,
      name: 'x.pdf',
      pages: [
        { page: 0, tables: [] },
        { page: 1, tables: [] },
      ],
      tables: [p0, p1],
    };

    const { rerender } = render(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('opt-expected-columns');
    fireEvent.change(screen.getByTestId('opt-expected-columns'), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByTestId('opt-expected-rows'), {
      target: { value: '6' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-rows')).toHaveValue('6')
    );

    // Page 2's table starts blank...
    rerender(
      <PageTableEditor
        metadata={meta}
        page={1}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('middle-title-bar')).toHaveTextContent('Page 2')
    );
    expect(screen.getByTestId('opt-expected-columns')).toHaveValue('');
    expect(screen.getByTestId('opt-expected-rows')).toHaveValue('');

    // ...and coming back to page 1 the hints typed for table A have been dropped.
    rerender(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('middle-title-bar')).toHaveTextContent('Page 1')
    );
    expect(screen.getByTestId('opt-expected-columns')).toHaveValue('');
    expect(screen.getByTestId('opt-expected-rows')).toHaveValue('');
  });
});

// Ticking Borders makes an OPTIONAL blocking find-grid-lines call, hinted with one entry per
// table that has either had its bounds moved or has a non-blank expected count. With nothing
// to tell the back end the tick advances synchronously, exactly as the skipped Colours case
// does.
describe('PageTableEditor — leaving Borders triggers the hinted find-grid-lines (blocking)', () => {
  const COLOURED_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
  };

  // Stage 1 (Colours confirmed) makes Borders (row 2) the first un-ticked row, so it is the
  // layer the editor mounts on — which is also what puts the expected-count fields on screen.
  const A1 = { ...TABLE_A, confirmationStage: 1 };
  const B1 = { ...TABLE_B, confirmationStage: 1 };

  function metadataForBorders(tables = [A1], areas = [COLOURED_AREA]) {
    return {
      pdfId: PDF_ID,
      name: 'losses.pdf',
      pages: [{ page: 0, tables: [], colouredAreas: areas }],
      tables,
    };
  }

  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  // Leave the Borders layer for another one, which is what fires the hinted call. Awaited
  // inside act so that a grid-lines promise the transition starts settles — committing its
  // merge, moving the layer and clearing actionBusy — inside an act scope, rather than warning
  // as an unwrapped update afterwards. A promise the test holds pending is unaffected: act only
  // flushes what is already resolvable.
  // eslint-disable-next-line
  async function leaveBordersFor(label = 'Rows') {
    await act(async () => {
      selectLayerRow(label);
    });
  }

  // Report a bounds move for one table up from the staged editor, leaving every other table
  // byte-identical. This is what arms the changed-bounds half of the trigger.
  function moveBounds(tableId, width) {
    const before = lastStagedProps().metadataTables;
    act(() => {
      lastStagedProps().onEditTables(
        before.map((t) =>
          t.tableId === tableId ? { ...t, bounds: { ...t.bounds, width } } : t
        )
      );
    });
  }

  // Report a move of one table's LEFT edge. Normalisation takes bounds.left as authoritative
  // (only width/height follow the axis sums), so unlike `moveBounds` this stands as reported —
  // which is what lets a test watch one table's geometry travel.
  function moveLeftEdge(tableId, left) {
    const before = lastStagedProps().metadataTables;
    act(() => {
      lastStagedProps().onEditTables(
        before.map((t) =>
          t.tableId === tableId ? { ...t, bounds: { ...t.bounds, left } } : t
        )
      );
    });
  }

  // The hint list passed as findGridLines' fourth argument on its most recent call.
  const lastHints = () =>
    findGridLines.mock.calls[findGridLines.mock.calls.length - 1][3];

  test('with no bounds change and no expected counts, leaving Borders makes NO call and simply moves on', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(lastStagedProps().mode).toBe('border');

    await leaveBordersFor();

    // Nothing to ask for, so no request and no blocking overlay.
    expect(findGridLines).not.toHaveBeenCalled();
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();

    // ...and the layer simply becomes the one asked for. Nothing is confirmed: leaving a
    // layer is not a statement about the work on it, only about what has to be rebuilt.
    await waitFor(() => expect(lastStagedProps().mode).toBe('rows'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('after a bounds change, leaving Borders calls findGridLines with the page colouredAreas and a hint for the moved table', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);

    await leaveBordersFor();

    // The hint carries the table's bounds as the editor holds them. The width is the column
    // sum, not the 0.06 this fixture asked for: `moveBounds` moves the border without moving
    // the columns with it, which the I1/I2 normalisation then corrects. A real drag moves both.
    expect(findGridLines).toHaveBeenCalledWith(PDF_ID, 0, [COLOURED_AREA], [
      { name: 'Alpha', tableInPage: 0, left: 0, top: 0, width: 0.04, height: 0.04 },
    ]);
  });

  test('a non-blank Expected Columns with no bounds change still triggers the call, and the hint carries expectedColumns', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('opt-expected-columns');
    fireEvent.change(screen.getByTestId('opt-expected-columns'), {
      target: { value: '4' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('4')
    );

    await leaveBordersFor();

    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(lastHints()).toEqual([
      {
        name: 'Alpha',
        tableInPage: 0,
        left: 0,
        top: 0,
        width: 0.04,
        height: 0.04,
        expectedColumns: 4,
      },
    ]);
  });

  test('expected counts ride only on the hints of the tables that have them', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const meta = metadataForBorders([A1, B1]);

    const { rerender } = render(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    // Table A gets an expected row count typed against it...
    await screen.findByTestId('opt-expected-rows');
    fireEvent.change(screen.getByTestId('opt-expected-rows'), {
      target: { value: '9' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-rows')).toHaveValue('9')
    );

    // ...and table B only has its border moved, so it is co-hinted without any counts.
    rerender(
      <PageTableEditor
        metadata={meta}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'B'}
      />
    );
    moveBounds('B', 0.06);

    await leaveBordersFor();

    expect(findGridLines).toHaveBeenCalledTimes(1);
    const hints = lastHints();
    expect(hints).toHaveLength(2);
    const hintA = hints.find((h) => h.name === 'Alpha');
    const hintB = hints.find((h) => h.name === 'Beta');
    expect(hintA.expectedRows).toBe(9);
    expect(hintA).not.toHaveProperty('expectedColumns');
    expect(hintB).not.toHaveProperty('expectedRows');
    expect(hintB).not.toHaveProperty('expectedColumns');
  });

  test('hints never carry cells or title', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const titled = { ...A1, title: { bounds: {}, text: 'T', confidence: 90 } };

    render(
      <PageTableEditor
        metadata={metadataForBorders([titled])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);
    await leaveBordersFor();

    for (const hint of lastHints()) {
      expect(hint).not.toHaveProperty('cells');
      expect(hint).not.toHaveProperty('title');
    }
  });

  test('the panel stays blocked while the call is in flight and the layer does not move until it resolves', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();
    moveBounds('A', 0.06);
    // The bounds move itself reports up; only the tick's write is of interest below.
    onChange.mockClear();

    await leaveBordersFor();

    // Blocking: the overlay is up, and nothing has been committed.
    await screen.findByTestId('image-loading-overlay');
    expect(onChange).not.toHaveBeenCalled();
    // And the layer has not moved: the rebuild owns the transition.
    expect(lastStagedProps().mode).toBe('border');

    await act(async () => {
      resolveFind({ tables: [] });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  test('on resolution the merged geometry is committed and only then does the layer become Rows', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    // Overlaps TABLE_A ({left:0, top:0, width:0.04, height:0.04}) so it matches A.
    const newCols = [
      { value: 0.25, confidence: 80 },
      { value: 0.25, confidence: 80 },
    ];
    const newRows = [{ value: 0.25, confidence: 80 }];
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);
    onChange.mockClear();
    await leaveBordersFor();

    // Still on Borders while the response is outstanding.
    expect(lastStagedProps().mode).toBe('border');

    await act(async () => {
      resolveFind({
        tables: [
          {
            tableInPage: 99,
            bounds: { left: 0, top: 0, width: 0.5, height: 0.25 },
            columnWidths: newCols,
            rowHeights: newRows,
          },
        ],
      });
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    const a = next.find((t) => t.tableId === 'A');
    // The detector's snapped geometry replaces the hand-positioned border — the point of
    // the call — and the layer only moves after that merge. The stage is not touched:
    // leaving a layer rebuilds, it does not confirm.
    expect(a.columnWidths).toEqual(newCols);
    expect(a.rowHeights).toEqual(newRows);
    expect(a.confirmationStage).toBe(1);
    await waitFor(() => expect(lastStagedProps().mode).toBe('rows'));
  });

  test('on rejection the error is surfaced, the stage stays at 1 and the overlay clears', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockRejectedValue(new Error('grid lines failed'));
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);
    onChange.mockClear();
    await leaveBordersFor();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('grid lines failed')
    );
    // Nothing committed, so the stage never left 1 and the layer never advanced.
    expect(onChange).not.toHaveBeenCalled();
    expect(lastStagedProps().mode).toBe('border');
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  // The accepted consequence of reusing the whole-page merge for a hinted (partial) response:
  // a re-detected table whose bounds grow over an UNCHANGED neighbour hard-deletes it.
  test('documented merge consequence: a returned table overlapping two live tables keeps the larger-overlap match and hard-deletes the other', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);

    // A covers 0..0.04, B covers 0.05..0.09. The returned table spans 0..0.07, so it overlaps
    // all of A (0.04 wide) but only 0.02 of B: A is the match, B is dropped as a duplicate.
    findGridLines.mockResolvedValue({
      tables: [
        {
          tableInPage: 99,
          bounds: { left: 0, top: 0, width: 0.07, height: 0.04 },
          columnWidths: [{ value: 0.07, confidence: 80 }],
          rowHeights: [{ value: 0.04, confidence: 80 }],
        },
      ],
    });
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders([A1, B1])}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.07);
    onChange.mockClear();
    await leaveBordersFor();

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.map((t) => t.tableId)).toEqual(['A']);
    expect(next[0].bounds.width).toBeCloseTo(0.07, 10);
  });

  test('a successful call clears the changed-bounds set: leaving Borders again makes no call', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);
    await leaveBordersFor();

    await waitFor(() => expect(findGridLines).toHaveBeenCalledTimes(1));

    // Go back to Borders and leave it again. Returning is exempt from the rebuild in its own
    // right (Colours is the only exempt destination), so this is a clean second attempt — and
    // this time the changed-bounds set is empty, so nothing qualifies.
    onChange.mockClear();
    await act(async () => {
      selectLayerRow('Borders');
    });
    await leaveBordersFor('Columns');

    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(lastStagedProps().mode).toBe('columns'));
  });

  // ---- Leaving Borders by LEAVING THE TABLE -------------------------------------------
  // Leaving the table is leaving the layer as far as the rebuild is concerned. It matters
  // most on the way off the page: the changed-bounds set and the expected counts are dropped
  // on a page change, so a call not made here would never be made at all.

  test('Next steps to the page next table only after the hinted call has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders([A1, B1])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onSelectTable={onSelectTable}
        onNextPage={onNextPage}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-next'));
    });

    // The moved table is re-detected BEFORE the table it belongs to is left. The hinted width
    // is the column sum, the I1/I2 normalisation having corrected a fixture that moves the
    // border without the columns; what the move did was arm the trigger.
    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(lastHints()).toEqual([
      { name: 'Alpha', tableInPage: 0, left: 0, top: 0, width: 0.04, height: 0.04 },
    ]);
    expect(onSelectTable).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onSelectTable).toHaveBeenCalledWith('B'));
    expect(onNextPage).not.toHaveBeenCalled();
  });

  test('Next off the last table changes the page only after the hinted call has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onNextPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onNextPage={onNextPage}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-next'));
    });

    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(onNextPage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onNextPage).toHaveBeenCalledTimes(1));
  });

  test('Previous changes the page only after the hinted call has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onPrevPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onPrevPage={onPrevPage}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-prev'));
    });

    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onPrevPage).toHaveBeenCalledTimes(1));
  });

  test('a failed call leaves the table and the page where they were', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockRejectedValue(new Error('grid lines failed'));
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders([A1, B1])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onSelectTable={onSelectTable}
        onNextPage={onNextPage}
      />
    );

    await screen.findByTestId('staged-editor');
    moveBounds('A', 0.06);

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-next'));
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('grid lines failed')
    );
    expect(onSelectTable).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
    // Still on Borders, with the work still outstanding: the next attempt to leave retries.
    expect(lastStagedProps().mode).toBe('border');
  });

  // ---- What is held, and when it reaches the document ---------------------------------

  test('a border move reaches the host only once the call it arms has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    // The left edge, not the width: normalisation takes bounds.left as authoritative, so this
    // is the one edge a fixture can move without the columns and have it stand.
    moveLeftEdge('A', 0.2);

    // Held: shown to the editor, but the document knows nothing of it and is not dirty.
    expect(onChange).not.toHaveBeenCalled();
    expect(lastStagedProps().metadataTables[0].bounds.left).toBeCloseTo(0.2, 10);

    await leaveBordersFor();
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0];
    expect(next.find((t) => t.tableId === 'A').bounds.left).toBeCloseTo(0.2, 10);
  });

  test('a failed call keeps the move held, so leaving again still offers it', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockRejectedValue(new Error('grid lines failed'));
    const onChange = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders()}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveLeftEdge('A', 0.2);
    await leaveBordersFor();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('grid lines failed')
    );
    // Nothing reported, and the move is still on screen for the next attempt.
    expect(onChange).not.toHaveBeenCalled();
    expect(lastStagedProps().metadataTables[0].bounds.left).toBeCloseTo(0.2, 10);
    expect(lastStagedProps().mode).toBe('border');

    findGridLines.mockResolvedValue({ tables: [] });
    await leaveBordersFor();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(
      onChange.mock.calls[0][0].find((t) => t.tableId === 'A').bounds.left
    ).toBeCloseTo(0.2, 10);
  });

  test('a held border move is dropped on a page change', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = jest.fn();
    const metadata = {
      ...metadataForBorders(),
      pages: [
        { page: 0, tables: [], colouredAreas: [COLOURED_AREA] },
        { page: 1, tables: [], colouredAreas: [] },
      ],
    };

    const { rerender } = render(
      <PageTableEditor
        metadata={metadata}
        page={0}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );

    await screen.findByTestId('staged-editor');
    moveLeftEdge('A', 0.2);

    // The page changes from outside the Layers panel — a thumbnail, the left-hand list — so
    // nothing flushes, and what was held goes with the page.
    rerender(
      <PageTableEditor
        metadata={metadata}
        page={1}
        onChange={onChange}
        selectedTableId={'A'}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('middle-title-bar')).toHaveTextContent('Page 2')
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(findGridLines).not.toHaveBeenCalled();
  });

  test('with nothing to tell the back end, Next steps straight on', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onSelectTable = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForBorders([A1, B1])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onSelectTable={onSelectTable}
      />
    );

    await screen.findByTestId('staged-editor');

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-next'));
    });

    expect(findGridLines).not.toHaveBeenCalled();
    expect(onSelectTable).toHaveBeenCalledWith('B');
  });
});

// Leaving the Colours layer by leaving the TABLE or the PAGE owes the same page-wide probe as
// picking another Layers row does: the coloured areas are the probe's only input beyond the
// page itself, so a page left without one carries grid lines that no longer match the areas
// drawn on it.
describe('PageTableEditor — leaving Colours by Next or Previous triggers the page probe', () => {
  const COLOURED_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
  };
  const EDITED_AREA = { ...COLOURED_AREA, width: 0.3 };

  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  function metadataForColours(tables = [TABLE_A]) {
    return {
      pdfId: PDF_ID,
      name: 'losses.pdf',
      pages: [{ page: 0, tables: [], colouredAreas: [COLOURED_AREA] }],
      tables,
    };
  }

  // Put the panel on Colours with the page's colour data dirty — the two conditions the probe
  // is owed under. Every coloured-area mutation funnels through this one commit callback, so it
  // is what marks the page dirty.
  async function onColoursWithAnEdit() {
    await screen.findByTestId('staged-editor');
    act(() => {
      lastStagedProps().onColouredAreasChange([EDITED_AREA]);
    });
    await act(async () => {
      selectLayerRow('Colours');
    });
    await waitFor(() => expect(lastStagedProps().mode).toBe('colours'));
  }

  test('Next steps to the page next table only after the probe has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onSelectTable = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForColours([TABLE_A, TABLE_B])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onSelectTable={onSelectTable}
      />
    );
    await onColoursWithAnEdit();

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-next'));
    });

    // The whole page is probed before the table is left. The host is a spy, so the edited
    // areas never come back through `metadata` and the request carries the page's as loaded;
    // what the edit did was mark the page dirty.
    expect(findGridLines).toHaveBeenCalledWith(PDF_ID, 0, [COLOURED_AREA]);
    expect(onSelectTable).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onSelectTable).toHaveBeenCalledWith('B'));
  });

  test('Previous changes the page only after the probe has merged', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    let resolveFind;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    const onPrevPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForColours()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onPrevPage={onPrevPage}
      />
    );
    await onColoursWithAnEdit();

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-prev'));
    });

    expect(findGridLines).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFind({ tables: [] });
    });

    await waitFor(() => expect(onPrevPage).toHaveBeenCalledTimes(1));
  });

  test('a page whose areas were never edited is left without a probe', async () => {
    stagedGridEditorEnabled.mockReturnValue(true);
    findGridLines.mockResolvedValue({ tables: [] });
    const onPrevPage = jest.fn();

    render(
      <PageTableEditor
        metadata={metadataForColours()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onPrevPage={onPrevPage}
      />
    );
    await screen.findByTestId('staged-editor');
    await act(async () => {
      selectLayerRow('Colours');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('layers-prev'));
    });

    expect(findGridLines).not.toHaveBeenCalled();
    expect(onPrevPage).toHaveBeenCalledTimes(1);
  });
});

// The staged Calculate on a just-created border table is ONE blocking call: a hinted
// find-grid-lines to DETECT the grid inside the drawn border, which a border-only table does
// not have. It reads no text — that is the host's page-exit recalculation — so calculate-cells
// has no part in it, and neither does find-tables (a whole-page detector).
describe('PageTableEditor — staged Calculate on a created border table', () => {
  const COLOURED_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.2,
    foreground: '#111111',
    background: '#eeeeee',
  };

  // The just-created table: a 1×1 border at stage 1, so Borders (row 2) is the first un-ticked
  // row and therefore the layer the editor mounts on — which is what puts the created-table
  // Calculate / Cancel buttons on screen.
  const CREATED = { ...BORDER_1X1, confirmationStage: 1 };

  // The grid find-grid-lines detects inside that border: a 2×2 grid over the same rectangle.
  const DETECTED_GRID = {
    tableInPage: 99,
    bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
    columnWidths: [
      { value: 0.05, confidence: 80 },
      { value: 0.05, confidence: 80 },
    ],
    rowHeights: [
      { value: 0.05, confidence: 80 },
      { value: 0.05, confidence: 80 },
    ],
  };

  function metadataForCreated() {
    return {
      pdfId: PDF_ID,
      name: 'losses.pdf',
      pages: [{ page: 0, tables: [], colouredAreas: [COLOURED_AREA] }],
      tables: [CREATED],
    };
  }

  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  // Render the staged editor with the created table selected, and report the creation up from
  // the staged overlay so the Borders layer offers its Calculate button.
  async function renderCreated(onChange = jest.fn()) {
    stagedGridEditorEnabled.mockReturnValue(true);
    render(
      <PageTableEditor
        metadata={metadataForCreated()}
        page={0}
        onChange={onChange}
        selectedTableId={'t-1'}
      />
    );
    await screen.findByTestId('staged-editor');
    act(() => {
      lastStagedProps().onCreatedTable('t-1');
    });
    await screen.findByTestId('opt-confirm-created');
    return onChange;
  }

  // Press the created table's Calculate. Awaited inside act so the promise it starts settles —
  // committing its write and clearing actionBusy — inside an act scope rather than warning as
  // an unwrapped update. A promise the test holds pending is unaffected: act only flushes what
  // is already resolvable.
  // eslint-disable-next-line
  async function clickCalculate() {
    await act(async () => {
      fireEvent.click(screen.getByTestId('opt-confirm-created'));
    });
  }

  test('Calculate detects the grid with findGridLines and commits it', async () => {
    findGridLines.mockResolvedValue({ tables: [DETECTED_GRID] });
    const onChange = await renderCreated();

    await clickCalculate();

    expect(findGridLines).toHaveBeenCalledTimes(1);

    // The detection is hinted with the drawn border only — no cells, no title.
    const [gridPdfId, gridPage, gridAreas, gridHints] =
      findGridLines.mock.calls[0];
    expect(gridPdfId).toBe(PDF_ID);
    expect(gridPage).toBe(0);
    expect(gridAreas).toEqual([COLOURED_AREA]);
    expect(gridHints).toEqual([
      { name: 'T', tableInPage: 0, left: 0, top: 0, width: 0.1, height: 0.1 },
    ]);

    // The committed table carries the detected grid, replacing the 1×1 the drawn border had.
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    const t = next.find((x) => x.tableId === 't-1');
    expect(t.columnWidths).toEqual(DETECTED_GRID.columnWidths);
    expect(t.rowHeights).toEqual(DETECTED_GRID.rowHeights);
    expect(t.cells).toHaveLength(4);
  });

  // The text read was deliberately removed: it duplicated the host's page-exit recalculation
  // and ran before the user had reached the Rows/Columns/Special Areas layers, so any grid edit
  // they went on to make invalidated it.
  test('Calculate reads no cell text', async () => {
    findGridLines.mockResolvedValue({ tables: [DETECTED_GRID] });
    await renderCreated();

    await clickCalculate();

    expect(calculateCells).not.toHaveBeenCalled();
  });

  test('the staged Calculate never calls findTables', async () => {
    findGridLines.mockResolvedValue({ tables: [DETECTED_GRID] });
    await renderCreated();

    await clickCalculate();

    expect(findTables).not.toHaveBeenCalled();
  });

  test('a non-blank expected count is passed to the grid-lines hint', async () => {
    findGridLines.mockResolvedValue({ tables: [DETECTED_GRID] });
    await renderCreated();

    fireEvent.change(screen.getByTestId('opt-expected-rows'), {
      target: { value: '6' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('opt-expected-rows')).toHaveValue('6')
    );

    await clickCalculate();

    expect(findGridLines.mock.calls[0][3][0].expectedRows).toBe(6);
    expect(findGridLines.mock.calls[0][3][0]).not.toHaveProperty(
      'expectedColumns'
    );
  });

  test('a grid-lines response with no table for it stops with the informational toast and commits nothing', async () => {
    findGridLines.mockResolvedValue({ tables: [] });
    const onChange = await renderCreated();

    await clickCalculate();

    expect(toast).toHaveBeenCalledWith('No table found');
    expect(onChange).not.toHaveBeenCalled();
    // The created flag is cleared either way, so the Calculate button is gone.
    await waitFor(() =>
      expect(screen.queryByTestId('opt-confirm-created')).toBeNull()
    );
  });

  test('the panel stays blocked while the detection is outstanding and clears once it resolves', async () => {
    let resolveGrid;
    findGridLines.mockImplementation(
      () => new Promise((resolve) => (resolveGrid = resolve))
    );
    await renderCreated();
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();

    await clickCalculate();

    await screen.findByTestId('image-loading-overlay');

    await act(async () => {
      resolveGrid({ tables: [DETECTED_GRID] });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  test('a failed detection surfaces through toast.error and clears the block', async () => {
    findGridLines.mockRejectedValue(new Error('detection failed'));
    await renderCreated();

    await clickCalculate();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('detection failed')
    );
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });
});

describe('PageTableEditor — merged-cell controls in the Special Areas Options block', () => {
  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  // A 4×4 table at stage 4, so Special Areas (row 5) is the first un-ticked row and therefore
  // the layer the editor mounts on — which is what puts the merged-cell buttons on screen.
  // Three cells are stated explicitly, each exercising a different corner of the span limits
  // (the remaining twelve squares are materialised by fillGridCells on load):
  //
  //   (0, 0) 1×1               — nothing to reduce, room to extend both ways
  //   (1, 1) rowSpan/colSpan 2 — mid-grid, room to extend and span to reduce both ways
  //   (0, 2) columnSpan 2      — its span already reaches the right edge (2 + 2 == 4 columns)
  const CELL = (row, column, rowSpan, columnSpan) => ({
    row,
    column,
    rowSpan,
    columnSpan,
    bounds: {
      left: column * 0.02,
      top: row * 0.02,
      width: columnSpan * 0.02,
      height: rowSpan * 0.02,
    },
    text: '',
    confidence: 0,
    header: false,
  });

  const MERGED_TABLE = {
    tableId: 'm-1',
    name: 'M',
    pdfPage: 0,
    tableInPage: 0,
    confirmationStage: 4,
    bounds: { left: 0, top: 0, width: 0.08, height: 0.08 },
    columnWidths: Array.from({ length: 4 }, () => ({
      value: 0.02,
      confidence: 90,
    })),
    rowHeights: Array.from({ length: 4 }, () => ({
      value: 0.02,
      confidence: 90,
    })),
    cells: [CELL(0, 0, 1, 1), CELL(1, 1, 2, 2), CELL(0, 2, 1, 2)],
  };

  // Render on the Special Areas layer and register a dispatcher in place of the staged
  // editor's own, exactly as the real editor does through onRequestSpecialAction.
  async function renderSpecial() {
    stagedGridEditorEnabled.mockReturnValue(true);
    render(
      <PageTableEditor
        metadata={metadataWith([MERGED_TABLE])}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'m-1'}
      />
    );
    await screen.findByTestId('staged-editor');
    expect(lastStagedProps().mode).toBe('special');
    const dispatch = jest.fn();
    act(() => {
      lastStagedProps().onRequestSpecialAction(dispatch);
    });
    return dispatch;
  }

  // Report a merged-cell selection up from the staged editor (null clears it).
  function selectMergedCell(cellRef) {
    act(() => {
      lastStagedProps().onSelectedMergedCellChange(cellRef);
    });
  }

  test('the five merged-cell buttons dispatch their action names through the registered dispatcher', async () => {
    const dispatch = await renderSpecial();
    // The mid-grid merged cell leaves all four Extend/Reduce buttons clickable.
    selectMergedCell({ row: 1, column: 1 });

    fireEvent.click(screen.getByTestId('opt-merge-cell'));
    fireEvent.click(screen.getByTestId('opt-extend-column'));
    fireEvent.click(screen.getByTestId('opt-reduce-column'));
    fireEvent.click(screen.getByTestId('opt-extend-row'));
    fireEvent.click(screen.getByTestId('opt-reduce-row'));

    expect(dispatch.mock.calls.map(([name]) => name)).toEqual([
      'mergeCell',
      'extendColumn',
      'reduceColumn',
      'extendRow',
      'reduceRow',
    ]);
  });

  test('with nothing selected the four Extend/Reduce buttons are disabled and Merge Cell is not', async () => {
    await renderSpecial();

    expect(lastStagedProps().selectedMergedCell).toBeNull();
    expect(screen.getByTestId('opt-merge-cell')).toBeEnabled();
    expect(screen.getByTestId('opt-extend-column')).toBeDisabled();
    expect(screen.getByTestId('opt-reduce-column')).toBeDisabled();
    expect(screen.getByTestId('opt-extend-row')).toBeDisabled();
    expect(screen.getByTestId('opt-reduce-row')).toBeDisabled();
  });

  test('a mid-grid merged cell enables all four, and the selection is mirrored back down', async () => {
    await renderSpecial();

    selectMergedCell({ row: 1, column: 1 });

    await waitFor(() =>
      expect(screen.getByTestId('opt-extend-column')).toBeEnabled()
    );
    expect(screen.getByTestId('opt-reduce-column')).toBeEnabled();
    expect(screen.getByTestId('opt-extend-row')).toBeEnabled();
    expect(screen.getByTestId('opt-reduce-row')).toBeEnabled();
    expect(lastStagedProps().selectedMergedCell).toEqual({ row: 1, column: 1 });
  });

  test('a span already reaching the right edge disables Extend Column but leaves Reduce Column enabled', async () => {
    await renderSpecial();

    selectMergedCell({ row: 0, column: 2 });

    await waitFor(() =>
      expect(screen.getByTestId('opt-extend-column')).toBeDisabled()
    );
    expect(screen.getByTestId('opt-reduce-column')).toBeEnabled();
  });

  test('a span-1-in-both-directions selection disables both Reduce buttons', async () => {
    await renderSpecial();

    selectMergedCell({ row: 0, column: 0 });

    await waitFor(() =>
      expect(screen.getByTestId('opt-reduce-column')).toBeDisabled()
    );
    expect(screen.getByTestId('opt-reduce-row')).toBeDisabled();
    // There is still room to grow in both directions.
    expect(screen.getByTestId('opt-extend-column')).toBeEnabled();
    expect(screen.getByTestId('opt-extend-row')).toBeEnabled();
  });
});

// The Layers panel's Next walks the displayed page's tables in tableInPage order and only
// changes the page once the last of them has been reached. Confirming Special Areas routes
// through the same handler, because LayersPanel calls onNext for its last row.
describe('PageTableEditor — Layers Next steps table-by-table before page-by-page', () => {
  // The index of the tinted (selected) Layers row. LayerRow leaves every unselected row's
  // background transparent, so which row is selected is observable from the panel itself.
  const selectedRowIndex = () =>
    screen
      .getAllByTestId('layer-row')
      .findIndex(
        (row) => window.getComputedStyle(row).backgroundColor !== 'transparent'
      );

  const rowIndexForStage = (stage) =>
    LAYER_KEY_ORDER.indexOf(layerKeyForStage(stage));

  function clickNext() {
    fireEvent.click(screen.getByTestId('layers-next'));
  }


  async function renderStaged(props) {
    stagedGridEditorEnabled.mockReturnValue(true);
    const view = render(
      <PageTableEditor page={0} onChange={jest.fn()} {...props} />
    );
    await screen.findByTestId('staged-editor');
    return view;
  }

  test('with a later table on the page, Next selects it and leaves the page alone', async () => {
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([TABLE_A, TABLE_B]),
      selectedTableId: 'A',
      onSelectTable,
      onNextPage,
    });

    clickNext();

    expect(onSelectTable).toHaveBeenCalledWith('B');
    expect(onNextPage).not.toHaveBeenCalled();
  });

  test('the step follows tableInPage order, not document order', async () => {
    // Document order puts `last` immediately after `first`; tableInPage order puts `middle`
    // there. tableInPage is a float (a manually drawn table is interpolated between two
    // others), which is why the walk cannot just index the array.
    const first = { ...TABLE_A, tableId: 'first', tableInPage: 0 };
    const last = {
      ...TABLE_B,
      tableId: 'last',
      tableInPage: 2,
      bounds: { left: 0.1, top: 0, width: 0.04, height: 0.04 },
      cells: [
        makeDefaultCell(0, 0, { left: 0.1, top: 0, width: 0.04, height: 0.04 }),
      ],
    };
    const middle = { ...TABLE_B, tableId: 'middle', tableInPage: 1.5 };
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([first, last, middle]),
      selectedTableId: 'first',
      onSelectTable,
      onNextPage,
    });

    clickNext();

    expect(onSelectTable).toHaveBeenCalledWith('middle');
    expect(onNextPage).not.toHaveBeenCalled();
  });

  test('with the last table on the page selected, Next changes the page', async () => {
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([TABLE_A, TABLE_B]),
      selectedTableId: 'B',
      onSelectTable,
      onNextPage,
    });

    clickNext();

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onSelectTable).not.toHaveBeenCalled();
  });

  test('with a single table on the page, Next changes the page', async () => {
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([TABLE_A]),
      selectedTableId: 'A',
      onSelectTable,
      onNextPage,
    });

    clickNext();

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onSelectTable).not.toHaveBeenCalled();
  });

  test('ticking Special Areas on a page with a later table steps the table rather than the page', async () => {
    // Stage 4 makes Special Areas (row 5) the first un-ticked row.
    const a = { ...TABLE_A, confirmationStage: 4 };
    const onChange = jest.fn();
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([a, TABLE_B]),
      selectedTableId: 'A',
      onChange,
      onSelectTable,
      onNextPage,
    });

    fireEvent.click(tickFor('Special Areas'));

    // The tick itself still confirms the selected table's last layer...
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.find((t) => t.tableId === 'A').confirmationStage).toBe(5);
    // ...and the Next action it performs walks to the page's remaining table.
    expect(onSelectTable).toHaveBeenCalledWith('B');
    expect(onNextPage).not.toHaveBeenCalled();
  });

  // A joined table is on the page like any other, so the walk must not step over it just
  // because a saved link grid moved it off the top-level list.
  test('Next steps onto a table joined under the selected root', async () => {
    const joined = { ...TABLE_B, tableInPage: 1 };
    const root = { ...TABLE_A, grid: [['A', 'B']], next: { B: joined } };
    const onSelectTable = jest.fn();
    const onNextPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([root]),
      selectedTableId: 'A',
      onSelectTable,
      onNextPage,
    });

    clickNext();

    expect(onSelectTable).toHaveBeenCalledWith('B');
    expect(onNextPage).not.toHaveBeenCalled();
  });

  // ---- Previous mirrors Next ---------------------------------------------------------

  function clickPrev() {
    fireEvent.click(screen.getByTestId('layers-prev'));
  }

  test('with an earlier table on the page, Previous selects it and leaves the page alone', async () => {
    const onSelectTable = jest.fn();
    const onPrevPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([TABLE_A, TABLE_B]),
      selectedTableId: 'B',
      onSelectTable,
      onPrevPage,
    });

    clickPrev();

    expect(onSelectTable).toHaveBeenCalledWith('A');
    expect(onPrevPage).not.toHaveBeenCalled();
  });

  test('with the first table on the page selected, Previous changes the page', async () => {
    const onSelectTable = jest.fn();
    const onPrevPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([TABLE_A, TABLE_B]),
      selectedTableId: 'A',
      onSelectTable,
      onPrevPage,
    });

    clickPrev();

    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onSelectTable).not.toHaveBeenCalled();
  });

  test('Previous steps back onto a joined table, and its layer follows that table stage', async () => {
    const joined = { ...TABLE_B, tableInPage: 1, confirmationStage: 2 };
    const root = {
      ...TABLE_A,
      confirmationStage: 1,
      grid: [['A', 'B']],
      next: { B: joined },
    };
    const onSelectTable = jest.fn();
    const onPrevPage = jest.fn();

    await renderStaged({
      metadata: metadataWith([root]),
      selectedTableId: 'B',
      onSelectTable,
      onPrevPage,
    });

    clickPrev();

    expect(onSelectTable).toHaveBeenCalledWith('A');
    expect(onPrevPage).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(selectedRowIndex()).toBe(rowIndexForStage(root.confirmationStage))
    );
  });

  test('stepping to another table selects the layer derived from that table stage', async () => {
    // A starts part-way up the ladder, so it keeps its place rather than being promoted on
    // entry (which is what a stage-0 table gets — see the entry-stage tests below).
    const a = { ...TABLE_A, confirmationStage: 1 };
    const b = { ...TABLE_B, confirmationStage: 2 };

    await renderStaged({
      metadata: metadataWith([a, b]),
      selectedTableId: 'A',
      onSelectTable: jest.fn(),
    });

    expect(selectedRowIndex()).toBe(rowIndexForStage(a.confirmationStage));

    clickNext();

    await waitFor(() =>
      expect(selectedRowIndex()).toBe(rowIndexForStage(b.confirmationStage))
    );
  });
});

// A table with nothing recorded against it opens on the layer entryConfirmationStage()
// derives — Special Areas — rather than at the bottom of a ladder that is no longer climbed.
// The stage itself is not written: that would dirty the document just by looking at a table.
describe('PageTableEditor — entering a table with no confirmation stage', () => {
  const selectedRowIndex = () =>
    screen
      .getAllByTestId('layer-row')
      .findIndex(
        (row) => window.getComputedStyle(row).backgroundColor !== 'transparent'
      );

  async function renderStaged(props) {
    stagedGridEditorEnabled.mockReturnValue(true);
    const view = render(
      <PageTableEditor page={0} onChange={jest.fn()} {...props} />
    );
    await screen.findByTestId('staged-editor');
    return view;
  }

  test.each([
    ['no stage at all', undefined],
    ['a null stage', null],
    ['stage 0', 0],
  ])('opens on Special Areas for a table with %s', async (_label, stage) => {
    const onChange = jest.fn();
    const a = { ...TABLE_A, confirmationStage: stage };

    await renderStaged({
      metadata: metadataWith([a, TABLE_B]),
      selectedTableId: 'A',
      onChange,
    });

    await waitFor(() =>
      expect(selectedRowIndex()).toBe(
        LAYER_KEY_ORDER.indexOf(layerKeyForStage(entryConfirmationStage()))
      )
    );
  });

  // Looking at a table is not an edit, so nothing is written and the document stays clean.
  test('writes nothing to the document on entry', async () => {
    const onChange = jest.fn();
    const a = { ...TABLE_A, confirmationStage: 0 };

    await renderStaged({
      metadata: metadataWith([a, TABLE_B]),
      selectedTableId: 'A',
      onChange,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  test('opens a table already part-way up the ladder where it left off', async () => {
    const a = { ...TABLE_A, confirmationStage: 2 };

    await renderStaged({
      metadata: metadataWith([a, TABLE_B]),
      selectedTableId: 'A',
    });

    expect(selectedRowIndex()).toBe(
      LAYER_KEY_ORDER.indexOf(layerKeyForStage(2))
    );
  });
});
