import { render, screen, fireEvent } from '@testing-library/react';
import LayerOptions from 'components/pdfTableViewer/LayerOptions';
import {
  boundaryCreateTableHelpId,
  boundaryCutCancelHelpId,
  boundaryCutEndHelpId,
  boundaryCutStartHelpId,
  boundaryDeleteAllTablesHelpId,
  boundaryDeleteTableHelpId,
  cutColourKey,
} from 'config';

// Every testid the block can ever render, so a test can assert that only the expected
// ones are present.
const ALL_TESTIDS = [
  'opt-delete-table',
  'opt-cut-start',
  'opt-cut-end',
  'opt-cut-cancel',
  'opt-delete-all-tables',
  'opt-create-table',
  'opt-delete-header',
  'colour-selectors',
  'opt-colour-submit',
  'opt-colour-delete',
];

const shown = () => ALL_TESTIDS.filter((id) => screen.queryByTestId(id) !== null);

describe('LayerOptions', () => {
  describe('borderMode', () => {
    it('offers the table-boundary actions', () => {
      render(<LayerOptions editorMode={'border'} />);
      expect(shown()).toEqual([
        'opt-delete-table',
        'opt-cut-start',
        'opt-delete-all-tables',
        'opt-create-table',
      ]);
    });

    it('renders no expected-count fields', () => {
      render(<LayerOptions editorMode={'border'} />);
      expect(screen.queryByTestId('opt-expected-columns')).toBeNull();
      expect(screen.queryByTestId('opt-expected-rows')).toBeNull();
    });

    it('forwards each button to its callback', () => {
      const cbs = {
        onDeleteTable: jest.fn(),
        onCreateTable: jest.fn(),
      };
      render(<LayerOptions editorMode={'border'} {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-delete-table'));
      fireEvent.click(screen.getByTestId('opt-create-table'));
      Object.values(cbs).forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));
    });
  });

  describe('gridMode', () => {
    it('renders nothing when no tool is armed', () => {
      render(<LayerOptions editorMode={'grid'} tool={null} />);
      expect(shown()).toEqual([]);
    });

    it('renders nothing for the Rows and Columns tools', () => {
      render(<LayerOptions editorMode={'grid'} tool={'rows'} />);
      expect(shown()).toEqual([]);
      render(<LayerOptions editorMode={'grid'} tool={'columns'} />);
      expect(shown()).toEqual([]);
    });

    it('offers Delete Header for the Header tool', () => {
      const onDeleteHeader = jest.fn();
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'header'}
          onDeleteHeader={onDeleteHeader}
        />
      );
      expect(shown()).toEqual(['opt-delete-header']);
      fireEvent.click(screen.getByTestId('opt-delete-header'));
      expect(onDeleteHeader).toHaveBeenCalledTimes(1);
    });

    it('waits for a selection before offering the colour selectors', () => {
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'colouredRows'}
        />
      );
      expect(shown()).toEqual([]);
    });

    it('offers the colour selectors once something is pending', () => {
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'colouredRows'}
          hasPendingSelection
        />
      );
      expect(shown()).toEqual(['colour-selectors', 'opt-colour-submit']);
    });

    it('adds Delete when the selection is an area already saved', () => {
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'colouredArea'}
          hasSavedAreaSelected
        />
      );
      expect(shown()).toEqual([
        'colour-selectors',
        'opt-colour-submit',
        'opt-colour-delete',
      ]);
    });

    it('offers the colour selectors immediately for Coloured Table', () => {
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'colouredTable'}
        />
      );
      expect(shown()).toEqual(['colour-selectors', 'opt-colour-submit']);
    });

    it('forwards Submit and Delete', () => {
      const onColourSubmit = jest.fn();
      const onColourDelete = jest.fn();
      render(
        <LayerOptions
          editorMode={'grid'}
          tool={'special'}
          specialTool={'colouredArea'}
          hasSavedAreaSelected
          onColourSubmit={onColourSubmit}
          onColourDelete={onColourDelete}
        />
      );
      fireEvent.click(screen.getByTestId('opt-colour-submit'));
      fireEvent.click(screen.getByTestId('opt-colour-delete'));
      expect(onColourSubmit).toHaveBeenCalledTimes(1);
      expect(onColourDelete).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the block itself even when it is empty', () => {
    render(<LayerOptions editorMode={'grid'} />);
    expect(screen.getByTestId('layer-options')).toBeInTheDocument();
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('gives the two boundary-pass buttons their own help ids', () => {
    render(<LayerOptions editorMode={'border'} />);

    expect(screen.getByTestId('opt-delete-table')).toHaveAttribute(
      'data-help-id',
      boundaryDeleteTableHelpId()
    );
    expect(screen.getByTestId('opt-create-table')).toHaveAttribute(
      'data-help-id',
      boundaryCreateTableHelpId()
    );
  });

  describe('cut and delete-all', () => {
    const NEW_TESTIDS = [
      'opt-cut-start',
      'opt-cut-end',
      'opt-cut-cancel',
      'opt-delete-all-tables',
    ];

    const domOrder = () =>
      Array.from(
        screen.getByTestId('layer-options').querySelectorAll('button[data-testid]')
      ).map((b) => b.getAttribute('data-testid'));

    it('lays the border-mode buttons out in order when not cutting', () => {
      render(<LayerOptions editorMode={'border'} />);
      expect(domOrder()).toEqual([
        'opt-delete-table',
        'opt-cut-start',
        'opt-delete-all-tables',
        'opt-create-table',
      ]);
    });

    it('lays the border-mode buttons out in order while cutting', () => {
      render(<LayerOptions editorMode={'border'} cutting />);
      expect(domOrder()).toEqual([
        'opt-delete-table',
        'opt-cut-end',
        'opt-cut-cancel',
        'opt-delete-all-tables',
        'opt-create-table',
      ]);
    });

    it('swaps Cut Start for Cut End and Cut Cancel in the cut colour while cutting', () => {
      render(<LayerOptions editorMode={'border'} cutting />);
      expect(screen.queryByTestId('opt-cut-start')).toBeNull();
      ['opt-cut-end', 'opt-cut-cancel'].forEach((id) => {
        expect(screen.getByTestId(id)).toHaveAttribute('data-colour', cutColourKey());
      });
    });

    it('enables Cut Start only when a cut is possible', () => {
      const { unmount } = render(<LayerOptions editorMode={'border'} />);
      expect(screen.getByTestId('opt-cut-start')).toBeDisabled();
      unmount();
      render(<LayerOptions editorMode={'border'} canCut />);
      expect(screen.getByTestId('opt-cut-start')).toBeEnabled();
    });

    it('disables Create table while cutting', () => {
      render(<LayerOptions editorMode={'border'} cutting />);
      expect(screen.getByTestId('opt-create-table')).toBeDisabled();
    });

    it('renders none of the new buttons in grid mode', () => {
      const states = [
        { tool: null },
        { tool: 'rows' },
        { tool: 'columns' },
        { tool: 'special', specialTool: 'header' },
        { tool: 'special', specialTool: 'colouredRows' },
        { tool: 'special', specialTool: 'colouredRows', hasPendingSelection: true },
        { tool: 'special', specialTool: 'colouredArea', hasSavedAreaSelected: true },
        { tool: 'special', specialTool: 'colouredTable' },
      ];
      states.forEach((props) => {
        [false, true].forEach((cutting) => {
          const { unmount } = render(
            <LayerOptions editorMode={'grid'} cutting={cutting} canCut {...props} />
          );
          NEW_TESTIDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
          unmount();
        });
      });
    });

    it('gives Cut Start and Delete all tables their help ids and callbacks', () => {
      const onCutStart = jest.fn();
      const onDeleteAllTables = jest.fn();
      render(
        <LayerOptions
          editorMode={'border'}
          canCut
          onCutStart={onCutStart}
          onDeleteAllTables={onDeleteAllTables}
        />
      );
      expect(screen.getByTestId('opt-cut-start')).toHaveAttribute(
        'data-help-id',
        boundaryCutStartHelpId()
      );
      expect(screen.getByTestId('opt-delete-all-tables')).toHaveAttribute(
        'data-help-id',
        boundaryDeleteAllTablesHelpId()
      );
      fireEvent.click(screen.getByTestId('opt-cut-start'));
      fireEvent.click(screen.getByTestId('opt-delete-all-tables'));
      expect(onCutStart).toHaveBeenCalledTimes(1);
      expect(onDeleteAllTables).toHaveBeenCalledTimes(1);
    });

    it('gives Cut End and Cut Cancel their help ids and callbacks', () => {
      const onCutEnd = jest.fn();
      const onCutCancel = jest.fn();
      render(
        <LayerOptions
          editorMode={'border'}
          cutting
          onCutEnd={onCutEnd}
          onCutCancel={onCutCancel}
        />
      );
      expect(screen.getByTestId('opt-cut-end')).toHaveAttribute(
        'data-help-id',
        boundaryCutEndHelpId()
      );
      expect(screen.getByTestId('opt-cut-cancel')).toHaveAttribute(
        'data-help-id',
        boundaryCutCancelHelpId()
      );
      fireEvent.click(screen.getByTestId('opt-cut-end'));
      fireEvent.click(screen.getByTestId('opt-cut-cancel'));
      expect(onCutEnd).toHaveBeenCalledTimes(1);
      expect(onCutCancel).toHaveBeenCalledTimes(1);
    });
  });
});
