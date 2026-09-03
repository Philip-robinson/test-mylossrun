'use client';

// The correction field of the extraction review screen, rendered INSIDE the grid cell
// (or the title) being corrected rather than in the dialog beside it. The value is
// typed where it is read, so the crop in the dialog and the text being compared against
// it are both in view at once and neither has to be remembered.
//
// It holds nothing: ReviewTablePanel owns the text, because the dialog's tick is what
// commits it and the panel owns both. Autofocused, since the click that opened the
// dialog was a click on this cell and typing is what comes next.
//
// Tab settles the correction and moves to the next cell wanting attention, which is what
// the dialog's Next button does — so it is reported through `onTab` rather than done here,
// the panel being what knows where "next" is. A Tab held with a modifier is left to the
// browser, so shift-tabbing out of the field still moves the focus; and a panel that
// supplies no `onTab` is refusing the move — a cell with no source cannot take a
// correction — so Tab then goes back to being an ordinary Tab.

import { TextField } from '@mui/material';
import { reviewCellEditRowCount, reviewCellEditorMinWidthPx } from 'config';

export default function ReviewCellEditor({ value, onChange, onTab }) {
  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!onTab) return;
    // The field is about to be unmounted, and a textarea's own Tab moves the focus.
    event.preventDefault();
    onTab();
  };

  return (
    <TextField
      multiline
      autoFocus
      minRows={reviewCellEditRowCount()}
      size={'small'}
      fullWidth
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      inputProps={{ 'data-testid': 'review-cell-editor' }}
      sx={{
        // A column is sized to its content, so a narrow one would otherwise give a
        // field too small to type into.
        minWidth: reviewCellEditorMinWidthPx(),
        backgroundColor: 'background.paper',
        // The text is read in the grid's own font while it is being corrected, so what
        // is typed looks like what it replaces. Left resizeable because a cell can hold
        // far more text than one row shows.
        '& textarea': { resize: 'vertical', font: 'inherit' },
        '& .MuiOutlinedInput-root': { padding: '2px 6px' },
      }}
    />
  );
}
