import { render, screen, fireEvent } from '@testing-library/react';
import ColourSelectors from 'components/pdfTableViewer/ColourSelectors';

const renderSelectors = (props = {}) =>
  render(
    <ColourSelectors
      foregroundColour={'#000000'}
      backgroundColour={'#ffffff'}
      onToggleForegroundPick={() => {}}
      onToggleBackgroundPick={() => {}}
      onSubmit={() => {}}
      onDelete={() => {}}
      {...props}
    />
  );

describe('ColourSelectors', () => {
  it('renders both swatches and Submit', () => {
    renderSelectors();
    expect(screen.getByTestId('opt-foreground-swatch')).toBeInTheDocument();
    expect(screen.getByTestId('opt-background-swatch')).toBeInTheDocument();
    expect(screen.getByTestId('opt-colour-submit')).toBeInTheDocument();
  });

  it('shows Delete only when the selection is a saved area', () => {
    renderSelectors({ canDelete: false });
    expect(screen.queryByTestId('opt-colour-delete')).toBeNull();
    renderSelectors({ canDelete: true });
    expect(screen.getByTestId('opt-colour-delete')).toBeInTheDocument();
  });

  it('marks the swatch whose pick is armed', () => {
    renderSelectors({ colourPickMode: 'background' });
    expect(screen.getByTestId('opt-background-swatch')).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByTestId('opt-foreground-swatch')).toHaveAttribute(
      'data-active',
      'false'
    );
  });

  it('forwards each control to its callback', () => {
    const cbs = {
      onToggleForegroundPick: jest.fn(),
      onToggleBackgroundPick: jest.fn(),
      onSubmit: jest.fn(),
      onDelete: jest.fn(),
    };
    renderSelectors({ ...cbs, canDelete: true });
    fireEvent.click(screen.getByTestId('opt-foreground-swatch'));
    fireEvent.click(screen.getByTestId('opt-background-swatch'));
    fireEvent.click(screen.getByTestId('opt-colour-submit'));
    fireEvent.click(screen.getByTestId('opt-colour-delete'));
    expect(cbs.onToggleForegroundPick).toHaveBeenCalledTimes(1);
    expect(cbs.onToggleBackgroundPick).toHaveBeenCalledTimes(1);
    expect(cbs.onSubmit).toHaveBeenCalledTimes(1);
    expect(cbs.onDelete).toHaveBeenCalledTimes(1);
  });
});
