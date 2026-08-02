'use client';

// OptionsGroup: one titled group of controls within an Options block. The small
// heading names the job the group does ("Title management", "Merged cell
// management", …) so the buttons under it can carry short labels and sit side by
// side rather than one full-width button per line.

import { Stack, Typography } from '@mui/material';
import { optionsGroupSpacing, optionsGroupTitleVariant } from 'config';

export default function OptionsGroup({ testId, title, children }) {
  return (
    <Stack data-testid={testId} spacing={optionsGroupSpacing()}>
      <Typography
        variant={optionsGroupTitleVariant()}
        color={'text.secondary'}
        sx={{ lineHeight: 1.2 }}
      >
        {title}
      </Typography>
      {children}
    </Stack>
  );
}
