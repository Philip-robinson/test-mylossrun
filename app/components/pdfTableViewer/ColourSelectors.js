'use client';

// The Options-panel block for the coloured-area tools: the Foreground and Background
// swatches, a Submit that writes the selection out as coloured areas, and a Delete shown
// only when what is selected is an area already saved. Controlled and stateless.

import { Button, Stack } from '@mui/material';
import ColourSwatch from 'components/pdfTableViewer/ColourSwatch';

export default function ColourSelectors({
  foregroundColour,
  backgroundColour,
  colourPickMode = null,
  canDelete = false,
  onToggleForegroundPick,
  onToggleBackgroundPick,
  onSubmit,
  onDelete,
}) {
  return (
    <Stack spacing={1} data-testid={'colour-selectors'}>
      <ColourSwatch
        testId={'opt-foreground-swatch'}
        label={'Foreground'}
        colour={foregroundColour}
        active={colourPickMode === 'foreground'}
        onClick={onToggleForegroundPick}
      />
      <ColourSwatch
        testId={'opt-background-swatch'}
        label={'Background'}
        colour={backgroundColour}
        active={colourPickMode === 'background'}
        onClick={onToggleBackgroundPick}
      />
      <Button
        data-testid={'opt-colour-submit'}
        size={'small'}
        variant={'outlined'}
        onClick={onSubmit}
      >
        {'Submit'}
      </Button>
      {canDelete ? (
        <Button
          data-testid={'opt-colour-delete'}
          size={'small'}
          variant={'outlined'}
          onClick={onDelete}
        >
          {'Delete'}
        </Button>
      ) : null}
    </Stack>
  );
}
