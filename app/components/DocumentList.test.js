import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentList from 'components/DocumentList';
import {
  documentListCountsHelpId,
  documentListStatusHelpId,
  documentListTableHelpId,
} from 'config';

// DocumentList is presentational now: the list, loading flag and polling live in
// the parent (pdfLoader). These tests drive it purely through props.

function row(overrides = {}) {
  return {
    pdfId: '1',
    name: 'doc.pdf',
    created: '2026-06-11T00:00:00Z',
    status: 'COMPLETED',
    error: null,
    pageCount: 3,
    ...overrides,
  };
}

describe('DocumentList', () => {
  test('shows a spinner with the header present while not yet loaded', () => {
    render(<DocumentList pdfs={[]} hasLoaded={false} />);

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('No documents yet')).not.toBeInTheDocument();
  });

  test('shows the empty-state block (with header) when loaded with no documents', () => {
    render(<DocumentList pdfs={[]} hasLoaded />);

    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a loss run PDF using the panel to the left/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Start with the upload panel/)).toBeInTheDocument();
    expect(screen.getByTestId('PictureAsPdfIcon')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('the column header cells have the green background applied', () => {
    render(<DocumentList pdfs={[]} hasLoaded />);

    const headerCell = screen.getByText('Name').closest('.MuiTableCell-root');
    expect(headerCell).toHaveStyle({ backgroundColor: 'var(--background-green)' });
  });

  test('the header shows five status counts derived from the pdfs prop', () => {
    render(
      <DocumentList
        hasLoaded
        pdfs={[
          row({ pdfId: '1', status: 'COMPLETED' }),
          row({ pdfId: '2', status: 'COMPLETED' }),
          row({ pdfId: '3', status: 'EXTRACTION_IN_PROGRESS' }),
          row({ pdfId: '4', status: 'READY_FOR_REVIEW' }),
          row({ pdfId: '5', status: 'LOADED' }),
          row({ pdfId: '6', status: 'INITIALISED' }),
          row({ pdfId: '7', status: 'ALLOCATED' }),
          row({ pdfId: '8', status: 'ERROR' }),
        ]}
      />,
    );

    // All includes ERROR; there is no separate ERROR header chip.
    expect(screen.getByTestId('count-all')).toHaveTextContent('8');
    expect(screen.getByTestId('count-complete')).toHaveTextContent('2');
    expect(screen.getByTestId('count-inProgress')).toHaveTextContent('1');
    expect(screen.getByTestId('count-ready')).toHaveTextContent('1');
    // Processing = ALLOCATED + INITIALISED + LOADED.
    expect(screen.getByTestId('count-processing')).toHaveTextContent('3');

    const header = screen.getByTestId('status-summary');
    ['All', 'Complete', 'In Progress', 'Ready', 'Processing'].forEach((label) =>
      expect(within(header).getByText(label)).toBeInTheDocument(),
    );
  });

  test('the header renders with zero counts when the list is empty', () => {
    render(<DocumentList pdfs={[]} hasLoaded />);

    expect(screen.getByTestId('count-all')).toHaveTextContent('0');
    expect(screen.getByTestId('count-complete')).toHaveTextContent('0');
    expect(screen.getByTestId('count-inProgress')).toHaveTextContent('0');
    expect(screen.getByTestId('count-ready')).toHaveTextContent('0');
    expect(screen.getByTestId('count-processing')).toHaveTextContent('0');
  });

  test('renders rows from props', () => {
    render(<DocumentList pdfs={[row()]} hasLoaded />);

    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('Jun 11, 2026')).toBeInTheDocument();

    // "Complete" also appears as a header summary label, so scope to the row.
    const tableRow = screen.getByText('doc.pdf').closest('tr');
    expect(within(tableRow).getByText('Complete')).toBeInTheDocument();
    expect(within(tableRow).getByText('3')).toBeInTheDocument();
  });

  test('an unknown status falls back to the raw value as the chip label', () => {
    render(<DocumentList pdfs={[row({ status: 'SOMETHING_NEW' })]} hasLoaded />);

    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });

  test('an ERROR row shows the Error chip with the reason in a tooltip', async () => {
    render(
      <DocumentList
        pdfs={[row({ name: 'bad.pdf', status: 'ERROR', error: 'Uploaded file is not a PDF', pageCount: null })]}
        hasLoaded
      />,
    );

    const chipLabel = screen.getByText('Error');
    expect(chipLabel).toBeInTheDocument();

    await userEvent.hover(chipLabel);
    expect(await screen.findByText('Uploaded file is not a PDF')).toBeInTheDocument();
  });

  test('inactive rows are not clickable; active rows call onSelectPdf with the pdfId', async () => {
    const onSelectPdf = jest.fn();
    render(
      <DocumentList
        pdfs={[
          row({ pdfId: 'p1', name: 'init.pdf', status: 'INITIALISED', pageCount: 1 }),
          row({ pdfId: 'p2', name: 'done.pdf', status: 'COMPLETED', pageCount: 2 }),
        ]}
        hasLoaded
        onSelectPdf={onSelectPdf}
      />,
    );

    await userEvent.click(screen.getByText('init.pdf'));
    expect(onSelectPdf).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('done.pdf'));
    expect(onSelectPdf).toHaveBeenCalledWith('p2');
  });

  test('an ALLOCATED row is non-clickable, shows -/- and a Processing chip with a 10% bar', async () => {
    const onSelectPdf = jest.fn();
    render(
      <DocumentList
        pdfs={[row({ pdfId: 'pa', name: 'pending.pdf', status: 'ALLOCATED', created: null, pageCount: null })]}
        hasLoaded
        onSelectPdf={onSelectPdf}
      />,
    );

    const tableRow = screen.getByText('pending.pdf').closest('tr');
    expect(within(tableRow).getByText('Processing')).toBeInTheDocument();
    expect(within(tableRow).getByTestId('status-progress-fill')).toHaveStyle({ width: '10%' });
    // Uploaded date, size and page count all render as '-'.
    expect(within(tableRow).getAllByText('-').length).toBe(3);

    await userEvent.click(screen.getByText('pending.pdf'));
    expect(onSelectPdf).not.toHaveBeenCalled();
  });

  // Size column: bytes are formatted into B/KB/MB with band-dependent precision.
  test.each([
    [15_000_000, '15 MB'], // > 10M: whole MB
    [10_000_001, '10 MB'],
    [2_500_000, '2.5 MB'], // > 999_999: one-decimal MB
    [1_000_000, '1.0 MB'],
    [50_000, '50 KB'], // > 10_000: whole KB
    [10_001, '10 KB'],
    [2_500, '2.5 KB'], // > 999: one-decimal KB
    [1_000, '1.0 KB'],
    [999, '999 B'], // <= 999: bytes
    [0, '0 B'],
  ])('size %d bytes renders as %s', (size, expected) => {
    render(<DocumentList pdfs={[row({ size })]} hasLoaded />);

    const tableRow = screen.getByText('doc.pdf').closest('tr');
    expect(within(tableRow).getByText(expected)).toBeInTheDocument();
  });

  test('a row without a size renders the size cell as -', () => {
    render(<DocumentList pdfs={[row({ size: undefined, created: null, pageCount: null })]} hasLoaded />);

    const tableRow = screen.getByText('doc.pdf').closest('tr');
    // Uploaded, size and pages all fall back to '-'.
    expect(within(tableRow).getAllByText('-').length).toBe(3);
  });

  // Colour-token VALUES (the pale/strong pairs) cannot be asserted under jsdom: sx
  // compiles to an emotion class that getComputedStyle does not resolve, and jsdom's
  // inline-style parser drops var() values. So these tests assert the meaningful,
  // observable structure — label, dot, and progress geometry — and the colour tokens
  // are verified in the manual testing stage. The progress-fill width is set via an
  // inline style (a plain percentage jsdom keeps), so it IS asserted here.

  // Dot+chip statuses with no progress bar. "Complete"/"In Progress"/"Ready" also
  // appear as header summary labels, so assertions are scoped to the row.
  test.each([
    ['COMPLETED', 'Complete'],
    ['EXTRACTION_IN_PROGRESS', 'In Progress'],
    ['READY_FOR_REVIEW', 'Ready'],
    ['ERROR', 'Error'],
  ])('status %s renders the "%s" dot+chip with no progress bar', (status, label) => {
    render(<DocumentList pdfs={[row({ status, error: 'x' })]} hasLoaded />);

    const tableRow = screen.getByText('doc.pdf').closest('tr');
    expect(within(tableRow).getByText(label)).toBeInTheDocument();
    expect(within(tableRow).getByTestId('status-dot')).toBeInTheDocument();
    expect(within(tableRow).queryByTestId('status-progress-fill')).not.toBeInTheDocument();
  });

  // VALIDATING is a mapped status: a "Validating" chip, no progress bar, and the
  // row stays clickable so a document being validated can be reopened.
  test('a VALIDATING row shows the Validating chip with no progress bar', () => {
    render(<DocumentList pdfs={[row({ status: 'VALIDATING' })]} hasLoaded />);

    const tableRow = screen.getByText('doc.pdf').closest('tr');
    expect(within(tableRow).getByText('Validating')).toBeInTheDocument();
    expect(within(tableRow).queryByText('VALIDATING')).not.toBeInTheDocument();
    expect(within(tableRow).getByTestId('status-dot')).toBeInTheDocument();
    expect(within(tableRow).queryByTestId('status-progress-fill')).not.toBeInTheDocument();
  });

  test('a VALIDATING row is clickable and calls onSelectPdf with the pdfId', async () => {
    const onSelectPdf = jest.fn();
    render(
      <DocumentList
        pdfs={[row({ pdfId: 'pv', name: 'validating.pdf', status: 'VALIDATING' })]}
        hasLoaded
        onSelectPdf={onSelectPdf}
      />,
    );

    await userEvent.click(screen.getByText('validating.pdf'));
    expect(onSelectPdf).toHaveBeenCalledWith('pv');
  });

  test.each([
    ['ALLOCATED', '10%'],
    ['INITIALISED', '30%'],
    ['LOADED', '60%'],
  ])('status %s renders a Processing dot+chip with a %s progress-bar fill', (status, width) => {
    render(<DocumentList pdfs={[row({ status })]} hasLoaded />);

    const tableRow = screen.getByText('doc.pdf').closest('tr');
    expect(within(tableRow).getByText('Processing')).toBeInTheDocument();
    expect(within(tableRow).getByTestId('status-dot')).toBeInTheDocument();
    expect(within(tableRow).getByTestId('status-progress-fill')).toHaveStyle({ width });
  });

  // The three elements this screen's hints point at. Each id is read from its config
  // function, the same one the copy module keys the tip by, so neither side carries the
  // string: an id that only matched by accident would show up as a hint that highlights
  // nothing rather than as a failure.
  test('the counts row, the table and every row status carry their help ids', () => {
    render(
      <DocumentList
        pdfs={[row({ pdfId: '1' }), row({ pdfId: '2', name: 'other.pdf' })]}
        hasLoaded
      />,
    );

    expect(screen.getByTestId('status-summary')).toHaveAttribute(
      'data-help-id',
      documentListCountsHelpId(),
    );

    const tableContainer = document.querySelector(
      `[data-help-id="${documentListTableHelpId()}"]`,
    );
    expect(tableContainer).toContainElement(screen.getByRole('table'));

    // One per row, not one for the column: the hint is about a document's status.
    expect(
      document.querySelectorAll(`[data-help-id="${documentListStatusHelpId()}"]`),
    ).toHaveLength(2);
  });
});
