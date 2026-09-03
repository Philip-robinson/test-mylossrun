'use client';

// The way into help, and the flag that there is something new in it.
//
// It offers nothing until a screen has registered, so the toolbar above the access
// gate carries no `?` at all: help that can say nothing about where the user is would
// only open onto an empty card.
//
// The button carries `data-help-id` because the entry card's hole is measured from it
// — the `?` is the one element help always describes — so the attribute is required
// rather than decorative.

import { Box } from '@mui/material';
import { helpButtonHelpId } from 'config';
import { useHelp } from 'components/help/HelpProvider';
import HelpNewBadge from 'components/help/HelpNewBadge';

export default function HelpButton() {
  const help = useHelp();

  if (!help || !help.screenId) {
    return null;
  }

  const { showNewBadge, openHelp } = help;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        component={'button'}
        type={'button'}
        onClick={openHelp}
        aria-label={'Help'}
        data-help-id={helpButtonHelpId()}
        data-testid={'help-button'}
        sx={{
          border: '1px solid',
          borderColor: 'currentColor',
          borderRadius: '999px',
          background: 'none',
          color: 'var(--secondary-text)',
          cursor: 'pointer',
          width: '20px',
          height: '20px',
          p: 0,
          fontSize: '0.75rem',
          lineHeight: 1,
        }}
      >
        {'?'}
      </Box>
      {showNewBadge && <HelpNewBadge onClick={openHelp} />}
    </Box>
  );
}
