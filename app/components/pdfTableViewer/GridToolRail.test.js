import { render, screen, fireEvent } from '@testing-library/react';
import GridToolRail from 'components/pdfTableViewer/GridToolRail';
import { gridToolRailHelpId } from 'config';

describe('GridToolRail', () => {
  it('renders the tool-bar whatever the armed tool is', () => {
    const { rerender } = render(<GridToolRail onSelectTool={() => {}} />);
    expect(screen.getByTestId('grid-tool-rail')).toBeInTheDocument();
    expect(screen.getByTestId('grid-toolbar')).toBeInTheDocument();

    rerender(<GridToolRail tool={'rows'} onSelectTool={() => {}} />);
    expect(screen.getByTestId('grid-toolbar')).toBeInTheDocument();
  });

  it('shows the sub-menu only while the Special tool is armed', () => {
    const { rerender } = render(<GridToolRail onSelectTool={() => {}} />);
    expect(screen.queryByTestId('special-tool-menu')).not.toBeInTheDocument();

    rerender(<GridToolRail tool={'rows'} onSelectTool={() => {}} />);
    expect(screen.queryByTestId('special-tool-menu')).not.toBeInTheDocument();

    rerender(<GridToolRail tool={'special'} onSelectTool={() => {}} />);
    expect(screen.getByTestId('special-tool-menu')).toBeInTheDocument();
  });

  it('holds the sub-menu inside the rail rather than beside the tool-bar', () => {
    render(<GridToolRail tool={'special'} onSelectTool={() => {}} />);
    const rail = screen.getByTestId('grid-tool-rail');
    const toolbar = screen.getByTestId('grid-toolbar');
    const menu = screen.getByTestId('special-tool-menu');
    expect(rail).toContainElement(toolbar);
    expect(rail).toContainElement(menu);
    expect(toolbar).not.toContainElement(menu);
  });

  it('reports a tool-bar click through onSelectTool', () => {
    const onSelectTool = jest.fn();
    render(<GridToolRail onSelectTool={onSelectTool} />);
    fireEvent.click(screen.getByTestId('grid-tool-special'));
    expect(onSelectTool).toHaveBeenCalledWith('special');
  });

  it('reports a sub-menu click through onSelectSpecialTool', () => {
    const onSelectSpecialTool = jest.fn();
    render(
      <GridToolRail
        tool={'special'}
        onSelectTool={() => {}}
        onSelectSpecialTool={onSelectSpecialTool}
      />
    );
    fireEvent.click(screen.getByTestId('special-tool-header'));
    expect(onSelectSpecialTool).toHaveBeenCalledWith('header');
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the rail help id', () => {
    render(<GridToolRail onSelectTool={() => {}} />);

    expect(screen.getByTestId('grid-tool-rail')).toHaveAttribute(
      'data-help-id',
      gridToolRailHelpId()
    );
  });
});
