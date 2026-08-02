import { render, screen, fireEvent } from '@testing-library/react';
import DimDocumentToggle from 'components/pdfTableViewer/DimDocumentToggle';

describe('DimDocumentToggle', () => {
  it('renders the label "Dim Document"', () => {
    render(<DimDocumentToggle on={false} onChange={() => {}} />);
    expect(screen.getByText('Dim Document')).toBeInTheDocument();
  });

  it('reflects the `on` prop via the switch checked state', () => {
    const { rerender } = render(
      <DimDocumentToggle on={false} onChange={() => {}} />
    );
    expect(screen.getByTestId('dim-document-toggle')).not.toBeChecked();

    rerender(<DimDocumentToggle on onChange={() => {}} />);
    expect(screen.getByTestId('dim-document-toggle')).toBeChecked();
  });

  it('calls onChange with the negated value when toggled', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <DimDocumentToggle on={false} onChange={onChange} />
    );
    fireEvent.click(screen.getByTestId('dim-document-toggle'));
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    rerender(<DimDocumentToggle on onChange={onChange} />);
    fireEvent.click(screen.getByTestId('dim-document-toggle'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
