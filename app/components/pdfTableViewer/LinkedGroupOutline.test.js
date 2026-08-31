import { render, screen } from '@testing-library/react';
import LinkedGroupOutline from 'components/pdfTableViewer/LinkedGroupOutline';

describe('LinkedGroupOutline', () => {
  const renderOutline = (props = {}) =>
    render(
      <LinkedGroupOutline
        left={'10%'}
        top={'20%'}
        width={'40%'}
        height={'30%'}
        {...props}
      />
    );

  it('sits on the rectangle it is given', () => {
    renderOutline();
    const ring = screen.getByTestId('linked-group-outline');
    expect(ring.style.left).toBe('10%');
    expect(ring.style.top).toBe('20%');
    expect(ring.style.width).toBe('40%');
    expect(ring.style.height).toBe('30%');
  });

  // The ring's colour is a var(--…) value jsdom drops, so membership is asserted through
  // the data attribute rather than the style.
  it('states that its table is in a linked group', () => {
    renderOutline();
    expect(screen.getByTestId('linked-group-outline')).toHaveAttribute(
      'data-linked',
      'true'
    );
  });

  it('takes no pointer events', () => {
    renderOutline();
    expect(screen.getByTestId('linked-group-outline').style.pointerEvents).toBe(
      'none'
    );
  });
});
