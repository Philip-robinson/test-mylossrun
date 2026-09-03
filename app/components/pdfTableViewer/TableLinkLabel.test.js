import { render, screen, fireEvent } from '@testing-library/react';
import TableLinkLabel from 'components/pdfTableViewer/TableLinkLabel';
import { tableLinkLabelHelpId } from 'config';
import {
  LINK_LABEL_END_LINKING,
  LINK_LABEL_JOINED,
  LINK_LABEL_PLAIN,
  LINK_LABEL_ROOT,
} from 'components/pdfTableViewer/tableSupportUtils';

const table = { tableId: 't1', name: 'Alpha' };

describe('TableLinkLabel', () => {
  const renderLabel = (props = {}) =>
    render(
      <TableLinkLabel
        table={table}
        left={'90px'}
        top={'20px'}
        colour={'var(--border-colour)'}
        colourName={'border'}
        state={LINK_LABEL_PLAIN}
        text={'Selected'}
        onClick={() => {}}
        {...props}
      />
    );

  it('shows the text it is given', () => {
    renderLabel({ state: LINK_LABEL_ROOT, text: 'Linked' });
    expect(screen.getByTestId('link-label')).toHaveTextContent('Linked');
  });

  it('carries the table id, the colour and the state', () => {
    renderLabel({ state: LINK_LABEL_END_LINKING, colourName: 'emphasis' });
    const label = screen.getByTestId('link-label');
    expect(label).toHaveAttribute('data-tableid', 't1');
    expect(label).toHaveAttribute('data-colour', 'emphasis');
    expect(label).toHaveAttribute('data-state', LINK_LABEL_END_LINKING);
  });

  it('reports its table when clicked', () => {
    const onClick = jest.fn();
    renderLabel({ onClick });
    fireEvent.click(screen.getByTestId('link-label'));
    expect(onClick).toHaveBeenCalledWith(table);
  });

  it('is inert while the table is joined into another table group', () => {
    const onClick = jest.fn();
    renderLabel({
      state: LINK_LABEL_JOINED,
      text: 'Linked to Root',
      onClick,
    });
    fireEvent.click(screen.getByTestId('link-label'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the link-label help id', () => {
    renderLabel();

    expect(screen.getByTestId('link-label')).toHaveAttribute(
      'data-help-id',
      tableLinkLabelHelpId()
    );
  });
});
