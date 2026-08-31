import { render, screen, fireEvent } from '@testing-library/react';
import ReviewTableTabs from 'components/pdfTableViewer/ReviewTableTabs';

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

  it('draws nothing for a single table, which needs no strip', () => {
    render(<ReviewTableTabs tables={[{ name: 'North' }]} activeIndex={0} onChange={() => {}} />);

    expect(screen.queryByTestId('review-tabs')).not.toBeInTheDocument();
  });

  it('draws nothing for no tables at all', () => {
    render(<ReviewTableTabs tables={[]} activeIndex={0} onChange={() => {}} />);

    expect(screen.queryByTestId('review-tabs')).not.toBeInTheDocument();
  });
});
