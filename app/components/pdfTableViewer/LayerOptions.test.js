import { render, screen, fireEvent } from '@testing-library/react';
import LayerOptions from 'components/pdfTableViewer/LayerOptions';

// Every testid the block can ever render, so a test can assert that only the expected
// ones are present.
const ALL_TESTIDS = [
  'opt-delete-table',
  'opt-create-table',
  'opt-confirm-created',
  'opt-cancel-created',
  'opt-delete-header',
  'colour-selectors',
  'opt-colour-submit',
  'opt-colour-delete',
];

const shown = () => ALL_TESTIDS.filter((id) => screen.queryByTestId(id) !== null);

describe('LayerOptions', () => {
  describe('borderMode', () => {
    it('offers the table-boundary actions', () => {
      render(<LayerOptions editorMode={'border'} hasSelectedTable />);
      expect(shown()).toEqual(['opt-delete-table', 'opt-create-table']);
      expect(screen.getByTestId('opt-expected-columns')).toBeInTheDocument();
      expect(screen.getByTestId('opt-expected-rows')).toBeInTheDocument();
    });

    it('omits the expected counts when no table is selected', () => {
      render(<LayerOptions editorMode={'border'} hasSelectedTable={false} />);
      expect(screen.queryByTestId('opt-expected-columns')).toBeNull();
    });

    it('adds Calculate and Cancel while a created table is unconfirmed', () => {
      render(<LayerOptions editorMode={'border'} isCreatedUnconfirmed />);
      expect(shown()).toEqual([
        'opt-delete-table',
        'opt-create-table',
        'opt-confirm-created',
        'opt-cancel-created',
      ]);
    });

    it('forwards each button to its callback', () => {
      const cbs = {
        onDeleteTable: jest.fn(),
        onCreateTable: jest.fn(),
        onConfirmCreated: jest.fn(),
        onCancelCreated: jest.fn(),
      };
      render(<LayerOptions editorMode={'border'} isCreatedUnconfirmed {...cbs} />);
      fireEvent.click(screen.getByTestId('opt-delete-table'));
      fireEvent.click(screen.getByTestId('opt-create-table'));
      fireEvent.click(screen.getByTestId('opt-confirm-created'));
      fireEvent.click(screen.getByTestId('opt-cancel-created'));
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
});
