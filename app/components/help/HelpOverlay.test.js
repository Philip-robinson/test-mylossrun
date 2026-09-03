import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  documentListCountsHelpId,
  documentListScreenId,
  dropBoxHelpId,
  helpButtonHelpId,
} from 'config';
import { helpHideLabel, helpIntroBody, helpScreens } from 'app/lib/helpContent';
import { HelpContext } from 'components/help/HelpProvider';
import HelpOverlay from 'components/help/HelpOverlay';

// Both DOM seams are injected, because jsdom returns an all-zero rect from
// getBoundingClientRect and implements neither elementFromPoint nor
// elementsFromPoint. Nothing here asserts a position: what the overlay decided is
// read from the hole's data-help-id and the card's text.
const TARGET_RECT = { top: 40, left: 80, width: 200, height: 60 };

const documentListHelp = () => helpScreens()[documentListScreenId()];

const tipTitle = (helpId) =>
  documentListHelp().tips.find((tip) => tip.helpId === helpId).title;

// Holds the target in state the way HelpProvider does, so a click on the scrim can
// be seen to move the overlay from one thing to the next.
function Harness({
  chainsAt = () => [],
  measureTarget = () => TARGET_RECT,
  exitHelp = () => {},
}) {
  const [targetHelpId, setTargetHelpId] = useState(null);

  return (
    <HelpContext.Provider
      value={{
        screenId: documentListScreenId(),
        isOpen: true,
        targetHelpId,
        setTargetHelpId,
        exitHelp,
        showNewBadge: false,
        openHelp: () => {},
        registerScreen: () => {},
        unregisterScreen: () => {},
      }}
    >
      <HelpOverlay measureTarget={measureTarget} chainsAt={chainsAt} />
    </HelpContext.Provider>
  );
}

const scrim = () => screen.getByTestId('help-scrim');

const card = () => screen.getByTestId('help-tip-card');

const hole = () => screen.queryByTestId('help-hole');

const clickScrim = (point = { clientX: 120, clientY: 200 }) =>
  fireEvent.click(scrim(), point);

describe('HelpOverlay', () => {
  describe('the entry card', () => {
    it('is titled with the name of the screen', () => {
      render(<Harness />);

      expect(card().textContent).toContain(documentListHelp().name);
    });

    it("reads the screen's summary and then the shared introduction", () => {
      render(<Harness />);

      const text = card().textContent;

      expect(text).toContain(documentListHelp().summary[0]);
      expect(text).toContain(helpIntroBody()[0]);
      expect(text.indexOf(documentListHelp().summary[0])).toBeLessThan(
        text.indexOf(helpIntroBody()[0]),
      );
    });

    it('points at the help button', () => {
      render(<Harness />);

      expect(hole()).toHaveAttribute('data-help-id', helpButtonHelpId());
    });
  });

  describe('clicking the screen', () => {
    it('asks what is under the point that was clicked', () => {
      const chainsAt = jest.fn(() => []);
      render(<Harness chainsAt={chainsAt} />);

      clickScrim({ clientX: 310, clientY: 420 });

      expect(chainsAt).toHaveBeenCalledWith(310, 420);
    });

    it('moves to the tip for a described element', () => {
      render(<Harness chainsAt={() => [[dropBoxHelpId()]]} />);

      clickScrim();

      expect(hole()).toHaveAttribute('data-help-id', dropBoxHelpId());
      expect(card().textContent).toContain(tipTitle(dropBoxHelpId()));
    });

    it('takes the innermost described element the point landed on', () => {
      render(
        <Harness
          chainsAt={() => [[documentListCountsHelpId(), dropBoxHelpId()]]}
        />,
      );

      clickScrim();

      expect(hole()).toHaveAttribute('data-help-id', documentListCountsHelpId());
    });

    it('changes nothing when nothing described was clicked', () => {
      render(<Harness chainsAt={() => [['not-a-described-element']]} />);

      clickScrim();

      expect(hole()).toHaveAttribute('data-help-id', helpButtonHelpId());
      expect(card().textContent).toContain(documentListHelp().name);
    });

    it('returns to the entry card when the help button itself is clicked', () => {
      const chains = [[dropBoxHelpId()], [helpButtonHelpId()]];
      render(<Harness chainsAt={() => chains.shift() || []} />);

      clickScrim();
      clickScrim();

      expect(hole()).toHaveAttribute('data-help-id', helpButtonHelpId());
      expect(card().textContent).toContain(documentListHelp().name);
    });
  });

  describe('geometry', () => {
    it('draws no hole around a target it cannot measure, but still shows it', () => {
      render(<Harness measureTarget={() => null} />);

      expect(hole()).not.toBeInTheDocument();
      expect(card().textContent).toContain(documentListHelp().name);
    });

    it('measures the new target when the target changes', () => {
      const measureTarget = jest.fn(() => TARGET_RECT);
      render(
        <Harness
          measureTarget={measureTarget}
          chainsAt={() => [[dropBoxHelpId()]]}
        />,
      );

      expect(measureTarget).toHaveBeenCalledWith(helpButtonHelpId());

      clickScrim();

      expect(measureTarget).toHaveBeenCalledWith(dropBoxHelpId());
    });

    it('measures again when the window is resized', () => {
      const measureTarget = jest.fn(() => TARGET_RECT);
      render(<Harness measureTarget={measureTarget} />);

      const before = measureTarget.mock.calls.length;
      fireEvent(window, new Event('resize'));

      expect(measureTarget.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe('the scrim', () => {
    it('marks itself as the help layer, so the hit-test can discount it', () => {
      render(<Harness />);

      expect(scrim()).toHaveAttribute('data-help-layer');
    });

    it('is not drawn at all outside a provider', () => {
      render(
        <HelpOverlay measureTarget={() => TARGET_RECT} chainsAt={() => []} />,
      );

      expect(screen.queryByTestId('help-scrim')).not.toBeInTheDocument();
    });
  });

  describe('leaving help', () => {
    it('exits on Escape', () => {
      const exitHelp = jest.fn();
      render(<Harness exitHelp={exitHelp} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(exitHelp).toHaveBeenCalledTimes(1);
    });

    it('ignores any other key', () => {
      const exitHelp = jest.fn();
      render(<Harness exitHelp={exitHelp} />);

      fireEvent.keyDown(window, { key: 'Enter' });

      expect(exitHelp).not.toHaveBeenCalled();
    });

    it('stops listening once it is gone', () => {
      const exitHelp = jest.fn();
      const { unmount } = render(<Harness exitHelp={exitHelp} />);

      unmount();
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(exitHelp).not.toHaveBeenCalled();
    });
  });

  describe('hiding the card', () => {
    const chainsAtDropBox = () => [[dropBoxHelpId()]];

    it('takes the card away but leaves the scrim and the hole', async () => {
      render(<Harness />);

      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));

      expect(screen.queryByTestId('help-tip-card')).not.toBeInTheDocument();
      expect(screen.getByTestId('help-scrim')).toBeInTheDocument();
      expect(screen.getByTestId('help-hole')).toHaveAttribute(
        'data-help-id',
        helpButtonHelpId(),
      );
    });

    it('does not leave help', async () => {
      const exitHelp = jest.fn();
      render(<Harness exitHelp={exitHelp} />);

      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));

      expect(exitHelp).not.toHaveBeenCalled();
    });

    it('brings the card back on the next click that resolves to something', async () => {
      render(<Harness chainsAt={chainsAtDropBox} />);

      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));
      fireEvent.click(screen.getByTestId('help-scrim'), { clientX: 10, clientY: 10 });

      expect(screen.getByTestId('help-tip-card')).toHaveTextContent(
        tipTitle(dropBoxHelpId()),
      );
    });

    // The card sits inside the scrim, so a click on it bubbles to the scrim's handler,
    // and elementsFromPoint reports the application's elements beneath the card as well
    // as the card. A Hide that did not stop its own click would be undone at once by
    // whatever happened to lie under the button.
    it('stays hidden when the click on Hide lands over something described', async () => {
      render(<Harness chainsAt={chainsAtDropBox} />);

      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));

      expect(screen.queryByTestId('help-tip-card')).not.toBeInTheDocument();
    });

    it('does not move the highlight when the card itself is clicked', async () => {
      render(<Harness chainsAt={chainsAtDropBox} />);

      await userEvent.click(screen.getByText(documentListHelp().name));

      expect(screen.getByTestId('help-hole')).toHaveAttribute(
        'data-help-id',
        helpButtonHelpId(),
      );
    });

    // A click on the background asks about nothing in particular, so it is how the reader
    // says they have finished looking at what the card was covering.
    it('comes back with the same words when a click resolves to nothing', async () => {
      render(<Harness chainsAt={() => [['not-a-help-id']]} />);

      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));
      fireEvent.click(screen.getByTestId('help-scrim'), { clientX: 10, clientY: 10 });

      expect(screen.getByTestId('help-tip-card')).toHaveTextContent(
        documentListHelp().name,
      );
      expect(screen.getByTestId('help-hole')).toHaveAttribute(
        'data-help-id',
        helpButtonHelpId(),
      );
    });

    // The words it comes back with are the ones it was showing, not the entry card's:
    // the reader put away an answer, and that answer is what they get back.
    it('comes back to the tip it was showing when it was hidden', async () => {
      // The drop box first, then the background: the card is put away over one thing's
      // words and must come back with those words, not with the entry card's.
      const chains = [[[dropBoxHelpId()]], [['not-a-help-id']]];
      render(<Harness chainsAt={() => chains.shift() ?? []} />);

      fireEvent.click(screen.getByTestId('help-scrim'), { clientX: 10, clientY: 10 });
      await userEvent.click(screen.getByRole('button', { name: helpHideLabel() }));
      expect(screen.queryByTestId('help-tip-card')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('help-scrim'), { clientX: 10, clientY: 10 });

      expect(screen.getByTestId('help-tip-card')).toHaveTextContent(
        tipTitle(dropBoxHelpId()),
      );
      expect(screen.getByTestId('help-hole')).toHaveAttribute(
        'data-help-id',
        dropBoxHelpId(),
      );
    });
  });
});
