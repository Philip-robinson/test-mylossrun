import { render, screen, fireEvent } from '@testing-library/react';
import ReviewTableTabs from 'components/pdfTableViewer/ReviewTableTabs';
import { reviewTabsHelpId } from 'config';

const tables = [{ name: 'North' }, { name: 'South' }, { name: 'East' }];

describe('ReviewTableTabs', () => {
  it('renders one tab per table, labelled and ordered by the tables', () => {
    render(<ReviewTableTabs tables={tables} activeIndex={0} onChange={() => {}} />);

    expect(screen.getAllByTestId('review-tab').map((tab) => tab.textContent)).toEqual([
      'North',
      'South',
      'East',
    ]);
  });

  it('reports the index of the tab that was chosen', () => {
    const onChange = jest.fn();
    render(<ReviewTableTabs tables={tables} activeIndex={0} onChange={onChange} />);

    fireEvent.click(screen.getAllByTestId('review-tab')[2]);

    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('marks the active index as the selected tab', () => {
    render(<ReviewTableTabs tables={tables} activeIndex={1} onChange={() => {}} />);

    const selected = screen.getAllByTestId('review-tab').map((tab) => tab.getAttribute('aria-selected'));
    expect(selected).toEqual(['false', 'true', 'false']);
  });

  // The overlay measures its tip's hole from this attribute and the copy module keys the
  // same tip by the same function, so the id is a literal on neither side.
  it('carries the tabs help id on the strip', () => {
    render(<ReviewTableTabs tables={tables} activeIndex={0} onChange={() => {}} />);

    expect(
      screen.getByTestId('review-tabs').closest(`[data-help-id="${reviewTabsHelpId()}"]`)
    ).toBeInTheDocument();
  });

  it('draws nothing for a single table, which needs no strip', () => {
    render(<ReviewTableTabs tables={[{ name: 'North' }]} activeIndex={0} onChange={() => {}} />);

    expect(screen.queryByTestId('review-tabs')).not.toBeInTheDocument();
  });

  it('draws nothing for no tables at all', () => {
    render(<ReviewTableTabs tables={[]} activeIndex={0} onChange={() => {}} />);

    expect(screen.queryByTestId('review-tabs')).not.toBeInTheDocument();
  });
});
