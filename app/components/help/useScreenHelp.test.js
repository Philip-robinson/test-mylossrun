// The provider renders the overlay; nothing here is about it, so it is stubbed.
jest.mock('components/help/HelpOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid={'help-overlay'} />,
}));

import { render, screen } from '@testing-library/react';
import {
  documentListScreenId,
  helpSeenKeyPrefix,
  linkTablesScreenId,
  reviewTableScreenId,
} from 'config';
import { helpScreens } from 'app/lib/helpContent';
import HelpProvider, { useHelp } from 'components/help/HelpProvider';
import useScreenHelp from 'components/help/useScreenHelp';

const seedSeen = (screenId) => {
  window.localStorage.setItem(
    `${helpSeenKeyPrefix()}${screenId}`,
    String(helpScreens()[screenId].version),
  );
};

// Every screen the tests register is seeded as already seen, so the provider's own
// arrival decision stays out of the way and what is asserted is the registration.
const seedEverythingSeen = () => {
  Object.keys(helpScreens()).forEach(seedSeen);
};

function ActiveScreen() {
  const { screenId } = useHelp();

  return <span data-testid={'active-screen'}>{screenId || 'none'}</span>;
}

function Screen({ screenId, children }) {
  useScreenHelp(screenId);

  return <>{children}</>;
}

const activeScreen = () => screen.getByTestId('active-screen');

describe('useScreenHelp', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedEverythingSeen();
  });

  it('returns nothing', () => {
    let returned = 'unset';

    function Reporting() {
      returned = useScreenHelp(documentListScreenId());

      return null;
    }

    render(
      <HelpProvider>
        <Reporting />
      </HelpProvider>,
    );

    expect(returned).toBeUndefined();
  });

  it('registers its screen with the provider on mount', () => {
    render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()} />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent(reviewTableScreenId());
  });

  it('registers the new screen when the screen id changes', () => {
    const { rerender } = render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()} />
      </HelpProvider>,
    );

    rerender(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={linkTablesScreenId()} />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent(linkTablesScreenId());
  });

  it('unregisters on unmount', () => {
    const { rerender } = render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()} />
      </HelpProvider>,
    );

    rerender(
      <HelpProvider>
        <ActiveScreen />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent('none');
  });

  it('registers nothing when the screen id is null', () => {
    render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={null} />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent('none');
  });

  it('gives up its registration when its screen id becomes null', () => {
    const { rerender } = render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()} />
      </HelpProvider>,
    );

    rerender(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={null} />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent('none');
  });

  // Each instance holds its own token, so one instance's cleanup cannot take another's
  // registration with it — which a single registration slot would do.
  it('keeps one instance registered when another on the same screen unmounts', () => {
    const { rerender } = render(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()}>
          <Screen screenId={reviewTableScreenId()} />
        </Screen>
      </HelpProvider>,
    );

    rerender(
      <HelpProvider>
        <ActiveScreen />
        <Screen screenId={reviewTableScreenId()} />
      </HelpProvider>,
    );

    expect(activeScreen()).toHaveTextContent(reviewTableScreenId());
  });

  it('does nothing outside a provider', () => {
    expect(() =>
      render(<Screen screenId={reviewTableScreenId()} />),
    ).not.toThrow();
  });
});
