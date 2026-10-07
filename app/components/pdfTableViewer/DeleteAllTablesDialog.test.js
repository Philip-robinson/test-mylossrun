import { fireEvent, render, screen } from '@testing-library/react';
import DeleteAllTablesDialog from 'components/pdfTableViewer/DeleteAllTablesDialog';
import {
  deleteAllCancelLabel,
  deleteAllTablesBody,
  deleteAllTablesTitle,
  deleteAllYesAllLabel,
  deleteAllYesPageLabel,
} from 'config';

const BUTTON_IDS = ['delete-all-cancel', 'delete-all-yes-all', 'delete-all-yes-page'];

function renderDialog(open) {
  const callbacks = {
    onCancel: jest.fn(),
    onDeleteAll: jest.fn(),
    onDeletePage: jest.fn(),
  };
  render(<DeleteAllTablesDialog open={open} {...callbacks} />);
  return callbacks;
}

describe('DeleteAllTablesDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog(false);
    expect(screen.queryByTestId('delete-all-dialog')).toBeNull();
    for (const id of BUTTON_IDS) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('shows the title, body and button labels from config when open', () => {
    renderDialog(true);
    expect(screen.getByTestId('delete-all-dialog')).toBeInTheDocument();
    expect(screen.getByText(deleteAllTablesTitle())).toBeInTheDocument();
    expect(screen.getByText(deleteAllTablesBody())).toBeInTheDocument();
    expect(screen.getByTestId('delete-all-cancel')).toHaveTextContent(deleteAllCancelLabel());
    expect(screen.getByTestId('delete-all-yes-all')).toHaveTextContent(deleteAllYesAllLabel());
    expect(screen.getByTestId('delete-all-yes-page')).toHaveTextContent(deleteAllYesPageLabel());
  });

  it('places the buttons in cancel, all, page order', () => {
    renderDialog(true);
    const order = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'))
      .filter((id) => BUTTON_IDS.includes(id));
    expect(order).toEqual(BUTTON_IDS);
  });

  it.each([
    ['delete-all-cancel', 'onCancel'],
    ['delete-all-yes-all', 'onDeleteAll'],
    ['delete-all-yes-page', 'onDeletePage'],
  ])('%s calls only %s, once', (id, name) => {
    const callbacks = renderDialog(true);
    fireEvent.click(screen.getByTestId(id));
    for (const [key, fn] of Object.entries(callbacks)) {
      expect(fn).toHaveBeenCalledTimes(key === name ? 1 : 0);
    }
  });

  it('calls onCancel when Escape is pressed', () => {
    const callbacks = renderDialog(true);
    fireEvent.keyDown(screen.getByTestId('delete-all-dialog'), { key: 'Escape' });
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onDeleteAll).not.toHaveBeenCalled();
    expect(callbacks.onDeletePage).not.toHaveBeenCalled();
  });
});
