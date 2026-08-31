import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewCellEditor from 'components/pdfTableViewer/ReviewCellEditor';
// Config is MOCKED with sentinels, and every expectation is derived by CALLING the
// mocked accessor rather than by naming a literal, so a change to a real constant
// can never fail a test here.
import {
  reviewCellEditRowCount,
  reviewCellEditorMinWidthPx,
} from 'config';

jest.mock('config', () => ({
  __esModule: true,
  reviewCellEditRowCount: jest.fn(() => 1),
  reviewCellEditorMinWidthPx: jest.fn(() => 137),
}));

const renderEditor = (props = {}) => {
  const onChange = jest.fn();
  render(<ReviewCellEditor value={'ABC Ltd'} onChange={onChange} {...props} />);
  return onChange;
};

const field = () => screen.getByTestId('review-cell-editor');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ReviewCellEditor', () => {
  it('shows the value it is given', () => {
    renderEditor();

    expect(field()).toHaveValue('ABC Ltd');
  });

  // It holds nothing of its own: the panel owns the text, because the dialog's tick is
  // what commits it. A field that kept its own copy would drift from the one saved.
  it('reports each keystroke and never changes on its own', async () => {
    const onChange = renderEditor({ value: 'AB' });

    await userEvent.type(field(), 'C');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ABC');
    expect(field()).toHaveValue('AB');
  });

  // The click that opened the dialog was a click on this cell, and typing is what comes
  // next — so the caret is already here.
  it('takes the focus as it appears', () => {
    renderEditor();

    expect(field()).toHaveFocus();
  });

  it('takes its floor width and its row count from config', () => {
    renderEditor();

    // MUI's `minRows` is honoured by TextareaAutosize's own measurement, which leaves
    // no `rows` attribute (and measures 0 in jsdom), so the strongest available check
    // is that the row count comes from config at all rather than from a literal.
    expect(reviewCellEditRowCount).toHaveBeenCalled();
    // The wrapper carries the width floor; the field itself fills it.
    expect(field().closest('.MuiFormControl-root')).toHaveStyle({
      minWidth: `${reviewCellEditorMinWidthPx()}px`,
    });
  });
});
