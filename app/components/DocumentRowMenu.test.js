import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { documentListActionsHelpId } from 'config';

import DocumentRowMenu from 'components/DocumentRowMenu';

describe('DocumentRowMenu', () => {
  const completedPdf = { pdfId: 'p1', name: 'losses.pdf', status: 'COMPLETED', tableCount: 2 };

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function renderMenu({
    pdf = completedPdf,
    onDownloadOriginal = jest.fn().mockResolvedValue(undefined),
    onExport = jest.fn().mockResolvedValue(undefined),
  } = {}) {
    const parentClick = jest.fn();
    render(
      <div onClick={parentClick}>
        <DocumentRowMenu pdf={pdf} onDownloadOriginal={onDownloadOriginal} onExport={onExport} />
      </div>
    );
    return { parentClick, onDownloadOriginal, onExport };
  }

  const button = () => screen.getByTestId('document-row-menu-button');

  it('opens a menu of Download Original and Export without clicking the row', async () => {
    const { parentClick } = renderMenu();

    await userEvent.click(button());

    expect(screen.getByTestId('document-row-download-original')).toHaveTextContent(
      'Download Original'
    );
    expect(screen.getByTestId('document-row-export')).toHaveTextContent('Export');
    expect(parentClick).not.toHaveBeenCalled();
  });

  it.each([
    ['document-row-download-original', 'onDownloadOriginal'],
    ['document-row-export', 'onExport'],
  ])('choosing %s calls %s with the pdf and closes the menu', async (testId, handlerName) => {
    const handlers = renderMenu();

    await userEvent.click(button());
    await userEvent.click(screen.getByTestId(testId));

    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    expect(handlers[handlerName]).toHaveBeenCalledWith(completedPdf);
    await waitFor(() => expect(screen.queryByTestId(testId)).not.toBeInTheDocument());
    expect(handlers.parentClick).not.toHaveBeenCalled();
  });

  it.each([
    ['resolves', (d) => d.resolve()],
    ['rejects', (d) => d.reject(new Error('boom'))],
  ])('is busy while the action is pending and idle once it %s', async (_label, settle) => {
    const pending = deferred();
    renderMenu({ onDownloadOriginal: jest.fn(() => pending.promise) });

    await userEvent.click(button());
    await userEvent.click(screen.getByTestId('document-row-download-original'));

    expect(button()).toHaveAttribute('data-busy', 'true');
    expect(button()).toBeDisabled();

    settle(pending);

    await waitFor(() => expect(button()).toHaveAttribute('data-busy', 'false'));
    expect(button()).toBeEnabled();
  });

  it.each([
    [{ status: 'ALLOCATED' }, true, true],
    [{ status: 'LOADED' }, false, true],
    [{ status: 'COMPLETED', tableCount: 0 }, false, true],
    [{ status: 'READY_FOR_REVIEW', tableCount: null }, false, false],
  ])('for %o disables download=%s and export=%s', async (fields, downloadDisabled, exportDisabled) => {
    renderMenu({ pdf: { pdfId: 'p1', name: 'losses.pdf', ...fields } });

    await userEvent.click(button());

    const expected = (disabled) => (disabled ? 'true' : null);
    expect(
      screen.getByTestId('document-row-download-original').getAttribute('aria-disabled')
    ).toBe(expected(downloadDisabled));
    expect(screen.getByTestId('document-row-export').getAttribute('aria-disabled')).toBe(
      expected(exportDisabled)
    );
  });

  it('carries the help id, so the overlay can describe it', () => {
    renderMenu();

    expect(button()).toHaveAttribute('data-help-id', documentListActionsHelpId());
  });
});
