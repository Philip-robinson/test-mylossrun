import { render, screen, fireEvent } from '@testing-library/react';
import AdditionalTablesList from 'components/pdfTableViewer/AdditionalTablesList';

const tables = [
  { tableId: 'a', name: 'Alpha', pdfPage: 0 },
  { tableId: 'b', name: 'Bravo', pdfPage: 2 },
];

describe('AdditionalTablesList', () => {
  const renderList = (props = {}) =>
    render(
      <AdditionalTablesList tables={tables} onSelect={() => {}} {...props} />
    );

  it('lists each table with its page, in the order given', () => {
    renderList();
    expect(
      screen.getAllByTestId('additional-table-entry').map((e) => e.textContent)
    ).toEqual(['Alpha — page 1', 'Bravo — page 3']);
  });

  it('reports the table whose row is clicked', () => {
    const onSelect = jest.fn();
    renderList({ onSelect });
    fireEvent.click(screen.getAllByTestId('additional-table-entry')[1]);
    expect(onSelect).toHaveBeenCalledWith(tables[1]);
  });

  it('marks the selected row', () => {
    renderList({ selectedTableId: 'b' });
    expect(
      screen.getAllByTestId('additional-table-entry').map((e) =>
        e.getAttribute('data-selected')
      )
    ).toEqual(['false', 'true']);
  });

  it('renders nothing but the container for an empty list', () => {
    renderList({ tables: [] });
    expect(screen.getByTestId('additional-tables-list')).toBeEmptyDOMElement();
  });
});
