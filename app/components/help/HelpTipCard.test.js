import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { helpChipLabel, helpExitLabel, helpHideLabel } from 'app/lib/helpContent';
import HelpTipCard from 'components/help/HelpTipCard';

// The card's colours and its position are inline styles the tests never read: the side
// it settled on is carried as data-help-side and that is what is asserted.
const BODY = ['Drop a PDF here. ', { bold: 'PDFs only' }, ', up to 50MB.'];

function renderCard(overrides = {}) {
  render(
    <HelpTipCard
      title={'Add a loss run'}
      body={BODY}
      side={'bottom'}
      position={{ top: 120, left: 240 }}
      onExit={() => {}}
      onHide={() => {}}
      {...overrides}
    />,
  );

  return screen.getByTestId('help-tip-card');
}

describe('HelpTipCard', () => {
  it('shows the help chip above the title', () => {
    const card = renderCard();

    expect(card.textContent).toContain(helpChipLabel());
    expect(card.textContent.indexOf(helpChipLabel())).toBeLessThan(
      card.textContent.indexOf('Add a loss run'),
    );
  });

  it('shows the title', () => {
    renderCard();

    expect(screen.getByText('Add a loss run')).toBeInTheDocument();
  });

  it('reads the body as one piece of text', () => {
    const card = renderCard();

    expect(card.textContent).toContain('Drop a PDF here. PDFs only, up to 50MB.');
  });

  it('emphasises the body words the copy marks bold', () => {
    const card = renderCard();

    expect(
      Array.from(card.querySelectorAll('strong')).map((element) => element.textContent),
    ).toEqual(['PDFs only']);
  });

  it('reports the side it was placed on', () => {
    expect(renderCard({ side: 'right' })).toHaveAttribute('data-help-side', 'right');
  });

  it('offers one way out, and reports it', async () => {
    const onExit = jest.fn();
    renderCard({ onExit });

    await userEvent.click(screen.getByRole('button', { name: helpExitLabel() }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers a way to get the card out of the way without leaving help', async () => {
    const onHide = jest.fn();
    const onExit = jest.fn();
    renderCard({ onHide, onExit });

    await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('offers those two buttons and no others, hide first', () => {
    renderCard();

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      helpHideLabel(),
      helpExitLabel(),
    ]);
  });
});
