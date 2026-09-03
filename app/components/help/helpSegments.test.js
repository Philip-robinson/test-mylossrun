import { render, screen } from '@testing-library/react';
import { helpSegmentNodes } from 'components/help/helpSegments';

function renderSegments(segments) {
  render(<div data-testid={'segments'}>{helpSegmentNodes(segments)}</div>);

  return screen.getByTestId('segments');
}

describe('helpSegmentNodes', () => {
  it('reads a run of segments as one piece of text, in order', () => {
    const segments = ['Click a row', { bold: ' to open it.' }, ' A long name is shortened.'];

    expect(renderSegments(segments).textContent).toBe(
      'Click a row to open it. A long name is shortened.',
    );
  });

  it('renders a bold segment as a strong element holding only that text', () => {
    const segments = ['plain ', { bold: 'emphasised' }, ' plain'];

    expect(
      Array.from(renderSegments(segments).querySelectorAll('strong')).map(
        (element) => element.textContent,
      ),
    ).toEqual(['emphasised']);
  });

  it('leaves a plain string unemphasised', () => {
    expect(renderSegments(['just words']).querySelectorAll('strong')).toHaveLength(0);
  });

  it('renders nothing for an empty segment array', () => {
    expect(renderSegments([]).textContent).toBe('');
  });

  it('renders nothing when there are no segments at all', () => {
    expect(renderSegments(undefined).textContent).toBe('');
  });

  it('drops a segment it does not recognise', () => {
    const segments = ['kept ', { italic: 'unknown' }, null, 'kept'];

    expect(renderSegments(segments).textContent).toBe('kept kept');
  });

  it('renders a list segment as one li per item, in order', () => {
    const segments = [
      'When in row edit mode:',
      { list: ['Creates a line.', 'Deletes a line.'] },
    ];

    expect(
      Array.from(renderSegments(segments).querySelectorAll('li')).map(
        (element) => element.textContent,
      ),
    ).toEqual(['Creates a line.', 'Deletes a line.']);
  });

  it('reads a list item that is a segment array, bold included', () => {
    const segments = [{ list: [['A ', { bold: 'Delete Header' }, ' button appears.']] }];
    const rendered = renderSegments(segments);

    expect(rendered.querySelector('li').textContent).toBe(
      'A Delete Header button appears.',
    );
    expect(rendered.querySelector('li strong').textContent).toBe('Delete Header');
  });

  it('nests a list held inside a list item', () => {
    const segments = [
      { list: [['A row can be selected, then:', { list: ['Pick its colours.'] }]] },
    ];
    const rendered = renderSegments(segments);

    expect(rendered.querySelectorAll('ul')).toHaveLength(2);
    expect(rendered.querySelector('li ul li').textContent).toBe('Pick its colours.');
  });

  it('drops a list item of a shape it does not recognise', () => {
    const segments = [{ list: ['kept', { italic: 'unknown' }, 'kept too'] }];

    expect(
      Array.from(renderSegments(segments).querySelectorAll('li')).map(
        (element) => element.textContent,
      ),
    ).toEqual(['kept', '', 'kept too']);
  });
});
