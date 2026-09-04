// The overlay is stubbed: what is under test here is what the provider decides, and
// the stub's presence stands for help being open.
jest.mock('components/help/HelpOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid={'help-overlay'} />,
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  cellEditorScreenId,
  documentListScreenId,
  helpSeenKeyPrefix,
  reviewTableScreenId,
} from 'config';
import { helpScreens } from 'app/lib/helpContent';
import HelpProvider, { useHelp } from 'components/help/HelpProvider';
import useScreenHelp from 'components/help/useScreenHelp';

const versionOf = (screenId) => helpScreens()[screenId].version;

const seenKey = (screenId) => `${helpSeenKeyPrefix()}${screenId}`;

const seedSeen = (screenId, version) => {
  window.localStorage.setItem(seenKey(screenId), String(version));
};

const storedSeen = (screenId) => window.localStorage.getItem(seenKey(screenId));

// A private window, or a browser with site data blocked: the storage is there and every
// call to it throws. jsdom's own localStorage is behind a proxy that will not take a
// spy, so the whole property is replaced and put back afterwards.
const denyStorage = () => {
  const deny = () => {
    throw new Error('storage denied');
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: deny, setItem: deny, removeItem: deny, clear: deny },
  });
};

const realLocalStorage = window.localStorage;

const restoreStorage = () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: realLocalStorage,
  });
};

// Reads the whole context value out into the DOM, so what the provider decided can be
// asserted on without reaching into the overlay.
function HelpProbe() {
  const { screenId, isOpen, showNewBadge, targetHelpId, openHelp, exitHelp } =
    useHelp();

  return (
    <div>
      <span data-testid={'probe-screen'}>{screenId || 'none'}</span>
      <span data-testid={'probe-open'}>{String(isOpen)}</span>
      <span data-testid={'probe-badge'}>{String(showNewBadge)}</span>
      <span data-testid={'probe-target'}>{targetHelpId || 'entry'}</span>
      <button type={'button'} onClick={openHelp}>
        {'open'}
      </button>
      <button type={'button'} onClick={exitHelp}>
        {'exit'}
      </button>
    </div>
  );
}

function Screen({ screenId, children }) {
  useScreenHelp(screenId);

  return <>{children}</>;
}

// The inner screen nests inside the outer one, which is how CellEditDialog sits inside
// a live ReviewTablePanel. Mounting them in separate renders is also how that happens:
// the panel is there first and the dialog appears over it.
function Harness({ outerScreenId = null, innerScreenId = null }) {
  return (
    <HelpProvider>
      <HelpProbe />
      {outerScreenId ? (
        <Screen screenId={outerScreenId}>
          {innerScreenId ? <Screen screenId={innerScreenId} /> : null}
        </Screen>
      ) : null}
    </HelpProvider>
  );
}

const overlay = () => screen.queryByTestId('help-overlay');

const probe = (name) => screen.getByTestId(`probe-${name}`);

const clickButton = (name) =>
  userEvent.click(screen.getByRole('button', { name }));

describe('HelpProvider', () => {
  beforeEach(() => {
    restoreStorage();
    window.localStorage.clear();
  });

  describe('arriving at a screen', () => {
    it('opens help on the entry card the first time a screen is visited', () => {
      render(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).toBeInTheDocument();
      expect(probe('target')).toHaveTextContent('entry');
      expect(probe('badge')).toHaveTextContent('false');
    });

    it('records the version it opened at, so the next visit is quiet', () => {
      render(<Harness outerScreenId={documentListScreenId()} />);

      expect(storedSeen(documentListScreenId())).toBe(
        String(versionOf(documentListScreenId())),
      );
    });

    it('does not open again when the screen is remounted in the same session', async () => {
      const { rerender } = render(
        <Harness outerScreenId={documentListScreenId()} />,
      );

      await clickButton('exit');
      rerender(<Harness />);
      rerender(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).not.toBeInTheDocument();
    });

    it('flags that there is something new when the stored version is behind', () => {
      seedSeen(documentListScreenId(), versionOf(documentListScreenId()) - 1);

      render(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).not.toBeInTheDocument();
      expect(probe('badge')).toHaveTextContent('true');
    });

    it('neither opens nor flags when the stored version is current', () => {
      seedSeen(documentListScreenId(), versionOf(documentListScreenId()));

      render(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).not.toBeInTheDocument();
      expect(probe('badge')).toHaveTextContent('false');
    });

    it('opens nothing while no screen is registered', () => {
      render(<Harness />);

      expect(overlay()).not.toBeInTheDocument();
      expect(probe('screen')).toHaveTextContent('none');
    });
  });

  describe('when localStorage cannot be read or written', () => {
    it('still opens on the first arrival', () => {
      denyStorage();

      render(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).toBeInTheDocument();
    });

    it('opens at most once in the session, having nowhere to record it', async () => {
      denyStorage();

      const { rerender } = render(
        <Harness outerScreenId={documentListScreenId()} />,
      );

      await clickButton('exit');
      rerender(<Harness />);
      rerender(<Harness outerScreenId={documentListScreenId()} />);

      expect(overlay()).not.toBeInTheDocument();
    });
  });

  describe('the active screen', () => {
    beforeEach(() => {
      seedSeen(reviewTableScreenId(), versionOf(reviewTableScreenId()));
      seedSeen(cellEditorScreenId(), versionOf(cellEditorScreenId()));
    });

    it('is the most recently registered one', () => {
      const { rerender } = render(
        <Harness outerScreenId={reviewTableScreenId()} />,
      );

      expect(probe('screen')).toHaveTextContent(reviewTableScreenId());

      rerender(
        <Harness
          outerScreenId={reviewTableScreenId()}
          innerScreenId={cellEditorScreenId()}
        />,
      );

      expect(probe('screen')).toHaveTextContent(cellEditorScreenId());
    });

    it('falls back to the earlier one when the later unmounts', () => {
      const { rerender } = render(
        <Harness
          outerScreenId={reviewTableScreenId()}
          innerScreenId={cellEditorScreenId()}
        />,
      );

      rerender(<Harness outerScreenId={reviewTableScreenId()} />);

      expect(probe('screen')).toHaveTextContent(reviewTableScreenId());
    });
  });

  describe('openHelp', () => {
    it('opens on the entry card and clears the flag, recording the version', async () => {
      seedSeen(documentListScreenId(), versionOf(documentListScreenId()) - 1);

      render(<Harness outerScreenId={documentListScreenId()} />);
      await clickButton('open');

      expect(overlay()).toBeInTheDocument();
      expect(probe('target')).toHaveTextContent('entry');
      expect(probe('badge')).toHaveTextContent('false');
      expect(storedSeen(documentListScreenId())).toBe(
        String(versionOf(documentListScreenId())),
      );
    });

    it('opens on a screen that has already been seen', async () => {
      seedSeen(documentListScreenId(), versionOf(documentListScreenId()));

      render(<Harness outerScreenId={documentListScreenId()} />);
      await clickButton('open');

      expect(overlay()).toBeInTheDocument();
    });
  });

  describe('exitHelp', () => {
    it('closes help and records nothing', async () => {
      seedSeen(documentListScreenId(), versionOf(documentListScreenId()));

      render(<Harness outerScreenId={documentListScreenId()} />);
      await clickButton('open');
      window.localStorage.clear();
      await clickButton('exit');

      expect(overlay()).not.toBeInTheDocument();
      expect(storedSeen(documentListScreenId())).toBeNull();
    });
  });
});
