import { render, screen, fireEvent } from '@testing-library/react';
import SpecialToolMenu from 'components/pdfTableViewer/SpecialToolMenu';
import {
  specialToolColouredAreaHelpId,
  specialToolColouredCellHelpId,
  specialToolColouredColumnsHelpId,
  specialToolColouredRowsHelpId,
  specialToolColouredTableHelpId,
  specialToolHeaderHelpId,
  specialToolHideRowHelpId,
  specialToolJoinedEndRowHelpId,
  specialToolMergedHelpId,
  specialToolSectionHelpId,
  specialToolTitleHelpId,
} from 'config';

const KEYS = [
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

describe('SpecialToolMenu', () => {
  it('lists its eleven entries in order with their labels', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const rendered = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'));
    expect(rendered).toEqual(KEYS.map((k) => `special-tool-${k}`));
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Merged')).toBeInTheDocument();
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('heads the colouring entries with a caption that is not a button', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const heading = screen.getByTestId('special-tool-heading-colouring');
    expect(heading).toHaveTextContent('Colouring');
    expect(screen.getAllByRole('button')).not.toContain(heading);
  });

  it('places Joined end row after Merged and before the Colouring heading', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const merged = screen.getByTestId('special-tool-merged');
    const joined = screen.getByTestId('special-tool-joinedEndRow');
    const heading = screen.getByTestId('special-tool-heading-colouring');
    expect(joined).toHaveTextContent('Joined end row');
    expect(merged.nextElementSibling).toBe(joined);
    expect(joined.nextElementSibling).toBe(heading);
  });

  it('shows Joined end row active from the table flag', () => {
    const { rerender } = render(
      <SpecialToolMenu splitBottomRow={true} onSelectSpecialTool={() => {}} />
    );
    expect(screen.getByTestId('special-tool-joinedEndRow')).toHaveAttribute(
      'data-active',
      'true'
    );
    rerender(
      <SpecialToolMenu splitBottomRow={false} onSelectSpecialTool={() => {}} />
    );
    expect(screen.getByTestId('special-tool-joinedEndRow')).toHaveAttribute(
      'data-active',
      'false'
    );
  });

  it('disables Joined end row when there is no table flag', () => {
    const { rerender } = render(
      <SpecialToolMenu onSelectSpecialTool={() => {}} />
    );
    expect(screen.getByTestId('special-tool-joinedEndRow')).toBeDisabled();
    rerender(
      <SpecialToolMenu splitBottomRow={null} onSelectSpecialTool={() => {}} />
    );
    expect(screen.getByTestId('special-tool-joinedEndRow')).toBeDisabled();
  });

  it('toggles the flag on a Joined end row click without selecting a tool', () => {
    const onSelectSpecialTool = jest.fn();
    const onToggleSplitBottomRow = jest.fn();
    render(
      <SpecialToolMenu
        splitBottomRow={false}
        onSelectSpecialTool={onSelectSpecialTool}
        onToggleSplitBottomRow={onToggleSplitBottomRow}
      />
    );
    fireEvent.click(screen.getByTestId('special-tool-joinedEndRow'));
    expect(onToggleSplitBottomRow).toHaveBeenCalledTimes(1);
    expect(onSelectSpecialTool).not.toHaveBeenCalled();
  });

  it('arms exactly the entry it is given', () => {
    render(<SpecialToolMenu specialTool={'hideRow'} onSelectSpecialTool={() => {}} />);
    expect(screen.getByTestId('special-tool-hideRow')).toHaveAttribute(
      'data-active',
      'true'
    );
    KEYS.filter((k) => k !== 'hideRow').forEach((k) =>
      expect(screen.getByTestId(`special-tool-${k}`)).toHaveAttribute(
        'data-active',
        'false'
      )
    );
  });

  it('reports the key of the clicked entry', () => {
    const onSelectSpecialTool = jest.fn();
    render(<SpecialToolMenu onSelectSpecialTool={onSelectSpecialTool} />);
    fireEvent.click(screen.getByTestId('special-tool-colouredTable'));
    expect(onSelectSpecialTool).toHaveBeenCalledWith('colouredTable');
    fireEvent.click(screen.getByTestId('special-tool-colouredCell'));
    expect(onSelectSpecialTool).toHaveBeenCalledWith('colouredCell');
  });

  it('places Title between Header and Hide Row', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const order = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'));
    expect(order.slice(0, 3)).toEqual([
      'special-tool-header',
      'special-tool-title',
      'special-tool-hideRow',
    ]);
  });

  it('reports the Title key and disarms it when it is already armed', () => {
    const onSelectSpecialTool = jest.fn();
    render(
      <SpecialToolMenu
        specialTool={'title'}
        onSelectSpecialTool={onSelectSpecialTool}
      />
    );
    expect(screen.getByTestId('special-tool-title')).toHaveAttribute(
      'data-active',
      'true'
    );
    fireEvent.click(screen.getByTestId('special-tool-title'));
    expect(onSelectSpecialTool).toHaveBeenCalledWith('title');
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('gives every entry its own help id', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);

    const expected = {
      header: specialToolHeaderHelpId(),
      title: specialToolTitleHelpId(),
      hideRow: specialToolHideRowHelpId(),
      sectionTitle: specialToolSectionHelpId(),
      merged: specialToolMergedHelpId(),
      joinedEndRow: specialToolJoinedEndRowHelpId(),
      colouredRows: specialToolColouredRowsHelpId(),
      colouredColumns: specialToolColouredColumnsHelpId(),
      colouredTable: specialToolColouredTableHelpId(),
      colouredCell: specialToolColouredCellHelpId(),
      colouredArea: specialToolColouredAreaHelpId(),
    };

    KEYS.forEach((key) =>
      expect(screen.getByTestId(`special-tool-${key}`)).toHaveAttribute(
        'data-help-id',
        expected[key]
      )
    );
  });

  it('gives no two entries the same help id', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);

    const ids = KEYS.map((key) =>
      screen.getByTestId(`special-tool-${key}`).getAttribute('data-help-id')
    );

    expect(new Set(ids).size).toBe(KEYS.length);
  });
});
