'use client';

// LayerOptions: a presentational dispatcher for the context-dependent Options block of
// the staged grid editor's Layers panel. What it renders follows the editor's mode and,
// in gridMode, the armed tool: borderMode carries the table-boundary actions, and the
// Special tool's Header and coloured-area entries carry the only controls the second
// pass needs. It holds no state and performs no editing itself.
//
// The block stays even when it is empty: the specification has further functions for it.

import { Box, Button, Stack } from '@mui/material';
import ColourSelectors from 'components/pdfTableViewer/ColourSelectors';
import {
  boundaryCreateTableHelpId,
  boundaryDeleteTableHelpId,
  colourSpecialToolKeys,
} from 'config';

// One Options button. Kept tiny and local — every button in this block shares
// the same look and only differs by testid / label / handler / disabled state.
function OptionButton({ testId, helpId, label, onClick, disabled }) {
  return (
    <Button
      data-testid={testId}
      data-help-id={helpId}
      size={'small'}
      variant={'outlined'}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

export default function LayerOptions({
  editorMode = 'border',
  tool = null,
  specialTool = null,
  isCreatedUnconfirmed = false,
  onDeleteTable,
  onCreateTable,
  onConfirmCreated,
  onCancelCreated,
  onDeleteHeader,
  hasPendingSelection = false,
  hasSavedAreaSelected = false,
  foregroundColour,
  backgroundColour,
  colourPickMode = null,
  onToggleForegroundPick,
  onToggleBackgroundPick,
  onColourSubmit,
  onColourDelete,
}) {
  let content = [];

  if (editorMode === 'border') {
    content = [
      <OptionButton
        key={'delete-table'}
        testId={'opt-delete-table'}
        helpId={boundaryDeleteTableHelpId()}
        label={'Delete this table'}
        onClick={onDeleteTable}
      />,
      <OptionButton
        key={'create-table'}
        testId={'opt-create-table'}
        helpId={boundaryCreateTableHelpId()}
        label={'Create table'}
        onClick={onCreateTable}
      />,
    ];
    if (isCreatedUnconfirmed) {
      content.push(
        <OptionButton
          key={'confirm-created'}
          testId={'opt-confirm-created'}
          label={'Calculate'}
          onClick={onConfirmCreated}
        />,
        <OptionButton
          key={'cancel-created'}
          testId={'opt-cancel-created'}
          label={'Cancel'}
          onClick={onCancelCreated}
        />
      );
    }
  } else if (tool === 'special' && specialTool === 'header') {
    content = [
      <OptionButton
        key={'delete-header'}
        testId={'opt-delete-header'}
        label={'Delete Header'}
        onClick={onDeleteHeader}
      />,
    ];
  } else if (tool === 'special' && colourSpecialToolKeys().includes(specialTool)) {
    // Coloured Table colours the whole table, so it has no selection step and its
    // selectors are offered straight away; the other three wait for something selected.
    const ready =
      specialTool === 'colouredTable' ||
      hasPendingSelection ||
      hasSavedAreaSelected;
    if (ready) {
      content = [
        <ColourSelectors
          key={'colour-selectors'}
          foregroundColour={foregroundColour}
          backgroundColour={backgroundColour}
          colourPickMode={colourPickMode}
          canDelete={hasSavedAreaSelected}
          onToggleForegroundPick={onToggleForegroundPick}
          onToggleBackgroundPick={onToggleBackgroundPick}
          onSubmit={onColourSubmit}
          onDelete={onColourDelete}
        />,
      ];
    }
  }
  // Every other gridMode state renders an empty block.

  // The block takes whatever height the panel has left over and scrolls inside it, so a
  // long set of options stays reachable on a short window instead of pushing the panel's
  // Previous / Next buttons off the bottom.
  return (
    <Box
      data-testid={'layer-options'}
      sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}
    >
      <Stack spacing={1}>{content}</Stack>
    </Box>
  );
}
