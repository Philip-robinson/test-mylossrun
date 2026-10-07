import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  boundaryPassScreenId,
  contentsPassScreenId,
  documentListScreenId,
  linkTablesScreenId,
  reviewTableScreenId,
  toolbarAllFilesHelpId,
  toolbarAllFilesLabel,
  toolbarGridEditorHelpId,
  toolbarReviewHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateBordersLabel,
  toolbarValidateTablesHelpId,
  toolbarValidateTablesLabel,
} from 'config';
import { HelpContext } from 'components/help/HelpProvider';
import { EditorPassContext } from 'components/EditorPassProvider';
import Toolbar from './Toolbar';

// The sign-out button reaches the session service, which navigates; mocking the module
// keeps a test click from leaving the page.
jest.mock('services/session', () => ({
  signOut: jest.fn(),
  navigateTo: jest.fn(),
}));

// The toolbar now carries the help button, which takes the screen and the way into
// help from the help context. The context is supplied directly where a test needs the
// button present; every other test renders the toolbar with no help at all, which is
// how the toolbar sits above the access gate.
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

const renderWithHelp = (value) =>
  render(
    <HelpContext.Provider value={value}>
      <Toolbar activeView={'loader'} />
    </HelpContext.Provider>,
  );

// The two pass tabs are drawn from the editor-pass context: which editor screen is up, and
// the switch to the other pass, registered by the editor beneath. A toolbar rendered with
// no provider at all — as the tests above it are — has neither.
const screenValue = (overrides = {}) => ({
  screen: null,
  actions: null,
  setScreen: () => {},
  setPassActions: () => {},
  ...overrides,
});

const renderWithPass = (value, props = {}) =>
  render(
    <EditorPassContext.Provider value={value}>
      <Toolbar activeView={'editor'} {...props} />
    </EditorPassContext.Provider>,
  );

const borders = () => screen.getByTestId('toolbar-validate-borders');
const tables = () => screen.getByTestId('toolbar-validate-tables');

const registeredActions = () => ({
  allFiles: jest.fn(),
  validateBorders: jest.fn(),
  validateTables: jest.fn(),
});

// The tab test ids in the order the toolbar draws them, and the one that is current.
const tabIds = (container) =>
  Array.from(container.querySelectorAll('.toolbar-tabs button')).map((tab) =>
    tab.getAttribute('data-testid'),
  );
const currentTabIds = (container) =>
  Array.from(
    container.querySelectorAll('.toolbar-tabs button.toolbar-tab-current'),
  ).map((tab) => tab.getAttribute('data-testid'));

describe('Toolbar', () => {
  test('renders the Cactus logo pointing at /cactuslogo.png', () => {
    render(<Toolbar activeView={'loader'} />);
    const cactus = screen.getByAltText('Cactus');
    expect(cactus).toBeInTheDocument();
    expect(cactus.getAttribute('src')).toMatch(/\/cactuslogo\.png$/);
  });

  test('renders the MyLossRun logo pointing at /MyLossRun.png', () => {
    render(<Toolbar activeView={'loader'} />);
    const myLossRun = screen.getByAltText('MyLossRun');
    expect(myLossRun).toBeInTheDocument();
    expect(myLossRun.getAttribute('src')).toMatch(/\/MyLossRun\.png$/);
  });

  test('renders the empty toolbar-data slot', () => {
    const { container } = render(<Toolbar activeView={'loader'} />);
    expect(container.querySelector('.toolbar-data')).toBeInTheDocument();
  });

  test('renders no tab buttons in the loader view', () => {
    const { container } = render(<Toolbar activeView={'loader'} />);
    const tabs = container.querySelector('.toolbar-tabs');
    expect(tabs).toBeInTheDocument();
    expect(tabs.querySelectorAll('button')).toHaveLength(0);
  });

  test('defaults to the loader view (no tab buttons) when activeView is omitted', () => {
    const { container } = render(<Toolbar />);
    const tabs = container.querySelector('.toolbar-tabs');
    expect(tabs.querySelectorAll('button')).toHaveLength(0);
  });

  test('renders the three editor tabs with the expected labels', () => {
    render(<Toolbar activeView={'editor'} />);
    expect(
      screen.getByRole('button', { name: toolbarAllFilesLabel() }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: toolbarValidateBordersLabel() }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: toolbarValidateTablesLabel() }),
    ).toBeInTheDocument();
  });

  test('clicking "← All Files" calls onAllFiles', async () => {
    const onAllFiles = jest.fn();
    render(<Toolbar activeView={'editor'} onAllFiles={onAllFiles} />);
    await userEvent.click(screen.getByRole('button', { name: toolbarAllFilesLabel() }));
    expect(onAllFiles).toHaveBeenCalledTimes(1);
  });

  // An editor host settles and saves before leaving, so its action is the one the tab calls.
  test('clicking ← All Files calls the registered allFiles action rather than onAllFiles', async () => {
    const onAllFiles = jest.fn();
    const actions = {
      allFiles: jest.fn(),
      validateBorders: jest.fn(),
      validateTables: jest.fn(),
    };
    renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions }), {
      onAllFiles,
    });

    await userEvent.click(screen.getByRole('button', { name: toolbarAllFilesLabel() }));

    expect(actions.allFiles).toHaveBeenCalledTimes(1);
    expect(onAllFiles).not.toHaveBeenCalled();
  });

  // With no editor beneath it there is no pass and no switch, so neither tab is the page
  // you are on and neither has anywhere to go.
  test('leaves both pass tabs inert where no editor has registered', async () => {
    const onAllFiles = jest.fn();
    render(<Toolbar activeView={'editor'} onAllFiles={onAllFiles} />);

    await userEvent.click(borders());
    await userEvent.click(tables());

    expect(onAllFiles).not.toHaveBeenCalled();
    expect(borders()).toHaveClass('toolbar-tab-link');
    expect(tables()).toHaveClass('toolbar-tab-link');
    expect(borders()).toHaveAttribute('aria-disabled', 'true');
  });

  test('renders the help button after the flexible spacer', () => {
    const { container } = renderWithHelp(helpValue());
    const spacer = container.querySelector('.toolbar-data');
    const helpButton = screen.getByTestId('help-button');
    expect(
      spacer.compareDocumentPosition(helpButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('renders no help button where there is no help', () => {
    render(<Toolbar activeView={'loader'} />);
    expect(screen.queryByTestId('help-button')).not.toBeInTheDocument();
  });

  test('renders the sign-out button after the flexible spacer', () => {
    const { container } = renderWithHelp(helpValue());
    const spacer = container.querySelector('.toolbar-data');
    const signOutButton = screen.getByTestId('sign-out-button');
    expect(
      spacer.compareDocumentPosition(signOutButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Unlike the help button, the account button needs no context: everyone who can see
  // the toolbar is past the access gate and so is signed in.
  test('renders the sign-out button where there is no help', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('sign-out-button')).toBeInTheDocument();
    expect(screen.queryByTestId('help-button')).not.toBeInTheDocument();
  });

  // The pass you are on is the current tab: primary text, underlined, and with nowhere to
  // go. The other is the way to the other pass, and makes the switch the Layers panel's
  // own Validate button makes.
  describe('the two pass tabs', () => {
    test('mark Validate borders as the page you are on in the boundary pass', () => {
      renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions: { validateBorders: jest.fn(), validateTables: jest.fn() } }));

      expect(borders()).toHaveClass('toolbar-tab-current');
      expect(borders()).toHaveAttribute('aria-current', 'page');
      expect(tables()).toHaveClass('toolbar-tab-link');
      expect(tables()).not.toHaveAttribute('aria-disabled');
    });

    test('mark Validate tables as the page you are on in the contents pass', () => {
      renderWithPass(screenValue({ screen: contentsPassScreenId(), actions: { validateBorders: jest.fn(), validateTables: jest.fn() } }));

      expect(tables()).toHaveClass('toolbar-tab-current');
      expect(tables()).toHaveAttribute('aria-current', 'page');
      expect(borders()).toHaveClass('toolbar-tab-link');
    });

    test('switch to the contents pass from the boundary pass', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions }));

      await userEvent.click(tables());

      expect(actions.validateTables).toHaveBeenCalledTimes(1);
      expect(actions.validateBorders).not.toHaveBeenCalled();
    });

    test('switch to the boundary pass from the contents pass', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(screenValue({ screen: contentsPassScreenId(), actions }));

      await userEvent.click(borders());

      expect(actions.validateBorders).toHaveBeenCalledTimes(1);
      expect(actions.validateTables).not.toHaveBeenCalled();
    });

    test('leave the tab for the pass you are on ineffective', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions }));

      await userEvent.click(borders());

      expect(actions.validateBorders).not.toHaveBeenCalled();
    });

    // With no actions registered the tab that is not current has nowhere to go, so it says
    // so rather than looking like a link that does nothing.
    test('mark the other pass out of reach where no actions are registered', () => {
      renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions: null }));

      expect(tables()).toHaveAttribute('aria-disabled', 'true');
      expect(borders()).toHaveClass('toolbar-tab-current');
    });

    // The overlay measures each tip's hole from these attributes and the copy module keys
    // the same tips by the same functions, so no id is a literal on either side.
    test('carry the help ids the editor screens describe them by', () => {
      renderWithPass(screenValue({ screen: boundaryPassScreenId(), actions: null }));

      expect(borders()).toHaveAttribute(
        'data-help-id',
        toolbarValidateBordersHelpId(),
      );
      expect(tables()).toHaveAttribute(
        'data-help-id',
        toolbarValidateTablesHelpId(),
      );
    });
  });

  // Each editor screen shows All Files and the two Validate tabs; Review and Grid Editor
  // appear only on their own screen, where they are the current tab.
  describe('the tabs each screen shows', () => {
    test('boundary pass shows the three tabs with Validate Borders current', () => {
      const { container } = renderWithPass(
        screenValue({ screen: boundaryPassScreenId(), actions: registeredActions() }),
      );

      expect(tabIds(container)).toEqual([
        'toolbar-all-files',
        'toolbar-validate-borders',
        'toolbar-validate-tables',
      ]);
      expect(currentTabIds(container)).toEqual(['toolbar-validate-borders']);
    });

    test('contents pass shows the three tabs with Validate Tables current', () => {
      const { container } = renderWithPass(
        screenValue({ screen: contentsPassScreenId(), actions: registeredActions() }),
      );

      expect(tabIds(container)).toEqual([
        'toolbar-all-files',
        'toolbar-validate-borders',
        'toolbar-validate-tables',
      ]);
      expect(currentTabIds(container)).toEqual(['toolbar-validate-tables']);
    });

    test('review adds a current Review tab and leaves both Validate tabs as links', () => {
      const { container } = renderWithPass(
        screenValue({ screen: reviewTableScreenId(), actions: registeredActions() }),
      );

      expect(tabIds(container)).toEqual([
        'toolbar-all-files',
        'toolbar-validate-borders',
        'toolbar-validate-tables',
        'toolbar-review',
      ]);
      expect(currentTabIds(container)).toEqual(['toolbar-review']);
      expect(borders()).toHaveClass('toolbar-tab-link');
      expect(borders()).not.toHaveAttribute('aria-disabled');
      expect(tables()).toHaveClass('toolbar-tab-link');
      expect(tables()).not.toHaveAttribute('aria-disabled');
    });

    test('grid editor adds a current Grid Editor tab and leaves both Validate tabs as links', () => {
      const { container } = renderWithPass(
        screenValue({ screen: linkTablesScreenId(), actions: registeredActions() }),
      );

      expect(tabIds(container)).toEqual([
        'toolbar-all-files',
        'toolbar-validate-borders',
        'toolbar-validate-tables',
        'toolbar-grid-editor',
      ]);
      expect(currentTabIds(container)).toEqual(['toolbar-grid-editor']);
      expect(borders()).toHaveClass('toolbar-tab-link');
      expect(borders()).not.toHaveAttribute('aria-disabled');
      expect(tables()).toHaveClass('toolbar-tab-link');
      expect(tables()).not.toHaveAttribute('aria-disabled');
    });

    test('on Review the Validate tabs call their actions and Review calls neither', async () => {
      const actions = registeredActions();
      renderWithPass(screenValue({ screen: reviewTableScreenId(), actions }));

      await userEvent.click(screen.getByTestId('toolbar-review'));
      expect(actions.validateBorders).not.toHaveBeenCalled();
      expect(actions.validateTables).not.toHaveBeenCalled();

      await userEvent.click(borders());
      expect(actions.validateBorders).toHaveBeenCalledTimes(1);

      await userEvent.click(tables());
      expect(actions.validateTables).toHaveBeenCalledTimes(1);
    });

    test('Review and Grid Editor carry their help ids', () => {
      const { unmount } = renderWithPass(
        screenValue({ screen: reviewTableScreenId(), actions: registeredActions() }),
      );
      expect(screen.getByTestId('toolbar-review')).toHaveAttribute(
        'data-help-id',
        toolbarReviewHelpId(),
      );
      unmount();

      renderWithPass(
        screenValue({ screen: linkTablesScreenId(), actions: registeredActions() }),
      );
      expect(screen.getByTestId('toolbar-grid-editor')).toHaveAttribute(
        'data-help-id',
        toolbarGridEditorHelpId(),
      );
    });
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the all-files help id on the All Files button', () => {
    render(<Toolbar activeView={'editor'} onAllFiles={() => {}} />);

    expect(screen.getByText(toolbarAllFilesLabel())).toHaveAttribute(
      'data-help-id',
      toolbarAllFilesHelpId(),
    );
  });
});
