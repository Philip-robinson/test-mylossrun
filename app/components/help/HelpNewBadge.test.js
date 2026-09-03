import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { helpNewBadgeLabel } from 'app/lib/helpContent';
import HelpNewBadge from 'components/help/HelpNewBadge';

describe('HelpNewBadge', () => {
  it('reads its words from the copy module', () => {
    render(<HelpNewBadge onClick={() => {}} />);

    expect(screen.getByTestId('help-new-badge')).toHaveTextContent(
      helpNewBadgeLabel(),
    );
  });

  it('is a way in, not just a notice', async () => {
    const onClick = jest.fn();
    render(<HelpNewBadge onClick={onClick} />);

    await userEvent.click(screen.getByTestId('help-new-badge'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
