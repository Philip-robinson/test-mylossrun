'use client';

// A controlled presentational toggle for dimming the underlying PDF document
// image in the staged grid editor. Rendered as an on/off switch with a
// "Dim Document" label. Purely presentational: the `on` state is owned by the
// parent, which is notified of requested changes via `onChange`.

import { FormControlLabel, Switch } from '@mui/material';

export default function DimDocumentToggle({ on, onChange }) {
  return (
    <FormControlLabel
      label="Dim Document"
      control={
        <Switch
          size="small"
          checked={!!on}
          onChange={(e) => onChange(e.target.checked)}
          inputProps={{
            'data-testid': 'dim-document-toggle',
            'aria-label': 'Dim Document',
          }}
        />
      }
    />
  );
}
