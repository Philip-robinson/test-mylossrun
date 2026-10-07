import { render } from '@testing-library/react';
import ReviewCellText from 'components/pdfTableViewer/ReviewCellText';

describe('ReviewCellText', () => {
  it('renders a <br> between each line, in order', () => {
    const { container } = render(
      <div>
        <ReviewCellText text={'a\r\nb\nc'} />
      </div>
    );
    const cell = container.firstChild;

    expect(cell.querySelectorAll('br')).toHaveLength(2);
    expect(Array.from(cell.childNodes).map((node) => node.nodeName)).toEqual([
      '#text',
      'BR',
      '#text',
      'BR',
      '#text',
    ]);
    expect(
      Array.from(cell.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
    ).toEqual(['a', 'b', 'c']);
  });

  it('renders text without a break as plain text', () => {
    const { container } = render(
      <div>
        <ReviewCellText text={'plain'} />
      </div>
    );
    const cell = container.firstChild;

    expect(cell.querySelector('br')).toBeNull();
    expect(cell.childNodes).toHaveLength(1);
    expect(cell.textContent).toBe('plain');
  });
});
