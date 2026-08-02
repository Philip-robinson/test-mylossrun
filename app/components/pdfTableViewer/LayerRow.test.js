import { render, screen, fireEvent } from '@testing-library/react';
import LayerRow from 'components/pdfTableViewer/LayerRow';

// ---------------------------------------------------------------------------
// LayerRow — controlled presentational row for the Layers panel.
// ---------------------------------------------------------------------------

const defaultProps = {
  colour: 'rgb(0, 0, 255)',
  label: 'Border',
  count: 3,
  selected: false,
  tickable: true,
  ticked: false,
  onSelect: () => {},
  onToggleTick: () => {},
};

const renderRow = (overrides = {}) =>
  render(<LayerRow {...defaultProps} {...overrides} />);

describe('LayerRow', () => {
  it('renders the label, count, and a dot whose colour reflects the colour prop', () => {
    renderRow({ colour: 'rgb(0, 0, 255)', label: 'Border', count: 3 });

    expect(screen.getByText('Border')).toBeInTheDocument();
    expect(screen.getByTestId('layer-count')).toHaveTextContent('3');

    const dot = screen.getByTestId('layer-dot');
    expect(dot).toHaveStyle({ backgroundColor: 'rgb(0, 0, 255)' });
  });

  it('tints a selected row with a 90%-transparent version of the dot colour', () => {
    renderRow({ colour: 'rgb(0, 0, 255)', selected: true });
    expect(screen.getByTestId('layer-row')).toHaveStyle({
      backgroundColor: 'color-mix(in srgb, rgb(0, 0, 255) 10%, transparent)',
    });
  });

  it('leaves an unselected row transparent', () => {
    renderRow({ colour: 'rgb(0, 0, 255)', selected: false });
    expect(screen.getByTestId('layer-row')).toHaveStyle({
      backgroundColor: 'transparent',
    });
  });

  // Every row is selectable: the layers are no longer gates climbed one at a time, so a
  // click always selects, whatever the table's confirmation stage.
  it('calls onSelect when the row is clicked', () => {
    const onSelect = jest.fn();
    renderRow({ onSelect });

    fireEvent.click(screen.getByText('Border'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects an untickable row too, and shows it as reachable', () => {
    const onSelect = jest.fn();
    renderRow({ tickable: false, onSelect });

    fireEvent.click(screen.getByText('Border'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('layer-row')).toHaveStyle({ cursor: 'pointer' });
  });

  // Only the row that is confirmed by a tick carries one; the rest reserve its width so
  // every count in the column lines up.
  it('renders no checkbox when the row is not tickable, but keeps its slot', () => {
    renderRow({ tickable: false });

    expect(screen.queryByTestId('layer-tick')).not.toBeInTheDocument();
    expect(screen.getByTestId('layer-tick-slot')).toBeInTheDocument();
  });

  it('renders the checkbox inside the slot when the row is tickable', () => {
    renderRow({ tickable: true });

    expect(screen.getByTestId('layer-tick-slot')).toContainElement(
      screen.getByTestId('layer-tick'),
    );
  });

  it('reflects the ticked prop on the checkbox', () => {
    const { rerender } = renderRow({ ticked: false });
    const checkbox = screen.getByTestId('layer-tick').querySelector('input');
    expect(checkbox).not.toBeChecked();

    rerender(<LayerRow {...defaultProps} ticked />);
    expect(
      screen.getByTestId('layer-tick').querySelector('input'),
    ).toBeChecked();
  });

  it('calls onToggleTick with the new checked value', () => {
    const onToggleTick = jest.fn();
    renderRow({ ticked: false, onToggleTick });

    fireEvent.click(screen.getByTestId('layer-tick').querySelector('input'));

    expect(onToggleTick).toHaveBeenCalledWith(true);
  });

  // The slot of an untickable row states whether the layer can be worked on.
  it('shows an eye in an untickable row that is not locked', () => {
    renderRow({ tickable: false, locked: false });

    expect(screen.getByTestId('layer-tick-slot')).toContainElement(
      screen.getByTestId('layer-eye'),
    );
    expect(screen.queryByTestId('layer-lock')).not.toBeInTheDocument();
  });

  it('shows a padlock in place of the eye when the row is locked', () => {
    renderRow({ tickable: false, locked: true });

    expect(screen.getByTestId('layer-tick-slot')).toContainElement(
      screen.getByTestId('layer-lock'),
    );
    expect(screen.queryByTestId('layer-eye')).not.toBeInTheDocument();
  });

  // Special Areas is the tickable row, and its tick keeps the slot whatever else is locked.
  it('keeps the checkbox on a tickable row rather than an eye or a padlock', () => {
    renderRow({ tickable: true, locked: true });

    expect(screen.getByTestId('layer-tick')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-eye')).not.toBeInTheDocument();
    expect(screen.queryByTestId('layer-lock')).not.toBeInTheDocument();
  });
});
