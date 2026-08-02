import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PDFEditTableStructure from 'components/pdfTableViewer/PDFEditTableStructure';
import { PageImageWithOverlay } from 'components/pdfTableViewer/PageImageWithOverlay';
import {
  gridSquareBounds,
  cellAt,
  makeDefaultCell,
  normaliseTableBounds,
  fillGridCells,
  metadataTablesToOverlay,
  reconcileCells,
  NEW,
  identityMap,
  splitMap,
  splitMapBelow,
  mergeMap,
  tableSizeLabel,
  linkedTablesWithParents,
  buildCalcHint,
  pickCalcResultTable,
  buildCalcReplacement,
  selectLowConfidenceCells,
  recalcCellBounds,
  buildRecalcHint,
  mergeRecalcCells,
  recalcShortfallMessage,
  chooseCellTextPlacement,
  CONFIDENCE_COLOUR_VARS,
} from 'components/pdfTableViewer/tableSupportUtils';
// Config values are only ever used as INPUTS here (to build a fixture or to derive the
// expected style), never asserted as literals, so these tests keep passing when a
// constant changes.
import {
  confirmedTableStage,
  confirmedTickBadgeSizePx,
  gridLineColour,
  readyTableStage,
} from 'config';
import {
  getImage,
  getThumbnails,
  getMetadata,
  saveTables,
  findTables,
  calculateCells,
} from 'services/images';
import toast from 'react-hot-toast';

jest.mock('services/images', () => ({
  getImage: jest.fn(),
  getThumbnails: jest.fn(),
  getMetadata: jest.fn(),
  saveTables: jest.fn(),
  getTableImages: jest.fn(),
  findTables: jest.fn(),
  calculateCells: jest.fn(),
}));

// Config is real except for the staged-editor flag, which is made controllable. The real
// default is now true (the staged editor ships on), but the bulk of this file's tests
// target the LEGACY editor path, so the flag is pinned OFF here by default; the
// staged-behaviour describe (page nav, default selection, change-tracking/recalc) opts
// back in. This keeps the legacy tests valid without rewriting them for the new editor.
jest.mock('config', () => {
  const actual = jest.requireActual('config');
  return {
    __esModule: true,
    ...actual,
    stagedGridEditorEnabled: jest.fn(() => false),
  };
});

// The Grid Editor (TableLinkageEditor) is mounted by the editor as a full-editor overlay.
// These tests exercise the
// mounting/unmounting contract only, not the panel internals, so its component is
// mocked to a simple marker that renders iff it received a rootTable prop. The module's
// pure named exports (e.g. hasSavedGrid, used by the editor's size labels) stay real.
// The mocked Cancel/Save controls let the Task 16 tests drive the host's mode handling without
// the real drag/drop editor. `global.__LINK_SAVE_TABLES__`, when set, is the list the mocked
// Save hands back; it defaults to the host's own list, i.e. a no-op save.
jest.mock('components/pdfTableViewer/TableLinkageEditor', () => ({
  __esModule: true,
  ...jest.requireActual('components/pdfTableViewer/TableLinkageEditor'),
  default: (props) =>
    props.rootTable ? (
      <div data-testid={'link-dialog'}>
        <button data-testid={'link-dialog-cancel'} onClick={props.onCancel}>
          {'cancel'}
        </button>
        <button
          data-testid={'link-dialog-save'}
          onClick={() =>
            props.onSave(global.__LINK_SAVE_TABLES__ ?? props.tables)
          }
        >
          {'save'}
        </button>
      </div>
    ) : null,
}));

// The review panel is mounted by the host in review mode (Task 16). These tests exercise the
// mounting contract and the props the host supplies, not the panel's internals, so it is
// mocked to a marker exposing tableId plus an Exit control.
//
// It also reports the ids of the `tables` list it was handed, and offers an Edit control that
// fires the host's shared commit path with whatever `global.__REVIEW_EDIT_TABLES__` holds. A
// corrected cell reaches the local metadata that way, so what these tests check is the wiring,
// not how the panel decides what to write.
//
// Every prop it was last rendered with is recorded on `global.__REVIEW_PANEL_PROPS__`, so a
// callback prop can be asserted by identity and invoked directly.
jest.mock('components/pdfTableViewer/ReviewTablePanel', () => ({
  __esModule: true,
  default: (props) => {
    global.__REVIEW_PANEL_PROPS__ = props;
    return (
      <div
        data-testid={'review-panel'}
        data-tableid={props.tableId}
        data-tableids={(props.tables ?? []).map((t) => t.tableId).join('|')}
      >
        <button data-testid={'review-panel-exit'} onClick={props.onExit}>
          {'exit'}
        </button>
        <button
          data-testid={'review-panel-edit'}
          onClick={() => props.onEditTables(global.__REVIEW_EDIT_TABLES__)}
        >
          {'edit'}
        </button>
      </div>
    );
  },
}));

// Messages use react-hot-toast (the same snackbar mechanism as the toolbar's Export
// button): toast() for "Not enough room" and toast.error() for load/save/image
// failures. The <Toaster/> lives in the app layout, not in this component, so assert
// on the mocked calls rather than on rendered DOM text.
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.dismiss = jest.fn();
  return { __esModule: true, default: toast };
});

// PageTableEditor is the real staged editor by default (so the existing rendering tests keep
// exercising it). The Task 14 host-behaviour tests below install a lightweight stand-in via
// `global.__PTE_MOCK__` that surfaces the host-supplied nav/selection/change props as simple
// controls, so the host's page-nav, selection-defaulting, change-tracking and
// recalc-on-page-change logic can be driven directly without the staged editor's internals.
jest.mock('components/pdfTableViewer/PageTableEditor', () => {
  const React = require('react');
  const actual = jest.requireActual(
    'components/pdfTableViewer/PageTableEditor'
  ).default;
  return {
    __esModule: true,
    default: (props) =>
      global.__PTE_MOCK__
        ? global.__PTE_MOCK__(props)
        : React.createElement(actual, props),
  };
});

const PDF_ID = '9b2f0c52-7c1e-4f7a-9a0d-1c2b3d4e5f6a';

// Two tables with distinct column/row counts so the size row is unambiguous.
// Real metadata shape: nested `bounds` (fractions 0.0–1.0) and PDFValue arrays
// ({ value, confidence }) for columnWidths / rowHeights.
const METADATA_FIXTURE = {
  name: 'losses.pdf',
  tables: [
    {
      tableId: 't-1',
      name: 'Premium Summary',
      pdfPage: 0,
      bounds: { left: 0.001, top: 0.002, width: 0.003, height: 0.004 },
      columnWidths: [
        { value: 0.005, confidence: 90 },
        { value: 0.006, confidence: 90 },
        { value: 0.007, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.008, confidence: 90 },
        { value: 0.009, confidence: 90 },
      ],
    },
    {
      tableId: 't-2',
      name: 'Loss Detail',
      pdfPage: 1,
      bounds: { left: 0.001, top: 0.002, width: 0.003, height: 0.004 },
      columnWidths: [
        { value: 0.001, confidence: 90 },
        { value: 0.002, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.001, confidence: 90 },
        { value: 0.002, confidence: 90 },
        { value: 0.003, confidence: 90 },
        { value: 0.004, confidence: 90 },
      ],
    },
  ],
  // The immutable per-page origin lists (metadata.pages[].tables): the right-column
  // page headings count these, NOT the editable top-level `tables` list above.
  pages: [
    { page: 0, width: 1.0, height: 2.0, tables: [{ tableId: 'p0-a' }] },
    {
      page: 1,
      width: 1.0,
      height: 2.0,
      tables: [{ tableId: 'p1-a' }, { tableId: 'p1-b' }],
    },
  ],
};

// A table record used for both the rect and grid-line assertions.
const GRID_TABLE = {
  left: 100,
  top: 200,
  width: 18,
  height: 18,
  columnWidths: [5, 6, 7],
  rowHeights: [5, 6, 7],
};

const THUMBNAILS_FIXTURE = {
  images: [
    { image: 'THUMB0', tables: [GRID_TABLE] },
    { image: 'THUMB1', tables: [GRID_TABLE] },
  ],
};

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

// Fire the load event on an <img> with mocked natural dimensions so the SVG
// overlay (gated on onLoad) renders.
function loadImage(img, { w = 100, h = 100 } = {}) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
  fireEvent.load(img);
}

// Drain chained promise microtasks (the mocked services resolve immediately),
// flushing the resulting React state updates inside act(). Used by the fake-timer
// resize tests where waitFor would deadlock against the faked clock.
async function flushAsync() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const DEFAULT_PANE_WIDTH = 400;

beforeEach(() => {
  jest.clearAllMocks();

  // jsdom does not implement scrollIntoView; the host now selects a default table on load
  // (which triggers the scroll-into-view effect), so provide a no-op stub. Individual tests
  // that assert on the call install their own spy.
  Element.prototype.scrollIntoView = jest.fn();

  // The component takes its first measurement synchronously (not via the observer),
  // so a no-op observer is enough for the non-resize tests. The resize tests below
  // install their own observer that captures the callback to simulate a resize.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Report a positive pane width so centreWidth/rightWidth become > 0.
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

  getThumbnails.mockResolvedValue(THUMBNAILS_FIXTURE);
  getImage.mockImplementation((pdfId, page) =>
    Promise.resolve(imageFixture(page))
  );
  getMetadata.mockResolvedValue(METADATA_FIXTURE);
  saveTables.mockResolvedValue({ tables: METADATA_FIXTURE.tables });

  // jsdom exposes `crypto` but not `randomUUID`; stub it so the generated tableId
  // is deterministic and assertable.
  if (!global.crypto) {
    // eslint-disable-next-line no-undef
    global.crypto = {};
  }
  global.crypto.randomUUID = jest.fn(() => 'new-uuid');

  toast.mockClear();
  toast.error.mockClear();
  toast.dismiss.mockClear();
});

describe('PDFEditTableStructure', () => {
  test('on mount fetches thumbnails then the first page image', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() => expect(getThumbnails).toHaveBeenCalled());
    expect(getThumbnails).toHaveBeenCalledWith(PDF_ID, expect.any(Number));

    await waitFor(() => expect(getImage).toHaveBeenCalled());
    expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, expect.any(Number));
  });

  test('requests 95% of the measured pane width', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function () {
        return {
          width: 1000,
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

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(getThumbnails).toHaveBeenCalledWith(PDF_ID, 950)
    );
    await waitFor(() => expect(getImage).toHaveBeenCalledWith(PDF_ID, 0, 950));
  });

  test('renders the three panel titles and the middle title bar showing the PDF name and page number', async () => {
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Document Overview');
    expect(screen.getByText('PAGES')).toBeInTheDocument();
    const titleBar = container.querySelector(
      '[data-testid="middle-title-bar"]'
    );
    expect(titleBar).toBeInTheDocument();
    // The bar shows the loaded PDF name (metadata.name) on the left followed by
    // the 1-based page number for the page displayed in the centre panel.
    await waitFor(() =>
      expect(titleBar).toHaveTextContent('losses.pdf — Page 1')
    );
  });

  test('renders one thumbnail image per returned image, first page at the top', async () => {
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="thumbnail"] img').length
      ).toBe(2)
    );

    const thumbImgs = container.querySelectorAll('[data-testid="thumbnail"] img');
    expect(thumbImgs[0]).toHaveAttribute('src', 'data:image/png;base64,THUMB0');
    expect(thumbImgs[1]).toHaveAttribute('src', 'data:image/png;base64,THUMB1');
  });

  test('clicking a thumbnail re-fetches get-image for that page and swaps the middle image', async () => {
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const middle = await screen.findByTestId('middle-image');
    await waitFor(() =>
      expect(middle.querySelector('img')).toHaveAttribute(
        'src',
        'data:image/png;base64,PAGE0'
      )
    );

    const thumbnails = container.querySelectorAll('[data-testid="thumbnail"]');
    await userEvent.click(thumbnails[1]);

    await waitFor(() => {
      const lastCall = getImage.mock.calls[getImage.mock.calls.length - 1];
      expect(lastCall).toEqual([PDF_ID, 1, expect.any(Number)]);
    });

    await waitFor(() =>
      expect(middle.querySelector('img')).toHaveAttribute(
        'src',
        'data:image/png;base64,PAGE1'
      )
    );
  });

  test('shows a loading overlay over the centre panel while the page image loads, then hides it', async () => {
    let resolveImage;
    getImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImage = () => resolve(imageFixture(0));
        })
    );

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    // While the get-image call is pending, the overlay covers the centre panel.
    expect(
      await screen.findByTestId('image-loading-overlay')
    ).toBeInTheDocument();

    // Once the image resolves, the overlay is removed.
    resolveImage();
    await waitFor(() =>
      expect(
        screen.queryByTestId('image-loading-overlay')
      ).not.toBeInTheDocument()
    );
  });

  test('draws one blue rect per table with the table coordinates', async () => {
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 'g-1',
          name: 'Grid',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.2, width: 0.018, height: 0.018 },
          columnWidths: [
            { value: 0.005, confidence: 100 },
            { value: 0.006, confidence: 100 },
            { value: 0.007, confidence: 100 },
          ],
          rowHeights: [
            { value: 0.005, confidence: 100 },
            { value: 0.006, confidence: 100 },
            { value: 0.007, confidence: 100 },
          ],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    const img = middle.querySelector('img');
    loadImage(img);

    const rect = await waitFor(() => {
      const r = middle.querySelector('rect');
      expect(r).not.toBeNull();
      return r;
    });

    expect(rect).toHaveAttribute('x', '100');
    expect(rect).toHaveAttribute('y', '200');
    expect(rect).toHaveAttribute('width', '18');
    expect(rect).toHaveAttribute('height', '18');
    expect(rect).toHaveAttribute('stroke', 'blue');
    expect(rect).toHaveAttribute('stroke-width', '1');
    expect(rect).toHaveAttribute('fill', 'none');
  });

  test('thumbnails (grid disabled) render no internal line elements', async () => {
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="thumbnail"] img').length
      ).toBe(2)
    );

    const thumbnails = container.querySelectorAll('[data-testid="thumbnail"]');
    for (const thumb of thumbnails) {
      loadImage(thumb.querySelector('img'));
    }

    // Rectangles may render, but never internal grid lines.
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="thumbnail"] rect')
      ).not.toBeNull()
    );
    for (const thumb of thumbnails) {
      expect(thumb.querySelectorAll('line').length).toBe(0);
    }
  });

  describe('right-column thumbnail overlay (live metadata borders)', () => {
    // A metadata table in PAGE-FRACTION space — the shape the host holds and now hands
    // straight to the thumbnail overlay. The thumbnail image is loaded at a natural
    // 100×100 below, so a fraction f maps to thumbnail pixel f × 100.
    const metaTable = (over = {}) => ({
      tableId: 'm-1',
      name: 'Meta One',
      pdfPage: 0,
      confirmationStage: 0,
      bounds: { left: 0.1, top: 0.2, width: 0.4, height: 0.3 },
      columnWidths: [
        { value: 0.2, confidence: 90 },
        { value: 0.2, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.15, confidence: 90 },
        { value: 0.15, confidence: 90 },
      ],
      ...over,
    });

    // Render a one-page document whose FETCHED thumbnail carries no tables of its own, so
    // every border drawn must have come from the host's live metadata; then load the
    // thumbnail image at a natural 100×100 (that size is the scale for the conversion).
    async function renderThumbnail(metadataTables) {
      getThumbnails.mockResolvedValue({
        images: [{ image: 'THUMB0', tables: [] }],
      });
      getMetadata.mockResolvedValue({
        name: 'losses.pdf',
        tables: metadataTables,
        pages: [{ page: 0, width: 1.0, height: 2.0, tables: [] }],
      });
      const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);
      await waitFor(() =>
        expect(
          container.querySelector('[data-testid="thumbnail"] img')
        ).not.toBeNull()
      );
      const thumb = container.querySelector('[data-testid="thumbnail"]');
      loadImage(thumb.querySelector('img'), { w: 100, h: 100 });
      return thumb;
    }

    // Wait for the thumbnail overlay to draw at least one border.
    async function firstRect(thumb) {
      return waitFor(() => {
        const r = thumb.querySelector('rect');
        expect(r).not.toBeNull();
        return r;
      });
    }

    test('draws a border per non-deleted metadata table on the page, scaled by the loaded image size', async () => {
      const thumb = await renderThumbnail([metaTable()]);
      const rect = await firstRect(thumb);
      // bounds 0.1/0.2/0.4/0.3 of a 100×100 thumbnail -> 10/20/40/30 whole pixels.
      expect(rect).toHaveAttribute('x', '10');
      expect(rect).toHaveAttribute('y', '20');
      expect(rect).toHaveAttribute('width', '40');
      expect(rect).toHaveAttribute('height', '30');
      expect(rect).toHaveAttribute('stroke', gridLineColour());
    });

    test('a soft-deleted table is not drawn', async () => {
      const thumb = await renderThumbnail([
        metaTable(),
        metaTable({
          tableId: 'm-2',
          name: 'Deleted One',
          deleted: true,
          bounds: { left: 0.5, top: 0.5, width: 0.4, height: 0.3 },
        }),
      ]);
      const rect = await firstRect(thumb);
      expect(thumb.querySelectorAll('rect')).toHaveLength(1);
      // The survivor is the live table (top 0.2 -> y 20), not the deleted one (0.5 -> 50).
      expect(rect).toHaveAttribute('y', '20');
    });

    test('a table nested in another table next map is not drawn', async () => {
      const child = metaTable({
        tableId: 'm-child',
        name: 'Joined',
        bounds: { left: 0.1, top: 0.6, width: 0.4, height: 0.3 },
      });
      const thumb = await renderThumbnail([metaTable({ next: { 1: child } })]);
      const rect = await firstRect(thumb);
      expect(thumb.querySelectorAll('rect')).toHaveLength(1);
      // The drawn border is the top-level parent's (top 0.2 -> y 20), not the child's
      // (0.6 -> 60).
      expect(rect).toHaveAttribute('y', '20');
    });

    test('editing a table bounds moves the thumbnail border with no save', async () => {
      // The centre panel and the thumbnails now read the SAME live metadata, so a
      // boundary drag in the centre must move the thumbnail border immediately — the
      // fetched thumbnail list only refreshes after a save.
      const middle = await renderForDrag(singleTable());
      const thumb = screen.getAllByTestId('thumbnail')[0];
      loadImage(thumb.querySelector('img'), { w: 100, h: 100 });
      // bounds.width 0.1 of a 100px-wide thumbnail -> 10px.
      await waitFor(() =>
        expect(thumb.querySelector('rect')).toHaveAttribute('width', '10')
      );

      // Right edge at viewbox x=100 (fraction 0.1) dragged out to x=120 (0.12).
      dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 120, toY: 50 });

      await waitFor(() =>
        expect(thumb.querySelector('rect')).toHaveAttribute('width', '12')
      );
      expect(saveTables).not.toHaveBeenCalled();
    });

    test('renders no size label and no low-confidence marker lines', async () => {
      const thumb = await renderThumbnail([
        metaTable({
          rowHeights: [
            { value: 0.15, confidence: 10 },
            { value: 0.15, confidence: 10 },
          ],
        }),
      ]);
      await firstRect(thumb);
      expect(
        thumb.querySelector('[data-testid="table-size-label"]')
      ).toBeNull();
      expect(thumb.querySelectorAll('line')).toHaveLength(0);
    });

    test('renders the table name in the border colour', async () => {
      const thumb = await renderThumbnail([metaTable({ name: 'Thumb Name' })]);
      const label = await waitFor(() => {
        const l = thumb.querySelector('[data-testid="thumbnail-table-name"]');
        expect(l).not.toBeNull();
        return l;
      });
      expect(label).toHaveTextContent('Thumb Name');
      expect(label).toHaveStyle({ color: gridLineColour() });
    });

    test('a table at the confirmed stage renders the tick badge', async () => {
      const thumb = await renderThumbnail([
        metaTable({ confirmationStage: confirmedTableStage() }),
      ]);
      await waitFor(() =>
        expect(
          thumb.querySelector('[data-testid="confirmed-tick"]')
        ).not.toBeNull()
      );
    });

    test('a table below the confirmed stage renders no tick badge', async () => {
      const thumb = await renderThumbnail([
        metaTable({ confirmationStage: confirmedTableStage() - 1 }),
      ]);
      await firstRect(thumb);
      expect(thumb.querySelector('[data-testid="confirmed-tick"]')).toBeNull();
    });

    test('the tick badge sits above the table top-right corner', async () => {
      const thumb = await renderThumbnail([
        metaTable({ confirmationStage: confirmedTableStage() }),
      ]);
      const badge = await waitFor(() => {
        const b = thumb.querySelector('[data-testid="confirmed-tick"]');
        expect(b).not.toBeNull();
        return b;
      });
      // Right edge = (10 + 40) / 100 of the width; top edge = 20 / 100 of the height.
      // The translate lifts the badge clear of (and back inside) that corner.
      expect(badge).toHaveStyle({ left: '50%', top: '20%' });
      expect(badge.style.transform).toContain('translate(-100%, -100%)');
      expect(badge).toHaveStyle({
        width: `${confirmedTickBadgeSizePx()}px`,
        height: `${confirmedTickBadgeSizePx()}px`,
      });
    });

    test('the centre panel is unaffected: plain blue border, grid lines, no thumbnail decorations', async () => {
      const middle = await renderAndGetMiddle();
      loadImage(middle.querySelector('img'));
      await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());
      expect(middle.querySelector('rect')).toHaveAttribute(
        'stroke',
        gridLineColour()
      );
      // The centre panel still draws its internal grid lines and hit lines.
      expect(
        middle.querySelectorAll('line:not([data-testid="hit-line"])').length
      ).toBeGreaterThan(0);
      expect(
        middle.querySelectorAll('[data-testid="hit-line"]').length
      ).toBeGreaterThan(0);
      // The thumbnail-only decorations never appear in the centre.
      expect(
        middle.querySelector('[data-testid="thumbnail-table-name"]')
      ).toBeNull();
      expect(middle.querySelector('[data-testid="confirmed-tick"]')).toBeNull();
    });
  });

  test('central image (grid enabled) draws internal lines, dropping the final cumulative total', async () => {
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 'g-1',
          name: 'Grid',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.2, width: 0.018, height: 0.018 },
          columnWidths: [
            { value: 0.005, confidence: 100 },
            { value: 0.006, confidence: 100 },
            { value: 0.007, confidence: 100 },
          ],
          rowHeights: [
            { value: 0.005, confidence: 100 },
            { value: 0.006, confidence: 100 },
            { value: 0.007, confidence: 100 },
          ],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    loadImage(middle.querySelector('img'));

    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());

    // Only the visible blue grid lines; the transparent hit lines carry the hit-line
    // testid and are excluded so the counts still reflect the drawn dividers.
    const lines = Array.from(
      middle.querySelectorAll('line:not([data-testid="hit-line"])')
    );

    for (const l of lines) {
      expect(l).toHaveAttribute('stroke', 'blue');
    }

    // Vertical: columnWidths=[5,6,7], left=100 -> cumulative [5,11,18] -> drop 18
    // -> x = 105, 111 each spanning the table height (y1=200, y2=218).
    const vlines = lines.filter(
      (l) => l.getAttribute('x1') === l.getAttribute('x2')
    );
    expect(vlines.map((l) => l.getAttribute('x1')).sort()).toEqual([
      '105',
      '111',
    ]);
    for (const l of vlines) {
      expect(l).toHaveAttribute('y1', '200');
      expect(l).toHaveAttribute('y2', '218');
    }

    // Horizontal: rowHeights=[5,6,7], top=200 -> cumulative [5,11,18] -> drop 18
    // -> y = 205, 211 each spanning the table width (x1=100, x2=118).
    const hlines = lines.filter(
      (l) => l.getAttribute('y1') === l.getAttribute('y2')
    );
    expect(hlines.map((l) => l.getAttribute('y1')).sort()).toEqual([
      '205',
      '211',
    ]);
    for (const l of hlines) {
      expect(l).toHaveAttribute('x1', '100');
      expect(l).toHaveAttribute('x2', '118');
    }

    // Exactly two of each, no far-edge line at 118.
    expect(vlines).toHaveLength(2);
    expect(hlines).toHaveLength(2);
  });

  test('a table with columnWidths/rowHeights of length 0 or 1 draws no internal lines on that axis', async () => {
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 'deg-1',
          name: 'Degenerate',
          pdfPage: 0,
          bounds: { left: 0.01, top: 0.02, width: 0.03, height: 0.04 },
          columnWidths: [],
          rowHeights: [{ value: 0.009, confidence: 100 }],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    loadImage(middle.querySelector('img'));

    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());
    expect(
      middle.querySelectorAll('line:not([data-testid="hit-line"])').length
    ).toBe(0);
  });

  test('centre overlay is interactive: renders boundary + internal hit lines and enables pointer events', async () => {
    // One table on page 0: 3 columns, 2 rows -> 2 internal vertical + 1 internal
    // horizontal hit line, plus 4 boundary hit lines = 7 hit lines total.
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 't-1',
          name: 'Grid',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.2, width: 0.018, height: 0.012 },
          columnWidths: [
            { value: 0.006, confidence: 100 },
            { value: 0.006, confidence: 100 },
            { value: 0.006, confidence: 100 },
          ],
          rowHeights: [
            { value: 0.006, confidence: 100 },
            { value: 0.006, confidence: 100 },
          ],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    loadImage(middle.querySelector('img'), { w: 100, h: 100 });

    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());

    const hitLines = middle.querySelectorAll('[data-testid="hit-line"]');
    // 4 boundary + (columnWidths.length - 1)=2 vertical + (rowHeights.length - 1)=1 horizontal.
    expect(hitLines).toHaveLength(7);

    // Every hit line is a transparent, wide, non-scaling stroke that only the stroke
    // is hittable.
    for (const l of hitLines) {
      expect(l).toHaveAttribute('stroke', 'transparent');
      expect(l).toHaveAttribute('stroke-width', '8');
      expect(l).toHaveAttribute('vector-effect', 'non-scaling-stroke');
      expect(l).toHaveStyle({ pointerEvents: 'stroke' });
    }

    // The centre SVG opts into pointer events (not 'none').
    const svg = middle.querySelector('svg');
    expect(svg).not.toHaveStyle({ pointerEvents: 'none' });
  });

  test('thumbnails stay inert: no hit lines and pointerEvents none on the overlay', async () => {
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="thumbnail"] img').length
      ).toBe(2)
    );

    const thumbnails = container.querySelectorAll('[data-testid="thumbnail"]');
    for (const thumb of thumbnails) {
      loadImage(thumb.querySelector('img'));
    }

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="thumbnail"] rect')
      ).not.toBeNull()
    );

    for (const thumb of thumbnails) {
      // No hit lines on thumbnails, and the overlay SVG keeps pointerEvents:'none'.
      expect(
        thumb.querySelectorAll('[data-testid="hit-line"]').length
      ).toBe(0);
      expect(thumb.querySelector('svg')).toHaveStyle({ pointerEvents: 'none' });
    }
  });

  test('surfaces a getThumbnails failure via a toast', async () => {
    getThumbnails.mockRejectedValue(new Error('thumbs failed'));
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('thumbs failed')
    );
  });

  test('surfaces a getImage failure via a toast and renders no centre image', async () => {
    getImage.mockRejectedValue(new Error('Page 0 does not exist'));
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Page 0 does not exist')
    );
    // `error` still gates the centre panel, so no stale/blank image mounts.
    expect(screen.queryByTestId('middle-image')).not.toBeInTheDocument();
  });

  test('debounces the resize refetch (400ms) and keeps the selected page', async () => {
    jest.useFakeTimers();
    try {
      const resizeCbs = [];
      let paneWidth = 400;
      global.ResizeObserver = class {
        constructor(cb) {
          resizeCbs.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function () {
          return { width: paneWidth, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
        },
      });

      const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);
      await flushAsync();

      const thumbnails = container.querySelectorAll('[data-testid="thumbnail"]');
      expect(thumbnails.length).toBe(2);
      fireEvent.click(thumbnails[1]);
      await flushAsync();
      expect(getImage.mock.calls[getImage.mock.calls.length - 1]).toEqual([
        PDF_ID,
        1,
        expect.any(Number),
      ]);

      // Resize: widen the panes and fire the observer.
      getThumbnails.mockClear();
      getImage.mockClear();
      paneWidth = 600;
      act(() => {
        resizeCbs.forEach((cb) => cb([]));
      });

      // Nothing refetches until the 400ms debounce window elapses.
      act(() => {
        jest.advanceTimersByTime(399);
      });
      expect(getThumbnails).not.toHaveBeenCalled();
      expect(getImage).not.toHaveBeenCalled();

      // At 400ms a single refetch fires, for the SAME selected page (1), not page 0.
      act(() => {
        jest.advanceTimersByTime(1);
      });
      await flushAsync();
      expect(getThumbnails).toHaveBeenCalledTimes(1);
      expect(getImage.mock.calls[getImage.mock.calls.length - 1]).toEqual([
        PDF_ID,
        1,
        expect.any(Number),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('coalesces a burst of resize events into a single debounced refetch', async () => {
    jest.useFakeTimers();
    try {
      const resizeCbs = [];
      let paneWidth = 400;
      global.ResizeObserver = class {
        constructor(cb) {
          resizeCbs.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function () {
          return { width: paneWidth, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
        },
      });

      render(<PDFEditTableStructure pdfId={PDF_ID} />);
      await flushAsync();
      getThumbnails.mockClear();
      getImage.mockClear();

      // A drag-resize fires many observer callbacks within the debounce window.
      for (let w = 410; w <= 600; w += 10) {
        paneWidth = w;
        act(() => {
          resizeCbs.forEach((cb) => cb([]));
        });
        act(() => {
          jest.advanceTimersByTime(50); // each < 400ms apart
        });
      }
      // Only after the final 400ms of quiet does a single refetch occur.
      expect(getThumbnails).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await flushAsync();
      expect(getThumbnails).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('clamps the selected page to the last entry when a resize refetch returns fewer pages', async () => {
    jest.useFakeTimers();
    try {
      const resizeCbs = [];
      let paneWidth = 400;
      global.ResizeObserver = class {
        constructor(cb) {
          resizeCbs.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function () {
          return { width: paneWidth, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
        },
      });

      // Three pages initially; select the last (index 2).
      getThumbnails.mockResolvedValue({
        images: [
          { image: 'T0', tables: [] },
          { image: 'T1', tables: [] },
          { image: 'T2', tables: [] },
        ],
      });

      const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);
      await flushAsync();
      const thumbnails = container.querySelectorAll('[data-testid="thumbnail"]');
      expect(thumbnails.length).toBe(3);
      fireEvent.click(thumbnails[2]);
      await flushAsync();
      expect(getImage.mock.calls[getImage.mock.calls.length - 1]).toEqual([
        PDF_ID,
        2,
        expect.any(Number),
      ]);

      // The debounced refetch returns only two pages; selection (2) clamps to the
      // last valid index (1), not reset to 0.
      getThumbnails.mockResolvedValue({
        images: [
          { image: 'T0', tables: [] },
          { image: 'T1', tables: [] },
        ],
      });
      getImage.mockClear();
      paneWidth = 600;
      act(() => {
        resizeCbs.forEach((cb) => cb([]));
      });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await flushAsync();

      expect(container.querySelectorAll('[data-testid="thumbnail"]').length).toBe(2);
      expect(getImage.mock.calls[getImage.mock.calls.length - 1]).toEqual([
        PDF_ID,
        1,
        expect.any(Number),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('shows an empty-state message (and no centre image call) when there are no pages', async () => {
    getThumbnails.mockResolvedValue({ images: [] });
    const onAllFiles = jest.fn();

    const { container } = render(
      <PDFEditTableStructure pdfId={PDF_ID} onAllFiles={onAllFiles} />
    );

    await screen.findByText('No Document');
    expect(
      screen.getByText('There are no documents to display')
    ).toBeInTheDocument();

    // Right pane blank, centre image never requested, no middle image.
    expect(container.querySelectorAll('[data-testid="thumbnail"]').length).toBe(0);
    expect(getImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('middle-image')).not.toBeInTheDocument();

    // The third line is a button that returns to the loader.
    await userEvent.click(screen.getByRole('button', { name: '← All Files' }));
    expect(onAllFiles).toHaveBeenCalledTimes(1);
  });

  test('loads metadata on mount and lists one entry per table with name and size rows', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() => expect(getMetadata).toHaveBeenCalledWith(PDF_ID));

    const entries = await screen.findAllByTestId('table-entry');
    expect(entries).toHaveLength(2);

    const names = screen.getAllByTestId('table-entry-name');
    expect(names[0]).toHaveTextContent('Premium Summary');
    expect(names[1]).toHaveTextContent('Loss Detail');

    // Size derived from rowHeights.length then columnWidths.length.
    const sizes = screen.getAllByTestId('table-entry-size');
    expect(sizes[0]).toHaveTextContent('2 Rows, 3 Columns');
    expect(sizes[1]).toHaveTextContent('4 Rows, 2 Columns');
  });

  test('the table-name row is bold', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    const names = await screen.findAllByTestId('table-entry-name');
    // MUI's sx normalises fontWeight: 'bold' to the numeric 700.
    expect(names[0]).toHaveStyle({ fontWeight: 700 });
  });

  test('the Save button is disabled on initial (clean) load', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
  });

  test('surfaces a getMetadata failure via a toast', async () => {
    getMetadata.mockRejectedValue(new Error('metadata failed'));
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('metadata failed')
    );
  });

  test('a disabled (clean) Save does not call saveTables when clicked', async () => {
    // Dirty is set by rename in Task 11; on a clean initial load the Save button
    // is disabled and clicking it must not call saveTables. The full
    // dirty→save→clear flow is exercised in Task 11.
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.click(save);
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('clicking a name row enters edit mode with an input initialised to the current name', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);

    const input = await screen.findByDisplayValue('Premium Summary');
    expect(input).toBeInTheDocument();
  });

  test('committing a new name with Enter updates the displayed name and enables Save', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);

    const input = await screen.findByDisplayValue('Premium Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Table{Enter}');

    // The edit control is gone and the new name is displayed.
    await waitFor(() =>
      expect(screen.queryByDisplayValue('Renamed Table')).not.toBeInTheDocument()
    );
    const updated = screen.getAllByTestId('table-entry-name');
    expect(updated[0]).toHaveTextContent('Renamed Table');
    // The second entry is untouched, in its original position.
    expect(updated[1]).toHaveTextContent('Loss Detail');

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeEnabled();
  });

  test('committing a new name on blur updates the displayed name', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);

    const input = await screen.findByDisplayValue('Premium Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'Blur Name');
    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.queryByDisplayValue('Blur Name')).not.toBeInTheDocument()
    );
    expect(screen.getAllByTestId('table-entry-name')[0]).toHaveTextContent(
      'Blur Name'
    );
  });

  test('Escape cancels the edit, leaving the original name and Save disabled', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);

    const input = await screen.findByDisplayValue('Premium Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'Should Not Stick{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByDisplayValue('Should Not Stick')
      ).not.toBeInTheDocument()
    );
    expect(screen.getAllByTestId('table-entry-name')[0]).toHaveTextContent(
      'Premium Summary'
    );
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('Save sends the renamed array with all other fields/order preserved and clears dirty', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);

    const input = await screen.findByDisplayValue('Premium Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'New Premium{Enter}');

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const [sentPdfId, sentTables] = saveTables.mock.calls[0];
    expect(sentPdfId).toBe(PDF_ID);
    // Only name[0] changed; every other field and the array order is preserved. Tables are
    // normalised on load: normaliseTableBounds enforces I1/I2 (bounds.width/height == axis
    // sums) and fillGridCells materialises a cell for every unmapped grid square, so the sent
    // tables are the normalised, filled fixtures with just name[0] edited.
    const loaded = (t) => fillGridCells(normaliseTableBounds(t));
    expect(sentTables).toEqual([
      { ...loaded(METADATA_FIXTURE.tables[0]), name: 'New Premium' },
      loaded(METADATA_FIXTURE.tables[1]),
    ]);

    // Dirty clears on success: Save returns to disabled.
    await waitFor(() => expect(save).toBeDisabled());
  });

  test('a successful Save re-fetches the thumbnails so they reflect the saved tables', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    // Let the initial thumbnail load settle, then ignore it — we only care that a
    // save triggers a fresh fetch.
    await waitFor(() => expect(getThumbnails).toHaveBeenCalled());

    const names = await screen.findAllByTestId('table-entry-name');
    await userEvent.click(names[0]);
    const input = await screen.findByDisplayValue('Premium Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'New Premium{Enter}');

    getThumbnails.mockClear();

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    // The right-column thumbnails re-fetch after the save completes.
    await waitFor(() => expect(getThumbnails).toHaveBeenCalledTimes(1));
    expect(getThumbnails).toHaveBeenCalledWith(PDF_ID, expect.any(Number));
  });

  test('hovering a table on the centre overlay highlights the matching left entry, scrolls it into view, and shows the hover label', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // The centre overlay's geometry now comes from metadata (page 0). Fractions × 1000
    // (the fixture pixelWidth/pixelHeight) reproduce a 100×100 grid at the origin with
    // 2 columns of 50 and 4 rows of 25. tableId/name join it to the left list.
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 't-1',
          name: 'Premium Summary',
          pdfPage: 0,
          bounds: { left: 0.0, top: 0.0, width: 0.1, height: 0.1 },
          columnWidths: [
            { value: 0.05, confidence: 100 },
            { value: 0.05, confidence: 100 },
          ],
          rowHeights: [
            { value: 0.025, confidence: 100 },
            { value: 0.025, confidence: 100 },
            { value: 0.025, confidence: 100 },
            { value: 0.025, confidence: 100 },
          ],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    const img = middle.querySelector('img');
    // Natural dims 100x100; rendered 1:1 at the origin so viewBox px == screen px.
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

    // Pointer deep INSIDE the table area, far from every grid line (cell (0,0) is
    // 0..50 x 0..25; (25,12) is ~12px from the nearest divider) -> still hovered.
    // This is the defining case: hovering is about the table's area, not proximity
    // to its grid lines.
    const overlayBox = img.parentElement;
    fireEvent.mouseMove(overlayBox, { clientX: 25, clientY: 12 });

    // The matching left entry (t-1 == first entry) gets the bounding box and is
    // scrolled into view with block: 'nearest'.
    await waitFor(() => {
      const entries = screen.getAllByTestId('table-entry');
      expect(entries[0]).toHaveStyle({ border: '2px solid #1976d2' });
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    // The hover label shows the name and the cols × rows cells in separate
    // segments, divided by a 1px vertical line.
    const label = await screen.findByTestId('hover-label');
    expect(screen.getByTestId('hover-label-name')).toHaveTextContent(
      'Premium Summary'
    );
    expect(screen.getByTestId('hover-label-size')).toHaveTextContent('2 × 4 cells');
    expect(screen.getByTestId('hover-label-divider')).toHaveStyle({ width: '1px' });
    // The table is flush against the top edge (top=0), so the label would sit above
    // the image; it is clamped down to top: 0 rather than being clipped off-screen.
    expect(label).toHaveStyle({ top: '0px' });

    // Pointer more than 2px OUTSIDE the area (5px below the bottom edge at y=100)
    // -> not hovered: label and highlight clear.
    fireEvent.mouseMove(overlayBox, { clientX: 50, clientY: 105 });
    await waitFor(() =>
      expect(screen.queryByTestId('hover-label')).not.toBeInTheDocument()
    );
    expect(screen.getAllByTestId('table-entry')[0]).not.toHaveStyle({
      border: '2px solid #1976d2',
    });

    // Re-hover, then leaving the overlay also clears the selection and label.
    fireEvent.mouseMove(overlayBox, { clientX: 25, clientY: 12 });
    await screen.findByTestId('hover-label');
    fireEvent.mouseLeave(overlayBox);
    await waitFor(() =>
      expect(screen.queryByTestId('hover-label')).not.toBeInTheDocument()
    );
    const entriesAfter = screen.getAllByTestId('table-entry');
    expect(entriesAfter[0]).not.toHaveStyle({ border: '2px solid #1976d2' });
  });

  test('with two near grids: inside one selects it, within 2px of exactly one selects it, within 2px of both selects nothing', async () => {
    Element.prototype.scrollIntoView = jest.fn();
    // Two non-overlapping grids on a 100x100 (1:1) image, separated by a 4px gap
    // (A spans x 0..40, B spans x 44..84), joined to left entries t-1 and t-2.
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 't-1',
          name: 'A',
          pdfPage: 0,
          bounds: { left: 0.0, top: 0.0, width: 0.04, height: 0.1 },
          columnWidths: [{ value: 0.04, confidence: 100 }],
          rowHeights: [{ value: 0.1, confidence: 100 }],
        },
        {
          tableId: 't-2',
          name: 'B',
          pdfPage: 0,
          bounds: { left: 0.044, top: 0.0, width: 0.04, height: 0.1 },
          columnWidths: [{ value: 0.04, confidence: 100 }],
          rowHeights: [{ value: 0.1, confidence: 100 }],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    const img = middle.querySelector('img');
    Object.defineProperty(img, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0 }),
    });
    loadImage(img, { w: 100, h: 100 });
    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());
    const overlayBox = img.parentElement;

    // Inside grid A -> A (t-1, first entry) selected.
    fireEvent.mouseMove(overlayBox, { clientX: 20, clientY: 50 });
    await waitFor(() =>
      expect(screen.getAllByTestId('table-entry')[0]).toHaveStyle({ border: '2px solid #1976d2' })
    );

    // In the gap, within 2px of A only (x=41: 1px from A, 3px from B) -> A selected.
    fireEvent.mouseMove(overlayBox, { clientX: 41, clientY: 50 });
    await waitFor(() =>
      expect(screen.getAllByTestId('table-entry')[0]).toHaveStyle({ border: '2px solid #1976d2' })
    );

    // Mid-gap, within 2px of BOTH (x=42: 2px from A and 2px from B) -> ambiguous,
    // select nothing: no hover label and neither entry highlighted.
    fireEvent.mouseMove(overlayBox, { clientX: 42, clientY: 50 });
    await waitFor(() =>
      expect(screen.queryByTestId('hover-label')).not.toBeInTheDocument()
    );
    const entries = screen.getAllByTestId('table-entry');
    expect(entries[0]).not.toHaveStyle({ border: '2px solid #1976d2' });
    expect(entries[1]).not.toHaveStyle({ border: '2px solid #1976d2' });
  });

  // ---- Task 2: boundary-edge drag ---------------------------------------------------
  //
  // The overlay draws its hit lines in a fixed order per table: boundary-left,
  // boundary-right, boundary-top, boundary-bottom, then the internal dividers. So among
  // the hit-line elements the first four are the boundaries in that order.
  const BOUNDARY = { left: 0, right: 1, top: 2, bottom: 3 };

  // Render, load a 1:1 100x100 image (so screen px == viewbox px), and stub the img's
  // getBoundingClientRect to a 100x100 box at the origin. With pixelWidth/Height 1000 a
  // fraction f maps to viewbox px f*1000, i.e. a pointer at viewbox x=60 is fraction 0.06.
  async function renderForDrag(metadata) {
    Element.prototype.scrollIntoView = jest.fn();
    getMetadata.mockResolvedValue(metadata);
    const middle = await renderAndGetMiddle();
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
    return middle;
  }

  // The boundary hit lines, in [left, right, top, bottom] order.
  function boundaryHitLines(middle) {
    return middle.querySelectorAll('[data-testid="hit-line"]');
  }

  // Drag a boundary edge: mouse-down on its hit line, one move on window to the target
  // screen coordinates, then release. Mouse family (not pointer) because jsdom's
  // PointerEvents do not carry clientX; the component listens on window with mousemove/up.
  function dragBoundary(middle, which, { toX, toY, fromX = 0, fromY = 0 }) {
    const line = boundaryHitLines(middle)[BOUNDARY[which]];
    fireEvent.mouseDown(line, { clientX: fromX, clientY: fromY });
    fireEvent.mouseMove(window, { clientX: toX, clientY: toY });
    fireEvent.mouseUp(window, { clientX: toX, clientY: toY });
  }

  // Perform Save and return the single committed table (assumes one-table fixtures).
  async function savedTable() {
    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    return saveTables.mock.calls[0][1][0];
  }

  const singleTable = (overrides) => ({
    tables: [
      {
        tableId: 't-1',
        name: 'T',
        pdfPage: 0,
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
        ...overrides,
      },
    ],
  });

  test('first left-boundary drag on backend bounds that violate I1 keeps unchanged columns` confidence', async () => {
    // Regression: a backend table whose bounds.width (0.10) does not equal sum(columnWidths)
    // (0.09) violates I1. A left/top shrink derives newLeft = (left + bounds.width) - sum,
    // so the 0.01 discrepancy shifts EVERY column's grid square and reconcileCells zeroed
    // every cell's confidence on the FIRST edit (bounds is recomputed consistent thereafter).
    // Normalising bounds on load fixes it. cell.bounds are tight OCR boxes (not the square).
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0.2, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.205, top: 0.02, width: 0.01, height: 0.05 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.235, top: 0.02, width: 0.01, height: 0.05 }, text: 'B', confidence: 80, header: false },
          { row: 0, column: 2, rowSpan: 1, columnSpan: 1, bounds: { left: 0.265, top: 0.02, width: 0.01, height: 0.05 }, text: 'C', confidence: 80, header: false },
        ],
      })
    );
    // Left edge at viewbox x=200 (fraction 0.2). Drag inward to x=210 (0.21): a small front
    // shrink of column 0 only; columns 1 and 2 keep their confidence.
    dragBoundary(middle, 'left', { fromX: 200, fromY: 50, toX: 210, toY: 50 });
    const t = await savedTable();
    expect(t.cells.find((c) => c.text === 'B').confidence).toBe(80);
    expect(t.cells.find((c) => c.text === 'C').confidence).toBe(80);
  });

  test('boundary grow: dragging the right edge outward enlarges the last column', async () => {
    const middle = await renderForDrag(singleTable());
    // Right edge is at viewbox x=100 (fraction 0.1); drag out to x=120 (fraction 0.12).
    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 120, toY: 50 });

    const t = await savedTable();
    // Last column grew by 0.02 (0.04 -> 0.06); others unchanged; width == sum == 0.12.
    const vals = t.columnWidths.map((c) => c.value);
    expect(vals[0]).toBeCloseTo(0.03, 10);
    expect(vals[1]).toBeCloseTo(0.03, 10);
    expect(vals[2]).toBeCloseTo(0.06, 10);
    expect(t.bounds.width).toBeCloseTo(0.12, 10);
    expect(t.bounds.left).toBe(0);
    // I1: sum(columnWidths) === bounds.width.
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(
      t.bounds.width,
      10
    );
    // Confidence preserved on the edited cell.
    expect(t.columnWidths[2].confidence).toBe(90);
  });

  test('boundary shrink with cascade delete: consuming a whole column drops it', async () => {
    const middle = await renderForDrag(singleTable());
    // Drag the right edge inward from x=100 (0.1) to x=55 (0.055): shrink 0.045 > last
    // column 0.04, so it is deleted and the remaining 0.005 comes off the new last col.
    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 55, toY: 50 });

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(2);
    expect(t.columnWidths.map((c) => c.value)[0]).toBeCloseTo(0.03, 10);
    expect(t.columnWidths.map((c) => c.value)[1]).toBeCloseTo(0.025, 10);
    expect(t.bounds.width).toBeCloseTo(0.055, 10);
    expect(t.bounds.left).toBe(0);
  });

  test('boundary shrink never deletes the final cell: it clamps at the 1px minimum', async () => {
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.05, height: 0.05 },
        columnWidths: [{ value: 0.05, confidence: 90 }],
        rowHeights: [{ value: 0.05, confidence: 90 }],
      })
    );
    // Drag the right edge inward from x=50 (0.05) well past 0 (x=-10). The single column
    // must not be deleted; it clamps to 1/1000 = 0.001.
    dragBoundary(middle, 'right', { fromX: 50, fromY: 25, toX: -10, toY: 25 });

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(1);
    expect(t.columnWidths[0].value).toBeCloseTo(0.001, 10);
    expect(t.bounds.width).toBeCloseTo(0.001, 10);
  });

  test('page-bounds clamp (I3): dragging the left edge past 0 clamps left to 0', async () => {
    const middle = await renderForDrag(singleTable());
    // Left edge at viewbox x=0 (fraction 0); drag outward to x=-20 (fraction -0.02).
    dragBoundary(middle, 'left', { fromX: 0, fromY: 50, toX: -20, toY: 50 });

    const t = await savedTable();
    expect(t.bounds.left).toBe(0);
    expect(t.bounds.left).toBeGreaterThanOrEqual(0);
    expect(t.bounds.left + t.bounds.width).toBeLessThanOrEqual(1);
  });

  test('≥1px gap: growing toward another same-page table stops 1px short', async () => {
    const middle = await renderForDrag({
      tables: [
        {
          tableId: 't-1',
          name: 'T',
          pdfPage: 0,
          bounds: { left: 0, top: 0, width: 0.1, height: 0.2 },
          columnWidths: [
            { value: 0.03, confidence: 90 },
            { value: 0.03, confidence: 90 },
            { value: 0.04, confidence: 90 },
          ],
          rowHeights: [{ value: 0.2, confidence: 90 }],
        },
        {
          tableId: 't-2',
          name: 'O',
          pdfPage: 0,
          bounds: { left: 0.2, top: 0, width: 0.1, height: 0.2 },
          columnWidths: [{ value: 0.1, confidence: 90 }],
          rowHeights: [{ value: 0.2, confidence: 90 }],
        },
      ],
    });
    // Drag t's right edge from x=100 (0.1) toward x=300 (0.3) — past o.left=0.2. The edge
    // must stop 1px (0.001) short: right edge == 0.2 - 0.001 == 0.199.
    dragBoundary(middle, 'right', { fromX: 100, fromY: 100, toX: 300, toY: 100 });

    const t = (await (async () => {
      const save = await screen.findByRole('button', { name: /save/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);
      await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
      return saveTables.mock.calls[0][1][0];
    })());
    expect(t.bounds.left + t.bounds.width).toBeCloseTo(0.199, 10);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(
      0.199,
      10
    );
  });

  // ---- Task 3: internal grid-line drag ---------------------------------------------
  //
  // Per table the hit lines render in a fixed order: boundary-left, boundary-right,
  // boundary-top, boundary-bottom, then the internal vertical dividers (grid-v, k=1..),
  // then the internal horizontal dividers (grid-h, k=1..). Task 3 selects an internal
  // divider by that render offset — after the 4 boundaries and the earlier dividers.
  // Only data-testid="hit-line" is on the DOM; kind/k live in the mouse-down closure.

  // Return the internal vertical divider hit line at 1-based index k (k=1 is the first).
  function verticalDivider(middle, k) {
    const lines = middle.querySelectorAll('[data-testid="hit-line"]');
    // 4 boundaries precede the vertical dividers.
    return lines[4 + (k - 1)];
  }

  // Return the internal horizontal divider hit line at 1-based index k, given the number
  // of internal vertical dividers that precede it in render order.
  function horizontalDivider(middle, k, vCount) {
    const lines = middle.querySelectorAll('[data-testid="hit-line"]');
    // 4 boundaries + vCount vertical dividers precede the horizontal dividers.
    return lines[4 + vCount + (k - 1)];
  }

  // Drag an internal line: mouse-down on its hit line, one move on window to the target
  // screen coords, then release. Mouse family (not pointer) — the component listens on
  // window with mousemove/up because jsdom's PointerEvents do not carry clientX.
  function dragLine(line, { fromX, fromY, toX, toY }) {
    fireEvent.mouseDown(line, { clientX: fromX, clientY: fromY });
    fireEvent.mouseMove(window, { clientX: toX, clientY: toY });
    fireEvent.mouseUp(window, { clientX: toX, clientY: toY });
  }

  test('Test A — internal vertical line move: equal-and-opposite, bounds unchanged (I1)', async () => {
    // One table on page 0: bounds 0.1x0.1 at origin, two equal columns of 0.05 (×1000 =
    // 50px each), two rows of 0.05. The single internal vertical divider (k=1) sits at
    // viewbox x=50. Drag it +10px right (x=50 -> 60 = fraction 0.05 -> 0.06).
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    dragLine(verticalDivider(middle, 1), {
      fromX: 50,
      fromY: 25,
      toX: 60,
      toY: 25,
    });

    const t = await savedTable();
    const vals = t.columnWidths.map((c) => c.value);
    // Equal and opposite: left grew to 0.06, right shrank to 0.04.
    expect(vals[0]).toBeCloseTo(0.06, 10);
    expect(vals[1]).toBeCloseTo(0.04, 10);
    // I1: sum(columnWidths) === bounds.width, and bounds.width is unchanged (0.1).
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
    // bounds otherwise untouched.
    expect(t.bounds.left).toBe(0);
    expect(t.bounds.top).toBe(0);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
    // Confidence preserved.
    expect(t.columnWidths[0].confidence).toBe(90);
  });

  test('Test A (horizontal analogue) — internal horizontal line move: equal-and-opposite, bounds unchanged (I2)', async () => {
    // Same table; the single internal horizontal divider (k=1) sits at viewbox y=50.
    // There is 1 internal vertical divider before it. Drag it +10px down (y=50 -> 60).
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    dragLine(horizontalDivider(middle, 1, 1), {
      fromX: 25,
      fromY: 50,
      toX: 25,
      toY: 60,
    });

    const t = await savedTable();
    const vals = t.rowHeights.map((c) => c.value);
    expect(vals[0]).toBeCloseTo(0.06, 10);
    expect(vals[1]).toBeCloseTo(0.04, 10);
    // I2: sum(rowHeights) === bounds.height, unchanged (0.1).
    expect(t.rowHeights.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
    expect(t.bounds.top).toBe(0);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  test('Test B — internal line pass/cross: squeezed cell removed, sizes still sum (I1)', async () => {
    // Three columns of 0.03 (×1000 = 30px each), bounds width 0.09. Internal vertical
    // dividers at viewbox x=30 (k=1) and x=60 (k=2). Drag k=1 PAST k=2, to x=75, so the
    // middle column is squeezed to 0 and removed on release.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.09, height: 0.1 },
        columnWidths: [
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    dragLine(verticalDivider(middle, 1), {
      fromX: 30,
      fromY: 25,
      toX: 75,
      toY: 25,
    });

    const t = await savedTable();
    // The squeezed middle column was removed: 3 -> 2.
    expect(t.columnWidths).toHaveLength(2);
    // No cell is <= 0 (I4).
    for (const c of t.columnWidths) {
      expect(c.value).toBeGreaterThan(0);
    }
    // I1 still holds; bounds unchanged.
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.09, 10);
    expect(t.bounds.width).toBeCloseTo(0.09, 10);
    expect(t.bounds.left).toBe(0);
    // The dragged divider landed at fraction 0.075: first column 0.075, last 0.015.
    const vals = t.columnWidths.map((c) => c.value);
    expect(vals[0]).toBeCloseTo(0.075, 10);
    expect(vals[1]).toBeCloseTo(0.015, 10);
  });

  test('Test C — last cell on an axis is protected on release', async () => {
    // Two columns of 0.05 (50px each). Drag the single divider (k=1) hard to the left
    // clamp edge so the left column tends toward 0; on release both survive if > epsilon,
    // and the axis is never emptied. At minimum columnWidths.length >= 1 and I1 holds.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    // Drag the divider far left past 0 (x=-30); it clamps to one pixel inside the table.
    dragLine(verticalDivider(middle, 1), {
      fromX: 50,
      fromY: 25,
      toX: -30,
      toY: 25,
    });

    const t = await savedTable();
    // The axis is never emptied.
    expect(t.columnWidths.length).toBeGreaterThanOrEqual(1);
    // I1 preserved; bounds unchanged.
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  // ---- Task 4: click-vs-drag disambiguation + popup menu ---------------------------
  //
  // A near-stationary gesture (< ~4px) on an internal grid line is a CLICK that opens an
  // MUI popup menu; a gesture past the threshold is a DRAG (Task 3 resize) and never opens
  // the menu. Boundary edges are always drags. Mouse family (not pointer) — the component
  // listens on window with mousemove/up because jsdom's PointerEvents do not carry clientX.

  // Click (no movement) an internal line's hit line: mouse-down then mouse-up at the same
  // screen coords, so the threshold resolves to a click.
  function clickLine(line, { x, y }) {
    fireEvent.mouseDown(line, { clientX: x, clientY: y });
    fireEvent.mouseUp(window, { clientX: x, clientY: y });
  }

  test('click (no drag) on a horizontal line opens the menu with Delete / Add Above / Add Below and makes no change', async () => {
    // Two rows of 0.05; the single internal horizontal divider (k=1) sits at viewbox y=50.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    clickLine(horizontalDivider(middle, 1, 1), { x: 25, y: 50 });

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Add Above' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Add Below' })
    ).toBeInTheDocument();
    // No column-oriented items on a horizontal line.
    expect(screen.queryByRole('menuitem', { name: 'Add Left' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Add Right' })).toBeNull();

    // A click alone makes no metadata change: Save stays disabled and nothing saved.
    // (The open MUI Menu is a modal that aria-hides the rest of the app, so query the
    // Save button with hidden: true.)
    expect(
      screen.getByRole('button', { name: /save/i, hidden: true })
    ).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('click (no drag) on a vertical line opens the menu with Delete / Add Left / Add Right and makes no change', async () => {
    // Two columns of 0.05; the single internal vertical divider (k=1) sits at viewbox x=50.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 50, y: 25 });

    await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Add Left' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Add Right' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add Above' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Add Below' })).toBeNull();

    expect(
      screen.getByRole('button', { name: /save/i, hidden: true })
    ).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('a drag on an internal line does not open the menu and commits the resize', async () => {
    // Two equal columns of 0.05; single vertical divider at viewbox x=50. Drag +10px.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
      })
    );

    dragLine(verticalDivider(middle, 1), {
      fromX: 50,
      fromY: 25,
      toX: 60,
      toY: 25,
    });

    // No menu opened.
    expect(screen.queryByRole('menu')).toBeNull();

    // The resize committed: Save enabled, and the moved divider is reflected in the payload.
    const t = await savedTable();
    const vals = t.columnWidths.map((c) => c.value);
    expect(vals[0]).toBeCloseTo(0.06, 10);
    expect(vals[1]).toBeCloseTo(0.04, 10);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  test('menu Delete (horizontal) merges the two adjacent rows, preserving the near cell confidence (I2)', async () => {
    // Rows 0.04 (conf 0.7) and 0.06 (conf 0.3); divider k=1 at viewbox y=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
      })
    );

    clickLine(horizontalDivider(middle, 1, 0), { x: 25, y: 40 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const t = await savedTable();
    expect(t.rowHeights).toHaveLength(1);
    // Near cell (k-1) absorbed the far cell's value; its confidence is retained.
    expect(t.rowHeights[0].value).toBeCloseTo(0.1, 10);
    expect(t.rowHeights[0].confidence).toBe(70);
    // I2: sum(rowHeights) === bounds.height, unchanged.
    expect(t.rowHeights.reduce((a, r) => a + r.value, 0)).toBeCloseTo(
      t.bounds.height,
      10
    );
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
  });

  test('menu Delete (vertical) merges the two adjacent columns, preserving the near cell confidence (I1)', async () => {
    // Columns 0.04 (conf 0.7) and 0.06 (conf 0.3); divider k=1 at viewbox x=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 40, y: 25 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(1);
    expect(t.columnWidths[0].value).toBeCloseTo(0.1, 10);
    expect(t.columnWidths[0].confidence).toBe(70);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(
      t.bounds.width,
      10
    );
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  test('menu Add Above (horizontal) half-splits the row above the line (I2)', async () => {
    // Rows 0.04 (above, conf 0.7) and 0.06 (below); divider k=1 at viewbox y=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
      })
    );

    clickLine(horizontalDivider(middle, 1, 0), { x: 25, y: 40 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Above' }));

    const t = await savedTable();
    // The row above (index 0) split into two halves of 0.02 each, carrying its confidence.
    expect(t.rowHeights).toHaveLength(3);
    expect(t.rowHeights[0].value).toBeCloseTo(0.02, 10);
    expect(t.rowHeights[1].value).toBeCloseTo(0.02, 10);
    expect(t.rowHeights[0].confidence).toBe(70);
    expect(t.rowHeights[1].confidence).toBe(70);
    // The row below is untouched.
    expect(t.rowHeights[2].value).toBeCloseTo(0.06, 10);
    expect(t.rowHeights[2].confidence).toBe(30);
    expect(t.rowHeights.reduce((a, r) => a + r.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
  });

  test('menu Add Below (horizontal) half-splits the row below the line (I2)', async () => {
    // Rows 0.04 (above) and 0.06 (below, conf 0.3); divider k=1 at viewbox y=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
      })
    );

    clickLine(horizontalDivider(middle, 1, 0), { x: 25, y: 40 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Below' }));

    const t = await savedTable();
    // The row below (index 1) split into two halves of 0.03 each, carrying its confidence.
    expect(t.rowHeights).toHaveLength(3);
    expect(t.rowHeights[0].value).toBeCloseTo(0.04, 10);
    expect(t.rowHeights[0].confidence).toBe(70);
    expect(t.rowHeights[1].value).toBeCloseTo(0.03, 10);
    expect(t.rowHeights[2].value).toBeCloseTo(0.03, 10);
    expect(t.rowHeights[1].confidence).toBe(30);
    expect(t.rowHeights[2].confidence).toBe(30);
    expect(t.rowHeights.reduce((a, r) => a + r.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
  });

  test('menu Add Left (vertical) half-splits the column left of the line (I1)', async () => {
    // Columns 0.04 (left, conf 0.7) and 0.06 (right); divider k=1 at viewbox x=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 40, y: 25 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Left' }));

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(3);
    expect(t.columnWidths[0].value).toBeCloseTo(0.02, 10);
    expect(t.columnWidths[1].value).toBeCloseTo(0.02, 10);
    expect(t.columnWidths[0].confidence).toBe(70);
    expect(t.columnWidths[1].confidence).toBe(70);
    expect(t.columnWidths[2].value).toBeCloseTo(0.06, 10);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  test('menu Add Right (vertical) half-splits the column right of the line (I1)', async () => {
    // Columns 0.04 (left) and 0.06 (right, conf 0.3); divider k=1 at viewbox x=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 40, y: 25 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Right' }));

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(3);
    expect(t.columnWidths[0].value).toBeCloseTo(0.04, 10);
    expect(t.columnWidths[0].confidence).toBe(70);
    expect(t.columnWidths[1].value).toBeCloseTo(0.03, 10);
    expect(t.columnWidths[2].value).toBeCloseTo(0.03, 10);
    expect(t.columnWidths[1].confidence).toBe(30);
    expect(t.columnWidths[2].confidence).toBe(30);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
  });

  // ---- Task 5: cell reconciliation threaded through the commit paths ----------------

  test('menu Add Left reconciles the cell array: survivors re-index and a new empty column of cells appears', async () => {
    // Two columns of 0.05 with a cell in each; single vertical divider (k=1) at viewbox x=50.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.1 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.05, top: 0, width: 0.05, height: 0.1 }, text: 'B', confidence: 80, header: false },
        ],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 50, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Left' }));

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(3);
    expect(t.cells).toHaveLength(3);
    const at = (r, c) => t.cells.find((x) => x.row === r && x.column === c);
    // A (old column 0) stays at column 0; its square halved -> confidence reset.
    expect(at(0, 0).text).toBe('A');
    expect(at(0, 0).confidence).toBe(0);
    // B (old column 1) re-indexes to column 2; its square is unchanged -> confidence kept.
    expect(at(0, 2).text).toBe('B');
    expect(at(0, 2).confidence).toBe(80);
    // The new middle column carries a default empty cell.
    expect(at(0, 1)).toMatchObject({ text: '', confidence: 0, header: false });
  });

  test('menu Add Below inserts the new empty row adjacent to the divider and slides content down', async () => {
    // 3 rows (0.025 / 0.05 / 0.025) with a cell in each; divider k=1 at viewbox y=25.
    // "Add Below" the divider between rows 0 and 1 must put the NEW empty row at index 1
    // (adjacent to the divider), push the old row-1 content to index 2, and leave the row
    // below (index 2 -> 3) untouched — NOT split row 1 with the blank landing at index 2.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.025, confidence: 90 },
          { value: 0.05, confidence: 90 },
          { value: 0.025, confidence: 90 },
        ],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.1, height: 0.025 }, text: 'HEAD', confidence: 80, header: false },
          { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0.025, width: 0.1, height: 0.05 }, text: 'MID', confidence: 80, header: false },
          { row: 2, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0.075, width: 0.1, height: 0.025 }, text: 'BOT', confidence: 80, header: false },
        ],
      })
    );

    clickLine(horizontalDivider(middle, 1, 0), { x: 50, y: 25 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Below' }));

    const t = await savedTable();
    expect(t.rowHeights).toHaveLength(4);
    expect(t.cells).toHaveLength(4);
    const at = (r, c) => t.cells.find((x) => x.row === r && x.column === c);
    // HEAD stays at row 0, untouched.
    expect(at(0, 0).text).toBe('HEAD');
    expect(at(0, 0).confidence).toBe(80);
    // The new empty row is index 1 (adjacent to the clicked divider).
    expect(at(1, 0)).toMatchObject({ text: '', confidence: 0, header: false });
    // MID slides down to row 2; its square was halved -> confidence reset.
    expect(at(2, 0).text).toBe('MID');
    expect(at(2, 0).confidence).toBe(0);
    // BOT moves to row 3 but its grid square is unchanged -> confidence kept.
    expect(at(3, 0).text).toBe('BOT');
    expect(at(3, 0).confidence).toBe(80);
  });

  test('menu Delete reconciles the cell array: the merged column`s far cell is dropped', async () => {
    // Columns 0.04 / 0.06 with a cell in each; divider k=1 at viewbox x=40.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 90 },
          { value: 0.06, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.04, height: 0.1 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.04, top: 0, width: 0.06, height: 0.1 }, text: 'B', confidence: 80, header: false },
        ],
      })
    );

    clickLine(verticalDivider(middle, 1), { x: 40, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(1);
    // Old column 1 (B) folded away; only A survives, at column 0.
    expect(t.cells).toHaveLength(1);
    expect(t.cells[0]).toMatchObject({ row: 0, column: 0, text: 'A' });
  });

  test('a divider-collapse drag reconciles cells: the squeezed column`s cell is dropped, the rest re-index', async () => {
    // Three columns of 0.03 with a cell in each; internal vertical dividers at x=30 (k=1)
    // and x=60 (k=2). Drag k=1 PAST k=2 to x=75: the middle column squeezes to 0 and is
    // removed on release.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.09, height: 0.1 },
        columnWidths: [
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.03, height: 0.1 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.03, top: 0, width: 0.03, height: 0.1 }, text: 'B', confidence: 80, header: false },
          { row: 0, column: 2, rowSpan: 1, columnSpan: 1, bounds: { left: 0.06, top: 0, width: 0.03, height: 0.1 }, text: 'C', confidence: 80, header: false },
        ],
      })
    );

    dragLine(verticalDivider(middle, 1), { fromX: 30, fromY: 50, toX: 75, toY: 50 });

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(2);
    // B (the squeezed middle column) is gone; A and C survive, C re-indexed to column 1.
    expect(t.cells.map((c) => c.text).sort()).toEqual(['A', 'C']);
    expect(t.cells.find((c) => c.text === 'C').column).toBe(1);
  });

  test('moving an internal divider resets confidence only for cells whose square moved', async () => {
    // 3 columns of 0.03 with a cell in each; divider k=1 (between col 0 and col 1) at x=30.
    // Drag it right to x=40: col 0 grows to 0.04, col 1 shrinks to 0.02, col 2 unchanged.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.09, height: 0.1 },
        columnWidths: [
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.03, height: 0.1 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.03, top: 0, width: 0.03, height: 0.1 }, text: 'B', confidence: 80, header: false },
          { row: 0, column: 2, rowSpan: 1, columnSpan: 1, bounds: { left: 0.06, top: 0, width: 0.03, height: 0.1 }, text: 'C', confidence: 80, header: false },
        ],
      })
    );

    dragLine(verticalDivider(middle, 1), { fromX: 30, fromY: 50, toX: 40, toY: 50 });

    const t = await savedTable();
    const cell = (text) => t.cells.find((c) => c.text === text);
    // A (col 0, widened) and B (col 1, shifted/shrunk) had their squares change -> reset.
    expect(cell('A').confidence).toBe(0);
    expect(cell('B').confidence).toBe(0);
    // C (col 2) is untouched by the move -> confidence kept.
    expect(cell('C').confidence).toBe(80);
  });

  test('a boundary cascade-delete drag reconciles cells: the consumed column`s cell is dropped', async () => {
    // Three columns of 0.03 with a cell in each; right edge at viewbox x=90. Drag it inward
    // to x=45 (fraction 0.045): the last column (0.03) is consumed whole and dropped.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.09, height: 0.1 },
        columnWidths: [
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
          { value: 0.03, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.03, height: 0.1 }, text: 'A', confidence: 80, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.03, top: 0, width: 0.03, height: 0.1 }, text: 'B', confidence: 80, header: false },
          { row: 0, column: 2, rowSpan: 1, columnSpan: 1, bounds: { left: 0.06, top: 0, width: 0.03, height: 0.1 }, text: 'C', confidence: 80, header: false },
        ],
      })
    );

    dragBoundary(middle, 'right', { fromX: 90, fromY: 50, toX: 45, toY: 50 });

    const t = await savedTable();
    expect(t.columnWidths).toHaveLength(2);
    // C (the consumed back column) is gone; A and B survive at columns 0 and 1.
    expect(t.cells.map((c) => c.text).sort()).toEqual(['A', 'B']);
    expect(t.cells.find((c) => c.text === 'A').column).toBe(0);
    expect(t.cells.find((c) => c.text === 'B').column).toBe(1);
  });

  test('menu Delete is not offered when the axis has a single cell', async () => {
    // A single column and single row: no internal dividers exist, so open the menu on a
    // horizontal divider of a 2-row / 1-column table and confirm Delete IS offered there,
    // then a 1-row axis omits it. Here: 1 column, 2 rows -> vertical axis has no divider;
    // click the horizontal divider and check Delete present, then verify the guard using a
    // table whose clicked axis has a single cell is covered by the column-count guard below.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        // Vertical axis: two columns so there is a vertical divider to click; but make the
        // point: after one Delete the axis is a single cell and Delete disappears.
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    // Delete the only vertical divider, leaving a single column.
    clickLine(verticalDivider(middle, 1), { x: 50, y: 25 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // The vertical axis now has one column, so there is no vertical divider left to click.
    await waitFor(() =>
      expect(screen.queryByRole('menu')).toBeNull()
    );
    const remainingVertical = middle.querySelectorAll('[data-testid="hit-line"]');
    // 4 boundaries + 0 vertical dividers + (rowHeights-1)=0 horizontal dividers = 4.
    expect(remainingVertical).toHaveLength(4);
  });

  // ---- Task 5: boundary-edge click add-line menu -----------------------------------
  //
  // A near-stationary gesture (< ~4px) on an OUTER boundary edge is a CLICK that opens an
  // MUI popup menu with a SINGLE "Add" item, which adds a grid line just inside that edge
  // by half-splitting the nearest cell (axis sum, hence bounds, unchanged). A gesture past
  // the threshold is still a boundary DRAG (resize) and never opens the menu. Boundary hit
  // lines render in [left, right, top, bottom] order (BOUNDARY above). Mouse family (not
  // pointer) — jsdom's PointerEvents do not carry clientX.

  // Click (no movement) a boundary edge's hit line: mouse-down then mouse-up at the same
  // screen coords, so the threshold resolves to a click.
  function clickBoundary(middle, which, { x, y }) {
    const line = boundaryHitLines(middle)[BOUNDARY[which]];
    fireEvent.mouseDown(line, { clientX: x, clientY: y });
    fireEvent.mouseUp(window, { clientX: x, clientY: y });
  }

  // Each boundary edge, when clicked, opens a menu whose ONLY item is the inward "Add".
  const BOUNDARY_MENU = [
    { which: 'bottom', label: 'Add Above', at: { x: 50, y: 100 } },
    { which: 'top', label: 'Add Below', at: { x: 50, y: 0 } },
    { which: 'left', label: 'Add Right', at: { x: 0, y: 50 } },
    { which: 'right', label: 'Add Left', at: { x: 100, y: 50 } },
  ];

  const OTHER_BOUNDARY_LABELS = [
    'Add Above',
    'Add Below',
    'Add Left',
    'Add Right',
    'Delete',
  ];

  for (const { which, label, at } of BOUNDARY_MENU) {
    test(`click (no drag) on the ${which} boundary opens a menu whose inward item is "${label}" and makes no change`, async () => {
      const middle = await renderForDrag(
        singleTable({
          bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
          columnWidths: [
            { value: 0.05, confidence: 90 },
            { value: 0.05, confidence: 90 },
          ],
          rowHeights: [
            { value: 0.05, confidence: 90 },
            { value: 0.05, confidence: 90 },
          ],
        })
      );

      clickBoundary(middle, which, at);

      const menu = await screen.findByRole('menu');
      expect(menu).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
      // The inward "Add" item plus the Task 7 "Delete Table" item: no OTHER Add/Delete
      // label is present.
      for (const other of OTHER_BOUNDARY_LABELS) {
        if (other === label) continue;
        expect(screen.queryByRole('menuitem', { name: other })).toBeNull();
      }
      expect(
        screen.getByRole('menuitem', { name: 'Delete Table' })
      ).toBeInTheDocument();
      // These fixtures are multi-cell (2×2) tables, so the Task 10 "Recalculate" item is
      // also present (mutually exclusive with the 1×1 "Calculate"). Total: Add + Recalculate
      // + Delete Table = 3.
      expect(
        screen.getByRole('menuitem', { name: 'Recalculate' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Calculate' })).toBeNull();
      expect(screen.getAllByRole('menuitem')).toHaveLength(3);

      // A click alone makes no metadata change: Save stays disabled and nothing saved.
      // (The open MUI Menu is a modal that aria-hides the rest of the app.)
      expect(
        screen.getByRole('button', { name: /save/i, hidden: true })
      ).toBeDisabled();
      expect(saveTables).not.toHaveBeenCalled();
    });
  }

  test('boundary Add Above (bottom edge) half-splits the last row (I2), bounds unchanged', async () => {
    // Rows 0.04 (top, conf 0.7) and 0.06 (bottom, conf 0.3); bottom edge at viewbox y=100.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
      })
    );

    clickBoundary(middle, 'bottom', { x: 50, y: 100 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Above' }));

    const t = await savedTable();
    // The last row (index 1) split into two halves of 0.03 each, carrying its confidence.
    expect(t.rowHeights).toHaveLength(3);
    expect(t.rowHeights[0].value).toBeCloseTo(0.04, 10);
    expect(t.rowHeights[0].confidence).toBe(70);
    expect(t.rowHeights[1].value).toBeCloseTo(0.03, 10);
    expect(t.rowHeights[2].value).toBeCloseTo(0.03, 10);
    expect(t.rowHeights[1].confidence).toBe(30);
    expect(t.rowHeights[2].confidence).toBe(30);
    // I2: sum(rowHeights) === bounds.height, unchanged.
    expect(t.rowHeights.reduce((a, r) => a + r.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
  });

  test('boundary Add Below (top edge) half-splits the first row (I2), bounds unchanged', async () => {
    // Rows 0.04 (top, conf 0.7) and 0.06 (bottom, conf 0.3); top edge at viewbox y=0.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
      })
    );

    clickBoundary(middle, 'top', { x: 50, y: 0 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Below' }));

    const t = await savedTable();
    // The first row (index 0) split into two halves of 0.02 each, carrying its confidence.
    expect(t.rowHeights).toHaveLength(3);
    expect(t.rowHeights[0].value).toBeCloseTo(0.02, 10);
    expect(t.rowHeights[1].value).toBeCloseTo(0.02, 10);
    expect(t.rowHeights[0].confidence).toBe(70);
    expect(t.rowHeights[1].confidence).toBe(70);
    expect(t.rowHeights[2].value).toBeCloseTo(0.06, 10);
    expect(t.rowHeights[2].confidence).toBe(30);
    expect(t.rowHeights.reduce((a, r) => a + r.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
  });

  test('boundary Add Right (left edge) half-splits the first column (I1), bounds unchanged', async () => {
    // Columns 0.04 (left, conf 0.7) and 0.06 (right, conf 0.3); left edge at viewbox x=0.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    clickBoundary(middle, 'left', { x: 0, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Right' }));

    const t = await savedTable();
    // The first column (index 0) split into two halves of 0.02 each, carrying its confidence.
    expect(t.columnWidths).toHaveLength(3);
    expect(t.columnWidths[0].value).toBeCloseTo(0.02, 10);
    expect(t.columnWidths[1].value).toBeCloseTo(0.02, 10);
    expect(t.columnWidths[0].confidence).toBe(70);
    expect(t.columnWidths[1].confidence).toBe(70);
    expect(t.columnWidths[2].value).toBeCloseTo(0.06, 10);
    expect(t.columnWidths[2].confidence).toBe(30);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
    expect(t.bounds.left).toBe(0);
  });

  test('boundary Add Left (right edge) half-splits the last column (I1), bounds unchanged', async () => {
    // Columns 0.04 (left, conf 0.7) and 0.06 (right, conf 0.3); right edge at viewbox x=100.
    const middle = await renderForDrag(
      singleTable({
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.04, confidence: 70 },
          { value: 0.06, confidence: 30 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      })
    );

    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Left' }));

    const t = await savedTable();
    // The last column (index 1) split into two halves of 0.03 each, carrying its confidence.
    expect(t.columnWidths).toHaveLength(3);
    expect(t.columnWidths[0].value).toBeCloseTo(0.04, 10);
    expect(t.columnWidths[0].confidence).toBe(70);
    expect(t.columnWidths[1].value).toBeCloseTo(0.03, 10);
    expect(t.columnWidths[2].value).toBeCloseTo(0.03, 10);
    expect(t.columnWidths[1].confidence).toBe(30);
    expect(t.columnWidths[2].confidence).toBe(30);
    expect(t.columnWidths.reduce((a, c) => a + c.value, 0)).toBeCloseTo(0.1, 10);
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
    expect(t.bounds.left).toBe(0);
  });

  // ---- Task 7: "Delete Table" on the boundary menu + confirmation dialog ----
  //
  // The boundary-edge menu now carries a second item, "Delete Table", below the inward
  // "Add …" item. Choosing it opens an "Are you sure?" confirmation dialog (Cancel /
  // Delete). Delete flags the table deleted: true through the commit path, which marks
  // the edit dirty (Save enables) and — via Task 3's overlayTables deleted-exclusion —
  // removes the table's grid from the centre overlay. This is distinct from the
  // internal-divider menu's "Delete" (which merges a single grid line).

  test('boundary menu shows the inward "Add" item and a "Delete Table" item', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    // Sub-threshold click on the right boundary (viewbox x=100) opens the boundary menu.
    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');

    // The existing inward "Add" item for the right edge is "Add Left" ...
    expect(
      screen.getByRole('menuitem', { name: 'Add Left' })
    ).toBeInTheDocument();
    // ... plus the new "Delete Table" item.
    expect(
      screen.getByRole('menuitem', { name: 'Delete Table' })
    ).toBeInTheDocument();
  });

  test('clicking "Delete Table" opens the "Are you sure?" dialog with Cancel and Delete', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Table' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Are you sure?');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  test('Cancel closes the dialog, makes no change, and leaves the table drawn', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Table' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // No metadata change: Save stays disabled and saveTables was never called.
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();

    // The table is still drawn on the centre overlay.
    expect(middle.querySelector('rect')).not.toBeNull();
  });

  test('Delete removes the table grid from the centre overlay and marks the edit dirty', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Table' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Dialog closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Task 3 excludes deleted tables from overlayTables, so the single table's rect is gone.
    await waitFor(() => expect(middle.querySelector('rect')).toBeNull());

    // The edit is dirty: Save is enabled.
    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
  });

  test('a boundary DRAG (well past 4px) still resizes and does NOT open the menu', async () => {
    const middle = await renderForDrag(singleTable());
    // Right edge at viewbox x=100 (fraction 0.1); drag out to x=120 (fraction 0.12) —
    // well beyond the 4px click threshold.
    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 120, toY: 50 });

    // No menu opened by a drag.
    expect(screen.queryByRole('menu')).toBeNull();

    const t = await savedTable();
    // Last column grew by 0.02 (0.04 -> 0.06); width == sum == 0.12 (same as the Task 2
    // boundary-grow test), proving the resize still happens.
    const vals = t.columnWidths.map((c) => c.value);
    expect(vals[2]).toBeCloseTo(0.06, 10);
    expect(t.bounds.width).toBeCloseTo(0.12, 10);
  });

  // ---- Task 9: "Calculate" on a border-only (1×1) table's boundary menu ----
  //
  // A table that is just a border (exactly one column and one row) offers a "Calculate"
  // item on its boundary menu — mutually exclusive with Task 10's "Recalculate". It opens
  // a dialog with two OPTIONAL numeric inputs; confirming sends ONE hint through
  // findTables(pdfId, [{ pdfPage, tables: [hint] }]) and REPLACES the whole table with the
  // finder's result (keeping the original tableId/pdfPage), normalised like a fresh load.

  // A border-only 1×1 table at bounds (0,0)-(0.1,0.1). renderForDrag maps a fraction f to
  // viewbox f*1000, so its right edge is at viewbox x=100 (clickable).
  const border1x1 = (overrides) =>
    singleTable({
      bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
      columnWidths: [{ value: 0.1, confidence: 100 }],
      rowHeights: [{ value: 0.1, confidence: 100 }],
      tableInPage: 0,
      cells: [makeDefaultCell(0, 0, { left: 0, top: 0, width: 0.1, height: 0.1 })],
      ...overrides,
    });

  // A finder result table for the border: a 2×2 grid carrying a single backend cell so the
  // replacement's fillGridCells (which materialises the other three squares) is observable.
  const calcResultTable = (overrides) => ({
    tableId: 'backend-id',
    name: 'T',
    pdfPage: 0,
    tableInPage: 0,
    bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
    columnWidths: [
      { value: 0.05, confidence: 90 },
      { value: 0.05, confidence: 90 },
    ],
    rowHeights: [
      { value: 0.05, confidence: 90 },
      { value: 0.05, confidence: 90 },
    ],
    cells: [
      {
        row: 0,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        bounds: { left: 0, top: 0, width: 0.05, height: 0.05 },
        text: 'A',
        confidence: 90,
        header: false,
      },
    ],
    ...overrides,
  });

  // Render the border table and open its boundary (right-edge) menu.
  async function openBorderBoundaryMenu(overrides) {
    const middle = await renderForDrag(border1x1(overrides));
    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    return middle;
  }

  test('a 1×1 border table boundary menu shows "Calculate" and not "Recalculate"', async () => {
    await openBorderBoundaryMenu();
    expect(
      screen.getByRole('menuitem', { name: 'Calculate' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Recalculate' })).toBeNull();
    // The existing inward "Add" and "Delete Table" items are still present.
    expect(
      screen.getByRole('menuitem', { name: 'Add Left' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete Table' })
    ).toBeInTheDocument();
  });

  test('a multi-cell table boundary menu does NOT show "Calculate"', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );
    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Calculate' })).toBeNull();
  });

  test('confirming Calculate with blank fields sends a hint WITHOUT expected counts', async () => {
    findTables.mockResolvedValue({ tables: [calcResultTable()] });
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    // Confirm with both fields left blank.
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(findTables).toHaveBeenCalledTimes(1));
    const [pdfIdArg, pagesArg] = findTables.mock.calls[0];
    expect(pdfIdArg).toBe(PDF_ID);
    expect(pagesArg).toHaveLength(1);
    expect(pagesArg[0].pdfPage).toBe(0);
    expect(pagesArg[0].tables).toHaveLength(1);
    const hint = pagesArg[0].tables[0];
    expect(hint).toMatchObject({
      name: 'T',
      tableInPage: 0,
      left: 0,
      top: 0,
      width: 0.1,
      height: 0.1,
    });
    expect(hint).not.toHaveProperty('expectedRows');
    expect(hint).not.toHaveProperty('expectedColumns');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('confirming Calculate with row/column values sends them as numbers', async () => {
    findTables.mockResolvedValue({ tables: [calcResultTable()] });
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Number of rows'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Number of columns'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(findTables).toHaveBeenCalledTimes(1));
    const hint = findTables.mock.calls[0][1][0].tables[0];
    expect(hint.expectedRows).toBe(10);
    expect(hint.expectedColumns).toBe(3);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('a returned table REPLACES the border table, keeping tableId/pdfPage and normalising', async () => {
    findTables.mockResolvedValue({
      tables: [
        // bounds.width/height deliberately violate I1/I2 to prove normaliseTableBounds runs.
        calcResultTable({ bounds: { left: 0, top: 0, width: 0.9, height: 0.9 } }),
      ],
    });
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const t = await savedTable();
    expect(t.tableId).toBe('t-1'); // original front-end id preserved
    expect(t.pdfPage).toBe(0); // original page preserved
    // I1/I2: bounds width/height == axis sums (normaliseTableBounds corrected 0.9 -> 0.1).
    expect(t.bounds.width).toBeCloseTo(0.1, 10);
    expect(t.bounds.height).toBeCloseTo(0.1, 10);
    // Every one of the 2×2 grid squares has a cell (fillGridCells materialised the rest).
    expect(t.cells).toHaveLength(4);
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        expect(
          t.cells.find((x) => x.row === r && x.column === c)
        ).toBeDefined();
      }
    }
  });

  test('a response with no table leaves the table unchanged and shows an info toast', async () => {
    findTables.mockResolvedValue({ tables: [] });
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(toast).toHaveBeenCalled();
    // Nothing committed: Save stays disabled and saveTables was never called.
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('findTables failure shows toast.error and changes nothing', async () => {
    findTables.mockRejectedValue(new Error('boom'));
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
  });

  test('shows the loading overlay while a Calculate is in flight and hides it after', async () => {
    let resolveFind;
    findTables.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    await openBorderBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    await screen.findByRole('dialog');
    // No overlay before the request starts.
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    // The shared loading overlay appears while the find-tables poll is in flight.
    await screen.findByTestId('image-loading-overlay');

    // Resolving the poll clears the overlay.
    await act(async () => {
      resolveFind({ tables: [calcResultTable()] });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  // ---- Task 10: "Recalculate" on a multi-cell table's boundary menu ----
  //
  // A multi-cell table (more than one column and/or row) offers a "Recalculate" item on
  // its boundary menu — mutually exclusive with the 1×1 "Calculate". It re-reads ONLY the
  // low-confidence (RED) cells: it builds ONE hint carrying a `cells` array (grid-line
  // bounds per selected cell) and merges the returned cells back into the table by
  // (row, column), leaving every other cell and all table geometry intact.

  // A 2×2 multi-cell table at bounds (0,0)-(0.1,0.1). Cells: (0,0) red (conf 30) and
  // (1,0) red (conf null); (0,1) green (conf 90) and (1,1) orange (conf 60). cell.bounds
  // are deliberately tight OCR boxes so the grid-line bounds computation is observable.
  const multiCell = (overrides) => ({
    tables: [
      {
        tableId: 't-1',
        name: 'T',
        pdfPage: 0,
        tableInPage: 0,
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.01, width: 0.02, height: 0.02 }, text: 'a', confidence: 30, header: false },
          { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.06, top: 0.01, width: 0.02, height: 0.02 }, text: 'b', confidence: 90, header: false },
          { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.06, width: 0.02, height: 0.02 }, text: 'c', confidence: null, header: false },
          { row: 1, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.06, top: 0.06, width: 0.02, height: 0.02 }, text: 'd', confidence: 60, header: false },
        ],
        ...overrides,
      },
    ],
  });

  // Render the multi-cell table and open its right-boundary menu.
  async function openMultiCellBoundaryMenu(overrides) {
    const middle = await renderForDrag(multiCell(overrides));
    clickBoundary(middle, 'right', { x: 100, y: 50 });
    await screen.findByRole('menu');
    return middle;
  }

  test('a multi-cell table boundary menu shows "Recalculate" and not "Calculate"', async () => {
    await openMultiCellBoundaryMenu();
    expect(
      screen.getByRole('menuitem', { name: 'Recalculate' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Calculate' })).toBeNull();
    // The existing inward "Add" and "Delete Table" items are still present.
    expect(
      screen.getByRole('menuitem', { name: 'Add Left' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete Table' })
    ).toBeInTheDocument();
  });

  test('Recalculate with NO low-confidence cells makes no request and shows an info toast', async () => {
    // Every cell green (conf 90): nothing qualifies as red.
    await openMultiCellBoundaryMenu({
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.05 }, text: 'a', confidence: 90, header: false },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.05, top: 0, width: 0.05, height: 0.05 }, text: 'b', confidence: 90, header: false },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0.05, width: 0.05, height: 0.05 }, text: 'c', confidence: 90, header: false },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.05, top: 0.05, width: 0.05, height: 0.05 }, text: 'd', confidence: 90, header: false },
      ],
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(findTables).not.toHaveBeenCalled();
    // Nothing committed: Save stays disabled and saveTables was never called.
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('shows the loading overlay while a Recalculate is in flight and hides it after', async () => {
    let resolveFind;
    findTables.mockImplementation(
      () => new Promise((resolve) => (resolveFind = resolve))
    );
    await openMultiCellBoundaryMenu();
    expect(screen.queryByTestId('image-loading-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    // The shared loading overlay appears while the find-tables poll is in flight.
    await screen.findByTestId('image-loading-overlay');

    // Resolving the poll clears the overlay.
    await act(async () => {
      resolveFind({ tables: [] });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('image-loading-overlay')).toBeNull()
    );
  });

  test('Recalculate sends ONE hint whose cells are the RED cells only, with grid-line bounds', async () => {
    findTables.mockResolvedValue({ tables: [] });
    await openMultiCellBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    await waitFor(() => expect(findTables).toHaveBeenCalledTimes(1));
    const [pdfIdArg, pagesArg] = findTables.mock.calls[0];
    expect(pdfIdArg).toBe(PDF_ID);
    expect(pagesArg).toHaveLength(1);
    expect(pagesArg[0].pdfPage).toBe(0);
    expect(pagesArg[0].tables).toHaveLength(1);
    const hint = pagesArg[0].tables[0];
    expect(hint).toMatchObject({
      name: 'T',
      tableInPage: 0,
      left: 0,
      top: 0,
      width: 0.1,
      height: 0.1,
    });
    // Only the two RED cells (0,0) and (1,0) are requested — NOT the green/orange ones.
    expect(hint.cells).toHaveLength(2);
    const byKey = Object.fromEntries(
      hint.cells.map((c) => [`${c.row},${c.column}`, c])
    );
    expect(Object.keys(byKey).sort()).toEqual(['0,0', '1,0']);
    // Grid-line bounds (from geometry, NOT the tight OCR cell.bounds): (0,0) is the
    // top-left 0.05×0.05 square; (1,0) sits one row down at top 0.05.
    expect(byKey['0,0'].bounds).toMatchObject({
      left: 0,
      top: 0,
      width: 0.05,
      height: 0.05,
    });
    expect(byKey['1,0'].bounds.left).toBeCloseTo(0, 10);
    expect(byKey['1,0'].bounds.top).toBeCloseTo(0.05, 10);
    expect(byKey['1,0'].bounds.width).toBeCloseTo(0.05, 10);
    expect(byKey['1,0'].bounds.height).toBeCloseTo(0.05, 10);
  });

  test('Recalculate merges ONLY the returned (row,column) cells and leaves geometry untouched', async () => {
    findTables.mockResolvedValue({
      tables: [
        {
          // Reflected identity + non-authoritative geometry the merge must ignore.
          name: 'T',
          tableInPage: 0,
          pdfPage: 0,
          bounds: { left: 0.5, top: 0.5, width: 0.4, height: 0.4 },
          columnWidths: [{ value: 0.4, confidence: 10 }],
          rowHeights: [{ value: 0.4, confidence: 10 }],
          cells: [
            { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.05 }, text: 'X', confidence: 95, header: false },
            { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0.05, width: 0.05, height: 0.05 }, text: 'Y', confidence: 88, header: false },
          ],
        },
      ],
    });
    await openMultiCellBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));
    await waitFor(() => expect(findTables).toHaveBeenCalledTimes(1));

    const t = await savedTable();
    // The two returned RED cells were replaced with fresh text/confidence.
    const c00 = t.cells.find((c) => c.row === 0 && c.column === 0);
    expect(c00.text).toBe('X');
    expect(c00.confidence).toBe(95);
    const c10 = t.cells.find((c) => c.row === 1 && c.column === 0);
    expect(c10.text).toBe('Y');
    expect(c10.confidence).toBe(88);
    // Every OTHER cell is untouched (original text/confidence preserved).
    const c01 = t.cells.find((c) => c.row === 0 && c.column === 1);
    expect(c01.text).toBe('b');
    expect(c01.confidence).toBe(90);
    const c11 = t.cells.find((c) => c.row === 1 && c.column === 1);
    expect(c11.text).toBe('d');
    expect(c11.confidence).toBe(60);
    // ALL table geometry preserved (the response geometry is ignored).
    expect(t.columnWidths.map((c) => c.value)).toEqual([0.05, 0.05]);
    expect(t.rowHeights.map((c) => c.value)).toEqual([0.05, 0.05]);
    expect(t.bounds).toEqual({ left: 0, top: 0, width: 0.1, height: 0.1 });
  });

  test('Recalculate with no tables returned warns "Some tables not detected" and changes nothing', async () => {
    findTables.mockResolvedValue({ tables: [] });
    await openMultiCellBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Some tables not detected')
    );
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('Recalculate warns "Some cells not detected" when fewer cells come back, still merging what did', async () => {
    // Two RED cells requested ((0,0) and (1,0)); the finder returns only (0,0).
    findTables.mockResolvedValue({
      tables: [
        {
          name: 'T',
          tableInPage: 0,
          pdfPage: 0,
          bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
          columnWidths: [{ value: 0.05, confidence: 90 }],
          rowHeights: [{ value: 0.05, confidence: 90 }],
          cells: [
            { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.05 }, text: 'X', confidence: 95, header: false },
          ],
        },
      ],
    });
    await openMultiCellBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Some cells not detected')
    );
    // The one returned cell was still merged.
    const t = await savedTable();
    expect(t.cells.find((c) => c.row === 0 && c.column === 0).text).toBe('X');
  });

  test('Recalculate surfaces a findTables failure via toast.error and changes nothing', async () => {
    findTables.mockRejectedValue(new Error('kaboom'));
    await openMultiCellBoundaryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recalculate' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('kaboom'));
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  // ---- Task 2 (this task): "Add table" on empty-area click ----
  //
  // A plain click on an empty area of the interactive centre overlay opens a
  // one-item "Add table" menu; choosing it inserts a new single-cell table at the
  // click point (unless it would run off the page or overlap a same-page table, in
  // which case a transient "Not enough room" error is shown and nothing is created).
  // The empty-area click is a plain click on the <svg>.
  function clickEmptyArea(middle, { x, y }) {
    fireEvent.click(middle.querySelector('svg'), { clientX: x, clientY: y });
  }

  test('empty-area click opens a one-item "Add table" menu; a click inside a table does not', async () => {
    // Single table occupying fraction 0..0.1 in both axes (viewbox 0..100). Click at
    // (300, 300) -> fractions (0.3, 0.3), clearly outside it.
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    clickEmptyArea(middle, { x: 300, y: 300 });

    await screen.findByRole('menu');
    expect(
      screen.getByRole('menuitem', { name: 'Add table' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);

    // Close the menu (Escape) then click INSIDE the table (viewbox 50,50 -> 0.05,0.05):
    // no add-table menu opens.
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    clickEmptyArea(middle, { x: 50, y: 50 });
    // Give any state a tick; assert no add-table menuitem appeared.
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Add table' })).toBeNull();
    });
  });

  test('picking "Add table" inserts a new single-cell table and marks the edit dirty', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    // Click at (300, 400) -> fractions L=0.3, T=0.4; new table 0.1 × 0.02, no overlap.
    clickEmptyArea(middle, { x: 300, y: 400 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    // Dirty BEFORE saving: the Save button is enabled.
    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());

    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sentTables = saveTables.mock.calls[0][1];

    // The new table is the one that isn't the original t-1.
    const added = sentTables.find((t) => t.tableId !== 't-1');
    expect(added).toBeTruthy();
    expect(typeof added.tableId).toBe('string');
    expect(added.tableId.length).toBeGreaterThan(0);
    expect(added.name).toBe('Page 1 Table 2'); // P=0 -> "Page 1"; page already had 1 table -> "Table 2"
    expect(added.pdfPage).toBe(0);
    expect(added.confidence).toBe(100);
    expect(added.bounds.left).toBeCloseTo(0.3, 10);
    expect(added.bounds.top).toBeCloseTo(0.4, 10);
    expect(added.bounds.width).toBeCloseTo(0.1, 10);
    expect(added.bounds.height).toBeCloseTo(0.02, 10);
    // Task 5: the 1×1 grid is seeded with its single (0,0) cell (confidence 0 -> red),
    // not an empty cells array.
    expect(added.cells).toHaveLength(1);
    expect(added.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      text: '',
      confidence: 0,
      header: false,
    });
    expect(added.cells[0].bounds.left).toBeCloseTo(0.3, 10);
    expect(added.cells[0].bounds.top).toBeCloseTo(0.4, 10);
    expect(added.cells[0].bounds.width).toBeCloseTo(0.1, 10);
    expect(added.cells[0].bounds.height).toBeCloseTo(0.02, 10);
    expect(added.next).toBeNull();
    expect(added.title).toBeNull();
    expect(added.sectionTitles).toBeNull();
    expect(added.footer).toBeNull();
    expect(added.columnWidths[0].confidence).toBe(100);
    expect(added.columnWidths[0].value).toBeCloseTo(0.1, 10);
    expect(added.rowHeights[0].confidence).toBe(100);
    expect(added.rowHeights[0].value).toBeCloseTo(0.02, 10);
    expect(added.extractionMechanism).toBe('MANUAL');
  });

  // As renderForDrag, but waits for the interactive SVG rather than a <rect>. Needed
  // for fixtures whose displayed page (page 0) has NO table, so no <rect> is drawn.
  async function renderForAddNoRect(metadata) {
    Element.prototype.scrollIntoView = jest.fn();
    getMetadata.mockResolvedValue(metadata);
    const middle = await renderAndGetMiddle();
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
    await waitFor(() => expect(middle.querySelector('svg')).not.toBeNull());
    return middle;
  }

  test('on a page with zero tables the new table is named "Page {P+1} Table 1"', async () => {
    // Fixture has a table only on page 1; display page 0 (page 0 has no <rect>, so use
    // the no-rect render helper).
    const middle = await renderForAddNoRect({
      tables: [
        {
          tableId: 't-p1',
          name: 'On page 1',
          pdfPage: 1,
          bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
          columnWidths: [{ value: 0.1, confidence: 90 }],
          rowHeights: [{ value: 0.1, confidence: 90 }],
        },
      ],
    });

    clickEmptyArea(middle, { x: 200, y: 200 }); // page 0 empty area
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sentTables = saveTables.mock.calls[0][1];

    const added = sentTables.find((t) => t.tableId !== 't-p1');
    expect(added.pdfPage).toBe(0);
    expect(added.name).toBe('Page 1 Table 1'); // page 0 had zero tables
  });

  test('the new table is spliced immediately after the last same-page table', async () => {
    // Order in metadata: page0 (A), page1 (B), page0 (C). Displaying page 0, a new
    // page-0 table must be inserted immediately AFTER C (index of the LAST page-0
    // table), i.e. at index 3 (the end here), never reordering B.
    const middle = await renderForDrag({
      tables: [
        { tableId: 'A', name: 'A', pdfPage: 0, bounds: { left: 0, top: 0, width: 0.05, height: 0.05 }, columnWidths: [{ value: 0.05, confidence: 90 }], rowHeights: [{ value: 0.05, confidence: 90 }] },
        { tableId: 'B', name: 'B', pdfPage: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.05 }, columnWidths: [{ value: 0.05, confidence: 90 }], rowHeights: [{ value: 0.05, confidence: 90 }] },
        { tableId: 'C', name: 'C', pdfPage: 0, bounds: { left: 0.2, top: 0.2, width: 0.05, height: 0.05 }, columnWidths: [{ value: 0.05, confidence: 90 }], rowHeights: [{ value: 0.05, confidence: 90 }] },
      ],
    });

    clickEmptyArea(middle, { x: 500, y: 500 }); // fractions 0.5,0.5 — clear of A and C
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sent = saveTables.mock.calls[0][1];

    const ids = sent.map((t) => t.tableId);
    // Original relative order preserved; the new id sits immediately after 'C'
    // (the last page-0 table), which here is the end of the list.
    const cIdx = ids.indexOf('C');
    expect(ids[cIdx + 1]).not.toBe(undefined);
    expect(['A', 'B', 'C']).not.toContain(ids[cIdx + 1]); // it's the new one
    expect(ids.indexOf('B')).toBe(1); // B untouched at index 1
  });

  test('a click too near the right edge shows "Not enough room" and creates nothing', async () => {
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.05, height: 0.05 } })
    );

    // Click at (950, 500): L=0.95, W=0.1 -> L+W=1.05 > 1 -> off the page.
    clickEmptyArea(middle, { x: 950, y: 500 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    // "Not enough room" is surfaced via a toast (same mechanism as the Export button).
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Not enough room'));
    // No add, Save disabled, nothing saved. (Menu closed on failure so no hidden:true.)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('a click whose new rectangle would overlap an existing same-page table shows "Not enough room"', async () => {
    // Existing table fraction 0.2..0.4 (both axes). Click at (150, 250) -> L=0.15,
    // T=0.25: the click point (0.15, 0.25) is OUTSIDE the table (so the menu opens),
    // but the resulting rect 0.15..0.25 × 0.25..0.27 overlaps the existing 0.2..0.4.
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0.2, top: 0.2, width: 0.2, height: 0.2 } })
    );

    clickEmptyArea(middle, { x: 150, y: 250 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Not enough room'));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  test('a click whose new rectangle only shares an edge with an existing table succeeds', async () => {
    // Existing table 0.2..0.3 × 0.3..0.4. Click at (100, 300) -> L=0.1, T=0.3: the
    // click point (0.1, 0.3) is OUTSIDE the table (so the menu opens). Candidate rect
    // 0.1..0.2 × 0.3..0.32: its RIGHT edge (0.2) exactly touches the existing LEFT
    // edge (0.2) and the y-spans overlap. Strict overlap (only a shared edge) => NOT
    // an overlap, so the add succeeds.
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0.2, top: 0.3, width: 0.1, height: 0.1 } })
    );

    clickEmptyArea(middle, { x: 100, y: 300 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sent = saveTables.mock.calls[0][1];
    expect(sent.some((t) => t.tableId !== 't-1')).toBe(true); // the add went through
    // No "Not enough room" toast surfaced.
    expect(toast).not.toHaveBeenCalled();
  });

  test('a boundary drag-resize released in empty area does not pop the "Add table" menu', async () => {
    // Regression: the svg onClick must not treat the `click` the browser synthesises
    // at the end of a hit-line drag as an empty-area click. Drag the right boundary
    // out past the page's right edge (client x=1100 -> fraction 1.1); the edge clamps
    // at 1.0 but the pointer is released at 1.1, OUTSIDE the (now full-width) table, so
    // the inside-a-table guard does not catch it. The trailing click must be swallowed.
    const middle = await renderForDrag(
      singleTable({ bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } })
    );

    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 1100, toY: 50 });
    // The browser fires a `click` on the svg after the drag's mouseup; simulate it at
    // the release point (jsdom does not synthesise it). fireEvent is synchronous so the
    // suppress flag set on mouseUp is still current here.
    fireEvent.click(middle.querySelector('svg'), { clientX: 1100, clientY: 50 });

    // No menu of any kind — and specifically no "Add table" item — should appear.
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Add table' })).toBeNull();
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('changing pdfId clears the panels; a failed metadata load does not leave the previous document on screen', async () => {
    // First document loads its two-table list.
    const { rerender } = render(<PDFEditTableStructure pdfId={'pdf-A'} />);
    await waitFor(() => expect(screen.getAllByTestId('table-entry')).toHaveLength(2));

    // Switch to a document whose metadata load fails.
    getMetadata.mockRejectedValueOnce(new Error('load failed'));
    rerender(<PDFEditTableStructure pdfId={'pdf-B'} />);

    // The previous document's table entries are cleared, not left stale under the new
    // document (the left panel resets on the pdfId change rather than persisting pdf-A).
    await waitFor(() =>
      expect(screen.queryAllByTestId('table-entry')).toHaveLength(0)
    );
  });

  test('a table flagged deleted draws no rect or hit line on the centre overlay', async () => {
    // Two single-cell tables on page 0: one live, one deleted. Only the live one may
    // reach overlayTables, so only its geometry (rect + boundary hit lines) is drawn.
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 'live',
          name: 'Live',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.1, width: 0.05, height: 0.05 },
          columnWidths: [{ value: 0.05, confidence: 100 }],
          rowHeights: [{ value: 0.05, confidence: 100 }],
        },
        {
          tableId: 'dead',
          name: 'Deleted',
          pdfPage: 0,
          deleted: true,
          bounds: { left: 0.5, top: 0.5, width: 0.05, height: 0.05 },
          columnWidths: [{ value: 0.05, confidence: 100 }],
          rowHeights: [{ value: 0.05, confidence: 100 }],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    loadImage(middle.querySelector('img'));

    // The live table's rect appears; wait for the overlay to render.
    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());

    // Exactly one rect — the deleted table contributes none.
    const rects = middle.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    // ...and it is the LIVE table (0.1 * 1000 = 100), not the deleted one (would be 500).
    expect(rects[0]).toHaveAttribute('x', '100');
    expect(rects[0]).toHaveAttribute('y', '100');

    // Interactivity gone too: one live single-cell table yields exactly 4 boundary hit
    // lines (no internal dividers). If the deleted table were drawn there would be 8.
    expect(
      middle.querySelectorAll('[data-testid="hit-line"]')
    ).toHaveLength(4);
  });

  // ---- Task 4: Include-deleted toggle, list composition, deleted-row behaviour -----
  describe('Include-deleted toggle and deleted rows', () => {
    // One live table on page 0, one deleted on page 0, one deleted on page 1. On mount
    // the centre displays page 0, so page-0 deleted tables are the ones that may appear.
    const DELETED_FIXTURE = {
      tables: [
        {
          tableId: 't-live-0',
          name: 'Live Zero',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
          columnWidths: [{ value: 0.1, confidence: 90 }],
          rowHeights: [{ value: 0.1, confidence: 90 }],
        },
        {
          tableId: 't-del-0',
          name: 'Deleted Zero',
          pdfPage: 0,
          deleted: true,
          bounds: { left: 0.4, top: 0.4, width: 0.2, height: 0.2 },
          columnWidths: [{ value: 0.1, confidence: 90 }],
          rowHeights: [{ value: 0.1, confidence: 90 }],
        },
        {
          tableId: 't-del-1',
          name: 'Deleted One',
          pdfPage: 1,
          deleted: true,
          bounds: { left: 0.4, top: 0.4, width: 0.2, height: 0.2 },
          columnWidths: [{ value: 0.1, confidence: 90 }],
          rowHeights: [{ value: 0.1, confidence: 90 }],
        },
      ],
    };

    // Render, wait for the page-0 image to mount (so pageImage.page === 0, which the
    // deleted-row page scope keys off) and for the live left-list entry to appear.
    async function renderWithDeleted() {
      getMetadata.mockResolvedValue(DELETED_FIXTURE);
      await renderAndGetMiddle();
      await screen.findByText('Live Zero');
    }

    test('toggle default OFF: a deleted table is hidden while live tables show', async () => {
      await renderWithDeleted();
      expect(screen.getByText('Live Zero')).toBeInTheDocument();
      expect(screen.queryByText('Deleted Zero')).toBeNull();
    });

    test('toggle ON: a deleted table on the displayed page appears in the secondary colour', async () => {
      await renderWithDeleted();
      fireEvent.click(screen.getByRole('checkbox'));

      const name = await screen.findByText('Deleted Zero');
      expect(name).toHaveStyle({ color: 'var(--secondary-text)' });
    });

    test('toggle ON: a deleted table on a different page is NOT shown (page scoping)', async () => {
      await renderWithDeleted();
      fireEvent.click(screen.getByRole('checkbox'));

      // The page-0 deleted table appears; the page-1 one does not (centre shows page 0).
      await screen.findByText('Deleted Zero');
      expect(screen.queryByText('Deleted One')).toBeNull();
    });

    test('toggle ON: live tables from all pages still appear (asymmetry)', async () => {
      getMetadata.mockResolvedValue(METADATA_FIXTURE);
      await renderAndGetMiddle();
      await screen.findByText('Premium Summary');
      fireEvent.click(screen.getByRole('checkbox'));

      // 'Loss Detail' is a LIVE table on page 1; live tables are never page-scoped.
      expect(screen.getByText('Loss Detail')).toBeInTheDocument();
    });

    test('clicking a deleted row does not start an inline rename', async () => {
      await renderWithDeleted();
      fireEvent.click(screen.getByRole('checkbox'));

      const name = await screen.findByText('Deleted Zero');
      fireEvent.click(name);

      // The InputBase is gated off for deleted rows, so no rename input appears.
      expect(screen.queryByDisplayValue('Deleted Zero')).toBeNull();
    });
  });

  test('hovering a deleted left-list row previews its grid in grey on the centre overlay', async () => {
    // One LIVE table and one DELETED table, both on page 0 (the displayed page).
    getMetadata.mockResolvedValue({
      tables: [
        {
          tableId: 't-live',
          name: 'Live',
          pdfPage: 0,
          bounds: { left: 0.1, top: 0.1, width: 0.02, height: 0.02 },
          columnWidths: [{ value: 0.02, confidence: 100 }],
          rowHeights: [{ value: 0.02, confidence: 100 }],
        },
        {
          tableId: 't-del',
          name: 'Deleted',
          pdfPage: 0,
          deleted: true,
          bounds: { left: 0.3, top: 0.3, width: 0.03, height: 0.03 },
          columnWidths: [
            { value: 0.015, confidence: 100 },
            { value: 0.015, confidence: 100 },
          ],
          rowHeights: [
            { value: 0.015, confidence: 100 },
            { value: 0.015, confidence: 100 },
          ],
        },
      ],
    });

    const middle = await renderAndGetMiddle();
    loadImage(middle.querySelector('img'), { w: 100, h: 100 });
    await waitFor(() => expect(middle.querySelector('rect')).not.toBeNull());

    // Turn the "Include deleted" toggle ON so the deleted row shows in the left list.
    fireEvent.click(screen.getByRole('checkbox'));

    // Find the DELETED row (the entry whose name is 'Deleted').
    const delRow = await waitFor(() => {
      const row = screen
        .getAllByTestId('table-entry')
        .find((r) => r.textContent.includes('Deleted'));
      expect(row).toBeTruthy();
      return row;
    });

    // No preview before hover.
    expect(middle.querySelector('[data-testid="deleted-preview"]')).toBeNull();

    // Hover the deleted row -> preview group appears, drawn in grey (#c0c0c0).
    fireEvent.mouseEnter(delRow);
    const preview = await waitFor(() => {
      const g = middle.querySelector('[data-testid="deleted-preview"]');
      expect(g).not.toBeNull();
      return g;
    });
    // rect at the deleted table's pixel bounds (0.3*1000=300, 0.03*1000=30) in grey.
    const rect = preview.querySelector('rect');
    expect(rect).toHaveAttribute('x', '300');
    expect(rect).toHaveAttribute('y', '300');
    expect(rect).toHaveAttribute('width', '30');
    expect(rect).toHaveAttribute('height', '30');
    expect(rect).toHaveAttribute('stroke', '#c0c0c0');
    // Internal grid lines (2×2 -> one vertical + one horizontal divider) are grey too,
    // and the preview draws NO hit lines.
    const lines = preview.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toHaveAttribute('stroke', '#c0c0c0');
    }
    expect(
      preview.querySelectorAll('[data-testid="hit-line"]').length
    ).toBe(0);

    // Leaving the row removes the preview.
    fireEvent.mouseLeave(delRow);
    await waitFor(() =>
      expect(
        middle.querySelector('[data-testid="deleted-preview"]')
      ).toBeNull()
    );
  });

  // ---- Task 6: Reinstate flow ------------------------------------------------------
  //
  // A deleted left-list row (revealed by the Task 4 "Include deleted" toggle) opens a
  // single-item "Reinstate" menu. Reinstate clears `deleted` unless the table would
  // overlap a LIVE table on the same page, in which case an info toast fires and nothing
  // changes. Overlap is compared in fraction space via the shared module-scope helper.

  // One live table and one deleted table on page 0 that do NOT overlap -> reinstate OK.
  const reinstateOkFixture = () => ({
    tables: [
      {
        tableId: 't-live',
        name: 'Live Grid',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
      {
        tableId: 't-del',
        name: 'Deleted Grid',
        pdfPage: 0,
        deleted: true,
        bounds: { left: 0.5, top: 0.5, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
    ],
  });

  // The deleted table's bounds overlap the live table on the same page -> reinstate is
  // blocked. Live {0,0,0.2,0.2} and deleted {0.1,0.1,0.1,0.1} overlap under strict rules.
  const reinstateClashFixture = () => ({
    tables: [
      {
        tableId: 't-live',
        name: 'Live Grid',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.2, height: 0.2 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [{ value: 0.2, confidence: 90 }],
      },
      {
        tableId: 't-del',
        name: 'Deleted Grid',
        pdfPage: 0,
        deleted: true,
        bounds: { left: 0.1, top: 0.1, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
    ],
  });

  // Mount, wait for the list, turn on the Task 4 "Include deleted" toggle so the deleted
  // row appears on the displayed page (page 0), click that row to open the Reinstate menu,
  // and return the open menu element.
  async function openReinstateMenu(fixture) {
    getMetadata.mockResolvedValue(fixture);
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    // The live row proves the table list has loaded.
    await screen.findByText('Live Grid');
    // Task 4 toggle (default OFF) — turning it on reveals deleted rows on this page.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include deleted' }));
    // The deleted row's clickable name Box; the click carries a screen position that the
    // Task 4 handler stores on reinstateMenu (clientX/clientY anchor the menu).
    const deletedRow = await screen.findByText('Deleted Grid');
    fireEvent.click(deletedRow, { clientX: 10, clientY: 10 });
    return screen.findByRole('menu');
  }

  test('clicking a deleted left-list row opens a menu whose only item is Reinstate', async () => {
    await openReinstateMenu(reinstateOkFixture());

    expect(
      screen.getByRole('menuitem', { name: 'Reinstate' })
    ).toBeInTheDocument();
    // Exactly one item — no Delete / Add / boundary items leak into this menu.
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });

  test('Reinstate with no overlapping live table clears deleted, enables Save, no toast', async () => {
    await openReinstateMenu(reinstateOkFixture());

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reinstate' }));

    // Dirty: Save enables (the menu has closed, so query it normally).
    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());

    // Success path shows no "not enough room" snackbar.
    expect(toast).not.toHaveBeenCalled();

    // Persist and confirm the flag was cleared on the reinstated table.
    fireEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const savedList = saveTables.mock.calls[0][1];
    const reinstated = savedList.find((t) => t.tableId === 't-del');
    expect(reinstated.deleted).toBe(false);
  });

  test('Reinstate blocked by an overlapping live table: info toast, stays deleted, Save disabled', async () => {
    await openReinstateMenu(reinstateClashFixture());

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reinstate' }));

    // Info snackbar via toast(...) — NOT toast.error(...).
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Not enough room to reinstate grid Deleted Grid'
      )
    );
    expect(toast.error).not.toHaveBeenCalled();

    // Nothing committed: Save never enabled, and no save request was made.
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(saveTables).not.toHaveBeenCalled();
  });

  // ---- Task 8: FE-6 — overlap checks ignore DELETED tables --------------------------
  //
  // Deleted tables no longer take part in the "no overlap" restriction: a new table may
  // be created over a deleted one, a boundary edge may be dragged across a deleted
  // footprint, and an empty-area click inside a deleted footprint is treated as empty
  // area (opens the Add table menu, opens no cell editor). Reinstating a deleted table
  // is still blocked only by collision with a LIVE table.
  describe('overlap checks ignore deleted tables (FE-6)', () => {
    test('Add table succeeds when the new rectangle overlaps only a deleted table', async () => {
      // A single DELETED table occupying fraction 0.2..0.4 in both axes. Click at
      // (150, 250) -> L=0.15, T=0.25: the click point (0.15, 0.25) is OUTSIDE the
      // deleted footprint (so the menu opens), but the candidate rect
      // 0.15..0.25 × 0.25..0.27 overlaps the deleted 0.2..0.4. Deleted tables no longer
      // count toward the no-overlap rule, so the add succeeds (previously "Not enough room").
      const middle = await renderForAddNoRect({
        tables: [
          {
            tableId: 'del',
            name: 'Deleted',
            pdfPage: 0,
            deleted: true,
            bounds: { left: 0.2, top: 0.2, width: 0.2, height: 0.2 },
            columnWidths: [{ value: 0.2, confidence: 90 }],
            rowHeights: [{ value: 0.2, confidence: 90 }],
          },
        ],
      });

      clickEmptyArea(middle, { x: 150, y: 250 });
      await screen.findByRole('menu');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add table' }));

      const save = await screen.findByRole('button', { name: /save/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);
      await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
      const sent = saveTables.mock.calls[0][1];
      // A new (non-deleted) table was inserted alongside the deleted one.
      expect(sent.some((t) => t.tableId !== 'del')).toBe(true);
      expect(toast).not.toHaveBeenCalledWith('Not enough room');
    });

    test('a boundary edge may be dragged across a deleted table footprint', async () => {
      // Live table 0..0.1 (right edge at fraction 0.1). A DELETED table sits at
      // 0.15..0.25 on the same row. Dragging the live table's right edge out to 0.2 would
      // previously clamp at the deleted table's left edge (~0.149); with deleted tables
      // ignored the clamp does not apply and the edge reaches 0.2.
      const middle = await renderForDrag({
        tables: [
          {
            tableId: 't-1',
            name: 'T',
            pdfPage: 0,
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
          },
          {
            tableId: 'del',
            name: 'Deleted',
            pdfPage: 0,
            deleted: true,
            bounds: { left: 0.15, top: 0, width: 0.1, height: 0.1 },
            columnWidths: [{ value: 0.1, confidence: 90 }],
            rowHeights: [{ value: 0.1, confidence: 90 }],
          },
        ],
      });

      dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 200, toY: 50 });

      const save = await screen.findByRole('button', { name: /save/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);
      await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
      const edited = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-1');
      // Right edge reached 0.2 (last column 0.04 -> 0.14); not clamped near 0.149.
      expect(edited.bounds.width).toBeCloseTo(0.2, 10);
    });

    test('an empty-area click inside a deleted table footprint opens the Add table menu (no cell editor)', async () => {
      // A single DELETED table covering 0.2..0.4. A click at (300, 300) -> (0.3, 0.3)
      // lands INSIDE its footprint. Because deleted tables are ignored, that click is
      // treated as empty area: the Add table menu opens and NO cell editor appears
      // (deleted tables contribute no editable cells).
      const middle = await renderForAddNoRect({
        tables: [
          {
            tableId: 'del',
            name: 'Deleted',
            pdfPage: 0,
            deleted: true,
            bounds: { left: 0.2, top: 0.2, width: 0.2, height: 0.2 },
            columnWidths: [{ value: 0.2, confidence: 90 }],
            rowHeights: [{ value: 0.2, confidence: 90 }],
          },
        ],
      });

      clickEmptyArea(middle, { x: 300, y: 300 });

      await screen.findByRole('menu');
      expect(
        screen.getByRole('menuitem', { name: 'Add table' })
      ).toBeInTheDocument();
      // No cell editor opened for the deleted table's footprint.
      expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument();
    });

    test('Reinstate is allowed when the table overlaps only another deleted table', async () => {
      // Reinstating t-del overlaps ONLY another deleted table (t-del2), never a live one,
      // so it succeeds and clears the flag. Confirms handleReinstate already ignores
      // deleted tables (no change to that handler in this task).
      getMetadata.mockResolvedValue({
        tables: [
          {
            tableId: 't-del',
            name: 'Deleted Grid',
            pdfPage: 0,
            deleted: true,
            bounds: { left: 0.1, top: 0.1, width: 0.1, height: 0.1 },
            columnWidths: [{ value: 0.1, confidence: 90 }],
            rowHeights: [{ value: 0.1, confidence: 90 }],
          },
          {
            tableId: 't-del2',
            name: 'Other Deleted',
            pdfPage: 0,
            deleted: true,
            bounds: { left: 0.12, top: 0.12, width: 0.1, height: 0.1 },
            columnWidths: [{ value: 0.1, confidence: 90 }],
            rowHeights: [{ value: 0.1, confidence: 90 }],
          },
        ],
      });
      render(<PDFEditTableStructure pdfId={PDF_ID} />);
      // Reveal deleted rows on the displayed page (page 0).
      fireEvent.click(
        await screen.findByRole('checkbox', { name: 'Include deleted' })
      );
      const row = await screen.findByText('Deleted Grid');
      fireEvent.click(row, { clientX: 10, clientY: 10 });
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Reinstate' })
      );

      const save = await screen.findByRole('button', { name: /save/i });
      await waitFor(() => expect(save).toBeEnabled());
      // No "not enough room" toast — the only overlap is with another deleted table.
      expect(toast).not.toHaveBeenCalled();
      fireEvent.click(save);
      await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
      const reinstated = saveTables.mock.calls[0][1].find(
        (t) => t.tableId === 't-del'
      );
      expect(reinstated.deleted).toBe(false);
    });
  });

  // ---- Task 6: Link feature mounting ------------------------------------------------
  //
  // Every non-deleted left-list row carries a "Link tables" IconButton (data-testid
  // "link-table") as a sibling of its name Box. Clicking it mounts the TableLinkageEditor
  // (mocked above) without starting an inline rename. Deleted rows never get the button.

  // Two live tables and one deleted table, all on page 0 so the deleted row can be
  // revealed with the "Include deleted" toggle.
  const linkFixture = () => ({
    tables: [
      {
        tableId: 'l-1',
        name: 'Root A',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
      {
        tableId: 'l-2',
        name: 'Root B',
        pdfPage: 0,
        bounds: { left: 0.3, top: 0.3, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
      {
        tableId: 'l-del',
        name: 'Gone',
        pdfPage: 0,
        deleted: true,
        bounds: { left: 0.6, top: 0.6, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
    ],
  });

  test('renders one Link button per non-deleted listed row', async () => {
    getMetadata.mockResolvedValue(linkFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Root A');
    // Include-deleted is OFF: two non-deleted rows -> two Link buttons.
    expect(screen.getAllByTestId('link-table')).toHaveLength(2);
  });

  test('a deleted row has no Link button', async () => {
    getMetadata.mockResolvedValue(linkFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Root A');
    // Reveal the deleted row on the displayed page.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include deleted' }));
    const deletedRow = (await screen.findByText('Gone')).closest(
      '[data-testid="table-entry"]'
    );

    // The deleted row itself carries no Link button, and the overall count is unchanged
    // (still the two non-deleted rows).
    expect(
      deletedRow.querySelector('[data-testid="link-table"]')
    ).toBeNull();
    expect(screen.getAllByTestId('link-table')).toHaveLength(2);
  });

  test('clicking a Link button mounts the Grid Editor', async () => {
    getMetadata.mockResolvedValue(linkFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Root A');
    expect(screen.queryByTestId('link-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId('link-table')[0]);

    expect(await screen.findByTestId('link-dialog')).toBeInTheDocument();
  });

  test('clicking a Link button does not start an inline rename', async () => {
    getMetadata.mockResolvedValue(linkFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Root A');
    fireEvent.click(screen.getAllByTestId('link-table')[0]);

    // No rename input appeared; the name text is still shown.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getAllByTestId('table-entry-name')[0]).toHaveTextContent(
      'Root A'
    );
  });

  // ---- Task 15: left-column stage buttons + the link button's new home --------------
  //
  // Every non-deleted entry gains a button row BELOW the title / size / tables lines. What
  // it holds depends on the table's confirmationStage (a missing or null stage counts as 0):
  // below the confirmed stage, no stage button; exactly at it, "Mark Ready"; at or above the
  // ready stage, "Review". The Link button lives at the right-hand end of that row (still a
  // sibling of the name Box, never nested inside it — the name Box's onClick starts the
  // inline rename). The stages are only ever used as INPUTS here, never asserted as literals.

  const stageTable = (tableId, name, confirmationStage, offset, extra = {}) => ({
    tableId,
    name,
    pdfPage: 0,
    confirmationStage,
    bounds: { left: offset, top: offset, width: 0.1, height: 0.1 },
    columnWidths: [{ value: 0.1, confidence: 90 }],
    rowHeights: [{ value: 0.1, confidence: 90 }],
    ...extra,
  });

  // One table below the confirmed stage, one exactly at it, one at the ready stage, and a
  // deleted one at the confirmed stage (revealed by the Include-deleted toggle).
  const stageFixture = () => ({
    tables: [
      stageTable('s-below', 'Below Stage', confirmedTableStage() - 1, 0),
      stageTable('s-confirmed', 'Confirmed Stage', confirmedTableStage(), 0.2),
      stageTable('s-ready', 'Ready Stage', readyTableStage(), 0.4),
      stageTable('s-del', 'Deleted Stage', confirmedTableStage(), 0.6, {
        deleted: true,
      }),
    ],
  });

  // The left-list entry whose name row reads `name`.
  const entryFor = async (name) =>
    (await screen.findByText(name)).closest('[data-testid="table-entry"]');

  test('a table below the confirmed stage shows no stage button', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const row = await entryFor('Below Stage');
    expect(row.querySelector('[data-testid="mark-ready"]')).toBeNull();
    expect(row.querySelector('[data-testid="review-table"]')).toBeNull();
  });

  test('a table at the confirmed stage shows only Mark Ready', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const row = await entryFor('Confirmed Stage');
    expect(row.querySelector('[data-testid="mark-ready"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="review-table"]')).toBeNull();
  });

  test('a table at the ready stage shows only Review', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const row = await entryFor('Ready Stage');
    expect(row.querySelector('[data-testid="review-table"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="mark-ready"]')).toBeNull();
  });

  test('a deleted row shows no stage button even at the confirmed stage', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findByText('Below Stage');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include deleted' }));

    const row = await entryFor('Deleted Stage');
    expect(row.querySelector('[data-testid="mark-ready"]')).toBeNull();
    expect(row.querySelector('[data-testid="review-table"]')).toBeNull();
  });

  test('Mark Ready advances only that table to the ready stage and dirties the document', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const row = await entryFor('Confirmed Stage');
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.click(row.querySelector('[data-testid="mark-ready"]'));

    // The document is dirty (Save enabled) but nothing has been PUT.
    await waitFor(() => expect(save).toBeEnabled());
    expect(saveTables).not.toHaveBeenCalled();

    // The entry now offers Review instead of Mark Ready.
    const after = await entryFor('Confirmed Stage');
    expect(after.querySelector('[data-testid="review-table"]')).not.toBeNull();
    expect(after.querySelector('[data-testid="mark-ready"]')).toBeNull();

    // Saving shows the stage advanced on that table alone.
    fireEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const saved = saveTables.mock.calls[0][1];
    const byId = Object.fromEntries(saved.map((t) => [t.tableId, t]));
    expect(byId['s-confirmed'].confirmationStage).toBe(readyTableStage());
    expect(byId['s-below'].confirmationStage).toBe(confirmedTableStage() - 1);
    expect(byId['s-ready'].confirmationStage).toBe(readyTableStage());
    expect(byId['s-del'].confirmationStage).toBe(confirmedTableStage());
  });

  test('the link button is not nested inside the name Box', async () => {
    getMetadata.mockResolvedValue(stageFixture());
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const row = await entryFor('Confirmed Stage');
    const name = row.querySelector('[data-testid="table-entry-name"]');
    // Present on the row, but NOT a descendant of the rename-triggering name Box.
    expect(row.querySelector('[data-testid="link-table"]')).not.toBeNull();
    expect(name.querySelector('[data-testid="link-table"]')).toBeNull();
  });

  // ---- Task 3: cell↔grid association + per-cell confidence squares ------------------
  //
  // gridSquareBounds/cellAt are pure module-level helpers; the confidence squares and
  // the hover text overlay are HTML siblings of the SVG (mirroring the hover-label
  // pattern), rendered only on the interactive centre panel.

  describe('gridSquareBounds', () => {
    const table = {
      bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.2 },
      columnWidths: [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }],
      rowHeights: [{ value: 0.1 }, { value: 0.1 }],
    };

    test('the top-left square starts at the table origin', () => {
      const b = gridSquareBounds(table, 0, 0);
      expect(b.left).toBeCloseTo(0.1, 10);
      expect(b.top).toBeCloseTo(0.2, 10);
      expect(b.width).toBeCloseTo(0.1, 10);
      expect(b.height).toBeCloseTo(0.1, 10);
    });

    test('an interior square offsets by the cumulative column/row sizes', () => {
      const b = gridSquareBounds(table, 1, 2);
      expect(b.left).toBeCloseTo(0.3, 10); // 0.1 + 0.1 + 0.1
      expect(b.top).toBeCloseTo(0.3, 10); // 0.2 + 0.1
      expect(b.width).toBeCloseTo(0.1, 10);
      expect(b.height).toBeCloseTo(0.1, 10);
    });
  });

  describe('cellAt', () => {
    const c00 = { row: 0, column: 0, rowSpan: 1, columnSpan: 1 };
    const cSpan = { row: 0, column: 1, rowSpan: 1, columnSpan: 2 };
    const table = { cells: [c00, cSpan] };

    test('returns the cell whose row/column match', () => {
      expect(cellAt(table, 0, 0)).toBe(c00);
    });

    test('matches a spanning cell only at its top-left square', () => {
      expect(cellAt(table, 0, 1)).toBe(cSpan);
      // The square the span also covers (0,2) carries no cell.
      expect(cellAt(table, 0, 2)).toBeUndefined();
    });

    test('returns undefined for a missing cell', () => {
      expect(cellAt(table, 1, 1)).toBeUndefined();
    });

    test('tolerates a table with no cells array', () => {
      expect(cellAt({}, 0, 0)).toBeUndefined();
    });
  });

  // ---- Task 5: reconcileCells (keep the cell array consistent with the grid) --------
  describe('reconcileCells', () => {
    // A 2-column × 1-row table with a cell in each column; bounds sum to the axes.
    const baseTable = () => ({
      bounds: { left: 0, top: 0, width: 0.2, height: 0.1 },
      columnWidths: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
      rowHeights: [{ value: 0.1, confidence: 90 }],
      cells: [
        {
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
          text: 'A',
          confidence: 80,
          header: false,
        },
        {
          row: 0,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          bounds: { left: 0.1, top: 0, width: 0.1, height: 0.1 },
          text: 'B',
          confidence: 80,
          header: false,
        },
      ],
    });

    const at = (cells, r, c) =>
      cells.find((x) => x.row === r && x.column === c);

    test('add column: survivors re-index, a NEW column of cells is created, resized bounds reset confidence', () => {
      const prev = baseTable();
      // splitEntry(columnWidths, 0) -> [0.05, 0.05, 0.1]; colMap = [0, NEW, 1].
      const newCols = [
        { value: 0.05, confidence: 90 },
        { value: 0.05, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ];
      const map = splitMap(2, 0);
      expect(map).toEqual([0, NEW, 1]);
      const cells = reconcileCells(
        prev,
        newCols,
        prev.rowHeights,
        identityMap(1),
        map,
        prev.bounds
      );
      expect(cells).toHaveLength(3);
      // Original column 0 -> column 0; its square shrank 0.1 -> 0.05 so confidence resets.
      expect(at(cells, 0, 0).text).toBe('A');
      expect(at(cells, 0, 0).confidence).toBe(0);
      expect(at(cells, 0, 0).bounds.width).toBeCloseTo(0.05, 10);
      // Original column 1 -> column 2; its square is unchanged (left 0.1, width 0.1).
      expect(at(cells, 0, 2).text).toBe('B');
      expect(at(cells, 0, 2).confidence).toBe(80);
      // The NEW column (index 1) gets a default empty cell.
      expect(at(cells, 0, 1)).toMatchObject({
        row: 0,
        column: 1,
        rowSpan: 1,
        columnSpan: 1,
        text: '',
        confidence: 0,
        header: false,
      });
      expect(at(cells, 0, 1).bounds.left).toBeCloseTo(0.05, 10);
      expect(at(cells, 0, 1).bounds.width).toBeCloseTo(0.05, 10);
    });

    test('add row: a full NEW row of default cells appears; the resized existing row resets', () => {
      const prev = baseTable();
      // splitEntry(rowHeights, 0) -> [0.05, 0.05]; rowMap = [0, NEW].
      const newRows = [
        { value: 0.05, confidence: 90 },
        { value: 0.05, confidence: 90 },
      ];
      const cells = reconcileCells(
        prev,
        prev.columnWidths,
        newRows,
        splitMap(1, 0),
        identityMap(2),
        prev.bounds
      );
      expect(cells).toHaveLength(4);
      // Row 0 cells kept but their squares halved in height -> confidence resets.
      expect(at(cells, 0, 0).text).toBe('A');
      expect(at(cells, 0, 0).confidence).toBe(0);
      expect(at(cells, 0, 0).bounds.height).toBeCloseTo(0.05, 10);
      // New row 1: one default cell per column.
      expect(at(cells, 1, 0)).toMatchObject({ text: '', confidence: 0, header: false });
      expect(at(cells, 1, 1)).toMatchObject({ text: '', confidence: 0, header: false });
      expect(at(cells, 1, 0).bounds.top).toBeCloseTo(0.05, 10);
    });

    test('splitMapBelow puts the NEW line first and pushes existing content to the far half', () => {
      // "Add Below"/"Add Right": the inserted line is adjacent to the clicked divider.
      expect(splitMapBelow(3, 1)).toEqual([0, NEW, 1, 2]);
      expect(splitMapBelow(2, 0)).toEqual([NEW, 0, 1]);
    });

    test('add row via splitMapBelow: NEW row is adjacent to the divider, content slides down, rows below are kept', () => {
      // 3 rows; splitting row 1 with the blank landing at index 1 (not 2). Mirrors the
      // "insert below row 0" expectation: old 0 -> 0, NEW -> 1, old 1 -> 2, old 2 -> 3.
      const prev = {
        bounds: { left: 0, top: 0, width: 0.1, height: 0.4 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.2, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.01, width: 0.05, height: 0.02 }, text: 'HEAD', confidence: 80, header: true },
          { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.12, width: 0.05, height: 0.02 }, text: 'MID', confidence: 80, header: false },
          { row: 2, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.32, width: 0.05, height: 0.02 }, text: 'BOT', confidence: 80, header: false },
        ],
      };
      // splitEntry(rowHeights, 1): 0.2 -> 0.1 + 0.1; map = [0, NEW, 1, 2].
      const newRows = [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ];
      const cells = reconcileCells(
        prev,
        prev.columnWidths,
        newRows,
        splitMapBelow(3, 1),
        identityMap(1),
        prev.bounds
      );
      // HEAD (row 0) untouched.
      expect(at(cells, 0, 0).text).toBe('HEAD');
      expect(at(cells, 0, 0).confidence).toBe(80);
      // The new empty row is index 1.
      expect(at(cells, 1, 0)).toMatchObject({ text: '', confidence: 0 });
      // MID slides to index 2; its square moved -> confidence reset.
      expect(at(cells, 2, 0).text).toBe('MID');
      expect(at(cells, 2, 0).confidence).toBe(0);
      // BOT -> index 3, square unchanged -> confidence and OCR bounds kept.
      expect(at(cells, 3, 0).text).toBe('BOT');
      expect(at(cells, 3, 0).confidence).toBe(80);
      expect(at(cells, 3, 0).bounds).toEqual({ left: 0.01, top: 0.32, width: 0.05, height: 0.02 });
    });

    test('adding a row leaves the confidence of rows BELOW the split untouched (OCR bounds)', () => {
      // Regression: a 3-row column. Cell bounds are the tighter OCR boxes (NOT the grid
      // squares). Splitting the middle row must only reset the split row; the row below
      // keeps its confidence because its grid square does not move.
      const prev = {
        bounds: { left: 0, top: 0, width: 0.1, height: 0.4 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.2, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.01, width: 0.05, height: 0.02 }, text: 'HEAD', confidence: 80, header: true },
          { row: 1, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.12, width: 0.05, height: 0.02 }, text: 'TEXT1', confidence: 80, header: false },
          { row: 2, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.01, top: 0.32, width: 0.05, height: 0.02 }, text: 'TEXT4', confidence: 80, header: false },
        ],
      };
      // splitEntry(rowHeights, 1): 0.2 -> 0.1 + 0.1; rowMap = [0, 1, NEW, 2].
      const newRows = [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ];
      const map = splitMap(3, 1);
      expect(map).toEqual([0, 1, NEW, 2]);
      const cells = reconcileCells(
        prev,
        prev.columnWidths,
        newRows,
        map,
        identityMap(1),
        prev.bounds
      );
      // HEAD (row 0) square unchanged -> confidence kept.
      expect(at(cells, 0, 0).text).toBe('HEAD');
      expect(at(cells, 0, 0).confidence).toBe(80);
      // TEXT1 (row 1) square halved in height -> confidence reset.
      expect(at(cells, 1, 0).text).toBe('TEXT1');
      expect(at(cells, 1, 0).confidence).toBe(0);
      // The inserted row 2 is a fresh empty cell.
      expect(at(cells, 2, 0)).toMatchObject({ text: '', confidence: 0 });
      // TEXT4 moves to row 3 but its grid square (top 0.3, height 0.1) is unchanged ->
      // confidence kept AND its OCR bounds are left untouched.
      expect(at(cells, 3, 0).text).toBe('TEXT4');
      expect(at(cells, 3, 0).confidence).toBe(80);
      expect(at(cells, 3, 0).bounds).toEqual({ left: 0.01, top: 0.32, width: 0.05, height: 0.02 });
    });

    test('merge: the merged line`s far cell is dropped and cells after it re-index', () => {
      const prev = baseTable();
      // mergeCells(columnWidths, 1) -> [0.2]; mergeMap = [0] (old col 1 removed).
      const newCols = [{ value: 0.2, confidence: 90 }];
      expect(mergeMap(2, 1)).toEqual([0]);
      const cells = reconcileCells(
        prev,
        newCols,
        prev.rowHeights,
        identityMap(1),
        mergeMap(2, 1),
        prev.bounds
      );
      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({ row: 0, column: 0, text: 'A' });
      // Its square widened 0.1 -> 0.2 so confidence resets.
      expect(cells[0].confidence).toBe(0);
      expect(cells[0].bounds.width).toBeCloseTo(0.2, 10);
    });

    // 3 columns of 0.1 with a cell in each, used by the two deletion cases.
    const threeColTable = () => ({
      bounds: { left: 0, top: 0, width: 0.3, height: 0.1 },
      columnWidths: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
      rowHeights: [{ value: 0.1, confidence: 90 }],
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.1, height: 0.1 }, text: 'A', confidence: 80, header: false },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.1, top: 0, width: 0.1, height: 0.1 }, text: 'B', confidence: 80, header: false },
        { row: 0, column: 2, rowSpan: 1, columnSpan: 1, bounds: { left: 0.2, top: 0, width: 0.1, height: 0.1 }, text: 'C', confidence: 80, header: false },
      ],
    });

    test('divider-collapse delete: the collapsed column`s cell is removed and the rest re-index', () => {
      const prev = threeColTable();
      // Column 1 squeezed to 0 and removed; survivors [0, 2]. Widths keep col0=0.1, col2->0.2.
      const newCols = [
        { value: 0.1, confidence: 90 },
        { value: 0.2, confidence: 90 },
      ];
      const cells = reconcileCells(
        prev,
        newCols,
        prev.rowHeights,
        identityMap(1),
        [0, 2],
        prev.bounds
      );
      expect(cells.map((c) => c.text).sort()).toEqual(['A', 'C']);
      // A stays at column 0 with an unchanged square -> confidence kept.
      expect(at(cells, 0, 0).text).toBe('A');
      expect(at(cells, 0, 0).confidence).toBe(80);
      // C moves to column 1; its square now starts at 0.1 (was 0.2) -> confidence resets.
      expect(at(cells, 0, 1).text).toBe('C');
      expect(at(cells, 0, 1).confidence).toBe(0);
    });

    test('boundary-cascade delete: a prefix run is removed and survivors shift with bounds.left', () => {
      const prev = threeColTable();
      // Left edge dragged inward removing column 0; survivors [1, 2]; bounds.left -> 0.1.
      const newCols = [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ];
      const newBounds = { left: 0.1, top: 0, width: 0.2, height: 0.1 };
      const cells = reconcileCells(
        prev,
        newCols,
        prev.rowHeights,
        identityMap(1),
        [1, 2],
        newBounds
      );
      expect(cells.map((c) => c.text).sort()).toEqual(['B', 'C']);
      // Both squares are geometrically unchanged once bounds.left shifts -> confidence kept.
      expect(at(cells, 0, 0).text).toBe('B');
      expect(at(cells, 0, 0).confidence).toBe(80);
      expect(at(cells, 0, 0).bounds.left).toBeCloseTo(0.1, 10);
      expect(at(cells, 0, 1).text).toBe('C');
      expect(at(cells, 0, 1).confidence).toBe(80);
    });

    test('a pre-existing spanning cell is re-indexed but keeps its span and bounds', () => {
      const prev = {
        bounds: { left: 0, top: 0, width: 0.2, height: 0.1 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            columnSpan: 2,
            bounds: { left: 0, top: 0, width: 0.2, height: 0.1 },
            text: 'span',
            confidence: 80,
            header: false,
          },
        ],
      };
      // Add a column at the front: colMap = [0, NEW, 1].
      const newCols = [
        { value: 0.05, confidence: 90 },
        { value: 0.05, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ];
      const cells = reconcileCells(
        prev,
        newCols,
        prev.rowHeights,
        identityMap(1),
        splitMap(2, 0),
        prev.bounds
      );
      const span = cells.find((c) => c.text === 'span');
      // Re-indexed to new column 0 but span + bounds untouched (no multi-square recompute).
      expect(span.column).toBe(0);
      expect(span.columnSpan).toBe(2);
      expect(span.bounds).toEqual({ left: 0, top: 0, width: 0.2, height: 0.1 });
      expect(span.confidence).toBe(80);
    });

    // A single-cell table whose stored cell.bounds is the tighter OCR box (NOT the grid
    // square) — the realistic shape. Confidence must survive an edit that leaves the
    // cell's grid square unchanged, and must reset only when the square actually moves.
    const ocrTable = () => ({
      bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
      columnWidths: [{ value: 0.1, confidence: 90 }],
      rowHeights: [{ value: 0.1, confidence: 90 }],
      cells: [
        {
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          // OCR text box: tighter than, and different from, the 0.1×0.1 grid square.
          bounds: { left: 0.02, top: 0.03, width: 0.05, height: 0.04 },
          text: 'A',
          confidence: 80,
          header: false,
        },
      ],
    });

    test('confidence is preserved when the grid square is unchanged, even though cell.bounds differs from the square', () => {
      const prev = ocrTable();
      // Identity edit: the grid square is identical before and after, so confidence must
      // be kept regardless of the (different) OCR cell.bounds.
      const cells = reconcileCells(
        prev,
        prev.columnWidths,
        prev.rowHeights,
        identityMap(1),
        identityMap(1),
        prev.bounds
      );
      expect(cells[0].confidence).toBe(80);
      // Unchanged square -> the OCR bounds are left untouched.
      expect(cells[0].bounds).toEqual({ left: 0.02, top: 0.03, width: 0.05, height: 0.04 });
    });

    test('confidence is preserved when the grid square moves only within the float epsilon', () => {
      const prev = ocrTable();
      // The column width drifts by < 1e-6, so the new square differs from the old by < eps.
      const cells = reconcileCells(
        prev,
        [{ value: 0.1 + 5e-7, confidence: 90 }],
        prev.rowHeights,
        identityMap(1),
        identityMap(1),
        prev.bounds
      );
      expect(cells[0].confidence).toBe(80);
    });

    test('confidence resets when the grid square resizes beyond the float epsilon', () => {
      const prev = ocrTable();
      // The column width halves: the new square differs from the old well beyond eps.
      const cells = reconcileCells(
        prev,
        [{ value: 0.05, confidence: 90 }],
        prev.rowHeights,
        identityMap(1),
        identityMap(1),
        prev.bounds
      );
      expect(cells[0].confidence).toBe(0);
      // Changed square -> the cell adopts the new grid square as its bounds.
      expect(cells[0].bounds).toEqual({ left: 0, top: 0, width: 0.05, height: 0.1 });
    });
  });

  describe('metadataTablesToOverlay', () => {
    test('grid cell sizes track the rounded cumulative offset (no per-cell rounding drift)', () => {
      // 8 rows of fraction 0.00625 (= 6.25px at scale 1000). Rounding each independently
      // gives 6px -> sum 48, drifting 2px short of the 50px table height. The cumulative
      // technique must land the running total exactly on 50 at the end.
      const rows = Array.from({ length: 8 }, () => ({
        value: 0.00625,
        confidence: 0,
      }));
      const table = {
        tableId: 't',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.01, height: 0.05 },
        columnWidths: [{ value: 0.01, confidence: 0 }],
        rowHeights: rows,
      };
      const [overlay] = metadataTablesToOverlay([table], 0, 1000, 1000);
      // Naive per-cell rounding would sum to 48; cumulative rounding sums to the true 50.
      const sum = overlay.rowHeights.reduce((a, h) => a + h, 0);
      expect(sum).toBe(50);
      expect(sum).toBe(overlay.height);
      // Every divider offset equals the rounded true offset, so none drifts by more than 1px.
      let acc = 0;
      overlay.rowHeights.forEach((h, i) => {
        acc += h;
        expect(acc).toBe(Math.round(0.00625 * (i + 1) * 1000));
      });
    });

    test('the same no-drift treatment applies to column widths (vertical dividers)', () => {
      // 8 columns of fraction 0.00625 (= 6.25px at scale 1000): naive per-cell rounding
      // sums to 48, 2px short of the 50px width; cumulative rounding lands exactly on 50.
      const cols = Array.from({ length: 8 }, () => ({
        value: 0.00625,
        confidence: 0,
      }));
      const table = {
        tableId: 't',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.05, height: 0.01 },
        columnWidths: cols,
        rowHeights: [{ value: 0.01, confidence: 0 }],
      };
      const [overlay] = metadataTablesToOverlay([table], 0, 1000, 1000);
      const sum = overlay.columnWidths.reduce((a, w) => a + w, 0);
      expect(sum).toBe(50);
      expect(sum).toBe(overlay.width);
      let acc = 0;
      overlay.columnWidths.forEach((w, i) => {
        acc += w;
        expect(acc).toBe(Math.round(0.00625 * (i + 1) * 1000));
      });
    });
  });

  describe('makeDefaultCell', () => {
    test('builds a span-1, empty, confidence-0, non-header cell with the given bounds', () => {
      const bounds = { left: 0.1, top: 0.2, width: 0.3, height: 0.4 };
      expect(makeDefaultCell(2, 3, bounds)).toEqual({
        row: 2,
        column: 3,
        rowSpan: 1,
        columnSpan: 1,
        bounds,
        text: '',
        confidence: 0,
        header: false,
      });
    });
  });

  describe('normaliseTableBounds', () => {
    test('rewrites bounds.width/height to the axis sums, preserving left/top', () => {
      const table = {
        bounds: { left: 0.2, top: 0.3, width: 0.1, height: 0.5 },
        columnWidths: [{ value: 0.03 }, { value: 0.03 }, { value: 0.03 }],
        rowHeights: [{ value: 0.1 }, { value: 0.1 }],
      };
      const out = normaliseTableBounds(table);
      expect(out.bounds.left).toBe(0.2);
      expect(out.bounds.top).toBe(0.3);
      expect(out.bounds.width).toBeCloseTo(0.09, 10);
      expect(out.bounds.height).toBeCloseTo(0.2, 10);
    });

    test('returns the same reference when already consistent (I1/I2 hold)', () => {
      const table = {
        bounds: { left: 0, top: 0, width: 0.06, height: 0.2 },
        columnWidths: [{ value: 0.03 }, { value: 0.03 }],
        rowHeights: [{ value: 0.1 }, { value: 0.1 }],
      };
      expect(normaliseTableBounds(table)).toBe(table);
    });

    test('leaves bounds untouched when an axis is missing (nothing to sum)', () => {
      const table = { bounds: { left: 0, top: 0, width: 0.1, height: 0.1 } };
      const out = normaliseTableBounds(table);
      expect(out.bounds.width).toBe(0.1);
      expect(out.bounds.height).toBe(0.1);
    });
  });

  describe('fillGridCells', () => {
    const at = (cells, r, c) => cells.find((x) => x.row === r && x.column === c);

    test('creates a default cell for every unmapped grid square', () => {
      const table = {
        bounds: { left: 0, top: 0, width: 0.2, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.1, height: 0.1 }, text: 'A', confidence: 80, header: false },
        ],
      };
      const filled = fillGridCells(table);
      // The 2×2 grid now has a cell in every square (one existing + three created).
      expect(filled.cells).toHaveLength(4);
      // The existing cell is left untouched.
      expect(at(filled.cells, 0, 0)).toBe(table.cells[0]);
      // Each created cell is empty, confidence 0, span 1, header false, bounds = its square.
      expect(at(filled.cells, 0, 1)).toMatchObject({
        row: 0,
        column: 1,
        rowSpan: 1,
        columnSpan: 1,
        text: '',
        confidence: 0,
        header: false,
        bounds: { left: 0.1, top: 0, width: 0.1, height: 0.1 },
      });
      expect(at(filled.cells, 1, 0)).toMatchObject({ text: '', confidence: 0 });
      expect(at(filled.cells, 1, 1)).toMatchObject({ text: '', confidence: 0 });
    });

    test('does not create cells for squares already covered by a spanning cell', () => {
      const table = {
        bounds: { left: 0, top: 0, width: 0.2, height: 0.1 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          { row: 0, column: 0, rowSpan: 1, columnSpan: 2, bounds: { left: 0, top: 0, width: 0.2, height: 0.1 }, text: 'span', confidence: 80, header: false },
        ],
      };
      // The span covers both squares (0,0) and (0,1), so nothing is added.
      const filled = fillGridCells(table);
      expect(filled.cells).toHaveLength(1);
      expect(filled).toBe(table);
    });
  });

  // 3 columns × 2 rows; four cells covering the three confidence bands, a null-confidence
  // cell, and two empty squares ((1,1) and (1,2)).
  const confidenceFixture = () => ({
    tables: [
      {
        tableId: 'c-1',
        name: 'Conf',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.3, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 100 },
          { value: 0.1, confidence: 100 },
          { value: 0.1, confidence: 100 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 100 },
          { value: 0.1, confidence: 100 },
        ],
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
            text: 'green cell',
            confidence: 90,
            header: false,
          },
          {
            row: 0,
            column: 1,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0.1, top: 0, width: 0.1, height: 0.1 },
            text: 'orange cell',
            confidence: 70,
            header: false,
          },
          {
            row: 0,
            column: 2,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0.2, top: 0, width: 0.1, height: 0.1 },
            text: 'red cell',
            confidence: 30,
            header: false,
          },
          {
            row: 1,
            column: 0,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0, top: 0.1, width: 0.1, height: 0.1 },
            text: 'null cell',
            confidence: null,
            header: false,
          },
        ],
      },
    ],
  });

  test('renders a confidence square per occupied grid square, coloured by band', async () => {
    const middle = await renderForDrag(confidenceFixture());

    const green = middle.querySelector(
      '[data-testid="confidence-square-c-1-0-0"]'
    );
    const orange = middle.querySelector(
      '[data-testid="confidence-square-c-1-0-1"]'
    );
    const red = middle.querySelector(
      '[data-testid="confidence-square-c-1-0-2"]'
    );
    const nullSquare = middle.querySelector(
      '[data-testid="confidence-square-c-1-1-0"]'
    );

    expect(green).not.toBeNull();
    expect(orange).not.toBeNull();
    expect(red).not.toBeNull();
    expect(nullSquare).not.toBeNull();

    // confidence 90 >= highConfidence()(80) -> green.
    expect(green).toHaveAttribute('data-colour', 'green');
    // 50 <= 70 < 80 -> orange.
    expect(orange).toHaveAttribute('data-colour', 'orange');
    // 30 < lowConfidence()(50) -> red.
    expect(red).toHaveAttribute('data-colour', 'red');
    // null confidence -> treated as below low -> red.
    expect(nullSquare).toHaveAttribute('data-colour', 'red');

    // The map is the single source of truth that routes each semantic band keyword to
    // the CSS custom property that paints it (defined once in globals.css).
    expect(CONFIDENCE_COLOUR_VARS).toEqual({
      red: 'var(--low-confidence)',
      orange: 'var(--medium-confidence)',
      green: 'var(--high-confidence)',
    });

    // data-colour still exposes the semantic keyword (test hook unchanged), but the
    // square no longer paints the raw keyword directly — backgroundColor is now the
    // CSS custom property from the map. (jsdom's cssstyle drops var() from inline
    // styles, so the literal keyword is no longer present on the element.)
    expect(green.style.backgroundColor).not.toBe('green');
    expect(orange.style.backgroundColor).not.toBe('orange');
    expect(red.style.backgroundColor).not.toBe('red');
    expect(nullSquare.style.backgroundColor).not.toBe('red');
  });

  test('fills unmapped grid squares with a red (confidence 0) cell square', async () => {
    const middle = await renderForDrag(confidenceFixture());

    // (1,1) and (1,2) carry no backend cell, so fillGridCells materialises a default
    // confidence-0 cell for each -> a red square now renders in every grid square.
    const filled1 = middle.querySelector(
      '[data-testid="confidence-square-c-1-1-1"]'
    );
    const filled2 = middle.querySelector(
      '[data-testid="confidence-square-c-1-1-2"]'
    );
    expect(filled1).not.toBeNull();
    expect(filled2).not.toBeNull();
    expect(filled1).toHaveAttribute('data-colour', 'red');
    expect(filled2).toHaveAttribute('data-colour', 'red');
  });

  test('hovering a confidence square overlays the cell text; leaving hides it', async () => {
    const middle = await renderForDrag(confidenceFixture());

    const green = middle.querySelector(
      '[data-testid="confidence-square-c-1-0-0"]'
    );
    fireEvent.mouseEnter(green);

    const overlay = await screen.findByTestId('cell-text-overlay');
    expect(overlay).toHaveTextContent('green cell');

    fireEvent.mouseLeave(green);
    await waitFor(() =>
      expect(screen.queryByTestId('cell-text-overlay')).not.toBeInTheDocument()
    );
  });

  test('clicking a below-high-confidence square marks the cell fully confident (100)', async () => {
    const middle = await renderForDrag(confidenceFixture());
    // red cell (0,2), confidence 30 (< highConfidence 80) -> click sets it to 100.
    fireEvent.click(
      middle.querySelector('[data-testid="confidence-square-c-1-0-2"]')
    );
    const t = await savedTable();
    expect(t.cells.find((c) => c.row === 0 && c.column === 2).confidence).toBe(
      100
    );
  });

  test('clicking a null-confidence square marks the cell fully confident (100)', async () => {
    const middle = await renderForDrag(confidenceFixture());
    // null cell (1,0) counts as below high -> click sets it to 100.
    fireEvent.click(
      middle.querySelector('[data-testid="confidence-square-c-1-1-0"]')
    );
    const t = await savedTable();
    expect(t.cells.find((c) => c.row === 1 && c.column === 0).confidence).toBe(
      100
    );
  });

  test('clicking an at-or-above-high-confidence square clears the cell confidence (0)', async () => {
    const middle = await renderForDrag(confidenceFixture());
    // green cell (0,0), confidence 90 (>= highConfidence 80) -> click sets it to 0.
    fireEvent.click(
      middle.querySelector('[data-testid="confidence-square-c-1-0-0"]')
    );
    const t = await savedTable();
    expect(t.cells.find((c) => c.row === 0 && c.column === 0).confidence).toBe(
      0
    );
  });

  test('thumbnails render no confidence squares', async () => {
    // Thumbnail fixtures carry cells so a leak would show; the non-interactive panel
    // must still render none.
    getThumbnails.mockResolvedValue({
      images: [
        {
          image: 'THUMB0',
          tables: [GRID_TABLE],
        },
      ],
    });
    getMetadata.mockResolvedValue(confidenceFixture());

    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="thumbnail"] img').length
      ).toBe(1)
    );
    const thumb = container.querySelector('[data-testid="thumbnail"]');
    loadImage(thumb.querySelector('img'));

    expect(
      thumb.querySelectorAll('[data-testid^="confidence-square"]').length
    ).toBe(0);
  });

  // ---- FE-2: per-row confidence squares in the MIDDLE editor ----------------------
  //
  // Display-only ~8×8 markers placed 10px beyond the table's right-hand edge, level with
  // the bottom of each row, coloured by that row's confidence (rowHeights[i].confidence).
  // Each carries data-testid="row-confidence-square-<tableId>-<row>" and a data-colour
  // semantic keyword. No click/hover behaviour.

  // A single-column table on page 0 whose four rows exercise all three confidence bands
  // plus a null (below-low) confidence. Row heights sum to bounds.height.
  const rowConfidenceFixture = () => ({
    tables: [
      {
        tableId: 'r-1',
        name: 'Rows',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.2, height: 0.4 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [
          { value: 0.1, confidence: 90 }, // >= high (80) -> green
          { value: 0.1, confidence: 70 }, // low <= 70 < high -> orange
          { value: 0.1, confidence: 30 }, // < low (50) -> red
          { value: 0.1, confidence: null }, // null -> below low -> red
        ],
      },
    ],
  });

  test('renders a row-confidence square per row, coloured by the row confidence band', async () => {
    const middle = await renderForDrag(rowConfidenceFixture());

    const green = middle.querySelector(
      '[data-testid="row-confidence-square-r-1-0"]'
    );
    const orange = middle.querySelector(
      '[data-testid="row-confidence-square-r-1-1"]'
    );
    const red = middle.querySelector(
      '[data-testid="row-confidence-square-r-1-2"]'
    );
    const nullSquare = middle.querySelector(
      '[data-testid="row-confidence-square-r-1-3"]'
    );

    expect(green).not.toBeNull();
    expect(orange).not.toBeNull();
    expect(red).not.toBeNull();
    expect(nullSquare).not.toBeNull();

    expect(green).toHaveAttribute('data-colour', 'green');
    expect(orange).toHaveAttribute('data-colour', 'orange');
    expect(red).toHaveAttribute('data-colour', 'red');
    expect(nullSquare).toHaveAttribute('data-colour', 'red');

    // backgroundColor is routed through CONFIDENCE_COLOUR_VARS (a CSS custom property),
    // not the raw keyword. jsdom's cssstyle drops var() from inline styles, so assert the
    // literal keyword is absent (same approach as the cell confidence squares).
    expect(green.style.backgroundColor).not.toBe('green');
    expect(orange.style.backgroundColor).not.toBe('orange');
    expect(red.style.backgroundColor).not.toBe('red');
    expect(nullSquare.style.backgroundColor).not.toBe('red');

    // Exactly one square per row, no more.
    expect(
      middle.querySelectorAll('[data-testid^="row-confidence-square-"]').length
    ).toBe(4);
  });

  test('a table with empty rowHeights renders no row-confidence squares', async () => {
    const middle = await renderForDrag({
      tables: [
        {
          tableId: 'r-0',
          name: 'Empty',
          pdfPage: 0,
          bounds: { left: 0, top: 0, width: 0.2, height: 0.1 },
          columnWidths: [{ value: 0.2, confidence: 90 }],
          rowHeights: [],
        },
      ],
    });

    expect(
      middle.querySelectorAll('[data-testid^="row-confidence-square-"]').length
    ).toBe(0);
  });

  test('row-confidence squares are display-only: clicking one does not change confidence', async () => {
    const middle = await renderForDrag(rowConfidenceFixture());

    const red = middle.querySelector(
      '[data-testid="row-confidence-square-r-1-2"]'
    );
    // Display-only: no click handler is attached (clicking is a no-op).
    expect(red.onclick).toBeNull();

    fireEvent.click(red);
    // The colour is unchanged (a toggle would have flipped it away from red).
    expect(red).toHaveAttribute('data-colour', 'red');
  });

  // ---- Task 4: header-row indication markers --------------------------------------
  //
  // Markers are HTML overlay siblings of the SVG (same layer as the confidence
  // squares), driven solely by headerCount (null -> 0). Header rows 0..h-1 show an
  // "H" (variant 'H'); the last header row h-1 shows "H -" (variant 'H-', click
  // decrements); the first non-header row h (when h < R) shows "+ H" (variant '+H',
  // click increments). Each carries data-testid="header-marker-<tableId>-<row>" and
  // data-variant. Markers only render on the interactive centre panel.

  // A single R-row table on page 0 with the given headerCount. bounds.height == sum of
  // the equal rowHeights so the row bands are well-defined.
  const headerFixture = (headerCount, rows = 4) => ({
    tables: [
      {
        tableId: 't-1',
        name: 'H',
        pdfPage: 0,
        headerCount,
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: Array.from({ length: rows }, () => ({
          value: 0.1 / rows,
          confidence: 90,
        })),
      },
    ],
  });

  // Click the header marker with the given testid, then Save and return the committed
  // headerCount of the single table.
  async function clickMarkerAndSavedHeaderCount(middle, testid) {
    const marker = middle.querySelector(`[data-testid="${testid}"]`);
    expect(marker).not.toBeNull();
    fireEvent.click(marker);
    const t = await savedTable();
    return t.headerCount;
  }

  test('headerCount = 0: only a "+ H" marker on row 0; clicking commits headerCount = 1', async () => {
    const middle = await renderForDrag(headerFixture(0));

    // No H markers anywhere.
    expect(
      middle.querySelectorAll('[data-variant="H"]').length
    ).toBe(0);
    expect(
      middle.querySelectorAll('[data-variant="H-"]').length
    ).toBe(0);

    // A single "+ H" marker on row 0.
    const plus = middle.querySelectorAll('[data-variant="+H"]');
    expect(plus).toHaveLength(1);
    expect(plus[0]).toHaveAttribute(
      'data-testid',
      'header-marker-t-1-0'
    );

    expect(
      await clickMarkerAndSavedHeaderCount(middle, 'header-marker-t-1-0')
    ).toBe(1);
  });

  test('headerCount = 2 (R > 2): H on rows 0 and 1 (row 1 is "H -"), "+ H" on row 2; clicks de/increment', async () => {
    const middle = await renderForDrag(headerFixture(2, 4));

    // Row 0 plain H, row 1 the decrement "H -".
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-0"]')
    ).toHaveAttribute('data-variant', 'H');
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-1"]')
    ).toHaveAttribute('data-variant', 'H-');
    // Row 2 is the first non-header row -> "+ H".
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-2"]')
    ).toHaveAttribute('data-variant', '+H');
    // Row 3 has no marker.
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-3"]')
    ).toBeNull();

    // Clicking "H -" decrements to 1.
    expect(
      await clickMarkerAndSavedHeaderCount(middle, 'header-marker-t-1-1')
    ).toBe(1);
  });

  test('headerCount = 2: clicking "+ H" on row 2 increments to 3', async () => {
    const middle = await renderForDrag(headerFixture(2, 4));
    expect(
      await clickMarkerAndSavedHeaderCount(middle, 'header-marker-t-1-2')
    ).toBe(3);
  });

  test('headerCount === R (all header): H on every row, last is "H -", no "+ H"; "H -" commits R - 1', async () => {
    const R = 4;
    const middle = await renderForDrag(headerFixture(R, R));

    // An H-family marker on every row; no "+ H".
    for (let r = 0; r < R; r += 1) {
      expect(
        middle.querySelector(`[data-testid="header-marker-t-1-${r}"]`)
      ).not.toBeNull();
    }
    expect(middle.querySelectorAll('[data-variant="+H"]').length).toBe(0);
    // Only the last row is the decrement variant.
    expect(
      middle.querySelector(`[data-testid="header-marker-t-1-${R - 1}"]`)
    ).toHaveAttribute('data-variant', 'H-');
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-0"]')
    ).toHaveAttribute('data-variant', 'H');

    expect(
      await clickMarkerAndSavedHeaderCount(
        middle,
        `header-marker-t-1-${R - 1}`
      )
    ).toBe(R - 1);
  });

  test('decrement floors at 0: clicking "H -" with headerCount = 1 commits 0', async () => {
    const middle = await renderForDrag(headerFixture(1, 4));
    expect(
      middle.querySelector('[data-testid="header-marker-t-1-0"]')
    ).toHaveAttribute('data-variant', 'H-');
    expect(
      await clickMarkerAndSavedHeaderCount(middle, 'header-marker-t-1-0')
    ).toBe(0);
  });

  test('increment ceilings at R: clicking "+ H" with headerCount = R - 1 commits R', async () => {
    const R = 4;
    const middle = await renderForDrag(headerFixture(R - 1, R));
    // The first non-header row is R-1.
    expect(
      middle.querySelector(`[data-testid="header-marker-t-1-${R - 1}"]`)
    ).toHaveAttribute('data-variant', '+H');
    expect(
      await clickMarkerAndSavedHeaderCount(
        middle,
        `header-marker-t-1-${R - 1}`
      )
    ).toBe(R);
  });

  test('null headerCount is treated as 0: only a "+ H" on row 0', async () => {
    const middle = await renderForDrag(headerFixture(null, 4));
    expect(middle.querySelectorAll('[data-variant="H"]').length).toBe(0);
    expect(middle.querySelectorAll('[data-variant="H-"]').length).toBe(0);
    const plus = middle.querySelectorAll('[data-variant="+H"]');
    expect(plus).toHaveLength(1);
    expect(plus[0]).toHaveAttribute('data-testid', 'header-marker-t-1-0');
  });

  test('thumbnails / non-interactive render shows no header markers', async () => {
    getThumbnails.mockResolvedValue({
      images: [{ image: 'THUMB0', tables: [GRID_TABLE] }],
    });
    getMetadata.mockResolvedValue(headerFixture(2, 4));

    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="thumbnail"] img').length
      ).toBe(1)
    );
    const thumb = container.querySelector('[data-testid="thumbnail"]');
    loadImage(thumb.querySelector('img'));

    expect(
      thumb.querySelectorAll('[data-testid^="header-marker"]').length
    ).toBe(0);
  });

  // ---- FE-4: cell-content editor popup --------------------------------------------
  //
  // Clicking a cell body (a spot inside an editable table that is not a hit line or a
  // confidence square) opens a draggable/resizable popup seeded with the cell's text.
  // Saving collapses newlines to spaces, sets the cell confidence to 100, and commits
  // (raising dirty). Cancel closes without any change. Placement is above the cell when
  // there is room, otherwise below.

  // A one-cell table on page 0. `top` shifts the table down the page (0 == flush with the
  // top, so no room above); `text` seeds the cell content.
  const editorFixture = ({ top = 0, text = 'hello' } = {}) => ({
    tables: [
      {
        tableId: 'e-1',
        name: 'E',
        pdfPage: 0,
        bounds: { left: 0, top, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0, top, width: 0.1, height: 0.1 },
            text,
            confidence: 40,
            header: false,
          },
        ],
      },
    ],
  });

  // Click the SVG overlay at the given screen point (origin/scale set by renderForDrag:
  // fx = clientX / 1000, fy = clientY / 1000). Dispatching on the <svg> makes it the
  // event target, so handleBackgroundClick fires (as it does for a genuine cell-body
  // click that misses every hit line and confidence square).
  function clickOverlay(middle, clientX, clientY) {
    const svg = middle.querySelector('svg');
    fireEvent.click(svg, { clientX, clientY });
  }

  test('clicking a cell body opens the editor seeded with the cell text', async () => {
    const middle = await renderForDrag(confidenceFixture());
    // Cell (0,0) 'green cell' spans fx 0..0.1, fy 0..0.1: click its centre.
    clickOverlay(middle, 50, 50);

    const editor = await screen.findByTestId('cell-editor');
    expect(editor).toBeInTheDocument();
    expect(screen.getByTestId('cell-editor-text')).toHaveValue('green cell');
  });

  test('saving collapses newlines to spaces, sets confidence 100, and raises dirty', async () => {
    const middle = await renderForDrag(confidenceFixture());
    // Open on the red cell (0,2), confidence 30.
    clickOverlay(middle, 250, 50);
    await screen.findByTestId('cell-editor');

    fireEvent.change(screen.getByTestId('cell-editor-text'), {
      target: { value: 'line one\nline two' },
    });
    fireEvent.click(screen.getByTestId('cell-editor-save'));

    // The editor closes on save.
    await waitFor(() =>
      expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument()
    );

    // savedTable() asserts the top Save button became enabled (dirty), then commits.
    const t = await savedTable();
    const cell = t.cells.find((c) => c.row === 0 && c.column === 2);
    expect(cell.text).toBe('line one line two');
    expect(cell.confidence).toBe(100);
  });

  test('cancel closes the editor without committing or setting dirty', async () => {
    const middle = await renderForDrag(confidenceFixture());
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    fireEvent.change(screen.getByTestId('cell-editor-text'), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByTestId('cell-editor-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument()
    );
    // No commit happened: the top Save button stays disabled (dirty never raised).
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('a mousedown outside the editor (e.g. the left/right columns) closes it', async () => {
    const middle = await renderForDrag(confidenceFixture());
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    // document.body stands in for anything outside the popup — the middle-panel
    // background, a hit line, or the left list / right thumbnails.
    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument()
    );
    // Closing discards, like Cancel: dirty is never raised.
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('a mousedown inside the editor leaves it open', async () => {
    const middle = await renderForDrag(confidenceFixture());
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    fireEvent.mouseDown(screen.getByTestId('cell-editor-text'));

    // A click within the popup must not dismiss it.
    expect(screen.getByTestId('cell-editor')).toBeInTheDocument();
  });

  test('opens above the cell when there is room above', async () => {
    const middle = await renderForDrag(editorFixture({ top: 0.05 }));
    // Give the editor a measurable height so the layout effect can decide placement.
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function () {
        return {
          width: 400,
          height: 30,
          top: 0,
          left: 0,
          right: 400,
          bottom: 30,
          x: 0,
          y: 0,
        };
      },
    });
    // Cell top screen px = 0.05 * 1000 = 50; height 100. Click inside (fy 0.10).
    clickOverlay(middle, 50, 100);

    const editor = await screen.findByTestId('cell-editor');
    // Room above (50 - 30 >= 0): placed at cellTop - editorHeight = 20.
    await waitFor(() => expect(editor.style.top).toBe('20px'));
  });

  test('opens below the cell when there is no room above', async () => {
    const middle = await renderForDrag(editorFixture({ top: 0 }));
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function () {
        return {
          width: 400,
          height: 30,
          top: 0,
          left: 0,
          right: 400,
          bottom: 30,
          x: 0,
          y: 0,
        };
      },
    });
    // Cell flush with the top (top 0): no room above, so it drops below (cellTop +
    // cellHeight = 0 + 100 = 100).
    clickOverlay(middle, 50, 50);

    const editor = await screen.findByTestId('cell-editor');
    await waitFor(() => expect(editor.style.top).toBe('100px'));
  });

  test('initial textarea width is capped at 30ch when the text exceeds 30 chars', async () => {
    const middle = await renderForDrag(
      editorFixture({ text: 'x'.repeat(40) })
    );
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    const textarea = screen.getByTestId('cell-editor-text');
    expect(textarea.style.width).toBe('30ch');
  });

  test('sizes the textarea to the text length plus a little when under 30 chars', async () => {
    // 'green cell' is 10 chars -> 10 + 3 padding = 13ch (not constrained by the column).
    const middle = await renderForDrag(editorFixture({ text: 'green cell' }));
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    const textarea = screen.getByTestId('cell-editor-text');
    expect(textarea.style.width).toBe('13ch');
  });

  test('floors very short text at the minimum textarea width', async () => {
    // 'x' is 1 char; 1 + 3 = 4 < MIN_CH (8), so the floor of 8ch applies.
    const middle = await renderForDrag(editorFixture({ text: 'x' }));
    clickOverlay(middle, 50, 50);
    await screen.findByTestId('cell-editor');

    const textarea = screen.getByTestId('cell-editor-text');
    expect(textarea.style.width).toBe('8ch');
  });

  test('regression: clicking a confidence square does not open the editor', async () => {
    const middle = await renderForDrag(confidenceFixture());
    fireEvent.click(
      middle.querySelector('[data-testid="confidence-square-c-1-0-0"]')
    );
    expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument();
  });

  test('regression: a boundary drag does not open the editor', async () => {
    const middle = await renderForDrag(singleTable());
    dragBoundary(middle, 'right', { fromX: 100, fromY: 50, toX: 120, toY: 50 });
    expect(screen.queryByTestId('cell-editor')).not.toBeInTheDocument();
  });
});

// Render, wait for the middle image to mount, and return the middle-image node.
async function renderAndGetMiddle() {
  render(<PDFEditTableStructure pdfId={PDF_ID} />);
  const middle = await screen.findByTestId('middle-image');
  await waitFor(() => expect(middle.querySelector('img')).not.toBeNull());
  return middle;
}

describe('tableSizeLabel', () => {
  // A bare table with the given column/row counts and header count.
  const sized = (tableId, cols, rows, headerCount) => ({
    tableId,
    headerCount,
    columnWidths: Array.from({ length: cols }, () => ({ value: 0.01, confidence: 90 })),
    rowHeights: Array.from({ length: rows }, () => ({ value: 0.01, confidence: 90 })),
  });

  test('a table without a grid shows its own row × column counts and no tables line', () => {
    expect(tableSizeLabel(sized('t', 3, 4, 1))).toEqual({
      sizeLine: '4 Rows, 3 Columns',
      tablesLine: null,
    });
  });

  test('a null or trivial 1x1 grid is not a grid', () => {
    expect(tableSizeLabel({ ...sized('t', 3, 4, 1), grid: null })).toEqual({
      sizeLine: '4 Rows, 3 Columns',
      tablesLine: null,
    });
    expect(
      tableSizeLabel({ ...sized('t', 3, 4, 1), grid: [['t']], next: {} })
    ).toEqual({ sizeLine: '4 Rows, 3 Columns', tablesLine: null });
  });

  test('a saved grid sums row-0 columns and column-0 rows (child headers excluded, Root headers kept)', () => {
    const b = sized('b', 2, 4, 1);
    const c = sized('c', 3, 5, 2);
    const root = {
      ...sized('root', 3, 4, 1),
      grid: [
        ['root', 'b'],
        ['c', ''],
      ],
      next: { b, c },
    };
    // Columns: root 3 + b 2 = 5. Rows: root 4 (headers kept) + c (5 - 2) = 7.
    expect(tableSizeLabel(root)).toEqual({
      sizeLine: '7 Rows, 5 Columns',
      tablesLine: '2 × 2 Tables',
    });
  });

  test('a child with a null headerCount contributes all its rows', () => {
    const b = sized('b', 3, 4, null);
    const root = {
      ...sized('root', 3, 2, 1),
      grid: [['root'], ['b']],
      next: { b },
    };
    expect(tableSizeLabel(root)).toEqual({
      sizeLine: '6 Rows, 3 Columns',
      tablesLine: '1 × 2 Tables',
    });
  });

  test('grid entries that resolve to no table are skipped', () => {
    const b = sized('b', 2, 4, 1);
    const root = {
      ...sized('root', 3, 4, 1),
      grid: [
        ['root', 'b'],
        ['gone', ''],
      ],
      next: { b },
    };
    expect(tableSizeLabel(root)).toEqual({
      sizeLine: '4 Rows, 5 Columns',
      tablesLine: '2 × 2 Tables',
    });
  });
});

describe('linkedTablesWithParents', () => {
  test('returns every table nested in a next map with its parent name, recursively', () => {
    const grandchild = { tableId: 'g', name: 'Grand' };
    const child = { tableId: 'c', name: 'Child', next: { g: grandchild } };
    const root = { tableId: 'r', name: 'Root', next: { c: child } };
    const plain = { tableId: 'p', name: 'Plain' };

    expect(linkedTablesWithParents([root, plain])).toEqual([
      { table: child, parentName: 'Root' },
      { table: grandchild, parentName: 'Child' },
    ]);
  });

  test('tables without next yield nothing', () => {
    expect(linkedTablesWithParents([{ tableId: 'p' }, { tableId: 'q', next: null }])).toEqual([]);
    expect(linkedTablesWithParents([])).toEqual([]);
    expect(linkedTablesWithParents(undefined)).toEqual([]);
  });
});

// ---- Task 9: Calculate request-building + replacement helpers ----
describe('Calculate helpers', () => {
  const borderTable = {
    tableId: 't-1',
    name: 'Border',
    pdfPage: 2,
    tableInPage: 1.5,
    bounds: { left: 0.1, top: 0.2, width: 0.5, height: 0.3 },
    columnWidths: [{ value: 0.5, confidence: 100 }],
    rowHeights: [{ value: 0.3, confidence: 100 }],
    cells: [
      makeDefaultCell(0, 0, { left: 0.1, top: 0.2, width: 0.5, height: 0.3 }),
    ],
  };

  describe('buildCalcHint', () => {
    test('omits both expected counts when the fields are blank', () => {
      const hint = buildCalcHint(borderTable, '', '');
      expect(hint).toEqual({
        name: 'Border',
        tableInPage: 1.5,
        left: 0.1,
        top: 0.2,
        width: 0.5,
        height: 0.3,
      });
      expect(hint).not.toHaveProperty('expectedRows');
      expect(hint).not.toHaveProperty('expectedColumns');
    });

    test('includes both expected counts as numbers when supplied', () => {
      const hint = buildCalcHint(borderTable, '10', '3');
      expect(hint.expectedRows).toBe(10);
      expect(hint.expectedColumns).toBe(3);
      expect(typeof hint.expectedRows).toBe('number');
      expect(typeof hint.expectedColumns).toBe('number');
    });

    test('includes only the field the user actually entered', () => {
      expect(buildCalcHint(borderTable, '4', '')).toMatchObject({
        expectedRows: 4,
      });
      expect(buildCalcHint(borderTable, '4', '')).not.toHaveProperty(
        'expectedColumns'
      );
      expect(buildCalcHint(borderTable, '', '2')).toMatchObject({
        expectedColumns: 2,
      });
      expect(buildCalcHint(borderTable, '', '2')).not.toHaveProperty(
        'expectedRows'
      );
    });
  });

  describe('pickCalcResultTable', () => {
    test('returns null when the response carries no tables', () => {
      expect(pickCalcResultTable(borderTable, [])).toBeNull();
      expect(pickCalcResultTable(borderTable, undefined)).toBeNull();
    });

    test('returns the sole table when exactly one is returned', () => {
      const only = { tableId: 'x', pdfPage: 9, tableInPage: 99 };
      expect(pickCalcResultTable(borderTable, [only])).toBe(only);
    });

    test('matches by tableInPage + pdfPage when several are returned', () => {
      const a = { tableId: 'a', pdfPage: 2, tableInPage: 0 };
      const b = { tableId: 'b', pdfPage: 2, tableInPage: 1.5 };
      expect(pickCalcResultTable(borderTable, [a, b])).toBe(b);
    });

    test('falls back to the first table when nothing matches', () => {
      const a = { tableId: 'a', pdfPage: 9, tableInPage: 9 };
      const b = { tableId: 'b', pdfPage: 8, tableInPage: 8 };
      expect(pickCalcResultTable(borderTable, [a, b])).toBe(a);
    });
  });

  describe('buildCalcReplacement', () => {
    test('keeps the original tableId/pdfPage, enforces I1/I2, and fills every grid square', () => {
      const result = {
        tableId: 'backend-id',
        name: 'Border',
        pdfPage: 0, // backend page differs from the front-end table's page
        tableInPage: 1.5,
        // bounds.width/height deliberately inconsistent with the axis sums (violates I1/I2).
        bounds: { left: 0, top: 0, width: 0.9, height: 0.9 },
        columnWidths: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.05, confidence: 90 },
          { value: 0.05, confidence: 90 },
        ],
        // Only one of the four grid squares carries a backend cell.
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            columnSpan: 1,
            bounds: { left: 0, top: 0, width: 0.05, height: 0.05 },
            text: 'A',
            confidence: 90,
            header: false,
          },
        ],
      };
      const out = buildCalcReplacement(borderTable, result);
      expect(out.tableId).toBe('t-1'); // original id preserved
      expect(out.pdfPage).toBe(2); // original page preserved
      // I1/I2: bounds width/height == axis sums.
      expect(out.bounds.width).toBeCloseTo(0.1, 10);
      expect(out.bounds.height).toBeCloseTo(0.1, 10);
      // fillGridCells materialised a cell for every one of the 2×2 grid squares.
      expect(out.cells).toHaveLength(4);
      for (let r = 0; r < 2; r += 1) {
        for (let c = 0; c < 2; c += 1) {
          expect(
            out.cells.find((x) => x.row === r && x.column === c)
          ).toBeDefined();
        }
      }
    });

    // A replacement MERGES rather than overwrites: the editor is the definitive source for
    // the editing state the finder has no concept of, so those fields are kept while the
    // finder's geometry and content are adopted. confirmationStage is the one that bites
    // hardest — losing it silently resets the user's progress through the layers.
    // `name` and `tableInPage` are NOT in this set: both finders deliberately reflect the
    // hint's values back, so they legitimately round-trip through the result.
    test('keeps the editing state the finder has no concept of', () => {
      const editorTable = {
        ...borderTable,
        confirmationStage: 4,
        deleted: false,
        next: { 'other-id': { tableId: 'other-id' } },
      };
      const result = {
        tableId: 'backend-id',
        pdfPage: 0,
        bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
        columnWidths: [{ value: 0.1, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
        cells: [],
        // confirmationStage / next are absent: the finder does not carry them at all.
        deleted: true, // and a default it would send is not authoritative either
      };
      const out = buildCalcReplacement(editorTable, result);

      expect(out.confirmationStage).toBe(4);
      expect(out.deleted).toBe(false);
      expect(out.next).toEqual({ 'other-id': { tableId: 'other-id' } });
      expect(out.tableId).toBe('t-1');
      expect(out.pdfPage).toBe(2);
      // …while the finder's geometry is still adopted.
      expect(out.bounds.left).toBe(0);
      expect(out.columnWidths).toHaveLength(1);
    });

    // A stage of 0 must survive as 0 rather than being treated as "nothing to keep".
    test('keeps a zero confirmationStage', () => {
      const out = buildCalcReplacement(
        { ...borderTable, confirmationStage: 0 },
        { bounds: { left: 0, top: 0, width: 0.1, height: 0.1 }, confirmationStage: 5 }
      );
      expect(out.confirmationStage).toBe(0);
    });
  });
});

// ---- Task 10: Recalculate cell-selection / bounds / merge helpers ----
describe('Recalculate helpers', () => {
  // A 3×3 grid whose column/row sizes are all 0.1, offset at (0.1, 0.2). Used for the
  // grid-line bounds and hint-building assertions.
  const grid3x3 = {
    tableId: 't-1',
    name: 'Grid',
    pdfPage: 1,
    tableInPage: 2.5,
    bounds: { left: 0.1, top: 0.2, width: 0.3, height: 0.3 },
    columnWidths: [
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
    ],
    rowHeights: [
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
      { value: 0.1, confidence: 90 },
    ],
  };

  describe('selectLowConfidenceCells', () => {
    test('selects only RED cells (null or < 50); excludes orange (50–79) and green (>=80)', () => {
      const cells = [
        { row: 0, column: 0, confidence: null }, // red
        { row: 0, column: 1, confidence: 0 }, // red
        { row: 0, column: 2, confidence: 49 }, // red
        { row: 1, column: 0, confidence: 50 }, // orange (boundary) — excluded
        { row: 1, column: 1, confidence: 79 }, // orange — excluded
        { row: 1, column: 2, confidence: 80 }, // green (boundary) — excluded
        { row: 2, column: 0, confidence: 100 }, // green — excluded
      ];
      const red = selectLowConfidenceCells(cells);
      expect(red.map((c) => `${c.row},${c.column}`)).toEqual([
        '0,0',
        '0,1',
        '0,2',
      ]);
    });

    test('treats a cell with no confidence field as RED and tolerates a missing array', () => {
      expect(selectLowConfidenceCells([{ row: 0, column: 0 }])).toHaveLength(1);
      expect(selectLowConfidenceCells(undefined)).toEqual([]);
    });
  });

  describe('recalcCellBounds', () => {
    test('a span-1 cell uses its single grid square, from grid lines NOT cell.bounds', () => {
      const cell = {
        row: 1,
        column: 1,
        rowSpan: 1,
        columnSpan: 1,
        // A deliberately-wrong tight OCR box that must be ignored.
        bounds: { left: 0.999, top: 0.999, width: 0.001, height: 0.001 },
      };
      const b = recalcCellBounds(grid3x3, cell);
      expect(b.left).toBeCloseTo(0.2, 10); // 0.1 origin + col 0 (0.1)
      expect(b.top).toBeCloseTo(0.3, 10); // 0.2 origin + row 0 (0.1)
      expect(b.width).toBeCloseTo(0.1, 10);
      expect(b.height).toBeCloseTo(0.1, 10);
    });

    test('a spanning cell sums the spanned columnWidths/rowHeights for width/height', () => {
      const cell = { row: 0, column: 1, rowSpan: 2, columnSpan: 2 };
      const b = recalcCellBounds(grid3x3, cell);
      expect(b.left).toBeCloseTo(0.2, 10); // 0.1 origin + col 0 (0.1)
      expect(b.top).toBeCloseTo(0.2, 10); // top row 0 -> table top
      expect(b.width).toBeCloseTo(0.2, 10); // cols 1 + 2 (0.1 + 0.1)
      expect(b.height).toBeCloseTo(0.2, 10); // rows 0 + 1 (0.1 + 0.1)
    });

    test('defaults a missing rowSpan/columnSpan to 1', () => {
      const b = recalcCellBounds(grid3x3, { row: 0, column: 0 });
      expect(b.width).toBeCloseTo(0.1, 10);
      expect(b.height).toBeCloseTo(0.1, 10);
    });
  });

  describe('buildRecalcHint', () => {
    test('carries name/tableInPage/bounds plus one grid-line cell per selected cell', () => {
      const hint = buildRecalcHint(grid3x3, [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
        { row: 1, column: 2, rowSpan: 1, columnSpan: 1 },
      ]);
      expect(hint).toMatchObject({
        name: 'Grid',
        tableInPage: 2.5,
        left: 0.1,
        top: 0.2,
        width: 0.3,
        height: 0.3,
      });
      expect(hint).not.toHaveProperty('expectedRows');
      expect(hint).not.toHaveProperty('expectedColumns');
      expect(hint.cells).toHaveLength(2);
      expect(hint.cells[0]).toMatchObject({
        row: 0,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
      });
      expect(hint.cells[0].bounds).toMatchObject({
        left: 0.1,
        top: 0.2,
        width: 0.1,
        height: 0.1,
      });
      expect(hint.cells[1].bounds.left).toBeCloseTo(0.3, 10); // col 0+1
      expect(hint.cells[1].bounds.top).toBeCloseTo(0.3, 10); // row 0
    });

    test('tolerates a missing cells list', () => {
      expect(buildRecalcHint(grid3x3, undefined).cells).toEqual([]);
    });
  });

  describe('mergeRecalcCells', () => {
    const table = {
      tableId: 't-1',
      bounds: { left: 0, top: 0, width: 0.1, height: 0.1 },
      columnWidths: [{ value: 0.05, confidence: 90 }, { value: 0.05, confidence: 90 }],
      rowHeights: [{ value: 0.1, confidence: 90 }],
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0, top: 0, width: 0.05, height: 0.1 }, text: 'old0', confidence: 20, header: false },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, bounds: { left: 0.05, top: 0, width: 0.05, height: 0.1 }, text: 'keep', confidence: 90, header: false },
      ],
    };

    test('replaces only the matching (row,column) cell and preserves others + geometry', () => {
      const returned = [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, bounds: { left: 0.001, top: 0.001, width: 0.049, height: 0.099 }, text: 'NEW', confidence: 99, header: false },
      ];
      const merged = mergeRecalcCells(table, returned);
      const c00 = merged.cells.find((c) => c.row === 0 && c.column === 0);
      expect(c00.text).toBe('NEW');
      expect(c00.confidence).toBe(99);
      expect(c00.bounds).toEqual({ left: 0.001, top: 0.001, width: 0.049, height: 0.099 });
      // The untouched cell is preserved by reference (no needless copy).
      const c01 = merged.cells.find((c) => c.row === 0 && c.column === 1);
      expect(c01).toBe(table.cells[1]);
      // Geometry preserved by reference.
      expect(merged.bounds).toBe(table.bounds);
      expect(merged.columnWidths).toBe(table.columnWidths);
      expect(merged.rowHeights).toBe(table.rowHeights);
    });

    test('a spanning returned cell replaces its counterpart including span', () => {
      const returned = [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 2, bounds: { left: 0, top: 0, width: 0.1, height: 0.1 }, text: 'wide', confidence: 70, header: false },
      ];
      const merged = mergeRecalcCells(table, returned);
      const c00 = merged.cells.find((c) => c.row === 0 && c.column === 0);
      expect(c00.columnSpan).toBe(2);
      expect(c00.text).toBe('wide');
    });

    test('tolerates missing/empty returned cells (no change) and a missing cells array', () => {
      expect(mergeRecalcCells(table, []).cells).toEqual(table.cells);
      expect(mergeRecalcCells(table, undefined).cells).toEqual(table.cells);
      expect(mergeRecalcCells({ bounds: {} }, []).cells).toEqual([]);
    });
  });
});

describe('recalcShortfallMessage', () => {
  const hint = (name, tableInPage, cellCount) => ({
    name,
    tableInPage,
    cells: Array.from({ length: cellCount }, (_, i) => ({ row: i, column: 0 })),
  });
  const table = (name, tableInPage, cellCount) => ({
    name,
    tableInPage,
    cells: Array.from({ length: cellCount }, (_, i) => ({ row: i, column: 0 })),
  });

  test('returns null when every requested table and all its cells came back', () => {
    expect(
      recalcShortfallMessage([hint('T', 0, 2)], [table('T', 0, 2)])
    ).toBeNull();
  });

  test('flags missing tables when fewer tables are returned than requested', () => {
    expect(recalcShortfallMessage([hint('T', 0, 2)], [])).toBe(
      'Some tables not detected'
    );
    // An upstream error the API route collapses to an empty result also surfaces here.
    expect(recalcShortfallMessage([hint('T', 0, 2)], undefined)).toBe(
      'Some tables not detected'
    );
  });

  test('flags missing tables when a requested table has no match by (name, tableInPage)', () => {
    // Right COUNT but the returned table is a different one.
    expect(
      recalcShortfallMessage([hint('T', 0, 2)], [table('Other', 3, 2)])
    ).toBe('Some tables not detected');
  });

  test('flags missing cells when a matched table returns fewer cells than requested', () => {
    expect(
      recalcShortfallMessage([hint('T', 0, 2)], [table('T', 0, 1)])
    ).toBe('Some cells not detected');
  });

  test('"tables not detected" takes precedence over "cells not detected"', () => {
    // One table fully missing, another short on cells: report the table shortfall.
    const requested = [hint('A', 0, 2), hint('B', 1, 2)];
    const returned = [table('A', 0, 1)]; // B missing; A short a cell
    expect(recalcShortfallMessage(requested, returned)).toBe(
      'Some tables not detected'
    );
  });

  test('generalises to several requested tables at once', () => {
    const requested = [hint('A', 0, 1), hint('B', 1, 2)];
    const returned = [table('A', 0, 1), table('B', 1, 2)];
    expect(recalcShortfallMessage(requested, returned)).toBeNull();
  });
});

describe('chooseCellTextPlacement', () => {
  const container = { width: 200, height: 100 };
  // A small cell near the top-left with room on every side.
  const cell = { left: 40, top: 20, width: 20, height: 10 };

  test('places the box directly below the cell when it fits', () => {
    const overlay = { width: 30, height: 15 };
    const { left, top, placement } = chooseCellTextPlacement(
      cell,
      overlay,
      container
    );
    expect(placement).toBe('below');
    expect(left).toBe(cell.left); // aligned to the cell's left edge
    expect(top).toBe(cell.top + cell.height); // just under the cell
  });

  test('falls back to the right of the cell when there is no room below', () => {
    // Cell low enough that below (top+height+overlay) overflows the container bottom,
    // but with vertical room for a right-placed box aligned to the cell top.
    const lowCell = { left: 40, top: 80, width: 20, height: 10 };
    const overlay = { width: 30, height: 15 };
    const { left, top, placement } = chooseCellTextPlacement(
      lowCell,
      overlay,
      container
    );
    expect(placement).toBe('right');
    expect(left).toBe(lowCell.left + lowCell.width); // just right of the cell
    expect(top).toBe(lowCell.top); // aligned to the cell's top
  });

  test('falls back to above the cell when there is room neither below nor right', () => {
    // Bottom-right corner: no room below (bottom edge) and no room right (right edge).
    const cornerCell = { left: 185, top: 88, width: 12, height: 10 };
    const overlay = { width: 30, height: 15 };
    const { top, placement } = chooseCellTextPlacement(
      cornerCell,
      overlay,
      container
    );
    expect(placement).toBe('above');
    expect(top).toBe(cornerCell.top - overlay.height); // sits above the cell
  });

  test('clamps a below/above box so it never spills past the right edge', () => {
    // Cell near the right edge: below fits vertically but the box would overflow right.
    const rightCell = { left: 180, top: 10, width: 15, height: 10 };
    const overlay = { width: 40, height: 15 };
    const { left, placement } = chooseCellTextPlacement(
      rightCell,
      overlay,
      container
    );
    expect(placement).toBe('below');
    expect(left).toBe(container.width - overlay.width); // clamped inside
  });

  test('never returns a negative origin', () => {
    // Box larger than the container: origin clamps to 0 rather than going negative.
    const cornerCell = { left: 190, top: 95, width: 10, height: 5 };
    const overlay = { width: 250, height: 150 };
    const { left, top } = chooseCellTextPlacement(cornerCell, overlay, container);
    expect(left).toBe(0);
    expect(top).toBe(0);
  });

  test('below: mouseX shifts the box so its right edge ends 10px short of the mouse', () => {
    // below placement (room beneath the cell) + mouseX: the box moves left so its
    // right edge (left + width) sits 10px short of the mouse x.
    const overlay = { width: 30, height: 15 };
    const mouseX = 100;
    const { left, placement } = chooseCellTextPlacement(
      cell,
      overlay,
      container,
      mouseX
    );
    expect(placement).toBe('below');
    expect(left).toBe(mouseX - 10 - overlay.width); // 100 - 10 - 30 = 60
  });

  test('below: the mouseX shift is still clamped inside the container', () => {
    // A mouseX near the left edge would push the box origin negative; the clamp
    // pins it back to 0.
    const overlay = { width: 30, height: 15 };
    const mouseX = 20; // 20 - 10 - 30 = -20 -> clamped to 0
    const { left, placement } = chooseCellTextPlacement(
      cell,
      overlay,
      container,
      mouseX
    );
    expect(placement).toBe('below');
    expect(left).toBe(0);
  });

  test('right: mouseX does not move the box', () => {
    const lowCell = { left: 40, top: 80, width: 20, height: 10 };
    const overlay = { width: 30, height: 15 };
    const { left, placement } = chooseCellTextPlacement(
      lowCell,
      overlay,
      container,
      100
    );
    expect(placement).toBe('right');
    expect(left).toBe(lowCell.left + lowCell.width); // unchanged by mouseX
  });

  test('above: mouseX does not move the box', () => {
    const cornerCell = { left: 185, top: 88, width: 12, height: 10 };
    const overlay = { width: 30, height: 15 };
    const { left, placement } = chooseCellTextPlacement(
      cornerCell,
      overlay,
      container,
      100
    );
    expect(placement).toBe('above');
    expect(left).toBe(container.width - overlay.width); // unchanged by mouseX (still clamped)
  });
});

describe('linked tables on the centre overlay', () => {
  // Root at viewbox 0..50 x 0..40 (2 cols × 4 rows); its linked child at 0..50 x
  // 60..80 (1 col × 1 row) on the same page. Fractions × the fixture's
  // pixelWidth/pixelHeight (1000) give viewbox px; natural dims 100×100 rendered 1:1.
  const CHILD = {
    tableId: 'c-1',
    name: 'Continuation',
    pdfPage: 0,
    bounds: { left: 0.0, top: 0.06, width: 0.05, height: 0.02 },
    columnWidths: [{ value: 0.05, confidence: 100 }],
    rowHeights: [{ value: 0.02, confidence: 100 }],
  };
  const ROOT = {
    tableId: 't-1',
    name: 'Premium Summary',
    pdfPage: 0,
    bounds: { left: 0.0, top: 0.0, width: 0.05, height: 0.04 },
    columnWidths: [
      { value: 0.025, confidence: 100 },
      { value: 0.025, confidence: 100 },
    ],
    rowHeights: [
      { value: 0.01, confidence: 100 },
      { value: 0.01, confidence: 100 },
      { value: 0.01, confidence: 100 },
      { value: 0.01, confidence: 100 },
    ],
    grid: [['t-1'], ['c-1']],
    next: { 'c-1': CHILD },
  };

  async function renderLinked() {
    getMetadata.mockResolvedValue({ tables: [ROOT] });
    const middle = await renderAndGetMiddle();
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
    return middle;
  }

  test('a table linked into another table\'s next/grid is still drawn on its page', async () => {
    const middle = await renderLinked();
    // Root and its linked child both draw their outline rect.
    expect(middle.querySelectorAll('rect')).toHaveLength(2);
    // But only the root appears in the left table list.
    expect(screen.getAllByTestId('table-entry')).toHaveLength(1);
  });

  test('neither a linked table nor the root that links it renders hit lines', async () => {
    const middle = await renderLinked();
    // The child is locked as a linked table; the root is locked because it HAS
    // linked tables. An editable root alone would render 8 hit lines (4 boundary
    // edges + 1 internal column divider + 3 internal row dividers).
    expect(middle.querySelectorAll('[data-testid="hit-line"]')).toHaveLength(0);
  });

  test('a root with linked tables renders no edit markers (confidence squares / header markers)', async () => {
    const middle = await renderLinked();
    const overlay = middle.querySelector('img').parentElement;
    expect(
      overlay.querySelectorAll('[data-testid^="confidence-square"]')
    ).toHaveLength(0);
    expect(
      overlay.querySelectorAll('[data-testid^="header-marker"]')
    ).toHaveLength(0);
  });

  test('hovering a linked table or its root appends the matching locked message', async () => {
    const middle = await renderLinked();
    const overlayBox = middle.querySelector('img').parentElement;

    // Hover the child (viewbox 0..50 x 60..80).
    fireEvent.mouseMove(overlayBox, { clientX: 25, clientY: 70 });
    await screen.findByTestId('hover-label');
    expect(screen.getByTestId('hover-label-name')).toHaveTextContent(
      'Continuation'
    );
    expect(screen.getByTestId('hover-label-locked')).toHaveTextContent(
      'Locked as part of Premium Summary'
    );

    // Hover the root (viewbox 0..50 x 0..40): locked because it HAS linked tables.
    fireEvent.mouseMove(overlayBox, { clientX: 25, clientY: 20 });
    await waitFor(() =>
      expect(screen.getByTestId('hover-label-name')).toHaveTextContent(
        'Premium Summary'
      )
    );
    expect(screen.getByTestId('hover-label-locked')).toHaveTextContent(
      'Locked as linked to other tables'
    );
  });
});

describe('right-column page headings', () => {
  // A minimal table record for the count assertions: only pdfPage, deleted and
  // confirmationStage matter here, but bounds and the axis arrays are supplied because the
  // host normalises and grid-fills every loaded table.
  const countTable = (tableId, pdfPage, extra = {}) => ({
    tableId,
    name: tableId,
    pdfPage,
    bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
    columnWidths: [{ value: 0.2, confidence: 90 }],
    rowHeights: [{ value: 0.2, confidence: 90 }],
    ...extra,
  });

  // Load `tables` as the editable list while leaving metadata.pages[].tables deliberately
  // MISMATCHED (the fixture's one-on-page-0 / two-on-page-1 lists), so a count that still
  // read the per-page origin lists would fail these tests.
  async function renderCounts(tables) {
    getMetadata.mockResolvedValue({
      name: 'counts.pdf',
      tables,
      pages: METADATA_FIXTURE.pages,
    });
    const { container } = render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="thumbnail"]').length).toBe(2)
    );
    return container;
  }

  // Five tables: two still to process (one below the confirmed stage, one carrying no stage
  // at all), two at the confirmed stage, and a soft-deleted one that must be counted in
  // neither. The confirmed stage is used only as an INPUT, never asserted as a literal.
  const progressTables = () => [
    countTable('p-1', 0, { confirmationStage: confirmedTableStage() - 1 }),
    countTable('p-2', 0),
    countTable('c-1', 1, { confirmationStage: confirmedTableStage() }),
    countTable('c-2', 1, { confirmationStage: confirmedTableStage() }),
    countTable('d-1', 1, {
      confirmationStage: confirmedTableStage() - 1,
      deleted: true,
    }),
  ];

  test('each thumbnail shows a page heading and its table count', async () => {
    await renderCounts([countTable('t-1', 0), countTable('t-2', 1)]);

    const titles = screen.getAllByTestId('thumbnail-page-title');
    expect(titles).toHaveLength(2);
    expect(titles[0]).toHaveTextContent('Page 1');
    expect(titles[1]).toHaveTextContent('Page 2');
    expect(titles[0]).toHaveStyle({ color: 'var(--primary-text)' });

    // One live table per page, so both read the singular form.
    const counts = screen.getAllByTestId('thumbnail-page-tables');
    expect(counts[0]).toHaveTextContent(/^1 table$/);
    expect(counts[1]).toHaveTextContent(/^1 table$/);
    expect(counts[0]).toHaveStyle({ color: 'var(--secondary-text)' });
  });

  test('counts come from the live tables list, not pages.tables', async () => {
    // Three live tables on page 0 and none on page 1 — the inverse shape of the fixture's
    // metadata.pages[].tables, which must NOT be consulted.
    await renderCounts([
      countTable('a', 0),
      countTable('b', 0),
      countTable('c', 0),
    ]);

    const counts = screen.getAllByTestId('thumbnail-page-tables');
    expect(counts[0]).toHaveTextContent(/^3 tables$/);
    // Zero tables reads "No tables".
    expect(counts[1]).toHaveTextContent(/^No tables$/);
  });

  test('soft-deleted tables are excluded from the per-thumbnail count', async () => {
    await renderCounts([
      countTable('live', 0),
      countTable('gone', 0, { deleted: true }),
      countTable('also-gone', 1, { deleted: true }),
    ]);

    const counts = screen.getAllByTestId('thumbnail-page-tables');
    expect(counts[0]).toHaveTextContent(/^1 table$/);
    expect(counts[1]).toHaveTextContent(/^No tables$/);
  });

  // A stand-in centre panel whose single button hands the host a table list with an extra
  // table on page 0 — the same commit path a real edit takes.
  function MockAddTable({ metadata, onChange }) {
    return (
      <button
        data-testid={'mock-add-table'}
        onClick={() => onChange([...metadata.tables, countTable('extra', 0)])}
      >
        {'add'}
      </button>
    );
  }

  test('a per-thumbnail count follows a table edit with no save', async () => {
    // The count must follow the live list immediately; the fetched thumbnails themselves
    // only refresh after a save.
    global.__PTE_MOCK__ = MockAddTable;
    try {
      await renderCounts([countTable('t-1', 0)]);
      expect(screen.getAllByTestId('thumbnail-page-tables')[0]).toHaveTextContent(
        /^1 table$/
      );

      await userEvent.click(await screen.findByTestId('mock-add-table'));

      await waitFor(() =>
        expect(
          screen.getAllByTestId('thumbnail-page-tables')[0]
        ).toHaveTextContent(/^2 tables$/)
      );
      expect(saveTables).not.toHaveBeenCalled();
    } finally {
      global.__PTE_MOCK__ = null;
    }
  });

  test('the summary shows the number of pages', async () => {
    await renderCounts(progressTables());

    expect(screen.getByTestId('pages-summary-pages')).toHaveTextContent(
      /^Pages: 2$/
    );
  });

  test('"Tables to process" counts non-deleted tables below the confirmed stage', async () => {
    await renderCounts(progressTables());

    expect(screen.getByTestId('pages-summary-to-process')).toHaveTextContent(
      /^Tables to process: 2$/
    );
  });

  test('"Tables completed" counts non-deleted tables at the confirmed stage', async () => {
    await renderCounts(progressTables());

    expect(screen.getByTestId('pages-summary-completed')).toHaveTextContent(
      /^Tables completed: 2$/
    );
  });

  test('the two table counts partition the non-deleted tables', async () => {
    const tables = progressTables();
    const live = tables.filter((t) => !t.deleted).length;
    await renderCounts(tables);

    const numberIn = (testId) =>
      Number(screen.getByTestId(testId).textContent.match(/(\d+)$/)[1]);
    const toProcess = numberIn('pages-summary-to-process');
    const completed = numberIn('pages-summary-completed');
    // Between them the two lines account for every live table, and the soft-deleted one is
    // in neither (the fixture holds one more table than `live`).
    expect(toProcess + completed).toBe(live);
    expect(live).toBeLessThan(tables.length);
  });

  test('a table with no confirmationStage counts as still to process', async () => {
    // A missing stage and an explicit null are both treated as stage 0, as elsewhere in
    // the editor.
    await renderCounts([
      countTable('no-stage', 0),
      countTable('null-stage', 1, { confirmationStage: null }),
    ]);

    expect(screen.getByTestId('pages-summary-to-process')).toHaveTextContent(
      /^Tables to process: 2$/
    );
    expect(screen.getByTestId('pages-summary-completed')).toHaveTextContent(
      /^Tables completed: 0$/
    );
  });

  test('a table at the ready stage still counts as completed', async () => {
    // The ready stage sits ABOVE the confirmed stage, so the summary's `>=` test must keep
    // treating a marked-ready table as completed rather than as still to process.
    await renderCounts([
      countTable('ready', 0, { confirmationStage: readyTableStage() }),
      countTable('confirmed', 1, {
        confirmationStage: confirmedTableStage(),
      }),
    ]);

    expect(screen.getByTestId('pages-summary-completed')).toHaveTextContent(
      /^Tables completed: 2$/
    );
    expect(screen.getByTestId('pages-summary-to-process')).toHaveTextContent(
      /^Tables to process: 0$/
    );
  });

  test('the old per-page-state summary lines are gone', async () => {
    await renderCounts(progressTables());

    expect(screen.queryByTestId('pages-summary-one')).toBeNull();
    expect(screen.queryByTestId('pages-summary-many')).toBeNull();
    expect(screen.queryByTestId('pages-summary-none')).toBeNull();
    const summary = screen.getByTestId('pages-summary');
    expect(summary).not.toHaveTextContent('1 table:');
    expect(summary).not.toHaveTextContent('>1 table:');
    expect(summary).not.toHaveTextContent('No tables:');
  });
});

describe('left-column size row with a saved grid', () => {
  // A continuation table joined below the root, giving the root a 1 × 2 grid.
  const linkedFixture = () => {
    const linked = {
      tableId: 'b-1',
      name: 'Continuation',
      pdfPage: 1,
      headerCount: 1,
      bounds: { left: 0.001, top: 0.002, width: 0.003, height: 0.004 },
      columnWidths: [
        { value: 0.001, confidence: 90 },
        { value: 0.002, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.001, confidence: 90 },
        { value: 0.002, confidence: 90 },
        { value: 0.003, confidence: 90 },
        { value: 0.004, confidence: 90 },
      ],
    };
    const root = {
      ...METADATA_FIXTURE.tables[0], // 3 columns × 2 rows
      headerCount: 1,
      grid: [['t-1'], ['b-1']],
      next: { 'b-1': linked },
    };
    return { tables: [root, METADATA_FIXTURE.tables[1]] };
  };

  test('a root table with a grid shows the combined joined-result totals', async () => {
    getMetadata.mockResolvedValue(linkedFixture());

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const sizes = await screen.findAllByTestId('table-entry-size');
    // Columns: root only in grid row 0 -> 3. Rows: root 2 + linked (4 - 1) -> 5.
    expect(sizes[0]).toHaveTextContent('5 Rows, 3 Columns');
    // A plain table shows its own counts.
    expect(sizes[1]).toHaveTextContent('4 Rows, 2 Columns');
  });

  test('the grid dimensions appear on their own line below the size line, only for the grid table', async () => {
    getMetadata.mockResolvedValue(linkedFixture());

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    // Root grid is 1 column × 2 rows of tables; the plain table has no grid so no
    // tables line at all — hence exactly one node across the two entries.
    const tablesLines = screen.getAllByTestId('table-entry-tables');
    expect(tablesLines).toHaveLength(1);
    expect(tablesLines[0]).toHaveTextContent('1 × 2 Tables');

    // It sits inside the grid table's entry, immediately after its size line.
    const entries = screen.getAllByTestId('table-entry');
    expect(entries[0]).toContainElement(tablesLines[0]);
    expect(
      entries[0].querySelector('[data-testid="table-entry-size"]').nextSibling
    ).toBe(tablesLines[0]);
  });

  test('a plain table renders no tables line', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    expect(screen.queryAllByTestId('table-entry-tables')).toHaveLength(0);
  });
});

describe('left-column title line', () => {
  // Metadata whose FIRST table carries the given title and whose second has none,
  // so a single rendered title line is unambiguous.
  const withTitle = (title) => ({
    ...METADATA_FIXTURE,
    tables: [{ ...METADATA_FIXTURE.tables[0], title }, METADATA_FIXTURE.tables[1]],
  });

  const boundedText = (text) => ({
    bounds: { left: 0.1, top: 0.1, width: 0.5, height: 0.02 },
    text,
    confidence: 90,
  });

  test('renders the read title text below the name row', async () => {
    const text =
      'Schedule of Losses for the period 1 January 2020 to 31 December 2024';
    getMetadata.mockResolvedValue(withTitle(boundedText(text)));

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const titles = await screen.findAllByTestId('table-entry-title');
    expect(titles).toHaveLength(1);
    expect(titles[0]).toHaveTextContent(text);

    // A sibling of the name row inside the entry, not nested in the name Box.
    const entry = screen.getAllByTestId('table-entry')[0];
    expect(entry).toContainElement(titles[0]);
    expect(
      entry
        .querySelector('[data-testid="table-entry-name"]')
        .querySelector('[data-testid="table-entry-title"]')
    ).toBeNull();
  });

  test('renders no title line when the table has no title', async () => {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    expect(screen.queryAllByTestId('table-entry-title')).toHaveLength(0);
  });

  test('renders no title line when title is null', async () => {
    getMetadata.mockResolvedValue(withTitle(null));

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    expect(screen.queryAllByTestId('table-entry-title')).toHaveLength(0);
  });

  test('renders no title line when the title text has not been read yet', async () => {
    getMetadata.mockResolvedValue(withTitle(boundedText(null)));

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    expect(screen.queryAllByTestId('table-entry-title')).toHaveLength(0);
  });

  test('renders no title line when the title text is empty', async () => {
    getMetadata.mockResolvedValue(withTitle(boundedText('')));

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    await screen.findAllByTestId('table-entry-size');
    expect(screen.queryAllByTestId('table-entry-title')).toHaveLength(0);
  });

  test('clicking the title does not start the inline rename', async () => {
    getMetadata.mockResolvedValue(withTitle(boundedText('Schedule of Losses')));

    render(<PDFEditTableStructure pdfId={PDF_ID} />);

    const title = (await screen.findAllByTestId('table-entry-title'))[0];
    await userEvent.click(title);

    // No rename input appeared; the name row still shows plain text.
    expect(screen.queryByDisplayValue('Premium Summary')).not.toBeInTheDocument();
    const name = screen.getAllByTestId('table-entry-name')[0];
    expect(name.querySelector('input')).toBeNull();
    expect(name).toHaveTextContent('Premium Summary');
  });
});

describe('PageImageWithOverlay editableTableId', () => {
  // Two independent top-level tables on the same page (page 0) in disjoint regions.
  // Fractions × pixelWidth/pixelHeight (1000) give viewbox px; the img is measured at
  // 1000×1000 so page-fraction f maps to screen coordinate f * 1000. Each table is
  // 2 cols × 2 rows; fillGridCells fills all four cells (confidence 0) so each renders
  // four confidence squares, and headerCount 0 yields one '+H' header marker per table.
  const TABLE_ALPHA = fillGridCells(
    normaliseTableBounds({
      tableId: 'tbl-alpha',
      name: 'Alpha',
      pdfPage: 0,
      bounds: { left: 0.0, top: 0.0, width: 0.2, height: 0.2 },
      columnWidths: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
    })
  );
  const TABLE_BETA = fillGridCells(
    normaliseTableBounds({
      tableId: 'tbl-beta',
      name: 'Beta',
      pdfPage: 0,
      bounds: { left: 0.5, top: 0.5, width: 0.2, height: 0.2 },
      columnWidths: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
      rowHeights: [
        { value: 0.1, confidence: 90 },
        { value: 0.1, confidence: 90 },
      ],
    })
  );
  const META_TABLES = [TABLE_ALPHA, TABLE_BETA];

  async function renderOverlay(extraProps = {}) {
    const overlay = metadataTablesToOverlay(META_TABLES, 0, 1000, 1000);
    const utils = render(
      <PageImageWithOverlay
        image={'QUFB'}
        tables={overlay}
        metadataTables={META_TABLES}
        page={0}
        pixelWidth={1000}
        pixelHeight={1000}
        onEditTables={jest.fn()}
        {...extraProps}
      />
    );
    const img = utils.container.querySelector('img');
    Object.defineProperty(img, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        width: 1000,
        height: 1000,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 1000,
        x: 0,
        y: 0,
      }),
    });
    loadImage(img, { w: 1000, h: 1000 });
    // Confidence squares depend on the measured rendered size (set on load).
    await waitFor(() =>
      expect(
        utils.container.querySelectorAll('[data-testid^="confidence-square-"]')
          .length
      ).toBeGreaterThan(0)
    );
    return utils;
  }

  test('with editableTableId set, only the matching table renders confidence squares', async () => {
    const { container } = await renderOverlay({ editableTableId: 'tbl-alpha' });
    expect(
      container.querySelectorAll('[data-testid^="confidence-square-tbl-alpha"]')
        .length
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-testid^="confidence-square-tbl-beta"]')
        .length
    ).toBe(0);
  });

  test('with editableTableId set, header markers appear only on the matching table', async () => {
    const { container } = await renderOverlay({ editableTableId: 'tbl-alpha' });
    expect(
      container.querySelectorAll('[data-testid^="header-marker-tbl-alpha"]')
        .length
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-testid^="header-marker-tbl-beta"]')
        .length
    ).toBe(0);
  });

  test('with editableTableId set, clicking inside a non-target table opens no cell editor', async () => {
    const { container } = await renderOverlay({ editableTableId: 'tbl-alpha' });
    const svg = container.querySelector('svg');
    // Centre of the NON-target table Beta (viewbox 500..700 x 500..700) -> (600, 600).
    fireEvent.click(svg, { clientX: 600, clientY: 600 });
    expect(screen.queryByTestId('cell-editor')).toBeNull();
    // Centre of the TARGET table Alpha (viewbox 0..200 x 0..200) -> (100, 100).
    fireEvent.click(svg, { clientX: 100, clientY: 100 });
    expect(await screen.findByTestId('cell-editor')).toBeInTheDocument();
  });

  test('with editableTableId omitted, all non-deleted non-saved-grid tables stay editable', async () => {
    const { container } = await renderOverlay();
    expect(
      container.querySelectorAll('[data-testid^="confidence-square-tbl-alpha"]')
        .length
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-testid^="confidence-square-tbl-beta"]')
        .length
    ).toBeGreaterThan(0);
    // Clicking inside Beta (previously the restricted one) opens the editor.
    const svg = container.querySelector('svg');
    fireEvent.click(svg, { clientX: 600, clientY: 600 });
    expect(await screen.findByTestId('cell-editor')).toBeInTheDocument();
  });
});

// ---- Task 14: host page-nav, selection defaulting, change-tracking, recalc-on-page-change
//
// These tests drive the HOST's logic in isolation via a stand-in PageTableEditor
// (global.__PTE_MOCK__) that exposes the nav/selection/change props the host supplies as
// simple controls. The staged editor's own internals are covered by its own suite.
describe('PDFEditTableStructure — Task 14 host nav / selection / change-tracking', () => {
  // A stand-in for PageTableEditor: renders the host-supplied nav/selection state and buttons
  // that invoke the host callbacks. The edit buttons call onChange with the host's own table
  // list mutated in the ways the change tracker classifies (boundary move, title change).
  function MockPageTableEditor(props) {
    const {
      metadata,
      onChange,
      onPrevPage,
      onNextPage,
      onColouredAreasChange,
      selectedTableId,
      hasPrevPage,
      hasNextPage,
    } = props;
    const addColour = () =>
      onColouredAreasChange(0, [
        {
          left: 0.1,
          top: 0.1,
          width: 0.2,
          height: 0.1,
          foreground: '#000000',
          background: '#ffff00',
        },
      ]);
    const moveBoundary = () =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target'
            ? { ...t, bounds: { ...t.bounds, left: t.bounds.left + 0.05 } }
            : t
        )
      );
    const changeTitle = () =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target'
            ? {
                ...t,
                title: {
                  bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.05 },
                  text: 'My Title',
                  confidence: 88,
                },
              }
            : t
        )
      );
    // A Special-Areas-ONLY edit: a new sub-title row, touching nothing else — no bounds, no
    // grid lines, no title. Adding one creates a rectangle whose text has never been read.
    const addSectionTitle = () =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target'
            ? {
                ...t,
                sectionTitles: [
                  {
                    tableRow: 1,
                    delete: false,
                    columnName: null,
                    data: {
                      bounds: { left: 0.1, top: 0.15, width: 0.2, height: 0.04 },
                      text: '',
                      confidence: 0,
                    },
                  },
                ],
              }
            : t
        )
      );
    // Another Special-Areas-only edit, this one producing no new rectangle at all.
    const bumpHeaderCount = () =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target'
            ? { ...t, headerCount: (t.headerCount ?? 0) + 1 }
            : t
        )
      );
    const changeTitle2 = () =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target'
            ? {
                ...t,
                title: {
                  bounds: { left: 0.2, top: 0.2, width: 0.3, height: 0.06 },
                  text: 'Manual Edit',
                  confidence: 91,
                },
              }
            : t
        )
      );
    // The real Special Areas tick (LayersPanel.handleToggleTick) does TWO things in ONE
    // event: it reports the confirmationStage advance up through onChange, and then invokes
    // the Next action. Both halves must happen in a single click to reproduce the real
    // sequence — the recalculation is launched from a render that has not yet seen the
    // stage write.
    const confirmSpecial = () => {
      onChange(
        metadata.tables.map((t) =>
          t.tableId === 'edit-target' ? { ...t, confirmationStage: 5 } : t
        )
      );
      onNextPage();
    };
    return (
      <div data-testid={'mock-pte'}>
        <div data-testid={'mock-selected'}>{selectedTableId ?? 'none'}</div>
        <div data-testid={'mock-hasprev'}>{String(hasPrevPage)}</div>
        <div data-testid={'mock-hasnext'}>{String(hasNextPage)}</div>
        <button data-testid={'mock-prev'} onClick={onPrevPage}>
          {'prev'}
        </button>
        <button data-testid={'mock-next'} onClick={onNextPage}>
          {'next'}
        </button>
        <button data-testid={'mock-move'} onClick={moveBoundary}>
          {'move'}
        </button>
        <button data-testid={'mock-title'} onClick={changeTitle}>
          {'title'}
        </button>
        <button data-testid={'mock-title-2'} onClick={changeTitle2}>
          {'title2'}
        </button>
        <button data-testid={'mock-add-colour'} onClick={addColour}>
          {'add-colour'}
        </button>
        <button data-testid={'mock-section-title'} onClick={addSectionTitle}>
          {'section-title'}
        </button>
        <button data-testid={'mock-header-count'} onClick={bumpHeaderCount}>
          {'header-count'}
        </button>
        <button data-testid={'mock-confirm-special'} onClick={confirmSpecial}>
          {'confirm-special'}
        </button>
      </div>
    );
  }

  // edit-target (multi-cell) on page 0; beta on page 1. tableInPage set so a find-tables
  // response can be matched back.
  const NAV_METADATA = {
    name: 'nav.pdf',
    tables: [
      {
        tableId: 'edit-target',
        name: 'Alpha',
        pdfPage: 0,
        tableInPage: 0,
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
      },
      {
        tableId: 'beta',
        name: 'Beta',
        pdfPage: 1,
        tableInPage: 0,
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [{ value: 0.2, confidence: 90 }],
      },
    ],
    pages: [
      { page: 0, width: 1, height: 1, tables: [{ tableId: 'a' }] },
      { page: 1, width: 1, height: 1, tables: [{ tableId: 'b' }] },
    ],
  };

  beforeEach(() => {
    global.__PTE_MOCK__ = MockPageTableEditor;
    getMetadata.mockResolvedValue(NAV_METADATA);
    // These tests exercise staged-editor host behaviour (first-class selection,
    // change-tracking, recalc-on-page-change), so run with the flag on.
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    global.__PTE_MOCK__ = null;
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(false);
  });

  async function renderNav({ pageCount = 2 } = {}) {
    getThumbnails.mockResolvedValue({
      images: Array.from({ length: pageCount }, (_v, i) => ({
        image: `T${i}`,
        tables: [],
      })),
    });
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await screen.findByTestId('mock-pte');
  }

  test('hasPrevPage/hasNextPage are computed at first, middle and last pages', async () => {
    await renderNav({ pageCount: 3 });

    // First page: no previous, has next.
    await waitFor(() =>
      expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('false')
    );
    expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('true');

    // Middle page.
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('true')
    );
    expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('true');

    // Last page: has previous, no next.
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('false')
    );
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('true');
  });

  test('Next on the last page shows "End of list" and does not change the page', async () => {
    await renderNav({ pageCount: 2 });
    // Move to the last page (index 1).
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('false')
    );

    await userEvent.click(screen.getByTestId('mock-next'));
    expect(toast).toHaveBeenCalledWith('End of list');
    // Still on the last page.
    expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('false');
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('true');
  });

  test('Prev on the first page shows "Start of list" and does not change the page', async () => {
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('false')
    );

    await userEvent.click(screen.getByTestId('mock-prev'));
    expect(toast).toHaveBeenCalledWith('Start of list');
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('false');
  });

  test('the selected table defaults to the first table on the page, updating on page change', async () => {
    await renderNav({ pageCount: 2 });
    // Page 0: first non-deleted table is edit-target.
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // Next -> page 1: first table there is beta.
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
  });

  // ---- Document Overview entries select the table they name ---------------------------

  const entryFor = (name) =>
    screen
      .getAllByTestId('table-entry')
      .find((entry) => within(entry).queryByText(name) !== null);

  test('clicking an entry on the displayed page selects that table', async () => {
    const [root, other] = NAV_METADATA.tables;
    getMetadata.mockResolvedValue({
      ...NAV_METADATA,
      // Both on page 0, so selecting the second one moves no page.
      tables: [root, { ...other, pdfPage: 0, tableInPage: 1 }],
    });

    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(entryFor('Beta'));

    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
    // Still page 0: no page to move to.
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('false');
  });

  test('clicking an entry on another page moves the page with the selection', async () => {
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(entryFor('Beta'));

    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
    // Beta is on page 1, so the page moved with it.
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('true');
    expect(screen.getByTestId('mock-hasnext')).toHaveTextContent('false');
  });

  test('clicking the name selects the table as well as starting the rename', async () => {
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(within(entryFor('Beta')).getByTestId('table-entry-name'));

    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
    expect(screen.getByRole('textbox')).toHaveValue('Beta');
  });

  // The row's own buttons keep their actions: the click never reaches the entry.
  test('clicking a row button does not select its table', async () => {
    const [root, other] = NAV_METADATA.tables;
    getMetadata.mockResolvedValue({
      ...NAV_METADATA,
      tables: [
        root,
        { ...other, confirmationStage: confirmedTableStage() },
      ],
    });

    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(within(entryFor('Beta')).getByTestId('mark-ready'));

    // Mark Ready did its job, and the selection and the page stayed where they were.
    expect(screen.getByTestId('mock-selected')).toHaveTextContent('edit-target');
    expect(screen.getByTestId('mock-hasprev')).toHaveTextContent('false');
  });

  // A saved link grid moves the joined tables off the top-level list. A page holding only
  // joined tables still has tables on it, and landing there must select the first of them
  // rather than leaving the page with nothing selected.
  test('a page whose only table is joined under another still defaults to that table', async () => {
    const [root, joined] = NAV_METADATA.tables;
    getMetadata.mockResolvedValue({
      ...NAV_METADATA,
      tables: [
        {
          ...root,
          grid: [[root.tableId, joined.tableId]],
          next: { [joined.tableId]: joined },
        },
      ],
    });

    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
  });

  test('editing a boundary adds the table to the change set; a page change recalculates it first, then clears the set', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [] });
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // Editing does not itself call calculate-cells.
    await userEvent.click(screen.getByTestId('mock-move'));
    expect(calculateCells).not.toHaveBeenCalled();

    // Next with a non-empty change set: recalc runs for the changed table first.
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
    const [sentPdfId, sentPage, , sentTables] = calculateCells.mock.calls[0];
    expect(sentPdfId).toBe(PDF_ID);
    expect(sentPage).toBe(0);
    expect(sentTables).toHaveLength(1);
    // The request identifies its table by tableInPage; it carries no name.
    expect(sentTables[0].tableInPage).toBe(0);

    // The page advanced to page 1.
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );

    // The change set was cleared: a further Prev back to page 0 makes no new call.
    await userEvent.click(screen.getByTestId('mock-prev'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );
    expect(calculateCells).toHaveBeenCalledTimes(1);
  });

  test('a page change backgrounds the recalculation: the page advances immediately without waiting for calculate-cells', async () => {
    // calculate-cells stays pending for the duration of the assertions.
    let resolveCalc;
    calculateCells.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCalc = () => res({ pdfPage: 0, tables: [] });
        })
    );
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // Edit so there is something to recalculate, then click Next.
    await userEvent.click(screen.getByTestId('mock-move'));
    await userEvent.click(screen.getByTestId('mock-next'));

    // calculate-cells has been triggered but is still pending (unresolved)...
    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
    // ...yet the page has ALREADY advanced to page 1 (beta) without awaiting it.
    expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta');

    // Resolve the pending background call so it does not leak past the test.
    await act(async () => {
      resolveCalc();
    });
  });

  // A calculate-cells response table: text and confidence only. The endpoint takes every
  // rectangle it was handed as correct, so it returns NO geometry — the title comes back
  // without bounds and the local ones are kept.
  const READ_ALPHA = {
    tableInPage: 0,
    cells: [],
    title: { text: 'Returned Title', confidence: 77 },
  };

  test('the request carries the edited title rectangle and a returned title is written back keeping its bounds', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [READ_ALPHA] });
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(screen.getByTestId('mock-title'));
    await userEvent.click(screen.getByTestId('mock-next'));

    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
    // The request table carries the (edited) title's RECTANGLE to read, not its text.
    const requestTable = calculateCells.mock.calls[0][3][0];
    expect(requestTable.title).toEqual({
      left: 0.1,
      top: 0.1,
      width: 0.2,
      height: 0.05,
    });

    // The returned title text is written back onto the existing bounds: a subsequent Save
    // sends it on the local table.
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );
    const save = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sentTables = saveTables.mock.calls[0][1];
    const savedTarget = sentTables.find((t) => t.tableId === 'edit-target');
    expect(savedTarget.title.text).toBe('Returned Title');
    expect(savedTarget.title.bounds).toEqual({
      left: 0.1,
      top: 0.1,
      width: 0.2,
      height: 0.05,
    });
  });

  // The Special Areas tick is now itself a recalculation trigger: it advances the table's
  // confirmationStage through onChange and then performs the Next action, both in one event.
  // The recalculation is therefore launched from a render that predates the stage write, so
  // its launch snapshot differs from the live table by that one field. The staleness guard
  // exists to protect USER edits made while the call was in flight; a confirmationStage
  // advance is not a user edit of any read-back field, so it must not discard the response.
  test('a title read by the recalculation survives the Special Areas tick that triggered it', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [READ_ALPHA] });
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // Give the table a title rectangle, then confirm Special Areas — which advances the
    // stage and navigates in the same event, exactly as the Layers panel now does.
    await userEvent.click(screen.getByTestId('mock-title'));
    await userEvent.click(screen.getByTestId('mock-confirm-special'));

    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );

    const save = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const sentTables = saveTables.mock.calls[0][1];
    const savedTarget = sentTables.find((t) => t.tableId === 'edit-target');
    // The text the recalculation read, not the pre-call placeholder.
    expect(savedTarget.title.text).toBe('Returned Title');
    // The stage advance that triggered the call is still there.
    expect(savedTarget.confirmationStage).toBe(5);
  });

  // The Special Areas layer owns the title, the header count, the sub-title rows and the
  // footer. Three of those four are rectangles calculate-cells reads, so an edit confined to
  // that layer still needs a re-read on leaving the page — adding a sub-title row in
  // particular creates a rectangle whose text has never been read at all.
  test('a Special-Areas-only edit still triggers the recalculation', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [] });
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // A sub-title row and nothing else: no bounds move, no grid-line move, no title change.
    await userEvent.click(screen.getByTestId('mock-section-title'));
    await userEvent.click(screen.getByTestId('mock-next'));

    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
    // …and the new sub-title row's rectangle is in the request, so its text gets read.
    const requestTable = calculateCells.mock.calls[0][3][0];
    expect(requestTable.specials).toEqual([
      { left: 0.1, top: 0.15, width: 0.2, height: 0.04 },
    ]);
  });

  test('a header-count-only edit also triggers it', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [] });
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    await userEvent.click(screen.getByTestId('mock-header-count'));
    await userEvent.click(screen.getByTestId('mock-next'));

    // headerCount produces no rectangle of its own, so this call reads nothing new. It fires
    // anyway: "the Special Areas layer was edited" is one rule, and carving out the one field
    // that happens to add no rectangle would be a subtlety with no benefit — the call is
    // backgrounded and costs the user nothing.
    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));
  });

  test('the backgrounded recalc does not clobber a title the user re-edited after it launched', async () => {
    // Hold calculate-cells pending so the title can be re-edited before it resolves.
    let resolveCalc;
    calculateCells.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCalc = () => res({ pdfPage: 0, tables: [READ_ALPHA] });
        })
    );
    await renderNav({ pageCount: 2 });
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent(
        'edit-target'
      )
    );

    // Edit the title, then Next: the background recalc launches with 'My Title'.
    await userEvent.click(screen.getByTestId('mock-title'));
    await userEvent.click(screen.getByTestId('mock-next'));
    await waitFor(() => expect(calculateCells).toHaveBeenCalledTimes(1));

    // Before the recalc resolves, the user re-edits the same table's title.
    await userEvent.click(screen.getByTestId('mock-title-2'));

    // The stale recalc resolves — it must NOT overwrite the newer manual title.
    await act(async () => {
      resolveCalc();
    });

    const save = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const savedTarget = saveTables.mock.calls[0][1].find(
      (t) => t.tableId === 'edit-target'
    );
    expect(savedTarget.title).toEqual(
      expect.objectContaining({ text: 'Manual Edit' })
    );
  });

  test('editing a page coloured area enables Save (marks dirty)', async () => {
    await renderNav({ pageCount: 2 });
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByTestId('mock-add-colour'));
    await waitFor(() => expect(save).toBeEnabled());
  });

  test('Save sends the edited page coloured areas in the request', async () => {
    await renderNav({ pageCount: 2 });
    await userEvent.click(screen.getByTestId('mock-add-colour'));
    const save = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const colouredAreas = saveTables.mock.calls[0][2];
    expect(colouredAreas).toEqual([
      {
        pdfPage: 0,
        colouredAreas: [
          expect.objectContaining({
            background: '#ffff00',
            foreground: '#000000',
          }),
        ],
      },
    ]);
  });
});

// ---- Task 11: recalculation triggers, richer hints and full replacement ------------------
//
// Same approach as the Task 14 block above — the host's logic is driven through the props it
// hands the centre panel via a stand-in PageTableEditor — plus the REAL right-column
// thumbnails, because a thumbnail click is now itself a recalculation trigger.
describe('PDFEditTableStructure — Task 11 recalculation triggers, hints and replacement', () => {
  // Distinct per-page coloured areas so a hint proves it carries the areas of the page being
  // RECALCULATED, not of the page navigated to.
  const PAGE0_AREA = {
    left: 0.1,
    top: 0.1,
    width: 0.2,
    height: 0.1,
    foreground: '#000000',
    background: '#ffff00',
  };
  const PAGE1_AREA = {
    left: 0.4,
    top: 0.4,
    width: 0.1,
    height: 0.1,
    foreground: '#111111',
    background: '#00ff00',
  };

  // t-a and t-b are multi-cell tables on page 0 (the Recalculate hint shape), t-d is a 1×1
  // border-only table on the same page (the Calculate hint shape) and t-c sits on page 1.
  // tableInPage is set on each so a response can be matched back to it.
  const RECALC_METADATA = {
    name: 'recalc.pdf',
    tables: [
      {
        tableId: 't-a',
        name: 'Alpha',
        pdfPage: 0,
        tableInPage: 0,
        // Partway through the layers: the recalculation must not reset this.
        confirmationStage: 3,
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        title: {
          bounds: { left: 0.1, top: 0.05, width: 0.2, height: 0.04 },
          text: 'Alpha Title',
          confidence: 60,
        },
      },
      {
        tableId: 't-b',
        name: 'Bravo',
        pdfPage: 0,
        tableInPage: 1,
        bounds: { left: 0.5, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
      },
      {
        tableId: 't-d',
        name: 'Delta',
        pdfPage: 0,
        tableInPage: 2,
        // Partway through the layers, like t-a: a wholesale replacement must not reset it.
        confirmationStage: 3,
        bounds: { left: 0.1, top: 0.6, width: 0.2, height: 0.1 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [{ value: 0.1, confidence: 90 }],
      },
      {
        tableId: 't-c',
        name: 'Charlie',
        pdfPage: 1,
        tableInPage: 0,
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
        rowHeights: [
          { value: 0.1, confidence: 90 },
          { value: 0.1, confidence: 90 },
        ],
      },
    ],
    pages: [
      {
        page: 0,
        width: 1,
        height: 1,
        tables: [{ tableId: 'a' }],
        colouredAreas: [PAGE0_AREA],
      },
      {
        page: 1,
        width: 1,
        height: 1,
        tables: [{ tableId: 'c' }],
        colouredAreas: [PAGE1_AREA],
      },
    ],
  };

  // What calculate-cells ACTUALLY sends back for a table: text and confidence, keyed by
  // (row, column). Every rectangle it was handed is taken as correct, so it detects nothing
  // and moves nothing — there are deliberately no bounds, no columnWidths and no rowHeights
  // here, and a returned title carries no bounds either. Writing a fixture with geometry
  // would be writing a response the endpoint cannot produce.
  function readAlpha(overrides = {}) {
    return {
      tableInPage: 0,
      cells: [{ row: 0, column: 0, text: 'Fresh', confidence: 95 }],
      ...overrides,
    };
  }

  // A stand-in for PageTableEditor exposing only the channels this task exercises: page nav,
  // the hover-vs-select distinction, a per-table boundary edit, and the expected-count map
  // the real component reports up from its transient Borders-layer fields.
  function MockPageTableEditor(props) {
    const {
      metadata,
      onChange,
      onPrevPage,
      onNextPage,
      onHoverTable,
      onSelectTable,
      selectedTableId,
      onExpectedCountsMapChange,
    } = props;
    // A boundary move — what the host's change tracker classifies as a change.
    const move = (tableId) =>
      onChange(
        metadata.tables.map((t) =>
          t.tableId === tableId
            ? { ...t, bounds: { ...t.bounds, left: t.bounds.left + 0.05 } }
            : t
        )
      );
    return (
      <div data-testid={'mock-pte'}>
        <div data-testid={'mock-selected'}>{selectedTableId ?? 'none'}</div>
        <button data-testid={'mock-prev'} onClick={onPrevPage}>
          {'prev'}
        </button>
        <button data-testid={'mock-next'} onClick={onNextPage}>
          {'next'}
        </button>
        <button data-testid={'mock-move-a'} onClick={() => move('t-a')}>
          {'move-a'}
        </button>
        <button data-testid={'mock-move-b'} onClick={() => move('t-b')}>
          {'move-b'}
        </button>
        <button data-testid={'mock-move-c'} onClick={() => move('t-c')}>
          {'move-c'}
        </button>
        <button data-testid={'mock-move-d'} onClick={() => move('t-d')}>
          {'move-d'}
        </button>
        <button
          data-testid={'mock-hover'}
          onMouseEnter={() => onHoverTable('t-b')}
          onClick={() => onHoverTable('t-b')}
        >
          {'hover'}
        </button>
        <button data-testid={'mock-select'} onClick={() => onSelectTable('t-b')}>
          {'select'}
        </button>
        <button
          data-testid={'mock-counts'}
          onClick={() =>
            onExpectedCountsMapChange({
              't-a': { expectedColumns: '4', expectedRows: '' },
              't-d': { expectedColumns: '', expectedRows: '9' },
            })
          }
        >
          {'counts'}
        </button>
      </div>
    );
  }

  beforeEach(() => {
    global.__PTE_MOCK__ = MockPageTableEditor;
    getMetadata.mockResolvedValue(RECALC_METADATA);
    getThumbnails.mockResolvedValue({
      images: [
        { image: 'T0', tables: [] },
        { image: 'T1', tables: [] },
      ],
    });
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [] });
    // Host recalculation-on-page-change is staged-editor behaviour, so run with the flag on.
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    global.__PTE_MOCK__ = null;
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(false);
  });

  async function renderRecalc() {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await screen.findByTestId('mock-pte');
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-a')
    );
  }

  // Click a control and let whatever promise the click starts settle INSIDE the act scope, so
  // the backgrounded recalculation's write-back is never an unwrapped update. A promise the
  // test deliberately holds pending is unaffected: act only flushes what is already
  // resolvable.
  // eslint-disable-next-line
  async function clickAndSettle(el) {
    await act(async () => {
      fireEvent.click(el);
    });
  }

  // Resolve a held calculate-cells promise and flush its write-back inside act.
  // eslint-disable-next-line
  async function settle(resolveCalc) {
    await act(async () => {
      resolveCalc();
    });
  }

  const thumbnail = (index) => screen.getAllByTestId('thumbnail')[index];
  const saveButton = () => screen.getByRole('button', { name: /save/i });

  // The request tables of the single calculate-cells call, by tableInPage — the only identity
  // the request carries (it has no `name`).
  const requestFor = (tableInPage) =>
    calculateCells.mock.calls[0][3].find((r) => r.tableInPage === tableInPage);

  test('clicking a thumbnail recalculates every changed table on the page being left, and moves the page', async () => {
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-move-b'));
    expect(calculateCells).not.toHaveBeenCalled();

    await clickAndSettle(thumbnail(1));

    expect(calculateCells).toHaveBeenCalledTimes(1);
    // The recalculation reads text: find-tables (a DETECTOR) is never involved.
    expect(findTables).not.toHaveBeenCalled();
    const [sentPdfId, sentPage, , sentTables] = calculateCells.mock.calls[0];
    expect(sentPdfId).toBe(PDF_ID);
    expect(sentPage).toBe(0);
    // BOTH changed tables on the page being left, not just the selected one.
    expect(sentTables.map((r) => r.tableInPage).sort()).toEqual([0, 1]);

    // The page moved: page 1's first table is now the default selection.
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-c')
    );
  });

  test('clicking a thumbnail when nothing has changed makes no calculate-cells call', async () => {
    await renderRecalc();

    await clickAndSettle(thumbnail(1));

    expect(calculateCells).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-c')
    );
  });

  test('the request carries one table per changed table with its cells, and the page coloured areas', async () => {
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-move-d'));
    await clickAndSettle(screen.getByTestId('mock-next'));

    expect(calculateCells).toHaveBeenCalledTimes(1);
    const [, , sentAreas, sentTables] = calculateCells.mock.calls[0];
    // Page 0's areas travel as the ONE page-level argument — never page 1's, and never
    // per-table.
    expect(sentAreas).toEqual([PAGE0_AREA]);
    expect(sentTables).toHaveLength(2);
    for (const requestTable of sentTables) {
      expect(requestTable).not.toHaveProperty('colouredAreas');
    }

    // t-a is 2×2, so its four filled grid cells are all listed with their own rectangles.
    const alpha = requestFor(0);
    expect(alpha.cells).toHaveLength(4);
    expect(alpha.cells.map((c) => `${c.row},${c.column}`).sort()).toEqual([
      '0,0',
      '0,1',
      '1,0',
      '1,1',
    ]);
    expect(alpha.cells[0]).toEqual(
      expect.objectContaining({ left: expect.any(Number), width: expect.any(Number) })
    );
    // t-d is the 1×1 border table: one cell, and no expected counts (the endpoint detects
    // nothing, so there is nothing for a count to steer).
    const delta = requestFor(2);
    expect(delta.cells).toHaveLength(1);
    expect(delta).not.toHaveProperty('expectedColumns');
    expect(delta).not.toHaveProperty('expectedRows');
  });

  test('Previous and Next still recalculate the page being left', async () => {
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));

    expect(calculateCells).toHaveBeenCalledTimes(1);
    expect(calculateCells.mock.calls[0][1]).toBe(0);

    // Now on page 1: edit its table and go back — the page being LEFT is page 1.
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-c')
    );
    await clickAndSettle(screen.getByTestId('mock-move-c'));
    await clickAndSettle(screen.getByTestId('mock-prev'));

    expect(calculateCells).toHaveBeenCalledTimes(2);
    const [, secondPage, secondAreas, secondTables] =
      calculateCells.mock.calls[1];
    expect(secondPage).toBe(1);
    expect(secondAreas).toEqual([PAGE1_AREA]);
    expect(secondTables).toHaveLength(1); // just t-c
  });

  test('hovering a table does NOT trigger a recalculation', async () => {
    await renderRecalc();
    await clickAndSettle(screen.getByTestId('mock-move-a'));

    // Hover reports a table up (it drives the left-list highlight) — it must never launch a
    // request; a mouse sweep across the page would otherwise fire one per table.
    fireEvent.mouseEnter(screen.getByTestId('mock-hover'));
    await clickAndSettle(screen.getByTestId('mock-hover'));
    await clickAndSettle(screen.getByTestId('mock-select'));
    expect(calculateCells).not.toHaveBeenCalled();

    // The change set is still intact, so a real trigger recalculates it.
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);
  });

  test('the transient expected counts never reach the request: calculate-cells detects nothing', async () => {
    await renderRecalc();

    // The centre panel reports its transient expected-count hints up (a column count for t-a,
    // a row count for t-d). They steer grid DETECTION, and a text read detects nothing, so
    // they have no place in this request.
    await clickAndSettle(screen.getByTestId('mock-counts'));
    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-move-d'));
    await clickAndSettle(screen.getByTestId('mock-next'));

    expect(calculateCells).toHaveBeenCalledTimes(1);
    for (const requestTable of calculateCells.mock.calls[0][3]) {
      expect(requestTable).not.toHaveProperty('expectedColumns');
      expect(requestTable).not.toHaveProperty('expectedRows');
    }
  });

  // A border-only (1×1) table used to be hinted without cells, which routed find-tables to
  // full grid detection and had its whole result adopted — name, geometry and all. A text read
  // has nothing to adopt: the table keeps everything it had and gains only the read text.
  test('a border-only table is no longer replaced wholesale: it keeps its name and geometry', async () => {
    calculateCells.mockResolvedValue({
      pdfPage: 0,
      tables: [readAlpha({ tableInPage: 2 })], // t-d's tableInPage
    });
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-d'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const sent = saveTables.mock.calls[0][1];
    const target = sent.find((t) => t.tableId === 't-d');
    expect(target.name).toBe('Delta');
    // The user's own edited border (left moved 0.1 -> 0.15) stands.
    expect(target.bounds.left).toBeCloseTo(0.15);
    expect(target.bounds.width).toBeCloseTo(0.2);
    expect(target.columnWidths).toHaveLength(1);
    expect(target.rowHeights).toHaveLength(1);
    // Only the text landed.
    expect(target.cells.find((c) => c.row === 0 && c.column === 0).text).toBe(
      'Fresh'
    );
    // Untouched neighbours are unaffected.
    expect(sent.find((t) => t.tableId === 't-b').name).toBe('Bravo');
  });

  // THE regression this whole change exists to prevent: the old cell-bearing find-tables hint
  // came back with no grid geometry, and adopting such a result wholesale removed the table's
  // grid lines. calculate-cells returns no geometry either — but nothing on the response side
  // is ever adopted, so there is no path by which the grid can be lost.
  test('a multi-cell table keeps its columnWidths/rowHeights and gains the returned cell text', async () => {
    calculateCells.mockResolvedValue({ pdfPage: 0, tables: [readAlpha()] });
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-a');
    // The grid survived: 2 columns and 2 rows, as the editor held them.
    expect(target.columnWidths).toHaveLength(2);
    expect(target.rowHeights).toHaveLength(2);
    expect(target.columnWidths[0].value).toBeCloseTo(0.1);
    // The re-read cell landed, matched by (row, column).
    expect(target.cells.find((c) => c.row === 0 && c.column === 0).text).toBe(
      'Fresh'
    );
    // The editor's own fields are untouched by a cell merge.
    expect(target.name).toBe('Alpha');
    expect(target.confirmationStage).toBe(3);
  });

  // The response's title carries text and confidence only, so the local bounds are the ones
  // that survive — the write-back has no other bounds to use.
  test('a returned title updates the text and keeps the local bounds', async () => {
    calculateCells.mockResolvedValue({
      pdfPage: 0,
      tables: [readAlpha({ title: { text: 'Read Title', confidence: 88 } })],
    });
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-a');
    expect(target.title.text).toBe('Read Title');
    expect(target.title.bounds).toEqual({
      left: 0.1,
      top: 0.05,
      width: 0.2,
      height: 0.04,
    });
    expect(target.columnWidths).toHaveLength(2);
  });

  // confirmationStage is the editor's own record of how far the user has taken a table
  // through the layers; the back end has no concept of it. Because the value is persisted by
  // Save, a write-back that reset it would write that reset to the metadata.
  test('confirmationStage survives the write-back, and Save persists it', async () => {
    calculateCells.mockResolvedValue({
      pdfPage: 0,
      tables: [readAlpha({ tableInPage: 2 })], // t-d's tableInPage
    });
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-d'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-d');
    // The text landed…
    expect(target.cells.find((c) => c.row === 0 && c.column === 0).text).toBe(
      'Fresh'
    );
    // …and the stage the editor owns survived it.
    expect(target.confirmationStage).toBe(3);
  });

  test('a returned table whose tableInPage matches nothing changes nothing', async () => {
    calculateCells.mockResolvedValue({
      pdfPage: 0,
      tables: [readAlpha({ tableInPage: 7 })],
    });
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-a');
    // Still the user's own edited table (left moved 0.1 -> 0.15), untouched by the response.
    expect(target.name).toBe('Alpha');
    expect(target.bounds.left).toBeCloseTo(0.15);
    expect(target.title.text).toBe('Alpha Title');
    expect(target.cells.every((c) => c.text !== 'Fresh')).toBe(true);
  });

  test('a table the user edited after the call was launched is left completely untouched', async () => {
    let resolveCalc;
    calculateCells.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCalc = () =>
            res({
              pdfPage: 0,
              tables: [readAlpha({ title: { text: 'Read Title', confidence: 88 } })],
            });
        })
    );
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);

    // The user edits the same table again while the call is in flight.
    await clickAndSettle(screen.getByTestId('mock-move-a'));

    // The now-stale response must not touch that table AT ALL — not its bounds, not its
    // cells, and not (partially) its title.
    await settle(resolveCalc);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));

    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-a');
    expect(target.name).toBe('Alpha');
    expect(target.bounds.left).toBeCloseTo(0.2);
    expect(target.bounds.width).toBeCloseTo(0.2);
    expect(target.title.text).toBe('Alpha Title');
    expect(target.cells.every((c) => c.text !== 'Fresh')).toBe(true);
  });

  test('dirty is set when the write-back changed something and not when the response changed nothing', async () => {
    let resolveCalc;
    calculateCells.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCalc = (tables) => res({ tables });
        })
    );
    await renderRecalc();

    // Edit, navigate (launching the call), then save while it is still in flight so the
    // document is CLEAN when the response lands.
    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));
    expect(calculateCells).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());

    // A response that matches nothing leaves the document clean.
    await settle(() => resolveCalc([readAlpha({ tableInPage: 7 })]));
    expect(saveButton()).toBeDisabled();

    // A response that does write text back dirties it again. We are on page 1 now, so edit
    // that page's table and navigate back — t-c is tableInPage 0 on page 1.
    await clickAndSettle(screen.getByTestId('mock-move-c'));
    await clickAndSettle(screen.getByTestId('mock-prev'));
    expect(calculateCells).toHaveBeenCalledTimes(2);
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    await settle(() => resolveCalc([readAlpha()]));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  test('a thumbnail click is not blocked by the call: the page moves before it resolves', async () => {
    let resolveCalc;
    calculateCells.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCalc = () => res({ pdfPage: 0, tables: [] });
        })
    );
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(thumbnail(1));

    // The call is in flight (unresolved)...
    expect(calculateCells).toHaveBeenCalledTimes(1);
    // ...yet the page has already moved to page 1.
    expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-c');

    await settle(resolveCalc);
  });

  test('a calculate-cells failure surfaces via toast.error and changes nothing', async () => {
    calculateCells.mockRejectedValue(new Error('read failed'));
    await renderRecalc();

    await clickAndSettle(screen.getByTestId('mock-move-a'));
    await clickAndSettle(screen.getByTestId('mock-next'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('read failed')
    );
    // The page still moved, and the user's own edit stands.
    expect(screen.getByTestId('mock-selected')).toHaveTextContent('t-c');
    await clickAndSettle(saveButton());
    await waitFor(() => expect(saveTables).toHaveBeenCalledTimes(1));
    const target = saveTables.mock.calls[0][1].find((t) => t.tableId === 't-a');
    expect(target.bounds.left).toBeCloseTo(0.15);
  });
});

// ---------------------------------------------------------------------------
// Task 16 — centre modes ('editor' | 'link' | 'review') and the Review action.
//
// The host shows one of three things: the page editor in the middle panel, or — as an overlay
// covering the whole editor — the grid editor (TableLinkageEditor) or the review panel. These
// tests drive the mode
// handling through a stand-in PageTableEditor and the mocked panels, so they cover the WIRING
// — which component is mounted, what props it gets, what returns to the editor — not the
// panels' internals.
describe('PDFEditTableStructure — Task 16 middle-panel modes and Review', () => {
  // Minimal stand-in for PageTableEditor: reports the page and selection it was given so the
  // tests can prove a panel mode neither changes the page nor loses the selection.
  function MockPageTableEditor({ page, selectedTableId }) {
    return (
      <div data-testid={'mock-pte'}>
        <div data-testid={'mock-page'}>{String(page)}</div>
        <div data-testid={'mock-selected'}>{selectedTableId ?? 'none'}</div>
      </div>
    );
  }

  // 'alpha' is at the ready stage, so its left-column row offers Review; 'beta' sits on page 1
  // and is only there to prove a mode change does not disturb the rest of the list.
  const MODE_METADATA = {
    name: 'modes.pdf',
    tables: [
      {
        tableId: 'alpha',
        name: 'Alpha',
        pdfPage: 0,
        tableInPage: 0,
        confirmationStage: readyTableStage(),
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [{ value: 0.2, confidence: 90 }],
      },
      {
        tableId: 'beta',
        name: 'Beta',
        pdfPage: 1,
        tableInPage: 0,
        bounds: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
        columnWidths: [{ value: 0.2, confidence: 90 }],
        rowHeights: [{ value: 0.2, confidence: 90 }],
      },
    ],
    pages: [
      { page: 0, width: 1, height: 1, tables: [{ tableId: 'alpha' }] },
      { page: 1, width: 1, height: 1, tables: [{ tableId: 'beta' }] },
    ],
  };

  beforeEach(() => {
    global.__PTE_MOCK__ = MockPageTableEditor;
    global.__LINK_SAVE_TABLES__ = null;
    global.__REVIEW_EDIT_TABLES__ = null;
    global.__REVIEW_PANEL_PROPS__ = null;
    getMetadata.mockResolvedValue(MODE_METADATA);
    getThumbnails.mockResolvedValue({
      images: [
        { image: 'T0', tables: [] },
        { image: 'T1', tables: [] },
      ],
    });
    saveTables.mockResolvedValue({});
    // Modes are a staged-editor behaviour (first-class selection), so run with the flag on.
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    global.__PTE_MOCK__ = null;
    global.__LINK_SAVE_TABLES__ = null;
    global.__REVIEW_EDIT_TABLES__ = null;
    global.__REVIEW_PANEL_PROPS__ = null;
    // eslint-disable-next-line global-require
    require('config').stagedGridEditorEnabled.mockReturnValue(false);
  });

  async function renderModes() {
    render(<PDFEditTableStructure pdfId={PDF_ID} />);
    await screen.findByTestId('mock-pte');
  }

  const linkButton = () => screen.getAllByTestId('link-table')[0];
  const reviewButton = () => screen.getByTestId('review-table');
  const saveButton = () => screen.getByRole('button', { name: /save/i });

  test('the link button shows the grid editor over the whole editor and unmounts the page editor', async () => {
    await renderModes();

    await userEvent.click(linkButton());

    const panel = await screen.findByTestId('link-dialog');
    expect(screen.queryByTestId('mock-pte')).not.toBeInTheDocument();
    // Placement, not just presence: the grid editor is a full-editor screen, so it is
    // drawn in the overlay that covers all three columns, not inside the middle one.
    expect(screen.getByTestId('full-panel')).toContainElement(panel);
    expect(screen.getByTestId('middle-panel')).not.toContainElement(panel);
  });

  test('the grid editor overlay leaves the left list and the thumbnails mounted', async () => {
    await renderModes();

    await userEvent.click(linkButton());
    await screen.findByTestId('link-dialog');

    // The three columns stay MOUNTED underneath the overlay, which is what keeps exiting
    // instant and the thumbnails un-refetched.
    expect(screen.getAllByTestId('table-entry')).toHaveLength(
      MODE_METADATA.tables.length
    );
    expect(screen.getAllByTestId('thumbnail')).toHaveLength(2);
  });

  test('the review panel is drawn over the whole editor, leaving the left list and thumbnails mounted', async () => {
    await renderModes();

    await userEvent.click(reviewButton());

    const panel = await screen.findByTestId('review-panel');
    expect(screen.getByTestId('full-panel')).toContainElement(panel);
    expect(screen.getByTestId('middle-panel')).not.toContainElement(panel);
    expect(screen.getAllByTestId('table-entry')).toHaveLength(
      MODE_METADATA.tables.length
    );
    expect(screen.getAllByTestId('thumbnail')).toHaveLength(2);
  });

  test("no full-editor overlay exists in 'editor' mode", async () => {
    await renderModes();

    expect(screen.queryByTestId('full-panel')).not.toBeInTheDocument();
  });

  test('the review panel is handed the host save path, the loaded filename and the All Files callback', async () => {
    const onAllFiles = jest.fn();
    render(<PDFEditTableStructure pdfId={PDF_ID} onAllFiles={onAllFiles} />);
    await screen.findByTestId('mock-pte');

    await userEvent.click(reviewButton());
    await screen.findByTestId('review-panel');

    const props = global.__REVIEW_PANEL_PROPS__;
    expect(props.originalFilename).toBe(MODE_METADATA.name);
    expect(props.onAllFiles).toBe(onAllFiles);
    // onSave is the host's own save: it PUTs the document and reports whether the server
    // was reached. Review already saved once, so this is the second call.
    let saved;
    // eslint-disable-next-line
    await act(async () => {
      saved = await props.onSave();
    });
    expect(saved).toBe(true);
    expect(saveTables).toHaveBeenCalledTimes(2);
  });

  test('Cancel in the grid editor returns to the page editor', async () => {
    await renderModes();

    await userEvent.click(linkButton());
    await screen.findByTestId('link-dialog');
    await userEvent.click(screen.getByTestId('link-dialog-cancel'));

    await screen.findByTestId('mock-pte');
    expect(screen.queryByTestId('link-dialog')).not.toBeInTheDocument();
  });

  test('Save in the grid editor commits the returned tables, dirties the document and returns to the editor', async () => {
    await renderModes();

    global.__LINK_SAVE_TABLES__ = MODE_METADATA.tables.map((t) =>
      t.tableId === 'alpha' ? { ...t, name: 'Linked Alpha' } : t
    );

    await userEvent.click(linkButton());
    await screen.findByTestId('link-dialog');
    await userEvent.click(screen.getByTestId('link-dialog-save'));

    await screen.findByTestId('mock-pte');
    expect(screen.queryByTestId('link-dialog')).not.toBeInTheDocument();
    // The commit reached the host's table list, and the document is dirty so Save enables.
    expect(screen.getByText('Linked Alpha')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  test('Review saves the document first, then shows the review panel for that table', async () => {
    await renderModes();

    await userEvent.click(reviewButton());

    const panel = await screen.findByTestId('review-panel');
    expect(saveTables).toHaveBeenCalledTimes(1);
    expect(saveTables.mock.calls[0][0]).toBe(PDF_ID);
    expect(panel).toHaveAttribute('data-tableid', 'alpha');
    expect(screen.getByTestId('full-panel')).toContainElement(panel);
    expect(screen.queryByTestId('mock-pte')).not.toBeInTheDocument();
  });

  test('the review panel is handed the live table list and the shared commit path', async () => {
    await renderModes();

    await userEvent.click(reviewButton());

    const panel = await screen.findByTestId('review-panel');
    // The whole local metadata list, not just the reviewed table: the panel resolves a
    // corrected cell's source through the root's linked children as well as the root itself.
    expect(panel).toHaveAttribute('data-tableids', 'alpha|beta');
    expect(screen.getByTestId('review-panel-edit')).toBeInTheDocument();
  });

  test('an edit committed from the review panel adopts the list and dirties the document', async () => {
    await renderModes();

    global.__REVIEW_EDIT_TABLES__ = MODE_METADATA.tables.map((t) =>
      t.tableId === 'alpha' ? { ...t, name: 'Corrected Alpha' } : t
    );

    await userEvent.click(reviewButton());
    await screen.findByTestId('review-panel');
    // Review saved first, so the document starts clean — the edit is what dirties it.
    expect(saveButton()).toBeDisabled();

    await userEvent.click(screen.getByTestId('review-panel-edit'));

    // Dirty, so the existing Save button is the single persistence point: the correction is
    // NOT written immediately.
    expect(saveButton()).toBeEnabled();
    expect(saveTables).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('review-panel-exit'));
    await screen.findByTestId('mock-pte');
    expect(screen.getByText('Corrected Alpha')).toBeInTheDocument();
  });

  test('a failed save leaves the page editor mounted and opens no review panel', async () => {
    saveTables.mockRejectedValue(new Error('save exploded'));
    await renderModes();

    await userEvent.click(reviewButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('save exploded')
    );
    expect(screen.queryByTestId('review-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-pte')).toBeInTheDocument();
  });

  test('Exit from the review panel returns to the page editor on the same page', async () => {
    await renderModes();

    await userEvent.click(reviewButton());
    await screen.findByTestId('review-panel');
    await userEvent.click(screen.getByTestId('review-panel-exit'));

    await screen.findByTestId('mock-pte');
    expect(screen.queryByTestId('review-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-page')).toHaveTextContent('0');
  });

  test('a thumbnail click does not change the page while a panel mode is active', async () => {
    await renderModes();

    await userEvent.click(reviewButton());
    await screen.findByTestId('review-panel');

    // Page 2's thumbnail: ignored while the review panel owns the middle panel.
    await userEvent.click(screen.getAllByTestId('thumbnail')[1]);
    await userEvent.click(screen.getByTestId('review-panel-exit'));

    await screen.findByTestId('mock-pte');
    expect(screen.getByTestId('mock-page')).toHaveTextContent('0');
  });

  test('returning from a panel preserves the selected page and the selected table', async () => {
    await renderModes();

    // Move to page 1 first, so the preserved page is not simply the initial one.
    await userEvent.click(screen.getAllByTestId('thumbnail')[1]);
    await waitFor(() =>
      expect(screen.getByTestId('mock-page')).toHaveTextContent('1')
    );
    await waitFor(() =>
      expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta')
    );

    await userEvent.click(linkButton());
    await screen.findByTestId('link-dialog');
    await userEvent.click(screen.getByTestId('link-dialog-cancel'));

    await screen.findByTestId('mock-pte');
    expect(screen.getByTestId('mock-page')).toHaveTextContent('1');
    expect(screen.getByTestId('mock-selected')).toHaveTextContent('beta');
  });
});
