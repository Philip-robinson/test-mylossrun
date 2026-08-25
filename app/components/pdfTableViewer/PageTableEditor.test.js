import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PageTableEditor from 'components/pdfTableViewer/PageTableEditor';
import { makeDefaultCell } from 'components/pdfTableViewer/tableSupportUtils';
import {
  getImage,
  getThumbnails,
  getMetadata,
  saveTables,
  findTables,
  findGridLines,
  calculateCells,
} from 'services/images';
import { stagedGridEditorEnabled, baseImageWidthPx } from 'config';
import toast from 'react-hot-toast';

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
    expect(getImage).toHaveBeenCalledWith(
      PDF_ID,
      0,
      Math.round(400 * 0.95),
      'PROCESSED'
    );
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

describe('PageTableEditor — the two passes', () => {
  const lastStagedProps = () =>
    mockStagedProps.mock.calls[mockStagedProps.mock.calls.length - 1][0];

  // Two tables on the page, so Next and Previous have somewhere to wrap to.
  const twoTables = () => metadataWith([TABLE_A, TABLE_B]);

  const renderStaged = async (props = {}) => {
    stagedGridEditorEnabled.mockReturnValue(true);
    const view = render(
      <PageTableEditor
        metadata={twoTables()}
        page={0}
        onChange={jest.fn()}
        selectedTableId={'A'}
        onSelectTable={jest.fn()}
        {...props}
      />
    );
    await screen.findByTestId('staged-editor');
    return view;
  };

  test('flag OFF: renders the legacy UI and no staged chrome', async () => {
    stagedGridEditorEnabled.mockReturnValue(false);
    render(
      <PageTableEditor metadata={twoTables()} page={0} onChange={jest.fn()} />
    );
    await screen.findByTestId('middle-image');
    expect(screen.queryByTestId('layers-panel')).toBeNull();
    expect(screen.queryByTestId('staged-editor')).toBeNull();
  });

  test('flag ON: renders the scale selector, dim toggle, LayersPanel and the editor', async () => {
    await renderStaged();
    expect(screen.getByTestId('scale-value')).toBeInTheDocument();
    expect(screen.getByTestId('dim-document-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('layers-panel')).toBeInTheDocument();
  });

  test('the Raw / Processed toggle is gone: the Colours layer replaces it', async () => {
    await renderStaged();
    expect(screen.queryByTestId('image-style-toggle')).toBeNull();
  });

  describe('borderMode', () => {
    test('opens in borderMode: Borders alone, no tool-bar, and the RAW rendering', async () => {
      await renderStaged();
      expect(screen.getAllByTestId('layer-row')).toHaveLength(1);
      expect(screen.getByText('Borders')).toBeInTheDocument();
      expect(screen.queryByTestId('grid-toolbar')).toBeNull();
      expect(lastStagedProps().editorMode).toBe('border');
      await waitFor(() =>
        expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, baseImageWidthPx(), 'RAW')
      );
    });

    test('offers the boundary actions in the Options block', async () => {
      await renderStaged();
      expect(screen.getByTestId('opt-delete-table')).toBeInTheDocument();
      expect(screen.getByTestId('opt-create-table')).toBeInTheDocument();
    });
  });

  describe('Validate Tables', () => {
    test('saves, then moves to gridMode at the page first table', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onSelectTable = jest.fn();
      await renderStaged({ onSave, onSelectTable, selectedTableId: 'B' });

      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-validate-tables'));
      });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSelectTable).toHaveBeenCalledWith('A');
      await waitFor(() =>
        expect(lastStagedProps().editorMode).toBe('grid')
      );
      expect(screen.getByTestId('grid-toolbar')).toBeInTheDocument();
      expect(screen.queryByTestId('layers-validate-tables')).toBeNull();
    });

    test('a failed save abandons the switch and stays in borderMode', async () => {
      const onSave = jest.fn().mockResolvedValue(false);
      await renderStaged({ onSave });

      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-validate-tables'));
      });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(lastStagedProps().editorMode).toBe('border');
      expect(screen.getByTestId('layers-validate-tables')).toBeInTheDocument();
    });
  });

  describe('gridMode', () => {
    // Get into the contents pass the way a user does.
    const enterGridMode = async (props = {}) => {
      const view = await renderStaged({
        onSave: jest.fn().mockResolvedValue(true),
        ...props,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-validate-tables'));
      });
      await waitFor(() => expect(lastStagedProps().editorMode).toBe('grid'));
      return view;
    };

    test('lists the four toggleable layers and the tool-bar', async () => {
      await enterGridMode();
      expect(screen.getAllByTestId('layer-row')).toHaveLength(4);
      expect(screen.getByTestId('grid-toolbar')).toBeInTheDocument();
    });

    test('every layer starts on', async () => {
      await enterGridMode();
      expect(lastStagedProps().layerVisibility).toEqual({
        rows: true,
        columns: true,
        special: true,
        colours: true,
      });
    });

    test('Colours on requests the PROCESSED rendering; off requests RAW again', async () => {
      await enterGridMode();
      await waitFor(() =>
        expect(getImage).toHaveBeenCalledWith(
          PDF_ID,
          0,
          baseImageWidthPx(),
          'PROCESSED'
        )
      );

      getImage.mockClear();
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('layer-row')[3]);
      });
      await waitFor(() =>
        expect(lastStagedProps().layerVisibility.colours).toBe(false)
      );
      // RAW was fetched for this page and width on entry, so it is served from the cache.
      expect(getImage).not.toHaveBeenCalled();
    });

    test('toggling Colours back again serves the processed rendering from the cache', async () => {
      await enterGridMode();
      await waitFor(() =>
        expect(getImage).toHaveBeenCalledWith(
          PDF_ID,
          0,
          baseImageWidthPx(),
          'PROCESSED'
        )
      );
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('layer-row')[3]);
      });
      getImage.mockClear();
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('layer-row')[3]);
      });
      await waitFor(() =>
        expect(lastStagedProps().layerVisibility.colours).toBe(true)
      );
      expect(getImage).not.toHaveBeenCalled();
    });

    test('turning a layer off reports it to the editor', async () => {
      await enterGridMode();
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('layer-row')[0]);
      });
      await waitFor(() =>
        expect(lastStagedProps().layerVisibility.rows).toBe(false)
      );
    });

    test('arming a tool disarms the one before it, and re-arming disarms it', async () => {
      await enterGridMode();
      fireEvent.click(screen.getByTestId('grid-tool-rows'));
      await waitFor(() => expect(lastStagedProps().tool).toBe('rows'));

      fireEvent.click(screen.getByTestId('grid-tool-columns'));
      await waitFor(() => expect(lastStagedProps().tool).toBe('columns'));

      fireEvent.click(screen.getByTestId('grid-tool-columns'));
      await waitFor(() => expect(lastStagedProps().tool).toBeNull());
    });

    test('the Special tool opens its submenu, and disarming it clears the armed entry', async () => {
      await enterGridMode();
      fireEvent.click(screen.getByTestId('grid-tool-special'));
      expect(await screen.findByTestId('special-tool-menu')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('special-tool-hideRow'));
      await waitFor(() => expect(lastStagedProps().specialTool).toBe('hideRow'));

      fireEvent.click(screen.getByTestId('grid-tool-special'));
      await waitFor(() => expect(lastStagedProps().tool).toBeNull());
      expect(lastStagedProps().specialTool).toBeNull();
      expect(screen.queryByTestId('special-tool-menu')).toBeNull();
    });

    test('the Header tool offers Delete Header, which clears the header', async () => {
      const onChange = jest.fn();
      const withHeader = { ...TABLE_A, headerCount: 1 };
      await enterGridMode({
        metadata: metadataWith([withHeader, TABLE_B]),
        onChange,
      });
      fireEvent.click(screen.getByTestId('grid-tool-special'));
      fireEvent.click(await screen.findByTestId('special-tool-header'));
      fireEvent.click(await screen.findByTestId('opt-delete-header'));

      const list = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(list.find((t) => t.tableId === 'A').headerCount).toBe(0);
    });
  });

  describe('Next and Previous', () => {
    test('Next steps to the next table on the page', async () => {
      const onSelectTable = jest.fn();
      await renderStaged({ selectedTableId: 'A', onSelectTable });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-next'));
      });
      expect(onSelectTable).toHaveBeenCalledWith('B');
    });

    test('Previous steps to the previous table on the page', async () => {
      const onSelectTable = jest.fn();
      await renderStaged({ selectedTableId: 'B', onSelectTable });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-prev'));
      });
      expect(onSelectTable).toHaveBeenCalledWith('A');
    });

    test('Next past the last table on the page moves to the next page', async () => {
      const onNextPage = jest.fn();
      const onSelectTable = jest.fn();
      await renderStaged({
        selectedTableId: 'B',
        onNextPage,
        onSelectTable,
        hasNextPage: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-next'));
      });
      expect(onNextPage).toHaveBeenCalledTimes(1);
      expect(onSelectTable).not.toHaveBeenCalled();
    });

    test('Previous before the first table on the page moves to the previous page', async () => {
      const onPrevPage = jest.fn();
      const onSelectTable = jest.fn();
      await renderStaged({
        selectedTableId: 'A',
        onPrevPage,
        onSelectTable,
        hasPrevPage: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-prev'));
      });
      expect(onPrevPage).toHaveBeenCalledTimes(1);
      expect(onSelectTable).not.toHaveBeenCalled();
    });

    // The page it lands on is chosen by the host; which table it lands on is chosen here.
    test('after a Next that changed page, the first table of the new page is selected', async () => {
      const onSelectTable = jest.fn();
      const metadata = metadataWith([
        TABLE_A,
        TABLE_B,
        { ...TABLE_A, tableId: 'C', name: 'Gamma', pdfPage: 1, tableInPage: 0 },
        { ...TABLE_B, tableId: 'D', name: 'Delta', pdfPage: 1, tableInPage: 1 },
      ]);
      const view = await renderStaged({
        metadata,
        selectedTableId: 'B',
        onSelectTable,
        hasNextPage: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-next'));
      });
      onSelectTable.mockClear();

      // The host answers the page change by re-rendering on the new page.
      view.rerender(
        <PageTableEditor
          metadata={metadata}
          page={1}
          onChange={jest.fn()}
          selectedTableId={'B'}
          onSelectTable={onSelectTable}
        />
      );
      await waitFor(() => expect(onSelectTable).toHaveBeenCalledWith('C'));
    });

    test('after a Previous that changed page, the last table of the new page is selected', async () => {
      const onSelectTable = jest.fn();
      const metadata = metadataWith([
        TABLE_A,
        TABLE_B,
        { ...TABLE_A, tableId: 'C', name: 'Gamma', pdfPage: 1, tableInPage: 0 },
        { ...TABLE_B, tableId: 'D', name: 'Delta', pdfPage: 1, tableInPage: 1 },
      ]);
      const view = await renderStaged({
        metadata,
        page: 1,
        selectedTableId: 'C',
        onSelectTable,
        hasPrevPage: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-prev'));
      });
      onSelectTable.mockClear();

      view.rerender(
        <PageTableEditor
          metadata={metadata}
          page={0}
          onChange={jest.fn()}
          selectedTableId={'C'}
          onSelectTable={onSelectTable}
        />
      );
      await waitFor(() => expect(onSelectTable).toHaveBeenCalledWith('B'));
    });

    // A one-page document cannot change page, so the document's wrap happens within it.
    test('on a one-page document Next wraps from the last table to the first', async () => {
      const onSelectTable = jest.fn();
      await renderStaged({
        selectedTableId: 'B',
        onSelectTable,
        hasPrevPage: false,
        hasNextPage: false,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-next'));
      });
      expect(onSelectTable).toHaveBeenCalledWith('A');
    });

    test('on a one-page document Previous wraps from the first table to the last', async () => {
      const onSelectTable = jest.fn();
      await renderStaged({
        selectedTableId: 'A',
        onSelectTable,
        hasPrevPage: false,
        hasNextPage: false,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-prev'));
      });
      expect(onSelectTable).toHaveBeenCalledWith('B');
    });

    test('a page change by any other route leaves the selection alone', async () => {
      const onSelectTable = jest.fn();
      const metadata = metadataWith([
        TABLE_A,
        TABLE_B,
        { ...TABLE_A, tableId: 'C', name: 'Gamma', pdfPage: 1, tableInPage: 0 },
      ]);
      const view = await renderStaged({
        metadata,
        selectedTableId: 'A',
        onSelectTable,
      });
      onSelectTable.mockClear();

      // A thumbnail click, say: the page changes without Next or Previous being used.
      view.rerender(
        <PageTableEditor
          metadata={metadata}
          page={1}
          onChange={jest.fn()}
          selectedTableId={'A'}
          onSelectTable={onSelectTable}
        />
      );
      await screen.findByTestId('staged-editor');
      expect(onSelectTable).not.toHaveBeenCalled();
    });
  });

  describe('the coloured-area tools', () => {
    const enterColouredRows = async (props = {}) => {
      const view = await renderStaged({
        onSave: jest.fn().mockResolvedValue(true),
        ...props,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-validate-tables'));
      });
      await waitFor(() => expect(lastStagedProps().editorMode).toBe('grid'));
      fireEvent.click(screen.getByTestId('grid-tool-special'));
      fireEvent.click(await screen.findByTestId('special-tool-colouredRows'));
      await waitFor(() =>
        expect(lastStagedProps().specialTool).toBe('colouredRows')
      );
      return view;
    };

    test('shows no colour selectors until something is picked', async () => {
      await enterColouredRows();
      expect(screen.queryByTestId('colour-selectors')).toBeNull();
    });

    test('Submit writes one coloured area per picked row, with the draft colours', async () => {
      const onColouredAreasChange = jest.fn();
      await enterColouredRows({ onColouredAreasChange });

      // The editor reports what the user picked, and the colours sampled under it.
      act(() => {
        lastStagedProps().onColourSeed({
          foreground: '#111111',
          background: '#eeeeee',
        });
        lastStagedProps().onPendingSelectionChange({
          kind: 'rows',
          rows: [0],
          columns: [],
          rect: null,
        });
      });

      fireEvent.click(await screen.findByTestId('opt-colour-submit'));

      expect(onColouredAreasChange).toHaveBeenCalled();
      const [, areas] =
        onColouredAreasChange.mock.calls[
          onColouredAreasChange.mock.calls.length - 1
        ];
      expect(areas).toHaveLength(1);
      // TABLE_A is a single row spanning its whole bounds.
      expect(areas[0]).toMatchObject({
        left: 0,
        top: 0,
        width: 0.04,
        height: 0.04,
        foreground: '#111111',
        background: '#eeeeee',
      });
    });

    test('Submit clears the picked rows and leaves the tool armed', async () => {
      await enterColouredRows();
      act(() => {
        lastStagedProps().onPendingSelectionChange({
          kind: 'rows',
          rows: [0],
          columns: [],
          rect: null,
        });
      });
      fireEvent.click(await screen.findByTestId('opt-colour-submit'));
      await waitFor(() => expect(lastStagedProps().pendingSelection).toBeNull());
      expect(lastStagedProps().specialTool).toBe('colouredRows');
    });
  });

  describe('confirmationStage', () => {
    test('no write made through the editor changes it', async () => {
      const onChange = jest.fn();
      const staged = { ...TABLE_A, confirmationStage: 3 };
      await renderStaged({
        metadata: metadataWith([staged, TABLE_B]),
        onChange,
      });

      // An edit reported by the editor, exactly as the overlay would report it.
      act(() => {
        lastStagedProps().onEditTables([
          { ...staged, headerCount: 1 },
          TABLE_B,
        ]);
      });
      // borderMode holds the edit until the pass is left, so step to the next table.
      await act(async () => {
        fireEvent.click(screen.getByTestId('layers-next'));
      });

      const written = onChange.mock.calls
        .map(([list]) => list.find((t) => t.tableId === 'A'))
        .filter(Boolean);
      written.forEach((t) => expect(t.confirmationStage).toBe(3));
    });
  });
});
