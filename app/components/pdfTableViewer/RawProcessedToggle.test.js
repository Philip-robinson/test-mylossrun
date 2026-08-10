import { render, screen, fireEvent } from '@testing-library/react';
import RawProcessedToggle from 'components/pdfTableViewer/RawProcessedToggle';

describe('RawProcessedToggle', () => {
  it('renders the label "Processed"', () => {
    render(<RawProcessedToggle value="RAW" onChange={() => {}} />);
    expect(screen.getByText('Processed')).toBeInTheDocument();
  });

  it('is checked for the processed style and clear for the raw one', () => {
    const { rerender } = render(
      <RawProcessedToggle value="RAW" onChange={() => {}} />
    );
    expect(screen.getByTestId('image-style-toggle')).not.toBeChecked();

    rerender(<RawProcessedToggle value="PROCESSED" onChange={() => {}} />);
    expect(screen.getByTestId('image-style-toggle')).toBeChecked();
  });

  it('calls onChange with PROCESSED when switched on and RAW when switched off', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <RawProcessedToggle value="RAW" onChange={onChange} />
    );
    fireEvent.click(screen.getByTestId('image-style-toggle'));
    expect(onChange).toHaveBeenCalledWith('PROCESSED');

    onChange.mockClear();
    rerender(<RawProcessedToggle value="PROCESSED" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('image-style-toggle'));
    expect(onChange).toHaveBeenCalledWith('RAW');
  });
});
