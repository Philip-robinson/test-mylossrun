import { render, screen, fireEvent } from '@testing-library/react';
import EditorScaleSelector from 'components/pdfTableViewer/EditorScaleSelector';
import { editorScaleHelpId } from 'config';

describe('EditorScaleSelector', () => {
  it('renders the current percent', () => {
    render(<EditorScaleSelector percent={100} onChange={() => {}} />);
    expect(screen.getByTestId('scale-value').textContent).toBe('100%');
  });

  it('calls onChange with the next option when ZoomIn is clicked', () => {
    const onChange = jest.fn();
    render(<EditorScaleSelector percent={100} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scale-zoom-in'));
    expect(onChange).toHaveBeenCalledWith(150);
  });

  it('calls onChange with the previous option when ZoomOut is clicked', () => {
    const onChange = jest.fn();
    render(<EditorScaleSelector percent={100} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scale-zoom-out'));
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('disables ZoomOut at the lowest option (50%)', () => {
    render(<EditorScaleSelector percent={50} onChange={() => {}} />);
    expect(screen.getByTestId('scale-zoom-out')).toBeDisabled();
    expect(screen.getByTestId('scale-zoom-in')).not.toBeDisabled();
  });

  it('disables ZoomIn at the highest option (200%)', () => {
    render(<EditorScaleSelector percent={200} onChange={() => {}} />);
    expect(screen.getByTestId('scale-zoom-in')).toBeDisabled();
    expect(screen.getByTestId('scale-zoom-out')).not.toBeDisabled();
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the scale help id on the whole control, not one of its buttons', () => {
    const { container } = render(<EditorScaleSelector percent={100} onChange={() => {}} />);
    const annotated = container.querySelector(`[data-help-id="${editorScaleHelpId()}"]`);

    expect(annotated).toContainElement(screen.getByTestId('scale-zoom-out'));
    expect(annotated).toContainElement(screen.getByTestId('scale-zoom-in'));
  });
});
