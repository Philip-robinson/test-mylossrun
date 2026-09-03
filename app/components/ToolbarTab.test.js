import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolbarTab from 'components/ToolbarTab';

const tab = () => screen.getByTestId('a-tab');

const renderTab = (props = {}) =>
  render(<ToolbarTab label={'A tab'} testId={'a-tab'} {...props} />);

describe('ToolbarTab', () => {
  it('is a muted link where it leads somewhere', async () => {
    const onClick = jest.fn();
    renderTab({ onClick });

    await userEvent.click(tab());

    expect(tab()).toHaveClass('toolbar-tab', 'toolbar-tab-link');
    expect(tab()).not.toHaveAttribute('aria-current');
    expect(tab()).not.toHaveAttribute('aria-disabled');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // The page you are on is marked as such and has nowhere to go, so its handler — which
  // the toolbar has no reason to withhold — is not called.
  it('is underlined and inert where it is the page you are on', async () => {
    const onClick = jest.fn();
    renderTab({ onClick, current: true });

    await userEvent.click(tab());

    expect(tab()).toHaveClass('toolbar-tab-current');
    expect(tab()).toHaveAttribute('aria-current', 'page');
    expect(tab()).toHaveAttribute('aria-disabled', 'true');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('says so where it leads nowhere', () => {
    renderTab();

    expect(tab()).toHaveClass('toolbar-tab-link');
    expect(tab()).toHaveAttribute('aria-disabled', 'true');
  });

  it('carries the help id it was given', () => {
    renderTab({ helpId: 'a-help-id' });

    expect(tab()).toHaveAttribute('data-help-id', 'a-help-id');
  });
});
