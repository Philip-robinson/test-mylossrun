'use client';

// One button of the grid tool-bar: a square icon that is armed or not. Controlled and
// stateless — the parent decides what arming means, this only reports the click.
//
// The armed background is a var(--…) colour, which jsdom drops from an inline style, so
// the armed state is also carried as a data attribute.

import { Box } from '@mui/material';
import { gridToolIconSizePx } from 'config';

export default function GridToolButton({
  testId,
  helpId,
  ariaLabel,
  active = false,
  activeBackgroundColour,
  onClick,
  children,
}) {
  const size = gridToolIconSizePx();
  return (
    <Box
      component={'button'}
      type={'button'}
      data-testid={testId}
      data-help-id={helpId}
      data-active={active ? 'true' : 'false'}
      aria-label={ariaLabel}
      onClick={onClick}
      sx={{
        width: size + 8,
        height: size + 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 0,
        border: '1px solid transparent',
        borderRadius: 1,
        cursor: 'pointer',
        backgroundColor: active ? activeBackgroundColour : 'transparent',
      }}
    >
      {children}
    </Box>
  );
}
