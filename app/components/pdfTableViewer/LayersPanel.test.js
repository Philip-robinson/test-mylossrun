import { render, screen, fireEvent } from '@testing-library/react';
import LayersPanel from 'components/pdfTableViewer/LayersPanel';
import {
  layersColoursHelpId,
  layersColumnsHelpId,
  layersNextHelpId,
  layersPanelHelpId,
  layersPreviousHelpId,
  layersRowsHelpId,
  layersSpecialHelpId,
  validateBordersHelpId,
  validateTablesHelpId,
} from 'config';

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
      expect(screen.queryByTestId('layers-validate-borders')).toBeNull();
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

    it('offers Validate Borders in place of Validate Tables', () => {
      renderPanel({ editorMode: 'grid' });
      expect(screen.queryByTestId('layers-validate-tables')).toBeNull();
      expect(screen.getByTestId('layers-validate-borders')).toHaveTextContent(
        'Validate Borders'
      );
    });

    it('calls onValidateBorders when that button is clicked', () => {
      const onValidateBorders = jest.fn();
      renderPanel({ editorMode: 'grid', onValidateBorders });
      fireEvent.click(screen.getByTestId('layers-validate-borders'));
      expect(onValidateBorders).toHaveBeenCalledTimes(1);
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

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the help ids of the panel and of its three buttons', () => {
    renderPanel();

    expect(screen.getByTestId('layers-panel')).toHaveAttribute(
      'data-help-id',
      layersPanelHelpId()
    );
    expect(screen.getByTestId('layers-prev')).toHaveAttribute(
      'data-help-id',
      layersPreviousHelpId()
    );
    expect(screen.getByTestId('layers-next')).toHaveAttribute(
      'data-help-id',
      layersNextHelpId()
    );
    expect(screen.getByTestId('layers-validate-tables')).toHaveAttribute(
      'data-help-id',
      validateTablesHelpId()
    );
  });

  // The contents pass describes each layer it lists, in the order the panel lists them.
  it('carries a help id on every layer row it lists in gridMode', () => {
    renderPanel({ editorMode: 'grid' });

    expect(
      screen.getAllByTestId('layer-row').map((row) => row.getAttribute('data-help-id')),
    ).toEqual([
      layersRowsHelpId(),
      layersColumnsHelpId(),
      layersSpecialHelpId(),
      layersColoursHelpId(),
    ]);
  });

  // Borders is the boundary pass's one row, always drawn, and that pass describes it
  // through its own tips rather than as a layer.
  it('leaves the Borders row unannotated', () => {
    renderPanel();

    expect(screen.getByTestId('layer-row')).not.toHaveAttribute('data-help-id');
  });

  // The pass switch wears one label in each pass and each pass describes the label it
  // shows, so the two faces of the one button carry an id apiece.
  it('carries the validate-borders help id in gridMode', () => {
    renderPanel({ editorMode: 'grid' });

    expect(screen.getByTestId('layers-validate-borders')).toHaveAttribute(
      'data-help-id',
      validateBordersHelpId()
    );
  });
});
