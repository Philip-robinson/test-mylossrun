'use client';

// A text-labelled tool button of the grid tool-bar. Controlled and stateless. The armed
// background is a var(--…) colour, which jsdom drops from an inline style, so the armed
// state is also carried as a data attribute.

import { Button } from '@mui/material';

export default function TextToolButton({
  testId,
  helpId,
  label,
  active = false,
  activeBackgroundColour,
  disabled = false,
  onClick,
}) {
  return (
    <Button
      data-testid={testId}
      data-help-id={helpId}
      data-active={active ? 'true' : 'false'}
      size={'small'}
      variant={'outlined'}
      disabled={disabled}
      onClick={onClick}
      sx={{
        justifyContent: 'flex-start',
        whiteSpace: 'nowrap',
        backgroundColor: active ? activeBackgroundColour : 'transparent',
      }}
    >
      {label}
    </Button>
  );
}
