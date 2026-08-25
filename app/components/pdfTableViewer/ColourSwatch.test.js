import { render, screen, fireEvent } from '@testing-library/react';
import ColourSwatch from 'components/pdfTableViewer/ColourSwatch';

const renderSwatch = (props = {}) =>
  render(
    <ColourSwatch
      testId={'swatch'}
      label={'Foreground'}
      colour={'#ff0000'}
      active={false}
      onClick={() => {}}
      {...props}
    />
  );

describe('ColourSwatch', () => {
  it('renders its label and its colour', () => {
    renderSwatch();
    expect(screen.getByText('Foreground')).toBeInTheDocument();
    expect(screen.getByTestId('swatch')).toHaveStyle({
      backgroundColor: '#ff0000',
    });
  });

  it('states whether its pick is armed', () => {
    const { rerender } = renderSwatch({ active: true });
    expect(screen.getByTestId('swatch')).toHaveAttribute('data-active', 'true');
    rerender(
      <ColourSwatch
        testId={'swatch'}
        label={'Foreground'}
        colour={'#ff0000'}
        active={false}
        onClick={() => {}}
      />
    );
    expect(screen.getByTestId('swatch')).toHaveAttribute('data-active', 'false');
  });

  it('calls onClick when enabled and not when disabled', () => {
    const onClick = jest.fn();
    renderSwatch({ onClick });
    fireEvent.click(screen.getByTestId('swatch'));
    expect(onClick).toHaveBeenCalledTimes(1);

    onClick.mockClear();
    renderSwatch({ onClick, disabled: true });
    fireEvent.click(screen.getAllByTestId('swatch')[1]);
    expect(onClick).not.toHaveBeenCalled();
  });
});
