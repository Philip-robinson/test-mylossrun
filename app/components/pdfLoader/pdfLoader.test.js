import { render, screen, waitFor, act } from '@testing-library/react';
import PDFLoader from 'components/pdfLoader/pdfLoader';
import { getPdfDisplayList } from 'services/pdfDisplayList';
import { awaitEntryChange } from 'services/awaitEntryChange';
import { resetPdfListCache } from 'components/pdfLoader/pdfListCache';

let capturedDocumentListProps;
let capturedOnUploaded;

jest.mock('components/DropBox', () => ({
  __esModule: true,
  default: (props) => {
    capturedOnUploaded = props.onUploaded;
    return <div data-testid="dropbox" />;
  },
}));

jest.mock('components/DocumentList', () => ({
  __esModule: true,
  default: (props) => {
    capturedDocumentListProps = props;
    return <div data-testid="document-list" />;
  },
}));

jest.mock('services/pdfDisplayList', () => ({
  getPdfDisplayList: jest.fn(),
  sleep: jest.fn(() => Promise.resolve()),
}));

jest.mock('services/awaitEntryChange', () => ({
  awaitEntryChange: jest.fn(),
}));

jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.dismiss = jest.fn();
  return { __esModule: true, default: toast };
});

// A promise that never settles — parks a loop after its scripted results.
const never = () => new Promise(() => {});

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPdfListCache();
  capturedDocumentListProps = undefined;
  capturedOnUploaded = undefined;
  // Default: one empty poll then park; no watch activity.
  getPdfDisplayList.mockResolvedValueOnce({ pdfs: [], lastModified: 'x' }).mockReturnValue(never());
  awaitEntryChange.mockReturnValue(never());
});

describe('PDFLoader', () => {
  test('renders DropBox and DocumentList', async () => {
    render(<PDFLoader onSelectPdf={() => {}} />);
    expect(screen.getByTestId('dropbox')).toBeInTheDocument();
    expect(screen.getByTestId('document-list')).toBeInTheDocument();
    // Let the mount poll settle so its state update runs inside act().
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));
  });

  test('forwards onSelectPdf to DocumentList', async () => {
    const onSelectPdf = jest.fn();
    render(<PDFLoader onSelectPdf={onSelectPdf} />);
    expect(capturedDocumentListProps.onSelectPdf).toBe(onSelectPdf);
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));
  });

  test('polls on mount and passes the fetched pdfs to DocumentList', async () => {
    getPdfDisplayList.mockReset();
    getPdfDisplayList
      .mockResolvedValueOnce({ pdfs: [{ pdfId: 'a', name: 'a.pdf', status: 'COMPLETED' }], lastModified: 'x' })
      .mockReturnValue(never());

    render(<PDFLoader onSelectPdf={() => {}} />);

    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));
    expect(capturedDocumentListProps.pdfs).toEqual([
      { pdfId: 'a', name: 'a.pdf', status: 'COMPLETED' },
    ]);
  });

  test('onUploaded prepends an ALLOCATED optimistic row immediately', async () => {
    render(<PDFLoader onSelectPdf={() => {}} />);
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));

    await act(async () => {
      capturedOnUploaded('pdf-x', 'new.pdf');
    });

    const rows = capturedDocumentListProps.pdfs;
    expect(rows[0]).toMatchObject({ pdfId: 'pdf-x', name: 'new.pdf', status: 'ALLOCATED', created: null, pageCount: null });
  });

  test('the watch upserts the changed entry by pdfId and stops at READY_FOR_REVIEW', async () => {
    awaitEntryChange.mockReset();
    awaitEntryChange
      .mockResolvedValueOnce({
        entry: { pdfId: 'pdf-x', name: 'new.pdf', status: 'READY_FOR_REVIEW', created: '2026-07-16T00:00:00Z', pageCount: 4 },
        lastModified: 'lm-1',
      })
      .mockReturnValue(never());

    render(<PDFLoader onSelectPdf={() => {}} />);
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));

    await act(async () => {
      capturedOnUploaded('pdf-x', 'new.pdf');
    });

    await waitFor(() => {
      const target = capturedDocumentListProps.pdfs.find((p) => p.pdfId === 'pdf-x');
      expect(target.status).toBe('READY_FOR_REVIEW');
    });
    const target = capturedDocumentListProps.pdfs.find((p) => p.pdfId === 'pdf-x');
    expect(target).toMatchObject({ pageCount: 4, created: '2026-07-16T00:00:00Z' });
    // Stopped after the terminal status: only one awaitEntryChange call.
    expect(awaitEntryChange).toHaveBeenCalledTimes(1);
  });

  test('a remount seeds from the cache and resumes the poll from the last date', async () => {
    getPdfDisplayList.mockReset();
    // First mount: one 200 with a row and a Last-Modified, then park.
    getPdfDisplayList
      .mockResolvedValueOnce({ pdfs: [{ pdfId: 'a', name: 'a.pdf', status: 'COMPLETED' }], lastModified: 'lm-1' })
      .mockReturnValue(never());

    const { unmount } = render(<PDFLoader onSelectPdf={() => {}} />);
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));
    expect(capturedDocumentListProps.pdfs).toEqual([{ pdfId: 'a', name: 'a.pdf', status: 'COMPLETED' }]);

    // Leave the loader (open the editor).
    unmount();

    // Remount (return to the loader): its next poll parks on a 304, so the only
    // list the user can see comes from the cache, not a fresh fetch.
    getPdfDisplayList.mockReset();
    let seenLastModified;
    getPdfDisplayList.mockImplementation((getLastModified) => {
      seenLastModified = getLastModified();
      return never();
    });

    render(<PDFLoader onSelectPdf={() => {}} />);

    // No empty flash: the cached row and loaded flag are present on first render.
    expect(capturedDocumentListProps.hasLoaded).toBe(true);
    expect(capturedDocumentListProps.pdfs).toEqual([{ pdfId: 'a', name: 'a.pdf', status: 'COMPLETED' }]);
    // The resumed poll sends the preserved If-Modified-Since date.
    expect(seenLastModified).toBe('lm-1');
  });

  test('a poll result that omits a watched row preserves the optimistic row', async () => {
    const second = deferred();
    getPdfDisplayList.mockReset();
    getPdfDisplayList
      .mockResolvedValueOnce({ pdfs: [], lastModified: 'x' })
      .mockReturnValueOnce(second.promise)
      .mockReturnValue(never());

    render(<PDFLoader onSelectPdf={() => {}} />);
    await waitFor(() => expect(capturedDocumentListProps.hasLoaded).toBe(true));

    // Optimistic row added; its watch parks (never) so it does not interfere.
    await act(async () => {
      capturedOnUploaded('pdf-x', 'new.pdf');
    });
    expect(capturedDocumentListProps.pdfs.some((p) => p.pdfId === 'pdf-x')).toBe(true);

    // A later full-list poll comes back WITHOUT pdf-x (it lists another doc).
    await act(async () => {
      second.resolve({ pdfs: [{ pdfId: 'other', name: 'other.pdf', status: 'COMPLETED' }], lastModified: 'y' });
    });

    await waitFor(() =>
      expect(capturedDocumentListProps.pdfs.some((p) => p.pdfId === 'other')).toBe(true),
    );
    // The watched optimistic row is preserved (re-prepended), not dropped.
    expect(capturedDocumentListProps.pdfs.some((p) => p.pdfId === 'pdf-x')).toBe(true);
  });
});
