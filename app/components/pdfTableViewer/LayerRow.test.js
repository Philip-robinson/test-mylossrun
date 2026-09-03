import { render, screen, fireEvent } from '@testing-library/react';
import LayerRow from 'components/pdfTableViewer/LayerRow';

// Colours are passed in as literals, never read from config, so an assertion here can
// use toHaveStyle: a var(--…) value would be dropped by jsdom's style parser.
const BLUE = 'rgb(0, 0, 255)';
const PALE_BLUE = 'rgb(230, 230, 255)';

const renderRow = (props = {}) =>
  render(
    <LayerRow
      colour={BLUE}
      backgroundColour={PALE_BLUE}
      label={'Rows'}
      count={3}
      on
      toggleable
      onToggle={() => {}}
      {...props}
    />
  );

describe('LayerRow', () => {
  it('renders the label, the count and the dot in the given colour', () => {
    renderRow();
    expect(screen.getByText('Rows')).toBeInTheDocument();
    expect(screen.getByTestId('layer-count')).toHaveTextContent('3');
    expect(screen.getByTestId('layer-dot')).toHaveStyle({
      backgroundColor: BLUE,
    });
  });

  it('shows the open eye and the layer background colour when on', () => {
    renderRow({ on: true });
    expect(screen.getByTestId('layer-eye')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-eye-off')).toBeNull();
    expect(screen.getByTestId('layer-row')).toHaveAttribute('data-on', 'true');
    expect(screen.getByTestId('layer-row')).toHaveStyle({
      backgroundColor: PALE_BLUE,
    });
  });

  it('shows the slashed eye and no row background when off', () => {
    renderRow({ on: false });
    expect(screen.getByTestId('layer-eye-off')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-eye')).toBeNull();
    expect(screen.getByTestId('layer-row')).toHaveAttribute('data-on', 'false');
    expect(screen.getByTestId('layer-row')).toHaveStyle({
      backgroundColor: 'transparent',
    });
  });

  // Borders is untoggleable and always on, so it now carries its tint too.
  it('gives an untoggleable row the background colour, since it is always on', () => {
    renderRow({ toggleable: false });
    expect(screen.getByTestId('layer-row')).toHaveAttribute('data-on', 'true');
    expect(screen.getByTestId('layer-row')).toHaveStyle({
      backgroundColor: PALE_BLUE,
    });
  });

  it('toggles to the opposite state when the row is clicked', () => {
    const onToggle = jest.fn();
    renderRow({ on: true, onToggle });
    fireEvent.click(screen.getByTestId('layer-row'));
    expect(onToggle).toHaveBeenCalledWith(false);

    onToggle.mockClear();
    renderRow({ on: false, onToggle });
    fireEvent.click(screen.getAllByTestId('layer-row')[1]);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders no eye and ignores clicks when it cannot be toggled', () => {
    const onToggle = jest.fn();
    renderRow({ toggleable: false, onToggle });
    expect(screen.queryByTestId('layer-eye')).toBeNull();
    expect(screen.queryByTestId('layer-eye-off')).toBeNull();
    fireEvent.click(screen.getByTestId('layer-row'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps the icon slot on an untoggleable row so counts stay aligned', () => {
    renderRow({ toggleable: false });
    expect(screen.getByTestId('layer-tick-slot')).toBeInTheDocument();
  });
});
