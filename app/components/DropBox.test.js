import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DropBox from './DropBox';
import { upload } from 'services/upload';
import toast from 'react-hot-toast';
import { dropBoxHelpId } from 'config';

// Mock the upload service (only backend access path).
jest.mock('services/upload', () => ({
  upload: jest.fn(),
}));

// Mock react-hot-toast: default export is a callable with an `error` method.
jest.mock('react-hot-toast', () => {
  const fn = jest.fn();
  fn.error = jest.fn();
  fn.success = jest.fn();
  return { __esModule: true, default: fn, Toaster: () => null };
});

// Build a native drop/drag event carrying a dataTransfer.files array,
// since jsdom does not populate dataTransfer on its own.
function createDataTransferEvent(type, files) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files },
    writable: false,
  });
  return event;
}

function pdfFile(name = 'a.pdf') {
  return new File(['x'], name, { type: 'application/pdf' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DropBox', () => {
  test('(a) drop calls upload with the dropped file', async () => {
    upload.mockResolvedValue({ success: true, pdfId: '1' });
    const { container } = render(<DropBox />);

    const dropZone = container.querySelector('.drop-box');
    expect(dropZone).toBeInTheDocument();

    const file = pdfFile();
    fireEvent(dropZone, createDataTransferEvent('drop', [file]));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(file);
  });

  test('(b) click-to-upload calls upload with the chosen file', async () => {
    upload.mockResolvedValue({ success: true, pdfId: '1' });
    render(<DropBox />);

    const input = screen.getByTestId('drop-box-input');
    const file = pdfFile('chosen.pdf');

    // Triggering the native picker click is not assertable in jsdom;
    // exercising the input's onChange path is sufficient.
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(file);
  });

  test('(c) empty drop is a no-op', async () => {
    render(<DropBox />);

    const dropZone = document.querySelector('.drop-box');
    fireEvent(dropZone, createDataTransferEvent('drop', []));

    // Give any async work a tick; upload must never be called.
    await Promise.resolve();
    expect(upload).not.toHaveBeenCalled();
  });

  test('(d) calls onUploaded with the returned pdfId and the file name on success', async () => {
    upload.mockResolvedValue({ success: true, pdfId: 'pdf-xyz' });
    const onUploaded = jest.fn();
    const { container } = render(<DropBox onUploaded={onUploaded} />);

    const file = pdfFile('report.pdf');
    fireEvent(container.querySelector('.drop-box'), createDataTransferEvent('drop', [file]));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('pdf-xyz', 'report.pdf'));
  });

  test('(e) upload failure surfaces an error', async () => {
    upload.mockRejectedValue(new Error('boom'));
    const { container } = render(<DropBox />);

    const dropZone = container.querySelector('.drop-box');
    fireEvent(dropZone, createDataTransferEvent('drop', [pdfFile()]));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Inline error text also appears.
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  // The help overlay measures its hint's hole from this attribute, and the copy module
  // keys the same tip by the same function, so the id is read from config on both sides
  // rather than written out here.
  test('(f) the drop panel carries the drop-box help id', () => {
    const { container } = render(<DropBox />);

    expect(container.querySelector('.drop-box')).toHaveAttribute(
      'data-help-id',
      dropBoxHelpId(),
    );
  });
});
