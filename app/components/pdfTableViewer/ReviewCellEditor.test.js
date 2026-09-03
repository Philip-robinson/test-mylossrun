import { fireEvent, render, screen } from '@testing-library/react';
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

  // Tab settles the correction and moves on, which is what the dialog's Next button does;
  // the panel owns both, so the field only reports the keystroke.
  describe('Tab', () => {
    it('reports a bare Tab and keeps the browser from moving the focus', async () => {
      const onTab = jest.fn();
      renderEditor({ onTab });

      const prevented = !fireEvent.keyDown(field(), {
        key: 'Tab',
        code: 'Tab',
      });

      expect(onTab).toHaveBeenCalledTimes(1);
      expect(prevented).toBe(true);
    });

    // Shift-tabbing out of the field must still move the focus.
    it('leaves a modified Tab to the browser', () => {
      const onTab = jest.fn();
      renderEditor({ onTab });

      ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'].forEach((modifier) => {
        const prevented = !fireEvent.keyDown(field(), {
          key: 'Tab',
          code: 'Tab',
          [modifier]: true,
        });
        expect(prevented).toBe(false);
      });

      expect(onTab).not.toHaveBeenCalled();
    });

    // No onTab means the panel is refusing the move — a cell with no source cannot take a
    // correction — so the keystroke goes back to being an ordinary Tab.
    it('leaves Tab to the browser when the panel supplies no handler', () => {
      renderEditor();

      const prevented = !fireEvent.keyDown(field(), {
        key: 'Tab',
        code: 'Tab',
      });

      expect(prevented).toBe(false);
    });

    it('ignores a key that is not Tab', () => {
      const onTab = jest.fn();
      renderEditor({ onTab });

      fireEvent.keyDown(field(), { key: 'Enter', code: 'Enter' });

      expect(onTab).not.toHaveBeenCalled();
    });
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
