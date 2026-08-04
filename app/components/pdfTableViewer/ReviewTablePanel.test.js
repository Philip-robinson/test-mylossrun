import { StrictMode } from 'react';
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewTablePanel from 'components/pdfTableViewer/ReviewTablePanel';
import { dialogPlacement } from 'components/pdfTableViewer/reviewEditUtils';
import { extractTable, getCellImages, tableToExcel } from 'services/images';
import toast from 'react-hot-toast';
// CellEditDialog and reviewEditUtils are REAL collaborators (the dialog is rendered by
// the panel, and both reach for the helpers): the point of the editing tests is that the
// panel, the dialog and the helpers agree about which source a cell names, which a mock
// would hide.
// Config is MOCKED, and every expectation below is derived by CALLING the mocked
// accessor rather than by naming a literal, so nothing here fails when a real
// constant changes. The threshold values are only ever inputs used to build a
// fixture confidence that sits in the intended band.
import {
  excelFileSuffix,
  highConfidence,
  lowConfidence,
  mediumConfidence,
  reviewCellBorderColour,
  reviewCellEditDialogWidthPx,
  reviewColumnMaxWidthPx,
  reviewEditedCellConfidence,
  reviewGutterHeightPx,
  reviewGutterWidthPx,
  reviewLowConfidenceBackgroundColour,
  reviewLowConfidenceBorderColour,
  reviewLowConfidenceMarkerWidthPx,
  reviewSelectedCellBackgroundColour,
  reviewSelectedCellBorderWidthPx,
  reviewSelectedCellPaddingPx,
  reviewSelectedCellRadiusPx,
  reviewSelectedCellShadow,
  reviewTitleLabel,
  reviewWideCellMinCharacters,
} from 'config';

jest.mock('services/images', () => ({
  extractTable: jest.fn(),
  getCellImages: jest.fn(),
  tableToExcel: jest.fn(),
}));

// Distinct sentinel colours so "which of the three border colours was chosen" is
// unambiguous; the real values happen to be distinct too, but a mock keeps the
// test independent of that. The dialog's own accessors are mocked here too, because
// the dialog is a real collaborator and reads them at render.
jest.mock('config', () => ({
  __esModule: true,
  lowConfidence: jest.fn(() => 50),
  mediumConfidence: jest.fn(() => 80),
  highConfidence: jest.fn(() => 90),
  reviewColumnMaxWidthPx: jest.fn(() => 250),
  reviewWideCellMinCharacters: jest.fn(() => 10),
  reviewLowConfidenceBorderColour: jest.fn(() => 'rgb(1, 0, 0)'),
  reviewLowConfidenceBackgroundColour: jest.fn(() => 'rgb(0, 2, 0)'),
  reviewLowConfidenceMarkerWidthPx: jest.fn(() => 4),
  reviewCellBorderColour: jest.fn(() => 'rgb(0, 0, 3)'),
  reviewSelectedCellBackgroundColour: jest.fn(() => 'rgb(0, 0, 5)'),
  reviewSelectedCellBorderWidthPx: jest.fn(() => 2),
  reviewSelectedCellRadiusPx: jest.fn(() => 6),
  reviewSelectedCellPaddingPx: jest.fn(() => 5),
  reviewSelectedCellShadow: jest.fn(() => '0 0 0 3px rgba(1, 2, 3, 0.15)'),
  cancelColour: jest.fn(() => 'rgb(9, 0, 0)'),
  confirmColour: jest.fn(() => 'rgb(0, 9, 0)'),
  reviewCellEditDialogWidthPx: jest.fn(() => 220),
  reviewCellEditRowCount: jest.fn(() => 4),
  maxCellEditorImageHeight: jest.fn(() => 66),
  reviewPoorCellSelectWidthPx: jest.fn(() => 111),
  reviewGutterWidthPx: jest.fn(() => 33),
  reviewGutterHeightPx: jest.fn(() => 17),
  reviewGutterBackgroundColour: jest.fn(() => 'rgb(0, 0, 7)'),
  reviewGutterBorderColour: jest.fn(() => 'rgb(0, 7, 0)'),
  // Deliberately not the real 'Title': the panel must take the title's name from config
  // rather than spell it out, and a sentinel is what proves it.
  reviewTitleLabel: jest.fn(() => 'Table title'),
  // Distinct from the real 100 so nothing can pass by coincidence, but still ABOVE the
  // sentinel high threshold — a corrected cell must stop counting towards the
  // below-high tally, and a sentinel below it would hide that.
  reviewEditedCellConfidence: jest.fn(() => 95),
  // Deliberately not the real '.xlsx': the download name has to be built from the accessor,
  // and a sentinel is what proves it. Read by exportUtils, a real collaborator here.
  excelFileSuffix: jest.fn(() => '.sentinel-xlsx'),
}));

// The <Toaster/> lives in the app layout, not in this component, so failures are
// asserted on the mocked toast calls rather than on rendered text.
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  return { __esModule: true, default: toast };
});

const bounds = (left, top, width, height) => ({ left, top, width, height });

// An amalgamated cell: a reference back to the source cell it was read from, plus
// the text and confidence read there.
const cell = (tableId, row, column, text, confidence) => ({
  tableId,
  row,
  column,
  text,
  confidence,
});

// An amalgamated section-title cell: discriminated structurally by carrying a
// sectionTitleIndex instead of a row/column.
const sectionCell = (tableId, sectionTitleIndex, text, confidence) => ({
  tableId,
  sectionTitleIndex,
  text,
  confidence,
});

// A position with no source at all — padding, or a column-name label. A blank
// tableId is the marker for "nothing in the metadata to write back to".
const sourceless = (text) => ({
  tableId: '',
  row: 0,
  column: 0,
  text,
  confidence: 0,
});

// One cell either side of highConfidence(), one exactly on it, and one sourceless
// position — which carries confidence 0 but is not a poor READING, since nothing ever
// read it.
const confidenceSpread = {
  name: 'root',
  headerCount: 0,
  cells: [
    [
      cell('root', 0, 0, 'poor', 10),
      cell('root', 0, 1, 'just poor', highConfidence() - 1),
      cell('root', 0, 2, 'high', highConfidence()),
      sourceless('pad'),
    ],
  ],
};

// Two header cells over two data cells, one of which is numeric.
const simpleTable = {
  name: 'root',
  title: null,
  headerCount: 1,
  cells: [
    [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
    [cell('root', 1, 0, 'ABC Ltd', 97), cell('root', 1, 1, '1,234.00', 97)],
  ],
};

// A merged table carrying one section title's value down two rows, under an
// appended column-name label that has no source of its own.
const sectionTitleTable = {
  name: 'root',
  title: null,
  headerCount: 1,
  cells: [
    [cell('root', 0, 0, 'Claim', 99), sourceless('Policy')],
    [cell('root', 1, 0, 'ABC Ltd', 97), sectionCell('root', 0, 'Section A', 88)],
    [cell('root', 2, 0, 'DEF Ltd', 97), sectionCell('root', 0, 'Section A', 88)],
  ],
};

// The bounds of the source table's title, distinct from every cell's, so a title crop
// requested against the wrong source value is visible.
const titleBounds = bounds(0.1, 0.05, 0.5, 0.04);

// The merged table's title as it now arrives on the wire: the table holding it, plus
// the text and confidence read there.
const amalgamatedTitle = (confidence) => ({
  tableId: 'root',
  text: 'Loss run 2024',
  confidence,
  bounds: titleBounds,
});

// The editor's locally held metadata: the source every reference above points at.
// Each value carries its own page-fraction bounds, so a wrong lookup produces a
// visibly wrong crop request.
const metadataTables = () => [
  {
    tableId: 'root',
    pdfPage: 2,
    title: {
      text: 'Loss run 2024',
      confidence: 40,
      bounds: titleBounds,
    },
    cells: [
      {
        row: 0,
        column: 0,
        text: 'Claim',
        confidence: 99,
        bounds: bounds(0.1, 0.2, 0.3, 0.04),
      },
      {
        row: 0,
        column: 1,
        text: 'Amount',
        confidence: 99,
        bounds: bounds(0.4, 0.2, 0.3, 0.04),
      },
      {
        row: 1,
        column: 0,
        text: 'ABC Ltd',
        confidence: 97,
        bounds: bounds(0.1, 0.3, 0.3, 0.05),
      },
      {
        row: 1,
        column: 1,
        text: '1,234.00',
        confidence: 97,
        bounds: bounds(0.4, 0.3, 0.3, 0.05),
      },
      {
        row: 2,
        column: 0,
        text: 'DEF Ltd',
        confidence: 97,
        bounds: bounds(0.1, 0.4, 0.3, 0.05),
      },
    ],
    sectionTitles: [
      {
        tableRow: 1,
        columnName: 'Policy',
        data: {
          text: 'Section A',
          confidence: 88,
          bounds: bounds(0.5, 0.6, 0.2, 0.03),
        },
      },
    ],
    next: {},
  },
];

const renderPanel = (props = {}) =>
  render(
    <ReviewTablePanel
      pdfId={'pdf-1'}
      tableId={'root'}
      tables={metadataTables()}
      onEditTables={jest.fn()}
      onExit={jest.fn()}
      {...props}
    />
  );

// The cells as rendered, keyed by their text — the fixtures use distinct values.
const cellsByText = () =>
  Object.fromEntries(
    screen.getAllByTestId('review-cell').map((el) => [el.textContent, el])
  );

const openEditor = async (text) => {
  await userEvent.click(cellsByText()[text]);
  return screen.getByTestId('cell-edit-dialog');
};

const typeCorrection = async (text) => {
  const field = screen.getByTestId('cell-edit-text');
  await userEvent.clear(field);
  await userEvent.type(field, text);
};

// The endpoint's answer about one cell: the untouched crop and the cleaned-up one, with
// distinct payloads so which of the two the dialog shows is never ambiguous.
const cellImages = { rawImage: 'UkFX', processedImage: 'UFJPQw==' };

// The elements the panel scrolled to, in order. jsdom implements no scrollIntoView at
// all, so it is stubbed on the prototype and records its receiver — a per-element mock
// would not exist for the component to call.
let scrolledInto = [];

beforeEach(() => {
  jest.clearAllMocks();
  getCellImages.mockResolvedValue(cellImages);
  scrolledInto = [];
  window.HTMLElement.prototype.scrollIntoView = jest.fn(function record() {
    scrolledInto.push(this);
  });
});

describe('ReviewTablePanel', () => {
  it('shows a spinner and Extracting… while the extraction is in flight', () => {
    extractTable.mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(screen.getByText('Extracting…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryAllByTestId('review-cell')).toHaveLength(0);
  });

  it('renders every cell of the extracted table in row/column order', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    expect(
      screen.getAllByTestId('review-cell').map((el) => el.textContent)
    ).toEqual(['Claim', 'Amount', 'ABC Ltd', '1,234.00']);
    expect(extractTable).toHaveBeenCalledWith('pdf-1', 'root');
    expect(screen.queryByText('Extracting…')).not.toBeInTheDocument();
  });

  it('right-aligns a numeric cell and left-aligns a non-numeric one', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const byText = cellsByText();
    expect(byText['1,234.00'].style.textAlign).toBe('right');
    expect(byText['ABC Ltd'].style.textAlign).toBe('left');
  });

  it('caps the column width and top-aligns every cell', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    screen.getAllByTestId('review-cell').forEach((el) => {
      expect(el.style.maxWidth).toBe(`${reviewColumnMaxWidthPx()}px`);
      expect(el.style.verticalAlign).toBe('top');
      expect(el.style.whiteSpace).toBe('normal');
      expect(el.style.overflowWrap).toBe('break-word');
      expect(el.style.wordBreak).not.toBe('break-all');
      // Every value here is short, so nothing holds its column open.
      expect(el.style.minWidth).toBe('');
    });
  });

  // Automatic table layout will squeeze a wrappable column to make room for the rest
  // of the row, so a long value needs its column pinned open at the cap rather than
  // wrapped into a narrow ribbon. One long cell is enough: the column follows its
  // widest cell, and the short cell alongside it carries no minimum of its own.
  it('pins a cell holding long text to the column cap, leaving short cells unpinned', async () => {
    const longText = 'x'.repeat(reviewWideCellMinCharacters() + 1);
    const atThreshold = 'y'.repeat(reviewWideCellMinCharacters());
    extractTable.mockResolvedValue({
      table: {
        name: 'root',
        headerCount: 0,
        cells: [
          [cell('root', 0, 0, longText, 99), cell('root', 0, 1, atThreshold, 99)],
          [
            cell('root', 1, 0, 'short', 99),
            // Trailing padding must not tip a short value over the threshold.
            cell(
              'root',
              1,
              1,
              `pad${' '.repeat(reviewWideCellMinCharacters())}`,
              99
            ),
          ],
        ],
      },
    });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const cells = screen.getAllByTestId('review-cell');
    expect(cells[0].style.minWidth).toBe(`${reviewColumnMaxWidthPx()}px`);
    // At the threshold, not over it: the rule is strictly greater than.
    expect(cells[1].style.minWidth).toBe('');
    expect(cells[2].style.minWidth).toBe('');
    expect(cells[3].style.minWidth).toBe('');
    // The cap still applies to the pinned cell, so min and max agree.
    expect(cells[0].style.maxWidth).toBe(`${reviewColumnMaxWidthPx()}px`);
  });

  // Confidence is shown by a wash and a marker, not by the border: there is now one
  // threshold, highConfidence(), and one appearance for everything under it.
  it('gives every cell the same border whatever its confidence', async () => {
    extractTable.mockResolvedValue({ table: confidenceSpread });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const byText = cellsByText();
    for (const text of ['poor', 'just poor', 'high', 'pad']) {
      expect(byText[text].style.borderColor).toBe(reviewCellBorderColour());
    }
  });

  it('washes a below-high cell, and only a below-high cell', async () => {
    extractTable.mockResolvedValue({ table: confidenceSpread });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const byText = cellsByText();
    expect(byText.poor.style.backgroundColor).toBe(
      reviewLowConfidenceBackgroundColour()
    );
    // One below the threshold is poor; sitting on it is not.
    expect(byText['just poor'].style.backgroundColor).toBe(
      reviewLowConfidenceBackgroundColour()
    );
    expect(byText.high.style.backgroundColor).toBe('');
    // A sourceless position is not flagged: its confidence of 0 means nothing read it,
    // not that something read it badly, and there is nothing behind it to correct.
    expect(byText.pad.style.backgroundColor).toBe('');
  });

  it('marks a below-high cell down its left edge, inside the cell', async () => {
    extractTable.mockResolvedValue({ table: confidenceSpread });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const bodyOf = (text) =>
      cellsByText()[text].querySelector('[data-testid="review-cell-body"]');
    expect(bodyOf('poor')).toHaveStyle({
      borderLeft: `${reviewLowConfidenceMarkerWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`,
      width: '100%',
      height: '100%',
    });
    expect(bodyOf('high').style.borderLeft).toBe('');
    // Every cell has the body wrapper, marked or not, so the text sits the same.
    expect(bodyOf('high')).toHaveStyle({ width: '100%', height: '100%' });
  });

  // headerCount replaces the per-cell header flag: the row index decides the tag.
  it('renders the header rows as th and the rest as td, and a sourceless position as an empty cell', async () => {
    extractTable.mockResolvedValue({
      table: {
        name: 'root',
        headerCount: 1,
        cells: [
          [cell('root', 0, 0, 'Head', 99), cell('root', 0, 1, 'Head 2', 99)],
          [cell('root', 1, 0, 'Body', 99), sourceless('')],
        ],
      },
    });

    renderPanel();

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    const cells = screen.getAllByTestId('review-cell');
    expect(cells.map((el) => el.tagName)).toEqual(['TH', 'TH', 'TD', 'TD']);
    expect(cells[3].textContent).toBe('');
    // A sourceless position still occupies the grid — a merged grid has no holes to
    // special-case — but it is drawn as plainly as a confident cell, so the padding
    // does not read as a screenful of doubtful values.
    expect(cells[3].style.borderColor).toBe(reviewCellBorderColour());
    expect(cells[3].style.backgroundColor).toBe('');
  });

  it('reports a failed extraction in the body and via toast.error, without retrying', async () => {
    extractTable.mockRejectedValue(new Error('extract exploded'));

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText('extract exploded')).toBeInTheDocument()
    );
    expect(toast.error).toHaveBeenCalledWith('extract exploded');
    expect(extractTable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Extracting…')).not.toBeInTheDocument();
  });

  it('calls onExit when Exit is clicked', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });
    const onExit = jest.fn();

    renderPanel({ onExit });

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    await userEvent.click(screen.getByTestId('review-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fetches once per pdfId/tableId pair', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    const { rerender } = renderPanel();
    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(1));

    // Same props: no refetch.
    rerender(
      <ReviewTablePanel pdfId={'pdf-1'} tableId={'root'} onExit={jest.fn()} />
    );
    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(1));

    // New table: refetch.
    rerender(
      <ReviewTablePanel pdfId={'pdf-1'} tableId={'other'} onExit={jest.fn()} />
    );
    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(2));
    expect(extractTable).toHaveBeenLastCalledWith('pdf-1', 'other');

    // New document: refetch.
    rerender(
      <ReviewTablePanel pdfId={'pdf-2'} tableId={'other'} onExit={jest.fn()} />
    );
    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(3));
    expect(extractTable).toHaveBeenLastCalledWith('pdf-2', 'other');
  });

  it('sets no state when the extraction resolves after unmount', async () => {
    let resolveExtract;
    extractTable.mockReturnValue(
      new Promise((resolve) => {
        resolveExtract = resolve;
      })
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderPanel();
    unmount();

    // eslint-disable-next-line
    await act(async () => {
      resolveExtract({ table: simpleTable });
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('review-cell')).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('sets no state when the extraction rejects after unmount', async () => {
    let rejectExtract;
    extractTable.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectExtract = reject;
      })
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderPanel();
    unmount();

    // eslint-disable-next-line
    await act(async () => {
      rejectExtract(new Error('too late'));
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
  // Under `next dev` the App Router runs in React StrictMode (Next 14 defaults
  // reactStrictMode to true for the app directory), so an effect's setup runs, is cleaned
  // up, and runs again. The dispatch is NOT idempotent — each call allocates a status id,
  // writes a status file, flips the document to EXTRACTION_IN_PROGRESS and fires a worker —
  // so the double invoke must not become two extractions. The second run has to adopt the
  // first request rather than skip fetching, or the panel would sit on the spinner forever
  // (the first run's result is discarded by its own cleanup).
  it('dispatches ONE extraction across a StrictMode double mount, and still renders it', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    render(
      <StrictMode>
        <ReviewTablePanel pdfId={'pdf-1'} tableId={'root'} onExit={jest.fn()} />
      </StrictMode>
    );

    await waitFor(() =>
      expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
    );
    expect(extractTable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Extracting…')).not.toBeInTheDocument();
  });

  // A different table is a different extraction: the de-duplication is per (pdfId, tableId),
  // never a blanket "only ever fetch once".
  it('re-dispatches when the addressed table changes', async () => {
    extractTable.mockResolvedValue({ table: simpleTable });

    const { rerender } = renderPanel();
    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(1));

    rerender(
      <ReviewTablePanel pdfId={'pdf-1'} tableId={'other'} onExit={jest.fn()} />
    );

    await waitFor(() => expect(extractTable).toHaveBeenCalledTimes(2));
    expect(extractTable).toHaveBeenLastCalledWith('pdf-1', 'other');
  });

  // The bar tells the user, before they start reading, how much of the merged table is
  // worth their attention. It sits outside the scrolling region so the number stays put
  // while the grid moves under it.
  describe('the below-high-confidence bar', () => {
    // Two cells under the sentinel high threshold, one on it, and a sourceless padding
    // position that is not counted.
    const mixedTable = {
      name: 'root',
      title: null,
      headerCount: 1,
      cells: [
        [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
        [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 88)],
        [cell('root', 2, 0, 'DEF Ltd', highConfidence()), sourceless('')],
      ],
    };

    const bar = () => screen.getByTestId('review-confidence-count');

    it('counts the cells below the high threshold, ignoring sourceless positions', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      expect(bar()).toHaveTextContent('2 entries flagged for review');
    });

    it('says "1 cell" when exactly one value is flagged', async () => {
      extractTable.mockResolvedValue({
        table: {
          ...mixedTable,
          cells: [
            mixedTable.cells[0],
            [
              cell('root', 1, 0, 'ABC Ltd', 60),
              cell('root', 1, 1, '1,234.00', highConfidence()),
            ],
            mixedTable.cells[2],
          ],
        },
      });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      expect(bar()).toHaveTextContent('1 entry flagged for review');
    });

    // Picking a coordinate is how a user reaches a poor cell in a table too big to
    // scan: the list names every one, and choosing it brings that cell into view.
    it('lists every poor cell by spreadsheet coordinate, top left being A1', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      const options = [
        ...screen.getByTestId('review-poor-cells').querySelectorAll('option'),
      ].map((o) => o.textContent);
      // A leading placeholder, then the two poor cells: A2 (confidence 60) and
      // B2 (confidence 88). Nothing for the sourceless padding at B3.
      expect(options).toEqual(['Go to…', 'A2', 'B2']);
    });

    it('labels the list, and sits it at the far end of the bar from the count', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      expect(screen.getByLabelText('Low confidence cells')).toBe(
        screen.getByTestId('review-poor-cells')
      );
      // The bar reads count first, list last, and pushes them apart.
      const bar = screen.getByTestId('review-bar');
      expect(bar).toHaveStyle({ justifyContent: 'space-between' });
      expect(bar.firstChild).toContainElement(
        screen.getByTestId('review-confidence-count')
      );
      expect(bar.lastChild).toContainElement(
        screen.getByTestId('review-poor-cells')
      );
    });

    it('scrolls the chosen cell into view', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await userEvent.selectOptions(
        screen.getByTestId('review-poor-cells'),
        'B2'
      );

      // B2 is row 1, column 1 of the grid — the fourth cell in reading order, and
      // the ONLY one scrolled to.
      expect(scrolledInto).toEqual([screen.getAllByTestId('review-cell')[3]]);
    });

    it('offers nothing to go to when every cell is confident', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      expect(screen.getByTestId('review-poor-cells')).toBeDisabled();
    });

    it('drops a cell from the list once it has been corrected', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await openEditor('ABC Ltd');
      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      await waitFor(() => {
        const options = [
          ...screen.getByTestId('review-poor-cells').querySelectorAll('option'),
        ].map((o) => o.textContent);
        expect(options).toEqual(['Go to…', 'B2']);
      });
    });

    // A coordinate is only useful next to the one you are on, and stepping beats
    // re-opening the list for every cell in turn.
    describe('the selected-cell readout and the step buttons', () => {
      // Three poor cells — A2, B2 and A3 — so a middle position exists to step from.
      const threePoor = {
        name: 'root',
        title: null,
        headerCount: 1,
        cells: [
          [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
          [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 70)],
          [cell('root', 2, 0, 'DEF Ltd', 80), cell('root', 2, 1, '9,999.00', 99)],
        ],
      };

      const shown = async (table = threePoor) => {
        extractTable.mockResolvedValue({ table });
        renderPanel();
        const expected = table.cells.flat().length;
        await waitFor(() =>
          expect(screen.queryAllByTestId('review-cell')).toHaveLength(expected)
        );
      };

      const readout = () => screen.queryByTestId('review-selected-cell');
      const previous = () => screen.getByTestId('review-previous-poor-cell');
      const next = () => screen.getByTestId('review-next-poor-cell');

      it('says nothing about a selected cell until one is selected', async () => {
        await shown();

        expect(readout()).not.toBeInTheDocument();
      });

      it('names the selected cell by its coordinate', async () => {
        await shown();

        await userEvent.click(cellsByText()['9,999.00']);

        // Row 3, column B — a confident cell, which can still be selected.
        expect(readout()).toHaveTextContent('Selected cell B3');
      });

      it('steps forward through the list from the selected cell', async () => {
        await shown();

        await userEvent.click(next());
        expect(readout()).toHaveTextContent('Selected cell A2');

        await userEvent.click(next());
        expect(readout()).toHaveTextContent('Selected cell B2');

        await userEvent.click(next());
        expect(readout()).toHaveTextContent('Selected cell A3');
      });

      it('steps back the same way, and scrolls to what it lands on', async () => {
        await shown();

        await userEvent.click(previous());
        expect(readout()).toHaveTextContent('Selected cell A3');
        // A3 is row 2, column 0 — the fifth cell in reading order.
        expect(scrolledInto).toEqual([screen.getAllByTestId('review-cell')[4]]);

        await userEvent.click(previous());
        expect(readout()).toHaveTextContent('Selected cell B2');
      });

      it('stops at each end rather than wrapping round', async () => {
        await shown();

        await userEvent.click(next());
        expect(previous()).toBeDisabled();

        await userEvent.click(next());
        await userEvent.click(next());
        expect(readout()).toHaveTextContent('Selected cell A3');
        expect(next()).toBeDisabled();
        expect(previous()).toBeEnabled();
      });

      it('offers no stepping when nothing is poor', async () => {
        await shown({ ...threePoor, cells: simpleTable.cells });

        expect(previous()).toBeDisabled();
        expect(next()).toBeDisabled();
      });

      it('lays the bar out count, selection, back, list, forward', async () => {
        await shown();
        await userEvent.click(next());

        // MUI's icons stamp testids of their own, so only this panel's are read.
        const order = [...screen.getByTestId('review-bar').querySelectorAll('*')]
          .map((el) => el.dataset.testid)
          .filter((id) => id?.startsWith('review-'));
        expect(order).toEqual([
          'review-confidence-count',
          'review-selected-cell',
          'review-previous-poor-cell',
          'review-poor-cells',
          'review-next-poor-cell',
        ]);
      });
    });

    it('is not inside the scrolling region', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      const scroller = screen.getByTestId('review-scroll');
      expect(scroller).not.toContainElement(bar());
      // And the grid it scrolls really is inside it.
      expect(scroller).toContainElement(screen.getAllByTestId('review-cell')[0]);
    });

    it('falls as cells are corrected, because a correction is confident', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await openEditor('ABC Ltd');
      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      await waitFor(() =>
        expect(bar()).toHaveTextContent('1 entry flagged for review')
      );
    });

    it('is absent while the extraction is in flight and after it fails', async () => {
      extractTable.mockReturnValue(new Promise(() => {}));

      const { unmount } = renderPanel();

      expect(
        screen.queryByTestId('review-confidence-count')
      ).not.toBeInTheDocument();
      unmount();

      extractTable.mockRejectedValue(new Error('extraction exploded'));
      renderPanel();

      await screen.findByText('extraction exploded');
      expect(
        screen.queryByTestId('review-confidence-count')
      ).not.toBeInTheDocument();
    });
  });

  // One cell at a time is "where the user is": the last one clicked, or the last one
  // jumped to from the bar's list. It is ringed so it can be found again after a glance
  // away.
  describe('the selected cell', () => {
    const selectionIn = (text) =>
      cellsByText()[text].querySelector('[data-testid="review-cell-selection"]');

    const rendered = async () => {
      extractTable.mockResolvedValue({ table: mixedTable });
      renderPanel();
      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
    };

    const mixedTable = {
      name: 'root',
      title: null,
      headerCount: 1,
      cells: [
        [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
        [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 88)],
        [cell('root', 2, 0, 'DEF Ltd', 99), sourceless('')],
      ],
    };

    it('rings nothing until something is chosen', async () => {
      await rendered();

      expect(screen.queryAllByTestId('review-cell-selection')).toHaveLength(0);
    });

    it('rings the cell that was clicked, and only that one', async () => {
      await rendered();

      await userEvent.click(cellsByText()['ABC Ltd']);

      expect(screen.getAllByTestId('review-cell-selection')).toHaveLength(1);
      expect(selectionIn('ABC Ltd')).toHaveStyle({
        backgroundColor: reviewSelectedCellBackgroundColour(),
        border: `${reviewSelectedCellBorderWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`,
        borderRadius: `${reviewSelectedCellRadiusPx()}px`,
        boxShadow: reviewSelectedCellShadow(),
        padding: `${reviewSelectedCellPaddingPx()}px`,
        width: '100%',
        height: '100%',
      });
      // It wraps the text rather than sitting beside it.
      expect(selectionIn('ABC Ltd')).toHaveTextContent('ABC Ltd');
    });

    it('moves the ring when another cell is clicked', async () => {
      await rendered();

      await userEvent.click(cellsByText()['ABC Ltd']);
      await userEvent.click(screen.getByTestId('cell-edit-cancel'));
      await userEvent.click(cellsByText()['DEF Ltd']);

      expect(screen.getAllByTestId('review-cell-selection')).toHaveLength(1);
      expect(selectionIn('DEF Ltd')).not.toBeNull();
    });

    it('rings a cell reached from the coordinate list', async () => {
      await rendered();

      await userEvent.selectOptions(
        screen.getByTestId('review-poor-cells'),
        'B2'
      );

      expect(selectionIn('1,234.00')).not.toBeNull();
      expect(screen.getAllByTestId('review-cell-selection')).toHaveLength(1);
    });

    it('rings a confident cell too, without washing it', async () => {
      await rendered();

      await userEvent.click(cellsByText()['DEF Ltd']);

      expect(selectionIn('DEF Ltd')).not.toBeNull();
      expect(cellsByText()['DEF Ltd'].style.backgroundColor).toBe('');
    });
  });

  // The merged table's title is a value like any other — read from the PDF, flagged when
  // it was read poorly, and editable — but it lives above the grid rather than at a
  // coordinate in it, so it needs its own place in the bar's list and its own selection.
  describe('the table title', () => {
    // A flagged title over two poor cells, A2 and B2, so the title's place in the list
    // and in the stepping order is unambiguous.
    const titled = (confidence) => ({
      name: 'root',
      title: amalgamatedTitle(confidence),
      headerCount: 1,
      cells: [
        [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
        [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 70)],
      ],
    });

    const shown = async (table, props = {}) => {
      extractTable.mockResolvedValue({ table });
      renderPanel(props);
      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
    };

    const title = () => screen.getByTestId('review-title');
    const bar = () => screen.getByTestId('review-confidence-count');
    const readout = () => screen.queryByTestId('review-selected-cell');
    const options = () =>
      [
        ...screen.getByTestId('review-poor-cells').querySelectorAll('option'),
      ].map((o) => o.textContent);

    it('shows the title above the grid, outside the scrolling region', async () => {
      await shown(titled(40));

      expect(title()).toHaveTextContent('Loss run 2024');
      const scroller = screen.getByTestId('review-scroll');
      expect(scroller).not.toContainElement(title());
      // Below the bar and above the grid, in reading order.
      const bodyOrder = [...document.body.querySelectorAll('[data-testid]')]
        .map((el) => el.dataset.testid)
        .filter((id) => ['review-bar', 'review-title', 'review-scroll'].includes(id));
      expect(bodyOrder).toEqual(['review-bar', 'review-title', 'review-scroll']);
    });

    it('shows no title when the table has none', async () => {
      await shown({ ...titled(40), title: null });

      expect(screen.queryByTestId('review-title')).not.toBeInTheDocument();
    });

    // The title is flagged on the same rule and shown the same way as a cell, so the two
    // read as one kind of thing needing one kind of attention.
    it('washes and marks a flagged title', async () => {
      await shown(titled(highConfidence() - 1));

      expect(title()).toHaveStyle({
        backgroundColor: reviewLowConfidenceBackgroundColour(),
        borderLeft: `${reviewLowConfidenceMarkerWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`,
      });
    });

    it('leaves a confident title unwashed and unmarked', async () => {
      await shown(titled(highConfidence()));

      expect(title().style.backgroundColor).toBe('');
      expect(title().style.borderLeft).toBe('');
    });

    it('counts a flagged title alongside the flagged cells', async () => {
      await shown(titled(40));

      expect(bar()).toHaveTextContent('3 entries flagged for review');
    });

    it('leaves a confident title out of the count', async () => {
      await shown(titled(highConfidence()));

      expect(bar()).toHaveTextContent('2 entries flagged for review');
    });

    it('counts a flagged title alone as one', async () => {
      await shown({
        ...titled(40),
        cells: [
          [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
          [
            cell('root', 1, 0, 'ABC Ltd', 99),
            cell('root', 1, 1, '1,234.00', 99),
          ],
        ],
      });

      expect(bar()).toHaveTextContent('1 entry flagged for review');
    });

    // The title sits above the grid on screen, so it comes first in the list too.
    it('heads the Go to… list when flagged', async () => {
      await shown(titled(40));

      expect(options()).toEqual(['Go to…', reviewTitleLabel(), 'A2', 'B2']);
    });

    it('is absent from the Go to… list when confident', async () => {
      await shown(titled(highConfidence()));

      expect(options()).toEqual(['Go to…', 'A2', 'B2']);
    });

    it('is selected, named and scrolled to when chosen from the list', async () => {
      await shown(titled(40));

      await userEvent.selectOptions(
        screen.getByTestId('review-poor-cells'),
        reviewTitleLabel()
      );

      expect(readout()).toHaveTextContent('Selected title');
      expect(scrolledInto).toEqual([title()]);
      expect(
        title().querySelector('[data-testid="review-title-selection"]')
      ).toHaveStyle({
        backgroundColor: reviewSelectedCellBackgroundColour(),
        border: `${reviewSelectedCellBorderWidthPx()}px solid ${reviewLowConfidenceBorderColour()}`,
        borderRadius: `${reviewSelectedCellRadiusPx()}px`,
        boxShadow: reviewSelectedCellShadow(),
        padding: `${reviewSelectedCellPaddingPx()}px`,
      });
      // And no grid cell is ringed instead of it.
      expect(screen.queryAllByTestId('review-cell-selection')).toHaveLength(0);
    });

    it('steps forward from the title to the first flagged cell, and back again', async () => {
      await shown(titled(40));

      await userEvent.click(screen.getByTestId('review-next-poor-cell'));
      expect(readout()).toHaveTextContent('Selected title');

      await userEvent.click(screen.getByTestId('review-next-poor-cell'));
      expect(readout()).toHaveTextContent('Selected cell A2');

      await userEvent.click(screen.getByTestId('review-previous-poor-cell'));
      expect(readout()).toHaveTextContent('Selected title');
      // Nothing before the title, which is the head of the list.
      expect(screen.getByTestId('review-previous-poor-cell')).toBeDisabled();
    });

    it('opens the edit dialog on the title, asking for its own crop', async () => {
      const tables = metadataTables();

      await shown(titled(40), { tables });

      await userEvent.click(title());

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('cell-edit-text')).toHaveValue('Loss run 2024');
      expect(readout()).toHaveTextContent('Selected title');
      await waitFor(() =>
        expect(getCellImages).toHaveBeenCalledWith(
          'pdf-1',
          tables[0].pdfPage,
          expect.any(Number),
          tables[0].title.bounds
        )
      );
    });

    // The title runs almost the full width of the editor, so the dialog fits neither above
    // it nor to either side and falls back to below, where the click decides the side. The
    // panel therefore has to hand the pointer on. jsdom measures everything as 0, so the
    // title's rectangle and the dialog's height are both stubbed to reach that branch.
    it('places the edit dialog below the title, on the side the click landed', async () => {
      const heightSpy = jest
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(120);
      try {
        await shown(titled(40));

        const wide = {
          left: 5,
          top: 40,
          right: window.innerWidth - 5,
          bottom: 70,
          width: window.innerWidth - 10,
          height: 30,
        };
        const pointer = { x: 400, y: 55 };
        title().getBoundingClientRect = () => wide;
        fireEvent.click(title(), { clientX: pointer.x, clientY: pointer.y });

        const expected = dialogPlacement(
          wide,
          { width: reviewCellEditDialogWidthPx(), height: 120 },
          { width: window.innerWidth, height: window.innerHeight },
          pointer
        );
        expect(expected.placement).toBe('below');
        const dialog = screen.getByTestId('cell-edit-dialog');
        expect(dialog.style.left).toBe(`${expected.left}px`);
        expect(dialog.style.top).toBe(`${expected.top}px`);
        // Opening the dialog also asks for the title's crop; let that settle before the
        // test ends, so the arriving image is not a state update outside the test.
        await waitFor(() => expect(getCellImages).toHaveBeenCalled());
      } finally {
        heightSpy.mockRestore();
      }
    });

    it('writes a confirmed title correction into the metadata and the panel', async () => {
      const onEditTables = jest.fn();

      await shown(titled(40), { onEditTables });

      await userEvent.click(title());
      await typeCorrection('Loss run 2025');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      await waitFor(() => expect(title()).toHaveTextContent('Loss run 2025'));
      expect(onEditTables).toHaveBeenCalledTimes(1);
      const [nextTables] = onEditTables.mock.calls[0];
      expect(nextTables[0].title.text).toBe('Loss run 2025');
      expect(nextTables[0].title.confidence).toBe(reviewEditedCellConfidence());
      // The title's bounds are not the edit's business and survive it.
      expect(nextTables[0].title.bounds).toEqual(titleBounds);
      // The grid is untouched by a title edit.
      expect(
        screen.getAllByTestId('review-cell').map((el) => el.textContent)
      ).toEqual(['Claim', 'Amount', 'ABC Ltd', '1,234.00']);
      // A correction is confident, so the title drops out of the flagged list.
      expect(bar()).toHaveTextContent('2 entries flagged for review');
      expect(options()).toEqual(['Go to…', 'A2', 'B2']);
      expect(toast.error).not.toHaveBeenCalled();
    });

    // Confirm-and-next reads its target before the correction lands, and the title is the
    // head of the list — so a confident cell's confirm-and-next steps on to the title, and
    // the dialog has to be handed the title rather than a grid position.
    it('carries confirm-and-next on to the title, then off it to the first flagged cell', async () => {
      const onEditTables = jest.fn();

      await shown(titled(40), { onEditTables });

      await userEvent.click(cellsByText().Claim);
      await typeCorrection('Claim ref');
      await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('cell-edit-text')).toHaveValue('Loss run 2024');
      expect(readout()).toHaveTextContent('Selected title');

      await typeCorrection('Loss run 2025');
      await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('cell-edit-text')).toHaveValue('ABC Ltd');
      expect(readout()).toHaveTextContent('Selected cell A2');
      await waitFor(() => expect(title()).toHaveTextContent('Loss run 2025'));
    });

    it('refuses a title correction whose source table is gone, and says so', async () => {
      const onEditTables = jest.fn();

      await shown(titled(40), { tables: [], onEditTables });

      await userEvent.click(title());
      await typeCorrection('Loss run 2025');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      expect(onEditTables).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(title()).toHaveTextContent('Loss run 2024');
    });
  });

  // Export is the end of the road: the document is saved, turned into a spreadsheet, and
  // the user is handed the file and sent back to the list.
  describe('exporting to Excel', () => {
    // The workbook itself, not a link to it: /api/to-excel collects it from its presigned
    // url server-side, so what the panel receives is bytes it can save from memory.
    const workbook = new Blob(['PK the workbook']);

    // What was handed to the browser: one entry per anchor click, with the object url it
    // pointed at and the name it asked to be saved under. jsdom neither downloads nor
    // navigates, so the click is stubbed on the prototype — the anchor is created and
    // removed inside the export and the test never otherwise sees it. `blobbed` is what
    // was turned into an object url, which is how "the workbook it was given" is checked.
    let handedOver = [];
    let blobbed = [];

    beforeEach(() => {
      handedOver = [];
      blobbed = [];
      global.URL.createObjectURL = jest.fn((blob) => {
        blobbed.push(blob);
        return 'blob:workbook';
      });
      global.URL.revokeObjectURL = jest.fn();
      jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function record() {
          handedOver.push({ href: this.href, download: this.download });
        });
    });

    afterEach(() => {
      HTMLAnchorElement.prototype.click.mockRestore();
    });

    const shown = async (props = {}) => {
      extractTable.mockResolvedValue({ table: simpleTable });
      const view = renderPanel(props);
      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      return view;
    };

    it('offers Export before Exit', async () => {
      await shown({ onSave: jest.fn() });

      const order = [...document.body.querySelectorAll('[data-testid]')]
        .map((el) => el.dataset.testid)
        .filter((id) => id === 'review-export' || id === 'review-exit');
      expect(order).toEqual(['review-export', 'review-exit']);
    });

    // The export is built from what the server holds, so the save has to reach the server
    // first. A save that did not raises its own toast and leaves the document dirty —
    // there is nothing to add and nothing to export.
    it('saves first, and exports nothing when the save did not land', async () => {
      const onSave = jest.fn().mockResolvedValue(false);
      const onAllFiles = jest.fn();

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(tableToExcel).not.toHaveBeenCalled();
      expect(onAllFiles).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(screen.getByTestId('review-export')).toBeEnabled();
      // The lock is dropped again, so this can be tried again without leaving the panel.
      expect(screen.queryByTestId('review-exporting')).toBeNull();
    });

    // The lock goes up BEFORE the save, not after it: a save takes long enough for a second
    // click to land inside it, and two exports would build the workbook twice and hand it
    // over twice.
    it('locks on the first click, so a click during the save starts nothing further', async () => {
      let landSave;
      const onSave = jest
        .fn()
        .mockImplementation(() => new Promise((resolve) => (landSave = resolve)));
      const onAllFiles = jest.fn();
      tableToExcel.mockResolvedValue(workbook);

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));
      // Locked while the save is still in flight, so the panel cannot be exported again.
      expect(screen.getByTestId('review-exporting')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('review-export'));

      expect(onSave).toHaveBeenCalledTimes(1);

      await act(async () => {
        landSave(true);
      });

      await waitFor(() => expect(handedOver).toHaveLength(1));
      expect(tableToExcel).toHaveBeenCalledTimes(1);
    });

    it('sends the amalgamated table with the document it came from', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onAllFiles = jest.fn();
      tableToExcel.mockResolvedValue(workbook);

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      await waitFor(() => expect(handedOver).toHaveLength(1));
      expect(tableToExcel).toHaveBeenCalledWith({
        ...simpleTable,
        pdfId: 'pdf-1',
        rootTableId: 'root',
        originalFilename: 'losses.pdf',
      });
      expect(toast.error).not.toHaveBeenCalled();
    });

    // The workbook arrives as bytes, so it is saved from memory under a name of the page's
    // own choosing — taken from the uploaded document's. Nothing is navigated to, which is
    // the point: the old hand-over was a cross-origin navigation the page could not await,
    // and the browser served it by cancelling whatever else the page had in flight.
    it('saves the workbook it was handed under the uploaded document name', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onAllFiles = jest.fn();
      tableToExcel.mockResolvedValue(workbook);

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      await waitFor(() => expect(handedOver).toHaveLength(1));
      expect(blobbed).toEqual([workbook]);
      expect(handedOver[0]).toEqual({
        href: 'blob:workbook',
        download: `losses${excelFileSuffix()}`,
      });
    });

    // There is no gap to wait out any more: the save completes before the export returns,
    // so the return to the list follows it directly and leaves nothing in the document.
    it('returns to the list as soon as the file is saved, leaving no anchor behind', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onAllFiles = jest.fn();
      tableToExcel.mockResolvedValue(workbook);

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      await waitFor(() => expect(onAllFiles).toHaveBeenCalledTimes(1));
      expect(document.querySelectorAll('a')).toHaveLength(0);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:workbook');
    });

    it('locks the panel behind a spinner while the export is in flight', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onAllFiles = jest.fn();
      let resolveExport;
      tableToExcel.mockReturnValue(
        new Promise((resolve) => {
          resolveExport = resolve;
        })
      );

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      const overlay = await screen.findByTestId('review-exporting');
      expect(overlay).toContainElement(screen.getByRole('progressbar'));
      // It covers the panel, so nothing under it can be reached mid-export.
      expect(overlay).toHaveStyle({
        position: 'absolute',
        top: '0px',
        right: '0px',
        bottom: '0px',
        left: '0px',
      });
      expect(onAllFiles).not.toHaveBeenCalled();

      // eslint-disable-next-line
      await act(async () => {
        resolveExport(workbook);
      });

      // The lock is never dropped on this path: the panel is taken away with the spinner
      // still up, so the export never flickers back to an editable table on its way out.
      expect(screen.getByTestId('review-exporting')).toBeInTheDocument();
      expect(onAllFiles).toHaveBeenCalledTimes(1);
    });

    it('reports a failed export, stays on the panel and clears the spinner', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      const onAllFiles = jest.fn();
      tableToExcel.mockRejectedValue(new Error('excel exploded'));

      await shown({ onSave, onAllFiles, originalFilename: 'losses.pdf' });

      await userEvent.click(screen.getByTestId('review-export'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('excel exploded')
      );
      expect(onAllFiles).not.toHaveBeenCalled();
      expect(handedOver).toEqual([]);
      expect(
        screen.queryByTestId('review-exporting')
      ).not.toBeInTheDocument();
      expect(screen.getAllByTestId('review-cell')).toHaveLength(4);
      expect(screen.getByTestId('review-export')).toBeEnabled();
    });
  });

  // Spreadsheet-style rulers, so a coordinate from the list can be found by eye. Each
  // sticks against the panel's own scroller in ONE axis only: the letters travel
  // sideways with the grid but hold their vertical place, the numbers the reverse.
  describe('the coordinate rulers', () => {
    const mixedTable = {
      name: 'root',
      title: null,
      headerCount: 1,
      cells: [
        [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
        [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 88)],
        [cell('root', 2, 0, 'DEF Ltd', 99), sourceless('')],
      ],
    };

    const columnHeads = () =>
      screen.getAllByTestId('review-column-head').map((el) => el.textContent);
    const rowHeads = () =>
      screen.getAllByTestId('review-row-head').map((el) => el.textContent);

    it('names the columns A, B, … and numbers the rows from 1', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      expect(columnHeads()).toEqual(['A', 'B']);
      expect(rowHeads()).toEqual(['1', '2', '3']);
      // The corner where the two rulers meet carries no label of its own.
      expect(screen.getByTestId('review-corner')).toHaveTextContent('');
    });

    it('sticks the letters to the top and the numbers to the left, corner to both', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      const [firstColumn] = screen.getAllByTestId('review-column-head');
      expect(firstColumn).toHaveStyle({ position: 'sticky', top: '0px' });
      // Not pinned sideways: it has to travel with the column it names.
      expect(firstColumn.style.left).toBe('');

      const [firstRow] = screen.getAllByTestId('review-row-head');
      expect(firstRow).toHaveStyle({ position: 'sticky', left: '0px' });
      expect(firstRow.style.top).toBe('');

      expect(screen.getByTestId('review-corner')).toHaveStyle({
        position: 'sticky',
        top: '0px',
        left: '0px',
      });
    });

    // The rulers pin to the scrollport's edges, so any padding on the scroller insets
    // them — they would sit that far in from the top and left of the visible area
    // instead of flush against it. jsdom does no layout, so the padding itself is what
    // is asserted; it is the whole cause.
    it('is not held off the top and left edges by the scroller', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      const padding = window.getComputedStyle(
        screen.getByTestId('review-scroll')
      );
      // jsdom leaves an undeclared padding as '', not '0px', so "no padding" is read as
      // "nothing but zero was asked for".
      const none = (value) => value === '' || parseFloat(value) === 0;
      expect(none(padding.paddingTop)).toBe(true);
      expect(none(padding.paddingLeft)).toBe(true);
      // The far edges keep their breathing room; only the ruled ones give it up.
      expect(none(padding.paddingRight)).toBe(false);
      expect(none(padding.paddingBottom)).toBe(false);
    });

    it('keeps a jumped-to cell clear of the rulers covering it', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      expect(screen.getAllByTestId('review-cell')[0]).toHaveStyle({
        scrollMarginTop: `${reviewGutterHeightPx()}px`,
        scrollMarginLeft: `${reviewGutterWidthPx()}px`,
      });
    });

    it('does not open the editor when a ruler is clicked', async () => {
      extractTable.mockResolvedValue({ table: mixedTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await userEvent.click(screen.getAllByTestId('review-row-head')[0]);
      await userEvent.click(screen.getAllByTestId('review-column-head')[0]);
      await userEvent.click(screen.getByTestId('review-corner'));

      expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
    });
  });

  describe('cell editing', () => {
    // The crop is requested at the width of the cell being edited, so it arrives at the
    // scale the user is already reading the table at rather than at a fixed size that
    // magnifies a narrow column and shrinks a wide one.
    it('opens the dialog on a cell click and asks for that cell’s crop at that cell’s width', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });
      const tables = metadataTables();
      // jsdom lays nothing out, so every rect is zero; a stub gives the clicked cell a
      // width distinguishable from anything else in play.
      const cellWidth = 137;
      jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({
          left: 10,
          top: 20,
          right: 10 + cellWidth,
          bottom: 40,
          width: cellWidth,
          height: 20,
        });

      renderPanel({ tables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();

      await openEditor('ABC Ltd');

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
      const source = tables[0].cells.find((c) => c.row === 1 && c.column === 0);
      await waitFor(() =>
        expect(getCellImages).toHaveBeenCalledWith(
          'pdf-1',
          tables[0].pdfPage,
          cellWidth,
          source.bounds
        )
      );
      // Both crops of that one cell are cached, and the processed one is what is shown.
      await waitFor(() =>
        expect(screen.getByTestId('cell-edit-image')).toHaveAttribute(
          'src',
          `data:image/png;base64,${cellImages.processedImage}`
        )
      );
      HTMLElement.prototype.getBoundingClientRect.mockRestore();
    });

    // Header cells are editable too: the extraction misreads a column heading as
    // readily as a value.
    it('opens the dialog for a header cell', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('Claim');

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
    });

    // The cache and the requested-set live in the panel, not the short-lived dialog,
    // so re-opening the same cell shows what was already fetched.
    it('does not re-request a crop when the same cell is re-opened', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });

      renderPanel();

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('ABC Ltd');
      await waitFor(() => expect(getCellImages).toHaveBeenCalledTimes(1));

      await userEvent.click(screen.getByTestId('cell-edit-cancel'));
      await openEditor('ABC Ltd');

      expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
      expect(getCellImages).toHaveBeenCalledTimes(1);
    });

    it('closes the dialog on cancel, changing neither the grid nor the metadata', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });
      const onEditTables = jest.fn();

      renderPanel({ onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('ABC Ltd');
      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-cancel'));

      expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
      expect(
        screen.getAllByTestId('review-cell').map((el) => el.textContent)
      ).toEqual(['Claim', 'Amount', 'ABC Ltd', '1,234.00']);
      expect(onEditTables).not.toHaveBeenCalled();
    });

    it('writes a confirmed correction into the grid and the metadata at the edited confidence', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });
      const onEditTables = jest.fn();

      renderPanel({ onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('ABC Ltd');
      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getAllByTestId('review-cell').map((el) => el.textContent)
        ).toEqual(['Claim', 'Amount', 'XYZ Ltd', '1,234.00'])
      );
      expect(onEditTables).toHaveBeenCalledTimes(1);
      const [nextTables] = onEditTables.mock.calls[0];
      const edited = nextTables[0].cells.find(
        (c) => c.row === 1 && c.column === 0
      );
      expect(edited.text).toBe('XYZ Ltd');
      expect(edited.confidence).toBe(reviewEditedCellConfidence());
      // The rest of the metadata is untouched.
      expect(
        nextTables[0].cells.find((c) => c.row === 1 && c.column === 1).text
      ).toBe('1,234.00');
      expect(toast.error).not.toHaveBeenCalled();
    });

    // A section title's value legitimately appears in every row it covers, so all of
    // those positions have to move together.
    it('updates every position sharing a section title, and the right sectionTitles entry', async () => {
      extractTable.mockResolvedValue({ table: sectionTitleTable });
      const onEditTables = jest.fn();

      renderPanel({ onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await userEvent.click(screen.getAllByTestId('review-cell')[3]);
      await typeCorrection('Section Z');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      await waitFor(() =>
        expect(
          screen.getAllByTestId('review-cell').map((el) => el.textContent)
        ).toEqual([
          'Claim',
          'Policy',
          'ABC Ltd',
          'Section Z',
          'DEF Ltd',
          'Section Z',
        ])
      );
      expect(onEditTables).toHaveBeenCalledTimes(1);
      const [nextTables] = onEditTables.mock.calls[0];
      expect(nextTables[0].sectionTitles[0].data.text).toBe('Section Z');
      expect(nextTables[0].sectionTitles[0].data.confidence).toBe(
        reviewEditedCellConfidence()
      );
      // The bounds are not the edit's business and survive it.
      expect(nextTables[0].sectionTitles[0].data.bounds).toEqual(
        metadataTables()[0].sectionTitles[0].data.bounds
      );
    });

    // A blank tableId means there is nothing in the metadata to write back to, so the
    // dialog opens but refuses the correction rather than accepting one that would
    // vanish at the next extraction.
    it('opens a sourceless cell with confirm disabled, and clicking it changes nothing', async () => {
      extractTable.mockResolvedValue({ table: sectionTitleTable });
      const onEditTables = jest.fn();

      renderPanel({ onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(6)
      );
      await openEditor('Policy');

      const confirm = screen.getByTestId('cell-edit-confirm');
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);

      expect(onEditTables).not.toHaveBeenCalled();
      expect(getCellImages).not.toHaveBeenCalled();
      expect(
        screen.getAllByTestId('review-cell').map((el) => el.textContent)
      ).toEqual([
        'Claim',
        'Policy',
        'ABC Ltd',
        'Section A',
        'DEF Ltd',
        'Section A',
      ]);
    });

    // A table deleted since the extraction leaves the reference dangling; a correction
    // that cannot be persisted must not be shown as if it had been.
    it('refuses a correction whose source table is gone, and says so', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });
      const onEditTables = jest.fn();

      renderPanel({ tables: [], onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('ABC Ltd');
      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
      expect(onEditTables).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(
        screen.getAllByTestId('review-cell').map((el) => el.textContent)
      ).toEqual(['Claim', 'Amount', 'ABC Ltd', '1,234.00']);
    });

    // The crop is a convenience, not a precondition: losing it must not cost the user
    // the edit.
    it('reports a failed crop fetch and still accepts the correction', async () => {
      extractTable.mockResolvedValue({ table: simpleTable });
      getCellImages.mockRejectedValue(new Error('crop exploded'));
      const onEditTables = jest.fn();

      renderPanel({ onEditTables });

      await waitFor(() =>
        expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
      );
      await openEditor('ABC Ltd');
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('crop exploded')
      );
      expect(screen.queryByTestId('cell-edit-image')).not.toBeInTheDocument();

      await typeCorrection('XYZ Ltd');
      await userEvent.click(screen.getByTestId('cell-edit-confirm'));

      await waitFor(() =>
        expect(
          screen.getAllByTestId('review-cell').map((el) => el.textContent)
        ).toEqual(['Claim', 'Amount', 'XYZ Ltd', '1,234.00'])
      );
      expect(onEditTables).toHaveBeenCalledTimes(1);
    });

    // Confirm-and-next is the working-through path: correct a cell, land on the next one
    // still needing attention, without going back to the grid in between.
    describe('confirm and next', () => {
      // Two poor cells, A2 and B2, and a confident one after them.
      const twoPoor = {
        name: 'root',
        title: null,
        headerCount: 1,
        cells: [
          [cell('root', 0, 0, 'Claim', 99), cell('root', 0, 1, 'Amount', 99)],
          [cell('root', 1, 0, 'ABC Ltd', 60), cell('root', 1, 1, '1,234.00', 70)],
        ],
      };

      it('saves, then re-opens on the next low confidence cell', async () => {
        extractTable.mockResolvedValue({ table: twoPoor });
        const tables = metadataTables();
        const onEditTables = jest.fn();

        renderPanel({ tables, onEditTables });
        await waitFor(() =>
          expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
        );
        await openEditor('ABC Ltd');
        await typeCorrection('XYZ Ltd');
        await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

        // Saved: grid and metadata both carry the correction.
        await waitFor(() =>
          expect(
            screen.getAllByTestId('review-cell').map((el) => el.textContent)
          ).toEqual(['Claim', 'Amount', 'XYZ Ltd', '1,234.00'])
        );
        expect(onEditTables).toHaveBeenCalledTimes(1);

        // And moved on: the dialog is still open, now on B2, pre-filled from it.
        expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('cell-edit-text')).toHaveValue('1,234.00');
        expect(screen.getByTestId('review-selected-cell')).toHaveTextContent(
          'Selected cell B2'
        );
      });

      it('closes on the last low confidence cell, having saved it', async () => {
        extractTable.mockResolvedValue({ table: twoPoor });
        const onEditTables = jest.fn();

        renderPanel({ onEditTables });
        await waitFor(() =>
          expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
        );
        await openEditor('1,234.00');
        await typeCorrection('9.99');
        await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

        expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
        expect(onEditTables).toHaveBeenCalledTimes(1);
        await waitFor(() =>
          expect(
            screen.getAllByTestId('review-cell').map((el) => el.textContent)
          ).toEqual(['Claim', 'Amount', 'ABC Ltd', '9.99'])
        );
      });

      it('does not step on when the correction could not be written', async () => {
        extractTable.mockResolvedValue({ table: twoPoor });
        const onEditTables = jest.fn();

        // No metadata to write back to, so the save fails before anything moves.
        renderPanel({ tables: [], onEditTables });
        await waitFor(() =>
          expect(screen.queryAllByTestId('review-cell')).toHaveLength(4)
        );
        await openEditor('ABC Ltd');
        await typeCorrection('XYZ Ltd');
        await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

        expect(toast.error).toHaveBeenCalled();
        expect(onEditTables).not.toHaveBeenCalled();
        expect(screen.queryByTestId('cell-edit-dialog')).not.toBeInTheDocument();
        expect(
          screen.getAllByTestId('review-cell').map((el) => el.textContent)
        ).toEqual(['Claim', 'Amount', 'ABC Ltd', '1,234.00']);
      });
    });
  });
});
