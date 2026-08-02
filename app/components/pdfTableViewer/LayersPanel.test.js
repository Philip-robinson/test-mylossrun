import { render, screen, fireEvent, within } from '@testing-library/react';
import LayersPanel from 'components/pdfTableViewer/LayersPanel';
import {
  layerBorderColour,
  layerRowsColour,
  layerColumnsColour,
  layerSpecialCellsColour,
  layerColoursColour,
} from 'config';

// Fixtures: a selected table with 3 rows, 2 columns, a header and a title, on a
// page with two tables and one coloured area.
const selectedTable = {
  tableId: 't1',
  rowHeights: [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }],
  columnWidths: [{ value: 0.2 }, { value: 0.2 }],
  headerCount: 1,
  title: { bounds: {}, text: 'A', confidence: 1 },
};
const samePageTables = [selectedTable, { tableId: 't2' }];
const pageColouredAreas = [{ left: 0, top: 0, width: 0.1, height: 0.1 }];

const mkCallbacks = () => ({
  onSelectLayer: jest.fn(),
  onToggleTick: jest.fn(),
  onPrev: jest.fn(),
  onNext: jest.fn(),
});

const renderPanel = (overrides = {}) => {
  const cbs = mkCallbacks();
  const props = {
    selectedTable,
    samePageTables,
    pageColouredAreas,
    selectedLayer: 'border',
    confirmationStage: null,
    hasPrevPage: true,
    hasNextPage: true,
    ...cbs,
    ...overrides,
  };
  const result = render(<LayersPanel {...props} />);
  // Re-render the same panel with a few props changed, so a test can watch one value move.
  const rerenderPanel = (changes) =>
    result.rerender(<LayersPanel {...props} {...changes} />);
  return { ...result, cbs, rerenderPanel };
};

// The checkbox belonging to one named row, so a test names the row rather than indexing a
// list of ticks whose length depends on which rows have one.
const tickFor = (label) =>
  within(
    screen.getByText(label).closest('[data-testid="layer-row"]'),
  ).getByRole('checkbox');

// The five rows in order, with the labels, colours and counts expected from the
// fixtures above.
const EXPECTED = [
  { label: 'Colours', colour: layerColoursColour(), count: '1' },
  { label: 'Borders', colour: layerBorderColour(), count: '2' },
  { label: 'Rows', colour: layerRowsColour(), count: '3' },
  { label: 'Columns', colour: layerColumnsColour(), count: '2' },
  { label: 'Special Areas', colour: layerSpecialCellsColour(), count: '2' },
];

describe('LayersPanel', () => {
  it('renders the Layers label and five rows with correct labels and counts', () => {
    renderPanel();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    const rows = screen.getAllByTestId('layer-row');
    expect(rows).toHaveLength(5);
    EXPECTED.forEach(({ label, count }, i) => {
      const row = rows[i];
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(within(row).getByTestId('layer-count')).toHaveTextContent(count);
    });
  });

  it('labels the border row "Borders", not "Border"', () => {
    renderPanel();
    expect(screen.getByText('Borders')).toBeInTheDocument();
    expect(screen.queryByText('Border')).toBeNull();
  });

  it('labels the special row "Special Areas", not "Special Cells"', () => {
    renderPanel();
    expect(screen.getByText('Special Areas')).toBeInTheDocument();
    expect(screen.queryByText('Special Cells')).toBeNull();
  });

  it('keeps the underlying layer keys when the relabelled rows are selected', () => {
    // Only the display labels changed: the keys forwarded to onSelectLayer are still
    // 'border' and 'special'.
    const { cbs } = renderPanel({ confirmationStage: 4 });
    fireEvent.click(screen.getByText('Borders'));
    expect(cbs.onSelectLayer).toHaveBeenCalledWith('border');
    fireEvent.click(screen.getByText('Special Areas'));
    expect(cbs.onSelectLayer).toHaveBeenCalledWith('special');
  });

  // Special Areas is the only row with a tick, because it is the only row whose tick means
  // anything. The rebuilds that hung off the Colours and Borders ticks are fired by leaving
  // those layers now. Every row still keeps a slot, so the counts stay in line.
  it('gives Special Areas the only checkbox, and every row a slot', () => {
    renderPanel({ confirmationStage: 1, selectedLayer: 'special' });
    expect(screen.getAllByTestId('layer-tick')).toHaveLength(1);
    expect(screen.getAllByTestId('layer-tick-slot')).toHaveLength(5);
    expect(tickFor('Special Areas')).toBeInTheDocument();
    for (const label of ['Colours', 'Borders', 'Rows', 'Columns']) {
      const row = screen.getByText(label).closest('[data-testid="layer-row"]');
      expect(within(row).queryByRole('checkbox')).toBeNull();
    }
  });

  it('ticks Special Areas only once its own stage is reached', () => {
    const { rerenderPanel } = renderPanel({
      confirmationStage: 4,
      selectedLayer: 'special',
    });
    expect(tickFor('Special Areas')).not.toBeChecked();
    rerenderPanel({ confirmationStage: 5 });
    expect(tickFor('Special Areas')).toBeChecked();
  });

  // Confirming a layer is a statement about the work just done on it, so the tick is live
  // only while its own row is the one being looked at.
  it('leaves the tick disabled until its own row is selected', () => {
    const { rerenderPanel } = renderPanel({
      confirmationStage: 4,
      selectedLayer: 'rows',
    });
    expect(tickFor('Special Areas')).toBeDisabled();
    rerenderPanel({ selectedLayer: 'special' });
    expect(tickFor('Special Areas')).toBeEnabled();
  });

  it('leaves the tick usable at any stage once its row is selected', () => {
    renderPanel({ confirmationStage: 0, selectedLayer: 'special' });
    expect(tickFor('Special Areas')).toBeEnabled();
  });

  // The layers are no longer gates climbed one at a time: every row selects at any stage,
  // including rows far above the one the table has reached.
  it('selects any row whatever the confirmation stage', () => {
    const { cbs } = renderPanel({ confirmationStage: 0 });
    for (const [label, key] of [
      ['Colours', 'colours'],
      ['Borders', 'border'],
      ['Rows', 'rows'],
      ['Columns', 'columns'],
      ['Special Areas', 'special'],
    ]) {
      fireEvent.click(screen.getByText(label));
      expect(cbs.onSelectLayer).toHaveBeenCalledWith(key);
    }
  });

  it('shows every row as reachable, whatever the stage', () => {
    renderPanel({ confirmationStage: 0 });
    for (const row of screen.getAllByTestId('layer-row')) {
      expect(row).toHaveStyle({ cursor: 'pointer' });
    }
  });

  it('toggling a tick calls onToggleTick(K, checked, key)', () => {
    const { cbs } = renderPanel({ confirmationStage: 4, selectedLayer: 'special' });
    fireEvent.click(tickFor('Special Areas'));
    expect(cbs.onToggleTick).toHaveBeenCalledWith(5, true, 'special');
  });

  it('unticking Special Areas selects it', () => {
    // Stage 5: the tick is on, so clicking unticks it (checked false).
    const { cbs } = renderPanel({ confirmationStage: 5, selectedLayer: 'special' });
    fireEvent.click(tickFor('Special Areas'));
    expect(cbs.onToggleTick).toHaveBeenCalledWith(5, false, 'special');
    expect(cbs.onSelectLayer).toHaveBeenCalledWith('special');
  });

  it('ticking the last row does not attempt to advance', () => {
    const { cbs } = renderPanel({ confirmationStage: 4, selectedLayer: 'special' });
    fireEvent.click(tickFor('Special Areas'));
    expect(cbs.onToggleTick).toHaveBeenCalledWith(5, true, 'special');
    expect(cbs.onSelectLayer).not.toHaveBeenCalled();
  });

  it('renders the selected table name under the heading', () => {
    renderPanel({ selectedTable: { ...selectedTable, name: 'Table 3' } });
    expect(screen.getByTestId('layers-table-name')).toHaveTextContent('Table 3');
  });

  it('renders no table-name node when there is no selected table', () => {
    renderPanel({ selectedTable: null });
    expect(screen.queryByTestId('layers-table-name')).toBeNull();
  });

  it('renders no table-name node when the selected table has no name', () => {
    renderPanel();
    expect(screen.queryByTestId('layers-table-name')).toBeNull();
  });

  it('ticking Special Areas performs Next as well as confirming the stage', () => {
    // Stage 4 leaves Special Areas (row 5) un-ticked, so clicking confirms it.
    const { cbs } = renderPanel({ confirmationStage: 4, selectedLayer: 'special' });
    fireEvent.click(tickFor('Special Areas'));
    expect(cbs.onToggleTick).toHaveBeenCalledWith(5, true, 'special');
    expect(cbs.onNext).toHaveBeenCalledTimes(1);
  });

  it('unticking Special Areas does not perform Next', () => {
    // Stage 5 makes Special Areas (row 5) ticked, so clicking unticks it.
    const { cbs } = renderPanel({ confirmationStage: 5, selectedLayer: 'special' });
    fireEvent.click(tickFor('Special Areas'));
    expect(cbs.onToggleTick).toHaveBeenCalledWith(5, false, 'special');
    expect(cbs.onNext).not.toHaveBeenCalled();
  });

  it('renders the LayerOptions block matching the selected layer', () => {
    renderPanel({ selectedLayer: 'special' });
    // The special-cells layer renders its distinctive buttons.
    expect(screen.getByTestId('opt-set-title')).toBeInTheDocument();
    expect(screen.queryByTestId('opt-create-table')).toBeNull();
  });

  // ---- Locked layers (the selected table is amalgamated into a grid) ----------------
  //
  // `lockedLayers` names the rows that cannot be edited. Each named row shows a padlock in
  // place of its eye, and the Options block of the SELECTED row is locked with it.

  const lockIn = (label) =>
    within(
      screen.getByText(label).closest('[data-testid="layer-row"]'),
    ).queryByTestId('layer-lock');

  it('shows an eye on every untickable row when nothing is locked', () => {
    renderPanel();
    expect(screen.getAllByTestId('layer-eye')).toHaveLength(4);
    expect(screen.queryByTestId('layer-lock')).toBeNull();
  });

  it('padlocks exactly the named rows and leaves the rest showing an eye', () => {
    renderPanel({ lockedLayers: ['colours', 'border', 'columns'] });

    expect(lockIn('Colours')).toBeInTheDocument();
    expect(lockIn('Borders')).toBeInTheDocument();
    expect(lockIn('Columns')).toBeInTheDocument();
    expect(lockIn('Rows')).toBeNull();
    expect(screen.getAllByTestId('layer-eye')).toHaveLength(1);
  });

  it('locks the Options block of a locked selected layer', () => {
    renderPanel({
      selectedLayer: 'columns',
      lockedLayers: ['colours', 'border', 'columns'],
    });
    expect(screen.getByTestId('opt-add-left')).toBeDisabled();
    expect(screen.getByTestId('opt-delete-line')).toBeDisabled();
  });

  it('leaves the Options block of an unlocked layer alone', () => {
    renderPanel({
      selectedLayer: 'rows',
      lockedLayers: ['colours', 'border', 'columns'],
    });
    expect(screen.getByTestId('opt-add-row')).toBeEnabled();
  });

  it('Prev/Next buttons call onPrev/onNext', () => {
    const { cbs } = renderPanel();
    fireEvent.click(screen.getByTestId('layers-prev'));
    fireEvent.click(screen.getByTestId('layers-next'));
    expect(cbs.onPrev).toHaveBeenCalledTimes(1);
    expect(cbs.onNext).toHaveBeenCalledTimes(1);
  });
});
