import { render, screen, fireEvent } from '@testing-library/react';
import TextToolButton from 'components/pdfTableViewer/TextToolButton';

const renderButton = (props = {}) =>
  render(
    <TextToolButton
      testId={'text-tool'}
      helpId={'text-tool-help'}
      label={'Split'}
      activeBackgroundColour={'red'}
      onClick={() => {}}
      {...props}
    />
  );

describe('TextToolButton', () => {
  it('renders its label as a button with its test id and help id', () => {
    renderButton();
    const button = screen.getByTestId('text-tool');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveTextContent('Split');
    expect(button).toHaveAttribute('data-help-id', 'text-tool-help');
  });

  it('carries its armed state as data-active', () => {
    const { rerender } = render(
      <TextToolButton testId={'text-tool'} helpId={'h'} label={'Join'} active />
    );
    expect(screen.getByTestId('text-tool')).toHaveAttribute('data-active', 'true');
    rerender(
      <TextToolButton testId={'text-tool'} helpId={'h'} label={'Join'} active={false} />
    );
    expect(screen.getByTestId('text-tool')).toHaveAttribute('data-active', 'false');
  });

  it('is enabled by default and disabled when asked', () => {
    const { unmount } = renderButton();
    expect(screen.getByTestId('text-tool')).toBeEnabled();
    unmount();
    renderButton({ disabled: true });
    expect(screen.getByTestId('text-tool')).toBeDisabled();
  });

  it('reports a click', () => {
    const onClick = jest.fn();
    renderButton({ onClick });
    fireEvent.click(screen.getByTestId('text-tool'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
