import { render, screen, fireEvent, within } from '@testing-library/react';
import GridToolbar from 'components/pdfTableViewer/GridToolbar';
import {
  gridToolColumnJoinHelpId,
  gridToolColumnSplitHelpId,
  gridToolColumnsHelpId,
  gridToolRailHelpId,
  gridToolRowJoinHelpId,
  gridToolRowSplitHelpId,
  gridToolRowsHelpId,
} from 'config';

const LINE_TOOLS = [
  { key: 'rows', testId: 'grid-tool-rows', helpId: gridToolRowsHelpId },
  { key: 'rowSplit', testId: 'grid-tool-row-split', helpId: gridToolRowSplitHelpId },
  { key: 'rowJoin', testId: 'grid-tool-row-join', helpId: gridToolRowJoinHelpId },
  { key: 'columns', testId: 'grid-tool-columns', helpId: gridToolColumnsHelpId },
  {
    key: 'columnSplit',
    testId: 'grid-tool-column-split',
    helpId: gridToolColumnSplitHelpId,
  },
  {
    key: 'columnJoin',
    testId: 'grid-tool-column-join',
    helpId: gridToolColumnJoinHelpId,
  },
];

const SPECIAL_KEYS = [
  'header',
  'title',
  'hideRow',
  'sectionTitle',
  'merged',
  'joinedEndRow',
  'colouredRows',
  'colouredColumns',
  'colouredTable',
  'colouredCell',
  'colouredArea',
];

const renderToolbar = (props = {}) =>
  render(
    <GridToolbar
      onSelectTool={() => {}}
      onSelectSpecialTool={() => {}}
      onToggleSplitBottomRow={() => {}}
      {...props}
    />
  );

describe('GridToolbar', () => {
  it('has no Special tool button', () => {
    renderToolbar();
    expect(screen.queryByTestId('grid-tool-special')).toBeNull();
    expect(screen.queryByTestId('grid-tool-special-icon')).toBeNull();
  });

  it('titles the Special section with a caption that is not a button', () => {
    renderToolbar();
    const title = screen.getByTestId('grid-toolbar-special-title');
    expect(title).toHaveTextContent('Special');
    expect(title.tagName).not.toBe('BUTTON');
    expect(screen.getAllByRole('button')).not.toContain(title);
  });

  it('lists every line tool, the Special title, then every Special entry inside the toolbar', () => {
    renderToolbar();
    const toolbar = screen.getByTestId('grid-toolbar');
    const wanted = [
      ...LINE_TOOLS.map(({ testId }) => testId),
      'grid-toolbar-special-title',
      ...SPECIAL_KEYS.map((k) => `special-tool-${k}`),
    ];
    const rendered = Array.from(toolbar.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => wanted.includes(id));
    expect(rendered).toEqual(wanted);
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-testid'))
    ).toEqual(wanted.filter((id) => id !== 'grid-toolbar-special-title'));
  });

  it('labels the Split and Join buttons', () => {
    renderToolbar();
    expect(screen.getByTestId('grid-tool-row-split')).toHaveTextContent('Split');
    expect(screen.getByTestId('grid-tool-row-join')).toHaveTextContent('Join');
    expect(screen.getByTestId('grid-tool-column-split')).toHaveTextContent('Split');
    expect(screen.getByTestId('grid-tool-column-join')).toHaveTextContent('Join');
  });

  it('draws an icon for Rows and Columns', () => {
    renderToolbar();
    expect(screen.getByTestId('grid-tool-rows-icon')).toBeInTheDocument();
    expect(screen.getByTestId('grid-tool-columns-icon')).toBeInTheDocument();
  });

  it.each(LINE_TOOLS.map(({ key }) => key))('arms exactly %s when given it', (armed) => {
    renderToolbar({ tool: armed });
    LINE_TOOLS.forEach(({ key, testId }) =>
      expect(screen.getByTestId(testId)).toHaveAttribute(
        'data-active',
        key === armed ? 'true' : 'false'
      )
    );
  });

  it('arms none of the line tools when no tool is given', () => {
    renderToolbar();
    LINE_TOOLS.forEach(({ testId }) =>
      expect(screen.getByTestId(testId)).toHaveAttribute('data-active', 'false')
    );
  });

  it.each(LINE_TOOLS.map(({ key, testId }) => [testId, key]))(
    'reports %s as %s when clicked',
    (testId, key) => {
      const onSelectTool = jest.fn();
      renderToolbar({ onSelectTool });
      fireEvent.click(screen.getByTestId(testId));
      expect(onSelectTool).toHaveBeenCalledWith(key);
    }
  );

  it('reports a Special entry click through onSelectSpecialTool', () => {
    const onSelectTool = jest.fn();
    const onSelectSpecialTool = jest.fn();
    renderToolbar({ onSelectTool, onSelectSpecialTool });
    fireEvent.click(screen.getByTestId('special-tool-hideRow'));
    expect(onSelectSpecialTool).toHaveBeenCalledWith('hideRow');
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it('shows the armed Special entry', () => {
    renderToolbar({ specialTool: 'title' });
    expect(screen.getByTestId('special-tool-title')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('special-tool-header')).toHaveAttribute(
      'data-active',
      'false'
    );
  });

  it('passes the joined end row flag and its toggle through', () => {
    const onToggleSplitBottomRow = jest.fn();
    renderToolbar({ splitBottomRow: true, onToggleSplitBottomRow });
    const joined = screen.getByTestId('special-tool-joinedEndRow');
    expect(joined).toHaveAttribute('data-active', 'true');
    fireEvent.click(joined);
    expect(onToggleSplitBottomRow).toHaveBeenCalledTimes(1);
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('gives each line tool its own help id', () => {
    renderToolbar();
    LINE_TOOLS.forEach(({ testId, helpId }) =>
      expect(screen.getByTestId(testId)).toHaveAttribute('data-help-id', helpId())
    );
  });

  it('carries the toolbar help id on its box', () => {
    renderToolbar();
    expect(screen.getByTestId('grid-toolbar')).toHaveAttribute(
      'data-help-id',
      gridToolRailHelpId()
    );
  });
});
