import { render, screen, fireEvent } from '@testing-library/react';
import GridToolButton from 'components/pdfTableViewer/GridToolButton';

describe('GridToolButton', () => {
  it('renders its icon and its aria label', () => {
    render(
      <GridToolButton testId={'b'} ariaLabel={'Rows'} onClick={() => {}}>
        <span data-testid={'icon'} />
      </GridToolButton>
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows')).toBeInTheDocument();
  });

  it('states whether it is armed', () => {
    render(
      <GridToolButton testId={'b'} active activeBackgroundColour={'rgb(1, 2, 3)'} onClick={() => {}} />
    );
    expect(screen.getByTestId('b')).toHaveAttribute('data-active', 'true');
  });

  it('is not armed by default', () => {
    render(<GridToolButton testId={'b'} onClick={() => {}} />);
    expect(screen.getByTestId('b')).toHaveAttribute('data-active', 'false');
  });

  it('reports its click', () => {
    const onClick = jest.fn();
    render(<GridToolButton testId={'b'} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('b'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
