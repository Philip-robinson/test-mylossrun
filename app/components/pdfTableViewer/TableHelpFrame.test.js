import { render, screen } from '@testing-library/react';
import TableHelpFrame from 'components/pdfTableViewer/TableHelpFrame';
import { editorPageTableHelpId } from 'config';

const table = { tableId: 't1', name: 'Alpha' };

describe('TableHelpFrame', () => {
  const renderFrame = (props = {}) =>
    render(
      <TableHelpFrame
        table={table}
        left={10}
        top={20}
        width={200}
        height={120}
        {...props}
      />
    );

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the page-table help id and the table it stands for', () => {
    renderFrame();
    const frame = screen.getByTestId('table-help-frame');

    expect(frame).toHaveAttribute('data-help-id', editorPageTableHelpId());
    expect(frame).toHaveAttribute('data-tableid', 't1');
  });

  it("takes the table's box", () => {
    renderFrame();
    const frame = screen.getByTestId('table-help-frame');

    expect(frame.style.left).toBe('10px');
    expect(frame.style.top).toBe('20px');
    expect(frame.style.width).toBe('200px');
    expect(frame.style.height).toBe('120px');
  });

  // Inert, so the editor's own gestures reach the overlay SVG beneath it. The help
  // overlay finds it by its rect instead.
  it('takes no pointer events', () => {
    renderFrame();

    expect(screen.getByTestId('table-help-frame').style.pointerEvents).toBe(
      'none'
    );
  });
});
