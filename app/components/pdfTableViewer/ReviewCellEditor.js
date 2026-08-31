'use client';

// The correction field of the extraction review screen, rendered INSIDE the grid cell
// (or the title) being corrected rather than in the dialog beside it. The value is
// typed where it is read, so the crop in the dialog and the text being compared against
// it are both in view at once and neither has to be remembered.
//
// It holds nothing: ReviewTablePanel owns the text, because the dialog's tick is what
// commits it and the panel owns both. Autofocused, since the click that opened the
// dialog was a click on this cell and typing is what comes next.

import { TextField } from '@mui/material';
import { reviewCellEditRowCount, reviewCellEditorMinWidthPx } from 'config';

export default function ReviewCellEditor({ value, onChange }) {
  return (
    <TextField
      multiline
      autoFocus
      minRows={reviewCellEditRowCount()}
      size={'small'}
      fullWidth
      value={value}
      onChange={(event) => onChange(event.target.value)}
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
