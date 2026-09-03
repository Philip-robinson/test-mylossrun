import { render, screen } from '@testing-library/react';
import TableNameSizeLabel from 'components/pdfTableViewer/TableNameSizeLabel';
import { tableNameLabelHelpId } from 'config';

const table = {
  tableId: 't1',
  name: 'Alpha',
  columnWidths: [{ value: 1 }, { value: 1 }, { value: 1 }],
  rowHeights: [{ value: 1 }, { value: 1 }],
};

describe('TableNameSizeLabel', () => {
  const renderLabel = (props = {}) =>
    render(
      <TableNameSizeLabel
        table={table}
        left={'10px'}
        top={'20px'}
        colour={'var(--border-colour)'}
        colourName={'border'}
        {...props}
      />
    );

  it('shows the table name and its column x row size', () => {
    renderLabel();
    expect(screen.getByTestId('selected-label-name')).toHaveTextContent('Alpha');
    expect(screen.getByTestId('selected-label-size')).toHaveTextContent('3 × 2');
  });

  it('carries the table id and the colour it took', () => {
    renderLabel();
    const label = screen.getByTestId('selected-label');
    expect(label).toHaveAttribute('data-tableid', 't1');
    expect(label).toHaveAttribute('data-colour', 'border');
  });

  it('sits where it is placed', () => {
    renderLabel();
    const label = screen.getByTestId('selected-label');
    expect(label.style.left).toBe('10px');
    expect(label.style.top).toBe('20px');
  });

  it('counts a table with no axes as 0 x 0', () => {
    renderLabel({ table: { tableId: 't2', name: 'Empty' } });
    expect(screen.getByTestId('selected-label-size')).toHaveTextContent('0 × 0');
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the table-name help id', () => {
    renderLabel();

    expect(screen.getByTestId('selected-label')).toHaveAttribute(
      'data-help-id',
      tableNameLabelHelpId()
    );
  });
});
