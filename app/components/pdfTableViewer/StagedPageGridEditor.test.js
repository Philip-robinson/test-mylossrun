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

    it('shows each table label (name + cols × rows)', async () => {
      const { container } = await renderLoaded(baseProps({ selectedTableId: 't1' }));
      const label = container.querySelector(
        '[data-testid="selected-label"][data-tableid="t1"]'
      );
      expect(label.querySelector('[data-testid="selected-label-name"]')).toHaveTextContent(
        'Alpha'
      );
      expect(label.querySelector('[data-testid="selected-label-size"]')).toHaveTextContent(
        '2 × 2'
      );
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

  // Every table on the page carries a boundary; only the selected one is drawn in the border
  // colour and only it can be dragged. The colours are var(--…) values jsdom drops, so
  // data-selected is what states which is which.
  describe('every table on the page is drawn', () => {
    const boundaries = (container) =>
      container.querySelectorAll('[data-testid="table-boundary"]');

    // beta joined under alpha's grid: on the page, but off the top-level list.
    const joined = () => [
      { ...alpha(), grid: [['t1', 't2']], next: { t2: beta() } },
    ];

    it('draws one boundary per table in the boundary pass', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      const rects = boundaries(container);
      expect(rects).toHaveLength(2);
      expect(
        [...rects].map((r) => r.getAttribute('data-tableid'))
      ).toEqual(['t1', 't2']);
      expect(
        [...rects].map((r) => r.getAttribute('data-selected'))
      ).toEqual(['true', 'false']);
    });

    it('draws one boundary per table in the contents pass too', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't2', editorMode: 'grid' })
      );
      const rects = boundaries(container);
      expect(rects).toHaveLength(2);
      expect(
        [...rects].map((r) => r.getAttribute('data-selected'))
      ).toEqual(['false', 'true']);
    });

    it('gives the four draggable edges to the selected table alone', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      const hits = container.querySelectorAll('[data-testid="hit-line"]');
      expect(hits).toHaveLength(4);
      expect(
        [...hits].every((h) => h.getAttribute('data-tableid') === 't1')
      ).toBe(true);
    });

    it('selects an unselected table when its rectangle is clicked', async () => {
      const onSelectTable = jest.fn();
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1', onSelectTable })
      );
      // A client coordinate maps to a fraction by /PIXELS, so beta's 0.3..0.4 is 300..400.
      // The click lands inside beta, well clear of alpha at 0..100.
      fireEvent.click(container.querySelector('svg'), {
        clientX: 350,
        clientY: 350,
      });
      expect(onSelectTable).toHaveBeenCalledWith('t2');
    });

    it('draws a table joined under another table on the same page', async () => {
      const { container } = await renderLoaded(
        baseProps({ metadataTables: joined(), selectedTableId: 't1' })
      );
      expect(
        [...boundaries(container)].map((r) => r.getAttribute('data-tableid'))
      ).toEqual(['t1', 't2']);
    });
  });

  // The Title tool sets metadata.tables[].title. Everything downstream of that field — the
  // calculate-cells request, the merge back, the left list's title line — already exists;
  // this is the gesture that fills it in.
  describe('the Title tool', () => {
    const titleProps = (overrides = {}) =>
      baseProps({
        selectedTableId: 't1',
        editorMode: 'grid',
        tool: 'special',
        specialTool: 'title',
        ...overrides,
      });

    it('writes the drawn rectangle onto the selected table', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(titleProps({ onEditTables }));
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 500, clientY: 500 });
      fireEvent.mouseMove(window, { clientX: 700, clientY: 560 });
      fireEvent.mouseUp(window, { clientX: 700, clientY: 560 });

      const written = lastList(onEditTables).find((t) => t.tableId === 't1');
      expect(written.title.bounds.left).toBeCloseTo(0.5, 5);
      expect(written.title.bounds.top).toBeCloseTo(0.5, 5);
      expect(written.title.bounds.width).toBeCloseTo(0.2, 5);
      expect(written.title.bounds.height).toBeCloseTo(0.06, 5);
      expect(written.title.text).toBe('');
      expect(written.title.confidence).toBe(0);
    });

    it('treats a sub-threshold press as a click and writes no title', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(titleProps({ onEditTables }));
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 500, clientY: 500 });
      fireEvent.mouseMove(window, { clientX: 501, clientY: 501 });
      fireEvent.mouseUp(window, { clientX: 501, clientY: 501 });
      expect(onEditTables).not.toHaveBeenCalled();
    });

    it('is not clamped to the table: a title may be drawn above it', async () => {
      const onEditTables = jest.fn();
      // alpha sits at fraction 0..0.1; the drag runs well above and left of it.
      const below = { ...alpha(), bounds: { left: 0.2, top: 0.2, width: 0.1, height: 0.1 } };
      const { container } = await renderLoaded(
        titleProps({ metadataTables: [below], onEditTables })
      );
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 150, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 350, clientY: 160 });
      fireEvent.mouseUp(window, { clientX: 350, clientY: 160 });

      const written = lastList(onEditTables).find((t) => t.tableId === 't1');
      expect(written.title.bounds.top).toBeCloseTo(0.1, 5);
      expect(written.title.bounds.top).toBeLessThan(below.bounds.top);
    });

    it('draws the title rect while the Special Areas layer is on, and not while it is off',
      async () => {
        const titled = {
          ...alpha(),
          title: { bounds: { left: 0.5, top: 0.5, width: 0.2, height: 0.06 }, text: '', confidence: 0 },
        };
        const { rerender, container } = await renderLoaded(
          titleProps({ metadataTables: [titled] })
        );
        expect(screen.getByTestId('title-rect')).toBeInTheDocument();

        rerender(
          <StagedPageGridEditor
            {...titleProps({
              metadataTables: [titled],
              specialTool: null,
              tool: null,
              layerVisibility: { rows: true, columns: true, special: false, colours: true },
            })}
          />
        );
        expect(container.querySelector('[data-testid="title-rect"]')).toBeNull();
      });

    it('gives the title four draggable sides only while the tool is armed', async () => {
      const titled = {
        ...alpha(),
        title: { bounds: { left: 0.5, top: 0.5, width: 0.2, height: 0.06 }, text: '', confidence: 0 },
      };
      const { container, rerender } = await renderLoaded(
        titleProps({ metadataTables: [titled] })
      );
      expect(
        container.querySelectorAll('[data-testid="title-hit-line"]')
      ).toHaveLength(4);

      rerender(
        <StagedPageGridEditor
          {...titleProps({ metadataTables: [titled], specialTool: null })}
        />
      );
      expect(
        container.querySelectorAll('[data-testid="title-hit-line"]')
      ).toHaveLength(0);
    });
  });

  // Both labels follow every drawn boundary. The Link label states a table's part in a
  // linked group, and opens or ends the linking session that forms one.
  describe('the per-table labels', () => {
    const linked = () => [
      { ...alpha(), name: 'Root', next: { t2: { ...beta(), name: 'Child' } } },
    ];

    const labels = (container, testid) =>
      [...container.querySelectorAll(`[data-testid="${testid}"]`)];

    it('draws a name label and a link label for every table', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      expect(labels(container, 'selected-label')).toHaveLength(2);
      expect(labels(container, 'link-label')).toHaveLength(2);
    });

    it('colours the selected table label apart from the rest', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      expect(
        labels(container, 'selected-label').map((l) => l.getAttribute('data-colour'))
      ).toEqual(['border', 'grey']);
    });

    it('reads Selected for a table in no group', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1' })
      );
      expect(
        labels(container, 'link-label').map((l) => l.textContent)
      ).toEqual(['Selected', 'Selected']);
    });

    it('reads Linked for a root and Linked to for its member', async () => {
      const { container } = await renderLoaded(
        baseProps({ metadataTables: linked(), selectedTableId: 't1' })
      );
      expect(
        labels(container, 'link-label').map((l) => l.textContent)
      ).toEqual(['Linked', 'Linked to Root']);
    });

    it('reads End Linking, in the emphasis colour, for the session root', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1', linkingRootId: 't1' })
      );
      const [first, second] = labels(container, 'link-label');
      expect(first).toHaveTextContent('End Linking');
      expect(first).toHaveAttribute('data-colour', 'emphasis');
      expect(second).toHaveTextContent('Selected');
    });

    it('opens a session from a Selected label and ends it from End Linking', async () => {
      const onToggleLinking = jest.fn();
      const { container, rerender } = await renderLoaded(
        baseProps({ selectedTableId: 't1', onToggleLinking })
      );
      fireEvent.click(labels(container, 'link-label')[0]);
      expect(onToggleLinking).toHaveBeenCalledWith('t1');

      onToggleLinking.mockClear();
      rerender(
        <StagedPageGridEditor
          {...baseProps({
            selectedTableId: 't1',
            linkingRootId: 't1',
            onToggleLinking,
          })}
        />
      );
      fireEvent.click(labels(container, 'link-label')[0]);
      expect(onToggleLinking).toHaveBeenCalledWith(null);
    });

    // The contents pass is about one table's insides; forming groups belongs to the boundary
    // pass, where the Pages list that picks the members is on screen.
    it('takes no click on any link label in the contents pass', async () => {
      const onToggleLinking = jest.fn();
      const { container } = await renderLoaded(
        baseProps({
          selectedTableId: 't1',
          editorMode: 'grid',
          onToggleLinking,
        })
      );
      labels(container, 'link-label').forEach((l) => fireEvent.click(l));
      expect(onToggleLinking).not.toHaveBeenCalled();
    });

    it('still shows the link labels in the contents pass', async () => {
      const { container } = await renderLoaded(
        baseProps({ selectedTableId: 't1', editorMode: 'grid' })
      );
      expect(labels(container, 'link-label')).toHaveLength(2);
    });

    it('takes no click on a Linked to label', async () => {
      const onToggleLinking = jest.fn();
      const { container } = await renderLoaded(
        baseProps({
          metadataTables: linked(),
          selectedTableId: 't1',
          onToggleLinking,
        })
      );
      fireEvent.click(labels(container, 'link-label')[1]);
      expect(onToggleLinking).not.toHaveBeenCalled();
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
      expect(toast).not.toHaveBeenCalled();
    });

    // The finders refuse a hint straying outside the unit page at all, so a rectangle
    // stored with an edge over the page could never be read — and an unread region is
    // flagged for review for ever with nothing on the review screen to correct it.
    it('trims a rubber-band drag that runs off the page rather than refusing it', async () => {
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
      // 0.6,0.6 to 1.2,1.2 — over the right and bottom edges, clear of alpha and beta.
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 600, clientY: 600 });
      fireEvent.mouseMove(window, { clientX: 1200, clientY: 1200 });
      fireEvent.mouseUp(window, { clientX: 1200, clientY: 1200 });

      const created = lastList(onEditTables).find(
        (t) => t.tableId === onCreatedTable.mock.calls[0][0]
      );
      expect(created.bounds.left).toBeCloseTo(0.6, 6);
      expect(created.bounds.top).toBeCloseTo(0.6, 6);
      expect(created.bounds.width).toBeCloseTo(0.4, 6);
      expect(created.bounds.height).toBeCloseTo(0.4, 6);
      // The axis sums are rebuilt from the trimmed rectangle, not the drawn one.
      expect(created.columnWidths[0].value).toBeCloseTo(0.4, 6);
      expect(created.rowHeights[0].value).toBeCloseTo(0.4, 6);
      expect(toast).not.toHaveBeenCalled();
    });

    it('still refuses a rubber-band drag lying wholly off the page', async () => {
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
      // Entirely past the right edge: trimming leaves it no width at all.
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 1100, clientY: 600 });
      fireEvent.mouseMove(window, { clientX: 1300, clientY: 700 });
      fireEvent.mouseUp(window, { clientX: 1300, clientY: 700 });

      expect(onEditTables).not.toHaveBeenCalled();
      expect(onCreatedTable).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledTimes(1);
    });

    it('reports a rejected rubber-band drag rather than failing silently', async () => {
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
      // Drawn over alpha, which occupies the page's top-left corner: an overlap, so
      // buildManualTable refuses it.
      const svg = container.querySelector('svg');
      fireEvent.mouseDown(svg, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(window, { clientX: 60, clientY: 60 });
      fireEvent.mouseUp(window, { clientX: 60, clientY: 60 });

      expect(onEditTables).not.toHaveBeenCalled();
      expect(onCreatedTable).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledTimes(1);
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

    // The Title tool sets the title rectangle, so it is drawn with the other special areas.
    // A merged-cell block has no renderer here.
    it('draws a title rectangle with the special areas, and no merged-cell block', async () => {
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
      expect(screen.getByTestId('title-rect')).toBeInTheDocument();
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

    // A Special tool acts on a press anywhere in the table, so a press that happened to
    // land on a divider must do what the tool is for and not move the divider. The grid
    // lines stay drawn; only the hit line that would take the press is withheld.
    describe.each([
      ['header'],
      ['title'],
      ['hideRow'],
      ['sectionTitle'],
      ['colouredRows'],
      ['colouredColumns'],
      ['colouredTable'],
      ['colouredCell'],
      ['colouredArea'],
    ])('with the %s Special tool armed', (specialTool) => {
      it('offers no grid-line hit lines to drag', async () => {
        await renderLoaded(gridProps({ tool: 'special', specialTool }));
        expect(screen.queryByTestId('row-hit-line')).toBeNull();
        expect(screen.queryByTestId('column-hit-line')).toBeNull();
      });

      it('still draws the grid lines', async () => {
        const { container } = await renderLoaded(
          gridProps({ tool: 'special', specialTool })
        );
        expect(
          container.querySelectorAll('[data-testid="row-line"]').length
        ).toBeGreaterThan(0);
        expect(
          container.querySelectorAll('[data-testid="column-line"]').length
        ).toBeGreaterThan(0);
      });
    });

    it('leaves the grid lines draggable when Special is armed with no tool picked', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(
        gridProps({ tool: 'special', specialTool: null, onEditTables })
      );
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });
      expect(editedAlpha(onEditTables).rowHeights[0].value).toBeCloseTo(0.07, 5);
    });
  });

  // The Rows and Columns tools work by press, optional drag, and release:
  //   press + release on a line        -> delete it
  //   press + drag + release on a line -> move it
  //   press + release in empty space   -> a new line there
  //   press + drag + release in space  -> a new line at the release point
  describe('the Rows tool', () => {
    it('deletes the line a press and release lands on, keeping the cells above', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'rows', onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });

      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights).toHaveLength(1);
      expect(edited.rowHeights[0].value).toBeCloseTo(0.1, 6);
    });

    it('moves the line a press and drag lands on, rather than deleting it', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'rows', onEditTables }));
      const hit = screen.getByTestId('row-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 70 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 70 });

      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights).toHaveLength(2);
      expect(edited.rowHeights[0].value).toBeCloseTo(0.07, 5);
    });

    it('creates a line where a press and release lands in empty space', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      // Row 0 spans fractions 0..0.05; screen y 10 is fraction 0.01.
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 25,
        clientY: 10,
      });
      fireEvent.mouseUp(window, { clientX: 25, clientY: 10 });

      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights).toHaveLength(3);
      expect(edited.rowHeights[0].value).toBeCloseTo(0.01, 6);
      expect(edited.bounds.height).toBeCloseTo(0.1, 6);
    });

    it('creates the line at the release point when the press is dragged', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      // Press in row 0 at fraction 0.01, release in row 1 at fraction 0.09.
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 25,
        clientY: 10,
      });
      fireEvent.mouseMove(window, { clientX: 25, clientY: 90 });
      fireEvent.mouseUp(window, { clientX: 25, clientY: 90 });

      const edited = editedAlpha(onEditTables);
      expect(edited.rowHeights.map((r) => r.value)).toEqual([
        expect.closeTo(0.05, 6),
        expect.closeTo(0.04, 6),
        expect.closeTo(0.01, 6),
      ]);
    });

    it('draws the line being created while the press is held', async () => {
      const { container } = await renderLoaded(gridProps({ tool: 'rows' }));
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 25,
        clientY: 10,
      });
      expect(screen.getByTestId('new-line-preview')).toBeInTheDocument();
      fireEvent.mouseUp(window, { clientX: 25, clientY: 10 });
      expect(screen.queryByTestId('new-line-preview')).toBeNull();
    });

    it('edits nothing when the press falls outside the table', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'rows', onEditTables })
      );
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 800,
        clientY: 800,
      });
      fireEvent.mouseUp(window, { clientX: 800, clientY: 800 });
      expect(onEditTables).not.toHaveBeenCalled();
    });
  });

  describe('the Columns tool', () => {
    it('deletes the line a press and release lands on, keeping the cells to the left', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'columns', onEditTables }));
      const hit = screen.getByTestId('column-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
      expect(editedAlpha(onEditTables).columnWidths).toHaveLength(1);
    });

    it('moves the line a press and drag lands on', async () => {
      const onEditTables = jest.fn();
      await renderLoaded(gridProps({ tool: 'columns', onEditTables }));
      const hit = screen.getByTestId('column-hit-line');
      fireEvent.mouseDown(hit, { clientX: 50, clientY: 50 });
      fireEvent.mouseMove(window, { clientX: 70, clientY: 50 });
      fireEvent.mouseUp(window, { clientX: 70, clientY: 50 });

      const edited = editedAlpha(onEditTables);
      expect(edited.columnWidths).toHaveLength(2);
      expect(edited.columnWidths[0].value).toBeCloseTo(0.07, 5);
    });

    it('creates a line where a press and release lands in empty space', async () => {
      const onEditTables = jest.fn();
      const { container } = await renderLoaded(
        gridProps({ tool: 'columns', onEditTables })
      );
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 10,
        clientY: 25,
      });
      fireEvent.mouseUp(window, { clientX: 10, clientY: 25 });

      const edited = editedAlpha(onEditTables);
      expect(edited.columnWidths).toHaveLength(3);
      expect(edited.columnWidths[0].value).toBeCloseTo(0.01, 6);
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

    // Alpha is a 2x2 grid over the page's top-left tenth, so screen (25, 75) is row 1
    // column 0 and screen (75, 25) is row 0 column 1.
    const CELL_R1C0 = { left: 0, top: 0.05, width: 0.05, height: 0.05 };
    const CELL_R0C1 = { left: 0.05, top: 0, width: 0.05, height: 0.05 };

    it('Cell: a click picks the one cell it landed in', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredCell',
          pendingSelection: null,
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 25,
        clientY: 75,
      });
      expect(onPendingSelectionChange).toHaveBeenCalledWith({
        kind: 'cell',
        rows: [],
        columns: [],
        rect: CELL_R1C0,
        cell: { row: 1, column: 0 },
      });
    });

    it('Cell: clicking the picked cell again clears the selection', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredCell',
          pendingSelection: {
            kind: 'cell',
            rows: [],
            columns: [],
            rect: CELL_R1C0,
            cell: { row: 1, column: 0 },
          },
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
        cell: null,
      });
    });

    it('Cell: clicking another cell moves the selection rather than adding to it', async () => {
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredCell',
          pendingSelection: {
            kind: 'cell',
            rows: [],
            columns: [],
            rect: CELL_R1C0,
            cell: { row: 1, column: 0 },
          },
          onPendingSelectionChange,
        })
      );
      fireEvent.click(container.querySelector('svg'), {
        clientX: 75,
        clientY: 25,
      });
      expect(onPendingSelectionChange).toHaveBeenCalledWith({
        kind: 'cell',
        rows: [],
        columns: [],
        rect: CELL_R0C1,
        cell: { row: 0, column: 1 },
      });
    });

    it('Cell: a click inside a saved area selects it rather than picking a cell', async () => {
      const onSelectColouredArea = jest.fn();
      const onPendingSelectionChange = jest.fn();
      const { container } = await renderLoaded(
        gridProps({
          tool: 'special',
          specialTool: 'colouredCell',
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
      await waitFor(() =>
        expect(
          document.querySelector(
            '[data-testid="selected-label"][data-tableid="t2"]'
          )
        ).toHaveTextContent('Beta')
      );
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
      // Beta spans [0.3..0.4]: a press and release at (350, 350) is inside its single row.
      fireEvent.mouseDown(container.querySelector('svg'), {
        clientX: 350,
        clientY: 350,
      });
      fireEvent.mouseUp(window, { clientX: 350, clientY: 350 });
      const list = lastList(onEditTables);
      expect(list.map((t) => t.tableId)).toEqual(['t1']);
      expect(list[0].next.t2.rowHeights).toHaveLength(2);
    });
  });
});

// The help overlay cuts its hole from the rect of the element carrying a tip's help id,
// so the tip about the table needs an element that is the table's box and nothing wider.
// Alpha spans page fractions [0..0.1] and Beta [0.3..0.4], which on the mocked 100x100
// image are the screen boxes asserted here.
describe('StagedPageGridEditor — the box help points at', () => {
  const frames = (container) =>
    Array.from(container.querySelectorAll('[data-testid="table-help-frame"]'));

  it("draws one frame, over the selected table's box", async () => {
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't1' })
    );

    const [frame, ...rest] = frames(container);

    expect(rest).toHaveLength(0);
    expect(frame).toHaveAttribute('data-tableid', 't1');
    expect(frame.style.left).toBe('0px');
    expect(frame.style.top).toBe('0px');
    expect(frame.style.width).toBe('100px');
    expect(frame.style.height).toBe('100px');
  });

  it('moves to whichever table is selected', async () => {
    const { container } = await renderLoaded(
      baseProps({ selectedTableId: 't2' })
    );

    const [frame] = frames(container);

    expect(frame).toHaveAttribute('data-tableid', 't2');
    expect(frame.style.left).toBe('300px');
    expect(frame.style.top).toBe('300px');
  });

  it('draws none where the page holds no table at all', async () => {
    const { container } = await renderLoaded(baseProps({ metadataTables: [] }));

    expect(frames(container)).toHaveLength(0);
  });
});
