'use client';

// A controlled presentational toggle for which rendering of the page the staged grid
// editor shows. On is Processed (the page's coloured areas flattened to black on white,
// the page the extraction reads); off is Raw (the page as the PDF draws it). Purely
// presentational: the `value` is owned by the parent, which is notified of requested
// changes via `onChange` as the imageStyle the backend takes.

import { FormControlLabel, Switch } from '@mui/material';
import { processedImageStyle, rawImageStyle } from 'config';

export default function RawProcessedToggle({ value, onChange }) {
  const processed = processedImageStyle();

  return (
    <FormControlLabel
      label="Processed"
      control={
        <Switch
          size="small"
          checked={value === processed}
          onChange={(e) =>
            onChange(e.target.checked ? processed : rawImageStyle())
          }
          inputProps={{
            'data-testid': 'image-style-toggle',
            'aria-label': 'Processed',
          }}
        />
      }
    />
  );
}
