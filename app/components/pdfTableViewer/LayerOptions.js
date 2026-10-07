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
import OptionsButtonRow from 'components/pdfTableViewer/OptionsButtonRow';
import {
  boundaryCreateTableHelpId,
  boundaryCutCancelHelpId,
  boundaryCutEndHelpId,
  boundaryCutStartHelpId,
  boundaryDeleteAllTablesHelpId,
  boundaryDeleteTableHelpId,
  colourSpecialToolKeys,
  cutCancelLabel,
  cutColour,
  cutColourKey,
  cutEndLabel,
  cutStartLabel,
  deleteAllTablesLabel,
} from 'config';

// One Options button. Kept tiny and local — every button in this block shares
// the same look and only differs by testid / label / handler / disabled state.
function OptionButton({ testId, helpId, label, onClick, disabled, sx, dataColour }) {
  return (
    <Button
      data-testid={testId}
      data-help-id={helpId}
      data-colour={dataColour}
      size={'small'}
      variant={'outlined'}
      onClick={onClick}
      disabled={disabled}
      sx={sx}
    >
      {label}
    </Button>
  );
}

export default function LayerOptions({
  editorMode = 'border',
  tool = null,
  specialTool = null,
  cutting = false,
  canCut = false,
  onCutStart,
  onCutEnd,
  onCutCancel,
  onDeleteAllTables,
  onDeleteTable,
  onCreateTable,
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
    const cutSx = { color: cutColour(), borderColor: cutColour() };
    content = [
      <OptionButton
        key={'delete-table'}
        testId={'opt-delete-table'}
        helpId={boundaryDeleteTableHelpId()}
        label={'Delete this table'}
        onClick={onDeleteTable}
      />,
      cutting ? (
        <OptionsButtonRow key={'cut-row'}>
          <OptionButton
            testId={'opt-cut-end'}
            helpId={boundaryCutEndHelpId()}
            label={cutEndLabel()}
            onClick={onCutEnd}
            sx={cutSx}
            dataColour={cutColourKey()}
          />
          <OptionButton
            testId={'opt-cut-cancel'}
            helpId={boundaryCutCancelHelpId()}
            label={cutCancelLabel()}
            onClick={onCutCancel}
            sx={cutSx}
            dataColour={cutColourKey()}
          />
        </OptionsButtonRow>
      ) : (
        <OptionButton
          key={'cut-start'}
          testId={'opt-cut-start'}
          helpId={boundaryCutStartHelpId()}
          label={cutStartLabel()}
          onClick={onCutStart}
          disabled={!canCut}
        />
      ),
      <OptionButton
        key={'delete-all-tables'}
        testId={'opt-delete-all-tables'}
        helpId={boundaryDeleteAllTablesHelpId()}
        label={deleteAllTablesLabel()}
        onClick={onDeleteAllTables}
      />,
      <OptionButton
        key={'create-table'}
        testId={'opt-create-table'}
        helpId={boundaryCreateTableHelpId()}
        label={'Create table'}
        onClick={onCreateTable}
        disabled={cutting}
      />,
    ];
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
