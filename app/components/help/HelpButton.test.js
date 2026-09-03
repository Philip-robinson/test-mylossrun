import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { documentListScreenId, helpButtonHelpId } from 'config';
import { helpNewBadgeLabel } from 'app/lib/helpContent';
import { HelpContext } from 'components/help/HelpProvider';
import HelpButton from 'components/help/HelpButton';

// The button needs nothing from the provider but the screen, the flag and the way in,
// so the context is supplied directly: what the provider decides is its own test's
// business.
const renderButton = (value) =>
  render(
    <HelpContext.Provider value={value}>
      <HelpButton />
    </HelpContext.Provider>,
  );

const helpValue = (overrides = {}) => ({
  screenId: documentListScreenId(),
  isOpen: false,
  targetHelpId: null,
  showNewBadge: false,
  openHelp: () => {},
  exitHelp: () => {},
  setTargetHelpId: () => {},
  registerScreen: () => {},
  unregisterScreen: () => {},
  ...overrides,
});

describe('HelpButton', () => {
  it('offers nothing while no screen has registered', () => {
    renderButton(helpValue({ screenId: null }));

    expect(screen.queryByTestId('help-button')).not.toBeInTheDocument();
  });

  it('offers nothing where there is no help at all', () => {
    render(<HelpButton />);

    expect(screen.queryByTestId('help-button')).not.toBeInTheDocument();
  });

  it('carries the help id the entry card measures its hole from', () => {
    renderButton(helpValue());

    expect(screen.getByTestId('help-button')).toHaveAttribute(
      'data-help-id',
      helpButtonHelpId(),
    );
  });

  it('is reachable as Help', () => {
    renderButton(helpValue());

    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('opens help when asked', async () => {
    const openHelp = jest.fn();
    renderButton(helpValue({ openHelp }));

    await userEvent.click(screen.getByTestId('help-button'));

    expect(openHelp).toHaveBeenCalledTimes(1);
  });

  it('flags nothing while there is nothing new', () => {
    renderButton(helpValue());

    expect(screen.queryByTestId('help-new-badge')).not.toBeInTheDocument();
  });

  it('flags what is new beside the button', () => {
    renderButton(helpValue({ showNewBadge: true }));

    expect(screen.getByTestId('help-new-badge')).toHaveTextContent(
      helpNewBadgeLabel(),
    );
  });

  it('opens help from the flag as well as from the button', async () => {
    const openHelp = jest.fn();
    renderButton(helpValue({ showNewBadge: true, openHelp }));

    await userEvent.click(screen.getByTestId('help-new-badge'));

    expect(openHelp).toHaveBeenCalledTimes(1);
  });
});
