import { render, screen, fireEvent } from '@testing-library/react';
import LayerOptions from 'components/pdfTableViewer/LayerOptions';

// Config is mocked (rather than read directly) so no assertion here can ever depend
// on a configured colour or size: the real values are passed through, but any test
// needing a specific one overrides it locally instead of asserting the constant.
jest.mock('config', () => {
  const actual = jest.requireActual('config');
  return { __esModule: true, ...actual };
});

// The full set of button testids the component can ever render, so a test can
// assert that only the expected ones are present.
const ALL_TESTIDS = [
  'opt-delete-table',
  'opt-create-table',
  'opt-confirm-created',
  'opt-cancel-created',
  'opt-add-above',
  'opt-add-below',
  'opt-delete-line',
  'opt-add-row',
  'opt-add-left',
  'opt-add-right',
  'opt-set-title',
  'opt-delete-title',
  'opt-remove-header',
  'opt-add-header',
  'opt-add-hidden-row',
  'opt-delete-hidden-row',
  'opt-add-sub-title',
  'opt-delete-sub-title',
  'opt-merge-cell',
  'opt-extend-column',
  'opt-reduce-column',
  'opt-extend-row',
  'opt-reduce-row',
];

// Every callback prop, so each render passes them all and clicks can be checked.
const mkCallbacks = () => ({
  onDeleteTable: jest.fn(),
  onCreateTable: jest.fn(),
  onConfirmCreated: jest.fn(),
  onCancelCreated: jest.fn(),
  onAddAbove: jest.fn(),
  onAddBelow: jest.fn(),
  onDeleteLine: jest.fn(),
  onAddRow: jest.fn(),
  onAddLeft: jest.fn(),
  onAddRight: jest.fn(),
  onSetTitle: jest.fn(),
  onDeleteTitle: jest.fn(),
  onRemoveHeader: jest.fn(),
  onAddHeader: jest.fn(),
  onAddSubTitleRow: jest.fn(),
  onAddHiddenRow: jest.fn(),
  onDeleteHiddenRow: jest.fn(),
  onDeleteSubTitleRow: jest.fn(),
  onColumnNameChange: jest.fn(),
  onMergeCell: jest.fn(),
  onExtendColumn: jest.fn(),
  onReduceColumn: jest.fn(),
  onExtendRow: jest.fn(),
  onReduceRow: jest.fn(),
});

const presentTestids = () =>
  ALL_TESTIDS.filter((id) => screen.queryByTestId(id) !== null);

describe('LayerOptions', () => {
  // Special Areas is taller than the panel on a short window, so the block scrolls
  // within whatever height is left rather than pushing the panel's page buttons off
  // the bottom.
  it('scrolls vertically inside the height the panel leaves it', () => {
    render(<LayerOptions layer="special" {...mkCallbacks()} />);
    const style = getComputedStyle(screen.getByTestId('layer-options'));
    expect(style.overflowY).toBe('auto');
    expect(style.flexGrow).toBe('1');
    // Without this a flex child refuses to shrink below its content, so the overflow
    // would never engage.
    expect(parseFloat(style.minHeight)).toBe(0);
  });

  describe('border layer', () => {
    it('renders Delete this table and Create table only (not confirmed-created)', () => {
      render(<LayerOptions layer="border" {...mkCallbacks()} />);
      expect(presentTestids().sort()).toEqual(
        ['opt-create-table', 'opt-delete-table'].sort(),
      );
    });

    it('adds Calculate/confirm and Cancel affordances when isCreatedUnconfirmed', () => {
      render(
        <LayerOptions layer="border" isCreatedUnconfirmed {...mkCallbacks()} />,
      );
      expect(presentTestids().sort()).toEqual(
        [
          'opt-delete-table',
          'opt-create-table',
          'opt-confirm-created',
          'opt-cancel-created',
        ].sort(),
      );
    });

    it('clicking each button calls its callback', () => {
      const cbs = mkCallbacks();
      render(<LayerOptions layer="border" isCreatedUnconfirmed {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-delete-table'));
      fireEvent.click(screen.getByTestId('opt-create-table'));
      fireEvent.click(screen.getByTestId('opt-confirm-created'));
      fireEvent.click(screen.getByTestId('opt-cancel-created'));
      expect(cbs.onDeleteTable).toHaveBeenCalledTimes(1);
      expect(cbs.onCreateTable).toHaveBeenCalledTimes(1);
      expect(cbs.onConfirmCreated).toHaveBeenCalledTimes(1);
      expect(cbs.onCancelCreated).toHaveBeenCalledTimes(1);
    });
  });

  // The transient Expected Columns / Expected Rows hints shown alongside the Borders
  // buttons. They are only meaningful for a specific table, so they appear on the
  // 'border' layer AND only when a table is selected.
  describe('border layer — Expected Columns / Expected Rows', () => {
    it('renders both fields, blank by default, when a table is selected', () => {
      render(
        <LayerOptions layer="border" hasSelectedTable {...mkCallbacks()} />,
      );
      expect(screen.getByLabelText('Expected Columns')).toBeInTheDocument();
      expect(screen.getByLabelText('Expected Rows')).toBeInTheDocument();
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('');
      expect(screen.getByTestId('opt-expected-rows')).toHaveValue('');
    });

    it('renders neither field when no table is selected', () => {
      render(<LayerOptions layer="border" {...mkCallbacks()} />);
      expect(screen.queryByTestId('opt-expected-columns')).toBeNull();
      expect(screen.queryByTestId('opt-expected-rows')).toBeNull();
    });

    it('renders neither field on another layer', () => {
      render(<LayerOptions layer="rows" hasSelectedTable {...mkCallbacks()} />);
      expect(screen.queryByTestId('opt-expected-columns')).toBeNull();
      expect(screen.queryByTestId('opt-expected-rows')).toBeNull();
    });

    it('reports a typed integer for the field it was typed into', () => {
      const onExpectedCountsChange = jest.fn();
      render(
        <LayerOptions
          layer="border"
          hasSelectedTable
          onExpectedCountsChange={onExpectedCountsChange}
          {...mkCallbacks()}
        />,
      );
      fireEvent.change(screen.getByTestId('opt-expected-columns'), {
        target: { value: '3' },
      });
      expect(onExpectedCountsChange).toHaveBeenCalledWith(
        'expectedColumns',
        '3',
      );

      fireEvent.change(screen.getByTestId('opt-expected-rows'), {
        target: { value: '12' },
      });
      expect(onExpectedCountsChange).toHaveBeenCalledWith('expectedRows', '12');
    });

    it('does not adopt non-numeric input', () => {
      const onExpectedCountsChange = jest.fn();
      render(
        <LayerOptions
          layer="border"
          hasSelectedTable
          expectedColumns="4"
          onExpectedCountsChange={onExpectedCountsChange}
          {...mkCallbacks()}
        />,
      );
      fireEvent.change(screen.getByTestId('opt-expected-columns'), {
        target: { value: '4a' },
      });
      expect(onExpectedCountsChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('opt-expected-columns')).toHaveValue('4');
    });

    it('rejects zero and negative input', () => {
      const onExpectedCountsChange = jest.fn();
      render(
        <LayerOptions
          layer="border"
          hasSelectedTable
          expectedRows="4"
          onExpectedCountsChange={onExpectedCountsChange}
          {...mkCallbacks()}
        />,
      );
      fireEvent.change(screen.getByTestId('opt-expected-rows'), {
        target: { value: '0' },
      });
      fireEvent.change(screen.getByTestId('opt-expected-rows'), {
        target: { value: '-1' },
      });
      expect(onExpectedCountsChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('opt-expected-rows')).toHaveValue('4');
    });

    it('allows clearing a field back to blank', () => {
      const onExpectedCountsChange = jest.fn();
      render(
        <LayerOptions
          layer="border"
          hasSelectedTable
          expectedColumns="4"
          onExpectedCountsChange={onExpectedCountsChange}
          {...mkCallbacks()}
        />,
      );
      fireEvent.change(screen.getByTestId('opt-expected-columns'), {
        target: { value: '' },
      });
      expect(onExpectedCountsChange).toHaveBeenCalledWith('expectedColumns', '');
    });
  });

  describe('rows layer', () => {
    it('shows Add above/below/Delete disabled when no line is selected, plus Add row when no internal lines', () => {
      render(<LayerOptions layer="rows" {...mkCallbacks()} />);
      expect(presentTestids().sort()).toEqual(
        ['opt-add-above', 'opt-add-below', 'opt-delete-line', 'opt-add-row'].sort(),
      );
      expect(screen.getByTestId('opt-add-above')).toBeDisabled();
      expect(screen.getByTestId('opt-add-below')).toBeDisabled();
      expect(screen.getByTestId('opt-delete-line')).toBeDisabled();
    });

    it('enables the action buttons when a line is selected', () => {
      render(<LayerOptions layer="rows" hasSelectedLine {...mkCallbacks()} />);
      expect(screen.getByTestId('opt-add-above')).toBeEnabled();
      expect(screen.getByTestId('opt-add-below')).toBeEnabled();
      expect(screen.getByTestId('opt-delete-line')).toBeEnabled();
    });

    it('hides Add row when internal lines exist', () => {
      render(
        <LayerOptions layer="rows" hasInternalLines {...mkCallbacks()} />,
      );
      expect(screen.queryByTestId('opt-add-row')).toBeNull();
    });

    it('clicking each button calls its callback', () => {
      const cbs = mkCallbacks();
      render(<LayerOptions layer="rows" hasSelectedLine {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-add-above'));
      fireEvent.click(screen.getByTestId('opt-add-below'));
      fireEvent.click(screen.getByTestId('opt-delete-line'));
      fireEvent.click(screen.getByTestId('opt-add-row'));
      expect(cbs.onAddAbove).toHaveBeenCalledTimes(1);
      expect(cbs.onAddBelow).toHaveBeenCalledTimes(1);
      expect(cbs.onDeleteLine).toHaveBeenCalledTimes(1);
      expect(cbs.onAddRow).toHaveBeenCalledTimes(1);
    });
  });

  describe('columns layer', () => {
    it('shows Add Left/Right/Delete disabled when no line is selected', () => {
      render(<LayerOptions layer="columns" {...mkCallbacks()} />);
      expect(presentTestids().sort()).toEqual(
        ['opt-add-left', 'opt-add-right', 'opt-delete-line'].sort(),
      );
      expect(screen.getByTestId('opt-add-left')).toBeDisabled();
      expect(screen.getByTestId('opt-add-right')).toBeDisabled();
      expect(screen.getByTestId('opt-delete-line')).toBeDisabled();
    });

    it('enables the action buttons when a line is selected', () => {
      render(<LayerOptions layer="columns" hasSelectedLine {...mkCallbacks()} />);
      expect(screen.getByTestId('opt-add-left')).toBeEnabled();
      expect(screen.getByTestId('opt-add-right')).toBeEnabled();
      expect(screen.getByTestId('opt-delete-line')).toBeEnabled();
    });

    it('clicking each button calls its callback', () => {
      const cbs = mkCallbacks();
      render(<LayerOptions layer="columns" hasSelectedLine {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-add-left'));
      fireEvent.click(screen.getByTestId('opt-add-right'));
      fireEvent.click(screen.getByTestId('opt-delete-line'));
      expect(cbs.onAddLeft).toHaveBeenCalledTimes(1);
      expect(cbs.onAddRight).toHaveBeenCalledTimes(1);
      expect(cbs.onDeleteLine).toHaveBeenCalledTimes(1);
    });
  });

  describe('special layer', () => {
    it('renders the special-cell buttons, including the sub-title-row and merged-cell buttons', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      expect(presentTestids().sort()).toEqual(
        [
          'opt-set-title',
          'opt-delete-title',
          'opt-remove-header',
          'opt-add-header',
          'opt-add-hidden-row',
          'opt-delete-hidden-row',
          'opt-add-sub-title',
          'opt-delete-sub-title',
          'opt-merge-cell',
          'opt-extend-column',
          'opt-reduce-column',
          'opt-extend-row',
          'opt-reduce-row',
        ].sort(),
      );
    });

    it('clicking each button calls its callback', () => {
      const cbs = mkCallbacks();
      render(
        <LayerOptions layer="special" hasSectionRowSelected {...cbs} />
      );
      fireEvent.click(screen.getByTestId('opt-set-title'));
      fireEvent.click(screen.getByTestId('opt-delete-title'));
      fireEvent.click(screen.getByTestId('opt-remove-header'));
      fireEvent.click(screen.getByTestId('opt-add-header'));
      fireEvent.click(screen.getByTestId('opt-add-hidden-row'));
      fireEvent.click(screen.getByTestId('opt-delete-hidden-row'));
      fireEvent.click(screen.getByTestId('opt-add-sub-title'));
      fireEvent.click(screen.getByTestId('opt-delete-sub-title'));
      expect(cbs.onSetTitle).toHaveBeenCalledTimes(1);
      expect(cbs.onDeleteTitle).toHaveBeenCalledTimes(1);
      expect(cbs.onRemoveHeader).toHaveBeenCalledTimes(1);
      expect(cbs.onAddHeader).toHaveBeenCalledTimes(1);
      expect(cbs.onAddHiddenRow).toHaveBeenCalledTimes(1);
      expect(cbs.onDeleteHiddenRow).toHaveBeenCalledTimes(1);
      expect(cbs.onAddSubTitleRow).toHaveBeenCalledTimes(1);
      expect(cbs.onDeleteSubTitleRow).toHaveBeenCalledTimes(1);
    });

    it('disables Delete Section Title Row until a section-title row is selected', () => {
      const { rerender } = render(
        <LayerOptions layer="special" {...mkCallbacks()} />
      );
      expect(screen.getByTestId('opt-delete-sub-title')).toBeDisabled();
      rerender(
        <LayerOptions layer="special" hasSectionRowSelected {...mkCallbacks()} />
      );
      expect(screen.getByTestId('opt-delete-sub-title')).toBeEnabled();
    });

    // The header-row group counts what it manages, so how many rows are headers is visible
    // without leaving the panel.
    it('counts the header rows in the group heading when there are any', () => {
      const { rerender } = render(
        <LayerOptions layer={'special'} headerCount={2} {...mkCallbacks()} />
      );
      expect(screen.getByText('Header row management (2)')).toBeInTheDocument();
      rerender(
        <LayerOptions layer={'special'} headerCount={1} {...mkCallbacks()} />
      );
      expect(screen.getByText('Header row management (1)')).toBeInTheDocument();
    });

    it('leaves the heading bare when there are no header rows', () => {
      render(<LayerOptions layer={'special'} headerCount={0} {...mkCallbacks()} />);
      expect(screen.getByText('Header row management')).toBeInTheDocument();
    });

    it('leaves the heading bare when the header count is not known', () => {
      render(<LayerOptions layer={'special'} {...mkCallbacks()} />);
      expect(screen.getByText('Header row management')).toBeInTheDocument();
    });

    // A hidden row is deleted through the same selection as a section-title row: both are
    // section titles, so Delete is gated on one being selected.
    it('disables Delete Hidden Row until a section-title row is selected', () => {
      const { rerender } = render(
        <LayerOptions layer={'special'} {...mkCallbacks()} />
      );
      expect(screen.getByTestId('opt-delete-hidden-row')).toBeDisabled();
      rerender(
        <LayerOptions
          layer={'special'}
          hasSectionRowSelected
          {...mkCallbacks()}
        />
      );
      expect(screen.getByTestId('opt-delete-hidden-row')).toBeEnabled();
    });

    // Hidden rows come before section titles: removing a row from the output is a coarser
    // decision than naming what one of them says.
    it('puts the Hidden rows group above Section title row management', () => {
      render(<LayerOptions layer={'special'} {...mkCallbacks()} />);
      const order = [...document.body.querySelectorAll('[data-testid]')]
        .map((el) => el.dataset.testid)
        .filter((id) => id === 'opt-add-hidden-row' || id === 'opt-add-sub-title');
      expect(order).toEqual(['opt-add-hidden-row', 'opt-add-sub-title']);
    });

    // Each group of actions is named by a heading, so the buttons under it can carry
    // one-word labels: "Remove" under "Header row management" reads as the old
    // "Remove Header Row".
    it.each([
      ['Title management', 'opt-set-title', 'Set'],
      ['Title management', 'opt-delete-title', 'Delete'],
      ['Header row management', 'opt-add-header', 'Add'],
      ['Header row management', 'opt-remove-header', 'Remove'],
      ['Hidden rows', 'opt-add-hidden-row', 'Add'],
      ['Hidden rows', 'opt-delete-hidden-row', 'Delete'],
      ['Section title row management', 'opt-add-sub-title', 'Add'],
      ['Section title row management', 'opt-delete-sub-title', 'Delete'],
      ['Merged cell management', 'opt-merge-cell', 'Create'],
      ['Merged cell management', 'opt-extend-column', 'Column +'],
      ['Merged cell management', 'opt-reduce-column', 'Column -'],
      ['Merged cell management', 'opt-extend-row', 'Row +'],
      ['Merged cell management', 'opt-reduce-row', 'Row -'],
    ])('titles the %s group and labels %s "%s"', (title, testId, label) => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByTestId(testId)).toHaveTextContent(label);
    });

    it('orders Remove after Add in the header-row group', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      const addHeader = screen.getByTestId('opt-add-header');
      const removeHeader = screen.getByTestId('opt-remove-header');
      // Bitwise test against the DOM's own ordering flag, so the assertion is about
      // document order rather than about any particular markup shape.
      expect(
        addHeader.compareDocumentPosition(removeHeader) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('keeps the header-removal testid and callback after the relabel', () => {
      const cbs = mkCallbacks();
      render(<LayerOptions layer="special" {...cbs} />);
      const removeHeader = screen.getByTestId('opt-remove-header');
      expect(removeHeader).toHaveTextContent('Remove');
      fireEvent.click(removeHeader);
      expect(cbs.onRemoveHeader).toHaveBeenCalledTimes(1);
    });

    it('draws a separator between each pair of neighbouring groups', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      const separators = screen.getAllByTestId('opt-separator');
      expect(separators).toHaveLength(4);
      // Position is asserted by document order alone — the rule's appearance comes from
      // config and must never be what a test depends on. Each rule closes one group and
      // opens the next, so it falls between their last and first buttons.
      [
        ['opt-delete-title', 'opt-add-header'],
        ['opt-remove-header', 'opt-add-hidden-row'],
        ['opt-delete-hidden-row', 'opt-add-sub-title'],
        ['opt-delete-sub-title', 'opt-merge-cell'],
      ].forEach(([before, after], index) => {
        const rule = separators[index];
        expect(
          screen.getByTestId(before).compareDocumentPosition(rule) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          rule.compareDocumentPosition(screen.getByTestId(after)) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });
    });

    it('centres each separator horizontally within the Options block', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      // The rule is deliberately narrower than the block, so auto side margins are what
      // centre it. Asserted because it is structural — unlike the colour, thickness and
      // corner radius, which come from config and must never be what a test depends on.
      screen.getAllByTestId('opt-separator').forEach((rule) => {
        expect(rule.style.marginLeft).toBe('auto');
        expect(rule.style.marginRight).toBe('auto');
      });
    });

    it('renders a Column name combo, disabled until an area is selected', () => {
      const { rerender } = render(
        <LayerOptions
          layer="special"
          columnNameOptions={['Premium']}
          {...mkCallbacks()}
        />
      );
      expect(screen.getByLabelText('Column name')).toBeDisabled();
      rerender(
        <LayerOptions
          layer="special"
          sectionAreaSelected
          columnNameOptions={['Premium']}
          {...mkCallbacks()}
        />
      );
      expect(screen.getByLabelText('Column name')).toBeEnabled();
    });
  });

  // The merged-cell section is the last group in the Special Areas Options block:
  // Merge Cell arms a mode (so it is always clickable), while each Extend/Reduce
  // button is gated by the matching `can…` prop the host computes.
  describe('special layer — merged-cell buttons', () => {
    const MERGED_TESTIDS = [
      'opt-merge-cell',
      'opt-extend-column',
      'opt-reduce-column',
      'opt-extend-row',
      'opt-reduce-row',
    ];

    it('renders all five merged-cell buttons', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      MERGED_TESTIDS.forEach((id) => {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      });
    });

    it('places all five after Delete Section Title Row in document order', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      const deleteSubTitle = screen.getByTestId('opt-delete-sub-title');
      // Bitwise test against the DOM's own ordering flag, so the assertion is about
      // document order rather than about any particular markup shape.
      MERGED_TESTIDS.forEach((id) => {
        expect(
          deleteSubTitle.compareDocumentPosition(screen.getByTestId(id)) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });
    });

    it('adds a final separator opening the merged-cell section', () => {
      render(<LayerOptions layer="special" {...mkCallbacks()} />);
      const separators = screen.getAllByTestId('opt-separator');
      expect(separators).toHaveLength(4);
      const last = separators[separators.length - 1];
      expect(
        last.compareDocumentPosition(screen.getByTestId('opt-merge-cell')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('keeps Merge Cell enabled whatever the can… props say, and calls onMergeCell', () => {
      const cbs = mkCallbacks();
      const { rerender } = render(<LayerOptions layer="special" {...cbs} />);
      expect(screen.getByTestId('opt-merge-cell')).toBeEnabled();
      rerender(
        <LayerOptions
          layer="special"
          canExtendColumn
          canReduceColumn
          canExtendRow
          canReduceRow
          {...cbs}
        />,
      );
      expect(screen.getByTestId('opt-merge-cell')).toBeEnabled();
      fireEvent.click(screen.getByTestId('opt-merge-cell'));
      expect(cbs.onMergeCell).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['opt-extend-column', 'canExtendColumn', 'onExtendColumn'],
      ['opt-reduce-column', 'canReduceColumn', 'onReduceColumn'],
      ['opt-extend-row', 'canExtendRow', 'onExtendRow'],
      ['opt-reduce-row', 'canReduceRow', 'onReduceRow'],
    ])(
      '%s is gated by %s and calls %s when clicked',
      (testId, canProp, callbackName) => {
        const cbs = mkCallbacks();
        const { rerender } = render(<LayerOptions layer="special" {...cbs} />);
        expect(screen.getByTestId(testId)).toBeDisabled();

        rerender(
          <LayerOptions layer="special" {...{ [canProp]: false }} {...cbs} />,
        );
        expect(screen.getByTestId(testId)).toBeDisabled();
        fireEvent.click(screen.getByTestId(testId));
        expect(cbs[callbackName]).not.toHaveBeenCalled();

        rerender(
          <LayerOptions layer="special" {...{ [canProp]: true }} {...cbs} />,
        );
        expect(screen.getByTestId(testId)).toBeEnabled();
        fireEvent.click(screen.getByTestId(testId));
        expect(cbs[callbackName]).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['border', 'rows', 'columns', 'colours'])(
      'renders none of the merged-cell buttons on the %s layer',
      (layer) => {
        render(
          <LayerOptions layer={layer} hasSelectedTable {...mkCallbacks()} />,
        );
        MERGED_TESTIDS.forEach((id) => {
          expect(screen.queryByTestId(id)).toBeNull();
        });
      },
    );
  });

  // The group separators belong to the Special Areas block only; no other layer's
  // Options block is divided into groups.
  describe('group separators', () => {
    it.each(['border', 'rows', 'columns', 'colours'])(
      'renders no separator on the %s layer',
      (layer) => {
        render(<LayerOptions layer={layer} hasSelectedTable {...mkCallbacks()} />);
        expect(screen.queryByTestId('opt-separator')).toBeNull();
      },
    );
  });

  describe('colours layer', () => {
    const mkColourCallbacks = () => ({
      onColourAdd: jest.fn(),
      onColourDelete: jest.fn(),
      onToggleForegroundPick: jest.fn(),
      onToggleBackgroundPick: jest.fn(),
    });

    it('always renders the Add button, and no delete/swatches when nothing is selected', () => {
      render(<LayerOptions layer="colours" {...mkColourCallbacks()} />);
      expect(screen.getByTestId('opt-colour-add')).toBeInTheDocument();
      expect(screen.queryByTestId('opt-colour-delete')).toBeNull();
      expect(screen.queryByTestId('opt-foreground-swatch')).toBeNull();
      expect(screen.queryByTestId('opt-background-swatch')).toBeNull();
    });

    it('with a selected area shows Delete plus both swatches carrying the given colours', () => {
      render(
        <LayerOptions
          layer="colours"
          colouredSelected
          foregroundColour="#ff0000"
          backgroundColour="#0000ff"
          {...mkColourCallbacks()}
        />,
      );
      expect(screen.getByTestId('opt-colour-delete')).toBeInTheDocument();
      const fg = screen.getByTestId('opt-foreground-swatch');
      const bg = screen.getByTestId('opt-background-swatch');
      expect(fg.style.backgroundColor).toBe('rgb(255, 0, 0)');
      expect(bg.style.backgroundColor).toBe('rgb(0, 0, 255)');
    });

    it('shows the brown border on the swatch whose pick mode is active', () => {
      const { rerender } = render(
        <LayerOptions
          layer="colours"
          colouredSelected
          foregroundColour="#ff0000"
          backgroundColour="#0000ff"
          colourPickMode="foreground"
          {...mkColourCallbacks()}
        />,
      );
      expect(screen.getByTestId('opt-foreground-swatch').style.border).toContain(
        'brown',
      );
      expect(
        screen.getByTestId('opt-background-swatch').style.border,
      ).not.toContain('brown');

      rerender(
        <LayerOptions
          layer="colours"
          colouredSelected
          foregroundColour="#ff0000"
          backgroundColour="#0000ff"
          colourPickMode="background"
          {...mkColourCallbacks()}
        />,
      );
      expect(
        screen.getByTestId('opt-background-swatch').style.border,
      ).toContain('brown');
      expect(
        screen.getByTestId('opt-foreground-swatch').style.border,
      ).not.toContain('brown');
    });

    it('clicking each control calls its callback', () => {
      const cbs = mkColourCallbacks();
      render(
        <LayerOptions
          layer="colours"
          colouredSelected
          foregroundColour="#ff0000"
          backgroundColour="#0000ff"
          {...cbs}
        />,
      );
      fireEvent.click(screen.getByTestId('opt-colour-add'));
      fireEvent.click(screen.getByTestId('opt-colour-delete'));
      fireEvent.click(screen.getByTestId('opt-foreground-swatch'));
      fireEvent.click(screen.getByTestId('opt-background-swatch'));
      expect(cbs.onColourAdd).toHaveBeenCalledTimes(1);
      expect(cbs.onColourDelete).toHaveBeenCalledTimes(1);
      expect(cbs.onToggleForegroundPick).toHaveBeenCalledTimes(1);
      expect(cbs.onToggleBackgroundPick).toHaveBeenCalledTimes(1);
    });
  });

  // A locked layer belongs to a table amalgamated into a grid of tables: the block is
  // still rendered — the values are worth reading — but nothing in it edits the table.
  describe('locked layer', () => {
    const mkColourCallbacks = () => ({
      onColourAdd: jest.fn(),
      onColourDelete: jest.fn(),
      onToggleForegroundPick: jest.fn(),
      onToggleBackgroundPick: jest.fn(),
    });

    it('border: disables Delete this table and both expected-count fields', () => {
      render(
        <LayerOptions layer="border" locked hasSelectedTable {...mkCallbacks()} />,
      );
      expect(screen.getByTestId('opt-delete-table')).toBeDisabled();
      expect(screen.getByLabelText('Expected Columns')).toBeDisabled();
      expect(screen.getByLabelText('Expected Rows')).toBeDisabled();
    });

    // Drawing a NEW table is a page action, not an edit of the amalgamated one.
    it('border: leaves Create table usable', () => {
      const cbs = mkCallbacks();
      render(<LayerOptions layer="border" locked {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-create-table'));
      expect(cbs.onCreateTable).toHaveBeenCalledTimes(1);
    });

    it('columns: disables every button even with a line selected', () => {
      render(
        <LayerOptions layer="columns" locked hasSelectedLine {...mkCallbacks()} />,
      );
      expect(screen.getByTestId('opt-add-left')).toBeDisabled();
      expect(screen.getByTestId('opt-add-right')).toBeDisabled();
      expect(screen.getByTestId('opt-delete-line')).toBeDisabled();
    });

    it('colours: disables Add and Delete, and neither swatch arms a pick', () => {
      const cbs = mkColourCallbacks();
      render(
        <LayerOptions
          layer="colours"
          locked
          colouredSelected
          foregroundColour="#ff0000"
          backgroundColour="#0000ff"
          {...cbs}
        />,
      );
      expect(screen.getByTestId('opt-colour-add')).toBeDisabled();
      expect(screen.getByTestId('opt-colour-delete')).toBeDisabled();
      fireEvent.click(screen.getByTestId('opt-foreground-swatch'));
      fireEvent.click(screen.getByTestId('opt-background-swatch'));
      expect(cbs.onToggleForegroundPick).not.toHaveBeenCalled();
      expect(cbs.onToggleBackgroundPick).not.toHaveBeenCalled();
    });

    // Rows and Special Areas are never locked, so the flag must not reach them.
    it('rows: is unaffected by the flag', () => {
      render(
        <LayerOptions layer="rows" locked hasSelectedLine {...mkCallbacks()} />,
      );
      expect(screen.getByTestId('opt-add-above')).toBeEnabled();
      expect(screen.getByTestId('opt-delete-line')).toBeEnabled();
    });

    it('special: is unaffected by the flag', () => {
      render(<LayerOptions layer="special" locked {...mkCallbacks()} />);
      expect(screen.getByTestId('opt-set-title')).toBeEnabled();
      expect(screen.getByTestId('opt-add-header')).toBeEnabled();
    });
  });
});
