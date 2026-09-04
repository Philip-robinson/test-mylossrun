'use client';

// A small circular icon button — a filled disc of the caller's colour with a white
// glyph in it. Shared so that the cell-edit dialog's reject and accept buttons are
// one component used twice rather than two near-identical files.
//
// It takes no `config` import on purpose: the colour arrives as a prop, which keeps
// this component free of configuration and lets each caller pick its own colour from
// config at the point of use.

import { IconButton } from '@mui/material';

export default function RoundIconButton({
  colour,
  icon,
  testId,
  onClick,
  disabled,
}) {
  return (
    <IconButton
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      // The hover rule repeats `backgroundColor` because MUI's default hover would
      // otherwise wash the disc over with its own translucent overlay and lose the
      // caller's colour. A disabled button is left to MUI's default disabled opacity
      // rather than a bespoke rule of ours.
      sx={{
        borderRadius: '50%',
        backgroundColor: colour,
        color: 'common.white',
        '&:hover': { backgroundColor: colour },
      }}
    >
      {icon}
    </IconButton>
  );
}
