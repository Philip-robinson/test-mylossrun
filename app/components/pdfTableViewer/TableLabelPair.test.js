import { render, screen } from '@testing-library/react';
import TableLabelPair from 'components/pdfTableViewer/TableLabelPair';

const TABLE = { tableId: 't1', name: 'Table 1', columnWidths: [], rowHeights: [] };

// jsdom lays nothing out, so each label's size is set from its test id.
function stubLabelSizes(sizes) {
  const width = jest
    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockImplementation(function () {
      return sizes[this.dataset.testid]?.width ?? 0;
    });
  const height = jest
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function () {
      return sizes[this.dataset.testid]?.height ?? 0;
    });
  return () => {
    width.mockRestore();
    height.mockRestore();
  };
}

function renderPair(left, right) {
  render(
    <TableLabelPair
      left={left}
      right={right}
      top={50}
      name={{ table: TABLE, colour: 'grey', colourName: 'grey' }}
      link={{
        table: TABLE,
        colour: 'grey',
        colourName: 'grey',
        state: 'link',
        text: 'Link',
        onClick: () => {},
      }}
    />
  );
}

describe('TableLabelPair', () => {
  let restore;
  beforeEach(() => {
    restore = stubLabelSizes({
      'selected-label': { width: 120, height: 16 },
      'link-label': { width: 40, height: 16 },
    });
  });
  afterEach(() => restore());

  test('a wide table keeps both labels side by side at the table top', () => {
    renderPair(100, 400);
    expect(screen.getByTestId('selected-label').style.top).toBe('50px');
    expect(screen.getByTestId('link-label').style.top).toBe('50px');
  });

  test('a narrow table lifts the Link label above the name label', () => {
    renderPair(100, 200);
    expect(screen.getByTestId('selected-label').style.top).toBe('50px');
    expect(screen.getByTestId('link-label').style.top).toBe('34px');
    expect(screen.getByTestId('selected-label').style.left).toBe('100px');
    expect(screen.getByTestId('link-label').style.left).toBe('200px');
  });
});
