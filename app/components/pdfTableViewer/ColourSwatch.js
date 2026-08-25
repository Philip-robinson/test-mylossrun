'use client';

// A 20x20 clickable colour swatch: the current foreground or background of a coloured
// area, and the control that arms picking that colour from the page image. A visible
// border marks the swatch whose pick is armed.
//
// The border colour is a var(--…) value, which jsdom drops from an inline style, so the
// armed state is also carried as a data attribute.

import { Stack } from '@mui/material';
import { layerColoursColour } from 'config';

export default function ColourSwatch({
  testId,
  label,
  colour,
  active,
  disabled,
  onClick,
}) {
  return (
    <Stack direction={'row'} spacing={1} alignItems={'center'}>
      <div
        data-testid={testId}
        data-active={active ? 'true' : 'false'}
        onClick={disabled ? undefined : onClick}
        style={{
          width: 20,
          height: 20,
          backgroundColor: colour,
          border: active
            ? `2px solid ${layerColoursColour()}`
            : '2px solid transparent',
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
      <span>{label}</span>
    </Stack>
  );
}
