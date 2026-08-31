import { render, screen, fireEvent } from '@testing-library/react';
import SpecialToolMenu from 'components/pdfTableViewer/SpecialToolMenu';

const KEYS = [
  'header',
  'title',
  'hideRow',
  'sectionTitle',
  'colouredRows',
  'colouredColumns',
  'colouredTable',
  'colouredCell',
  'colouredArea',
];

describe('SpecialToolMenu', () => {
  it('lists its nine entries in order with their labels', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const rendered = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'));
    expect(rendered).toEqual(KEYS.map((k) => `special-tool-${k}`));
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('heads the colouring entries with a caption that is not a button', () => {
    render(<SpecialToolMenu onSelectSpecialTool={() => {}} />);
    const heading = screen.getByTestId('special-tool-heading-colouring');
    expect(heading).toHaveTextContent('Colouring');
    expect(screen.getAllByRole('button')).not.toContain(heading);
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
});
