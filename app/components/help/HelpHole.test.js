import { render, screen } from '@testing-library/react';
import { dropBoxHelpId } from 'config';
import HelpHole from 'components/help/HelpHole';

// jsdom returns an all-zero rect from getBoundingClientRect and drops nothing about
// the shadow into anything readable, so the hole is asserted on its presence and its
// help id only — never on where it landed or what it painted.
const RECT = { top: 40, left: 80, width: 200, height: 60 };

describe('HelpHole', () => {
  it('draws a hole carrying the id of the element it describes', () => {
    render(<HelpHole rect={RECT} helpId={dropBoxHelpId()} />);

    expect(screen.getByTestId('help-hole')).toHaveAttribute(
      'data-help-id',
      dropBoxHelpId(),
    );
  });

  it('draws nothing when there is no rect to draw around', () => {
    render(<HelpHole rect={null} helpId={dropBoxHelpId()} />);

    expect(screen.queryByTestId('help-hole')).not.toBeInTheDocument();
  });
});
