import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { accountButtonHelpId, signOutLabel } from 'config';
import { navigateTo, signOut } from 'services/session';

import SignOutButton from 'components/SignOutButton';

jest.mock('services/session', () => ({
  signOut: jest.fn(),
  navigateTo: jest.fn()
}));

describe('SignOutButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an account button', () => {
    render(<SignOutButton />);

    const button = screen.getByRole('button', { name: 'Account' });

    expect(button).toBe(screen.getByTestId('sign-out-button'));
    expect(screen.getByTestId('AccountCircleOutlinedIcon')).toBeInTheDocument();
  });

  it('carries the help id, so the overlay can describe it', () => {
    render(<SignOutButton />);

    expect(screen.getByTestId('sign-out-button')).toHaveAttribute(
      'data-help-id',
      accountButtonHelpId(),
    );
  });

  it('shows no menu item until the button is clicked', () => {
    render(<SignOutButton />);

    expect(screen.queryByTestId('sign-out-menu-item')).not.toBeInTheDocument();
  });

  it('opens a menu holding one sign-out item when clicked', async () => {
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.click(screen.getByTestId('sign-out-button'));

    const items = screen.getAllByRole('menuitem');

    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(signOutLabel());
    expect(screen.getByTestId('LogoutOutlinedIcon')).toBeInTheDocument();
  });

  it('signs out with the browser storage and the module navigator', async () => {
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.click(screen.getByTestId('sign-out-button'));
    await user.click(screen.getByTestId('sign-out-menu-item'));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(window.localStorage, navigateTo);
  });

  it('closes the menu when the item is chosen', async () => {
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.click(screen.getByTestId('sign-out-button'));
    await user.click(screen.getByTestId('sign-out-menu-item'));

    expect(await screen.findByTestId('sign-out-button')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
