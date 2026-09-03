'use client';

// A controlled presentational toggle for dimming the underlying PDF document
// image in the staged grid editor. Rendered as an on/off switch with a
// "Dim Document" label. Purely presentational: the `on` state is owned by the
// parent, which is notified of requested changes via `onChange`.

import { FormControlLabel, Switch } from '@mui/material';
import { editorDimDocumentHelpId } from 'config';

export default function DimDocumentToggle({ on, onChange }) {
  return (
    // The help id goes on the label rather than the input, so the overlay's hole covers
    // the switch and the words beside it, which is the control as the reader sees it.
    <FormControlLabel
      data-help-id={editorDimDocumentHelpId()}
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
