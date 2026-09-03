'use client';

// The flag beside the toolbar's `?` when a screen's hints have changed since the user
// last saw them.
//
// It is a button rather than a label: a message the user cannot act on is worse than
// none, so the pill is a second way into the same help the `?` opens.

import { Box } from '@mui/material';
import { helpBadgeBackgroundColour, helpBadgeTextColour } from 'config';
import { helpNewBadgeLabel } from 'app/lib/helpContent';

export default function HelpNewBadge({ onClick }) {
  return (
    <Box
      component={'button'}
      type={'button'}
      onClick={onClick}
      data-testid={'help-new-badge'}
      sx={{
        border: 'none',
        cursor: 'pointer',
        px: 1,
        py: 0.25,
        borderRadius: '999px',
        fontSize: '0.7rem',
        lineHeight: 1.4,
        backgroundColor: helpBadgeBackgroundColour(),
        color: helpBadgeTextColour(),
      }}
    >
      {helpNewBadgeLabel()}
    </Box>
  );
}
