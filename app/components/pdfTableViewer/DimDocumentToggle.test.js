import { render, screen, fireEvent } from '@testing-library/react';
import DimDocumentToggle from 'components/pdfTableViewer/DimDocumentToggle';
import { editorDimDocumentHelpId } from 'config';

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

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the dim-document help id on the switch and its label together', () => {
    const { container } = render(<DimDocumentToggle on={false} onChange={() => {}} />);
    const annotated = container.querySelector(
      `[data-help-id="${editorDimDocumentHelpId()}"]`
    );

    expect(annotated).toBeInTheDocument();
    expect(annotated).toContainElement(screen.getByTestId('dim-document-toggle'));
  });
});
