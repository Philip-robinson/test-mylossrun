import { render, screen, fireEvent } from '@testing-library/react';
import LayersPanel from 'components/pdfTableViewer/LayersPanel';

// A table with two rows, three columns, a header, one section title and a name, so every
// row's count is distinguishable.
const TABLE = {
  tableId: 't1',
  name: 'Table one',
  rowHeights: [{ value: 0.5 }, { value: 0.5 }],
  columnWidths: [{ value: 0.3 }, { value: 0.3 }, { value: 0.4 }],
  headerCount: 1,
  sectionTitles: [{ tableRow: 1, delete: true, columnName: null, data: null }],
};

const renderPanel = (props = {}) =>
  render(
    <LayersPanel
      editorMode={'border'}
      layerVisibility={{ rows: true, columns: true, special: true, colours: true }}
      onToggleLayer={() => {}}
      selectedTable={TABLE}
      samePageTables={[TABLE, { tableId: 't2' }]}
      pageColouredAreas={[{ left: 0, top: 0, width: 1, height: 1 }]}
      onPrev={() => {}}
      onNext={() => {}}
      onValidateTables={() => {}}
      {...props}
    />
  );

// A row's text is its label followed by its count; the label is what is left when the
// trailing digits come off.
const labels = () =>
  screen
    .getAllByTestId('layer-row')
    .map((row) => row.textContent.replace(/\d+$/, ''));

describe('LayersPanel', () => {
  describe('borderMode', () => {
    it('lists Borders alone, with the Validate Tables button', () => {
      renderPanel({ editorMode: 'border' });
      expect(screen.getAllByTestId('layer-row')).toHaveLength(1);
      expect(screen.getByText('Borders')).toBeInTheDocument();
      expect(screen.getByTestId('layers-validate-tables')).toBeInTheDocument();
    });

    it('gives the Borders row no eye, since it is always drawn', () => {
      renderPanel({ editorMode: 'border' });
      expect(screen.queryByTestId('layer-eye')).toBeNull();
      expect(screen.queryByTestId('layer-eye-off')).toBeNull();
    });

    it('calls onValidateTables when the button is clicked', () => {
      const onValidateTables = jest.fn();
      renderPanel({ editorMode: 'border', onValidateTables });
      fireEvent.click(screen.getByTestId('layers-validate-tables'));
      expect(onValidateTables).toHaveBeenCalledTimes(1);
    });
  });

  describe('gridMode', () => {
    it('lists Rows, Columns, Special Areas and Colours in that order', () => {
      renderPanel({ editorMode: 'grid' });
      expect(labels()).toEqual(['Rows', 'Columns', 'Special Areas', 'Colours']);
    });

    it('offers no Validate Tables button', () => {
      renderPanel({ editorMode: 'grid' });
      expect(screen.queryByTestId('layers-validate-tables')).toBeNull();
    });

    it('shows each row on or off according to layerVisibility', () => {
      renderPanel({
        editorMode: 'grid',
        layerVisibility: { rows: true, columns: false, special: true, colours: false },
      });
      const states = screen
        .getAllByTestId('layer-row')
        .map((row) => row.getAttribute('data-on'));
      expect(states).toEqual(['true', 'false', 'true', 'false']);
    });

    it('reports the layer key when a row is clicked', () => {
      const onToggleLayer = jest.fn();
      renderPanel({ editorMode: 'grid', onToggleLayer });
      fireEvent.click(screen.getAllByTestId('layer-row')[2]);
      expect(onToggleLayer).toHaveBeenCalledWith('special');
    });

    it('counts rows, columns, special areas and coloured areas', () => {
      renderPanel({ editorMode: 'grid' });
      const counts = screen
        .getAllByTestId('layer-count')
        .map((c) => c.textContent);
      // 2 rows, 3 columns, header + one section title = 2 specials, 1 coloured area.
      expect(counts).toEqual(['2', '3', '2', '1']);
    });
  });

  it('renders the selected table name under the heading', () => {
    renderPanel();
    expect(screen.getByTestId('layers-table-name')).toHaveTextContent('Table one');
  });

  it('forwards Previous and Next', () => {
    const onPrev = jest.fn();
    const onNext = jest.fn();
    renderPanel({ onPrev, onNext });
    fireEvent.click(screen.getByTestId('layers-prev'));
    fireEvent.click(screen.getByTestId('layers-next'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
