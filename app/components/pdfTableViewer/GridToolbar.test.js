import { render, screen, fireEvent } from '@testing-library/react';
import GridToolbar from 'components/pdfTableViewer/GridToolbar';

describe('GridToolbar', () => {
  it('renders the three captioned tools in order', () => {
    render(<GridToolbar onSelectTool={() => {}} />);
    expect(screen.getByTestId('grid-toolbar')).toBeInTheDocument();
    ['grid-tool-rows', 'grid-tool-columns', 'grid-tool-special'].forEach((id) =>
      expect(screen.getByTestId(id)).toBeInTheDocument()
    );
    expect(screen.getByText('Rows')).toBeInTheDocument();
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Special')).toBeInTheDocument();
  });

  it('draws an icon for each tool', () => {
    render(<GridToolbar onSelectTool={() => {}} />);
    expect(screen.getByTestId('grid-tool-rows-icon')).toBeInTheDocument();
    expect(screen.getByTestId('grid-tool-columns-icon')).toBeInTheDocument();
    expect(screen.getByTestId('grid-tool-special-icon')).toBeInTheDocument();
  });

  it('arms exactly the tool it is given', () => {
    render(<GridToolbar tool={'columns'} onSelectTool={() => {}} />);
    expect(screen.getByTestId('grid-tool-columns')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('grid-tool-rows')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('grid-tool-special')).toHaveAttribute('data-active', 'false');
  });

  it('arms none of them when no tool is given', () => {
    render(<GridToolbar onSelectTool={() => {}} />);
    ['grid-tool-rows', 'grid-tool-columns', 'grid-tool-special'].forEach((id) =>
      expect(screen.getByTestId(id)).toHaveAttribute('data-active', 'false')
    );
  });

  it('reports the key of the clicked tool', () => {
    const onSelectTool = jest.fn();
    render(<GridToolbar onSelectTool={onSelectTool} />);
    fireEvent.click(screen.getByTestId('grid-tool-special'));
    expect(onSelectTool).toHaveBeenCalledWith('special');
  });
});
