import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  documentListScreenId,
  toolbarAllFilesHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
} from 'config';
import { HelpContext } from 'components/help/HelpProvider';
import { EditorPassContext } from 'components/EditorPassProvider';
import Toolbar from './Toolbar';

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

// The two pass tabs are drawn from the editor-pass context: which pass is on screen, and
// the switch to the other, registered by the editor beneath. A toolbar rendered with no
// provider at all — as the tests above it are — has neither.
const passValue = (overrides = {}) => ({
  pass: null,
  actions: null,
  setPass: () => {},
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
      screen.getByRole('button', { name: '← All Files' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Validate borders' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Validate tables' }),
    ).toBeInTheDocument();
  });

  test('clicking "← All Files" calls onAllFiles', async () => {
    const onAllFiles = jest.fn();
    render(<Toolbar activeView={'editor'} onAllFiles={onAllFiles} />);
    await userEvent.click(screen.getByRole('button', { name: '← All Files' }));
    expect(onAllFiles).toHaveBeenCalledTimes(1);
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

  // The pass you are on is the current tab: primary text, underlined, and with nowhere to
  // go. The other is the way to the other pass, and makes the switch the Layers panel's
  // own Validate button makes.
  describe('the two pass tabs', () => {
    test('mark Validate borders as the page you are on in the boundary pass', () => {
      renderWithPass(passValue({ pass: 'border', actions: { validateBorders: jest.fn(), validateTables: jest.fn() } }));

      expect(borders()).toHaveClass('toolbar-tab-current');
      expect(borders()).toHaveAttribute('aria-current', 'page');
      expect(tables()).toHaveClass('toolbar-tab-link');
      expect(tables()).not.toHaveAttribute('aria-disabled');
    });

    test('mark Validate tables as the page you are on in the contents pass', () => {
      renderWithPass(passValue({ pass: 'grid', actions: { validateBorders: jest.fn(), validateTables: jest.fn() } }));

      expect(tables()).toHaveClass('toolbar-tab-current');
      expect(tables()).toHaveAttribute('aria-current', 'page');
      expect(borders()).toHaveClass('toolbar-tab-link');
    });

    test('switch to the contents pass from the boundary pass', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(passValue({ pass: 'border', actions }));

      await userEvent.click(tables());

      expect(actions.validateTables).toHaveBeenCalledTimes(1);
      expect(actions.validateBorders).not.toHaveBeenCalled();
    });

    test('switch to the boundary pass from the contents pass', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(passValue({ pass: 'grid', actions }));

      await userEvent.click(borders());

      expect(actions.validateBorders).toHaveBeenCalledTimes(1);
      expect(actions.validateTables).not.toHaveBeenCalled();
    });

    test('leave the tab for the pass you are on ineffective', async () => {
      const actions = { validateBorders: jest.fn(), validateTables: jest.fn() };
      renderWithPass(passValue({ pass: 'border', actions }));

      await userEvent.click(borders());

      expect(actions.validateBorders).not.toHaveBeenCalled();
    });

    // The switch is out of reach while a full panel stands over the editor, so the tab
    // that would make it says so rather than looking like a link that does nothing.
    test('mark the other pass out of reach where the editor has no switch to offer', () => {
      renderWithPass(passValue({ pass: 'border', actions: null }));

      expect(tables()).toHaveAttribute('aria-disabled', 'true');
      expect(borders()).toHaveClass('toolbar-tab-current');
    });

    // The overlay measures each tip's hole from these attributes and the copy module keys
    // the same tips by the same functions, so no id is a literal on either side.
    test('carry the help ids the editor screens describe them by', () => {
      renderWithPass(passValue({ pass: 'border', actions: null }));

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

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the all-files help id on the All Files button', () => {
    render(<Toolbar activeView={'editor'} onAllFiles={() => {}} />);

    expect(screen.getByText('← All Files')).toHaveAttribute(
      'data-help-id',
      toolbarAllFilesHelpId(),
    );
  });
});
