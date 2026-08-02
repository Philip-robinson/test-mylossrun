'use client';

// OptionsButtonRow: a row of Options buttons that share the block's width equally.
// The panel is narrow, so each child is allowed to shrink below its natural width
// and its side padding is trimmed — three short labels still fit on one line.

import { Stack } from '@mui/material';
import { optionsRowSpacing } from 'config';

export default function OptionsButtonRow({ children }) {
  return (
    <Stack
      direction={'row'}
      spacing={optionsRowSpacing()}
      sx={{ '& > *': { flex: 1, minWidth: 0, px: 0.5 } }}
    >
      {children}
    </Stack>
  );
}
