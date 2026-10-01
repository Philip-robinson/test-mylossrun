import { render, screen } from '@testing-library/react';
import SplitRowWave from 'components/pdfTableViewer/SplitRowWave';

describe('SplitRowWave', () => {
  it('renders one wave whose rect is filled by its own pattern', () => {
    render(<SplitRowWave />);

    const waves = screen.getAllByTestId('review-split-row-wave');
    expect(waves).toHaveLength(1);
    const pattern = waves[0].querySelector('pattern');
    expect(pattern).not.toBeNull();
    expect(pattern.getAttribute('id')).toBeTruthy();
    expect(pattern.querySelector('path')).not.toBeNull();
    const rect = waves[0].querySelector(':scope > rect');
    expect(rect.getAttribute('fill')).toBe(`url(#${pattern.getAttribute('id')})`);
  });

  it('gives each instance a different pattern id', () => {
    render(
      <>
        <SplitRowWave />
        <SplitRowWave />
      </>
    );

    const ids = screen
      .getAllByTestId('review-split-row-wave')
      .map((wave) => wave.querySelector('pattern').getAttribute('id'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
