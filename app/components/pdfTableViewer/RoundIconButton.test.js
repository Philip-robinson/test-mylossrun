import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundIconButton from 'components/pdfTableViewer/RoundIconButton';

describe('RoundIconButton', () => {
  it('renders the supplied icon and is findable by its testId', () => {
    render(
      <RoundIconButton
        colour="rebeccapurple"
        icon={<span data-testid={'the-icon'}>ICON</span>}
        testId={'round-icon-button'}
        onClick={() => {}}
      />
    );

    const button = screen.getByTestId('round-icon-button');
    expect(button).toBeInTheDocument();
    expect(button).toContainElement(screen.getByTestId('the-icon'));
    expect(screen.getByText('ICON')).toBeInTheDocument();
  });

  it('carries the help id it is given, and none when it is given none', () => {
    const { rerender } = render(
      <RoundIconButton
        colour={'rebeccapurple'}
        icon={<span>{'ICON'}</span>}
        testId={'round-icon-button'}
        helpId={'the-help-id'}
        onClick={() => {}}
      />
    );

    expect(screen.getByTestId('round-icon-button')).toHaveAttribute(
      'data-help-id',
      'the-help-id'
    );

    rerender(
      <RoundIconButton
        colour={'rebeccapurple'}
        icon={<span>{'ICON'}</span>}
        testId={'round-icon-button'}
        onClick={() => {}}
      />
    );

    expect(screen.getByTestId('round-icon-button')).not.toHaveAttribute(
      'data-help-id'
    );
  });

  it('calls onClick once when clicked', async () => {
    const onClick = jest.fn();
    render(
      <RoundIconButton
        colour="rebeccapurple"
        icon={<span>ICON</span>}
        testId={'round-icon-button'}
        onClick={onClick}
      />
    );

    await userEvent.click(screen.getByTestId('round-icon-button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and calls nothing when `disabled` is set', async () => {
    const onClick = jest.fn();
    render(
      <RoundIconButton
        colour="rebeccapurple"
        icon={<span>ICON</span>}
        testId={'round-icon-button'}
        onClick={onClick}
        disabled
      />
    );

    const button = screen.getByTestId('round-icon-button');
    expect(button).toBeDisabled();

    // The pointer-events check is switched off because MUI disables a button with
    // `pointer-events: none`, which user-event would otherwise refuse to click at
    // all — the point of this test is that the click reaches the DOM and STILL
    // invokes nothing.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
