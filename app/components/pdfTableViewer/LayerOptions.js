'use client';

// LayerOptions: a presentational dispatcher for the context-dependent Options
// block of the staged grid editor's Layers panel. It renders the correct set of
// action buttons for the currently-active Layer row (`layer`) and wires each to
// the matching callback. It holds no state and performs no editing itself.

import { Box, Button, Stack } from '@mui/material';
import { layerColoursColour } from 'config';
import ColumnNameCombo from 'components/pdfTableViewer/ColumnNameCombo';
import ExpectedCountsFields from 'components/pdfTableViewer/ExpectedCountsFields';
import OptionsButtonRow from 'components/pdfTableViewer/OptionsButtonRow';
import OptionsGroup from 'components/pdfTableViewer/OptionsGroup';
import OptionsSeparator from 'components/pdfTableViewer/OptionsSeparator';

// One Options button. Kept tiny and local — every button in this block shares
// the same look and only differs by testid / label / handler / disabled state.
function OptionButton({ testId, label, onClick, disabled }) {
  return (
    <Button
      data-testid={testId}
      size={'small'}
      variant={'outlined'}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

// A 20×20 clickable colour swatch used by the Colours layer for the selected
// area's Foreground / Background. A visible brown border marks the swatch whose
// pixel-pick mode is currently active. Inline styles (not sx) so the rendered
// backgroundColor / border are directly observable.
function ColourSwatch({ testId, label, colour, active, disabled, onClick }) {
  return (
    <Stack direction={'row'} spacing={1} alignItems={'center'}>
      <div
        data-testid={testId}
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

export default function LayerOptions({
  layer,
  hasSelectedLine = false,
  hasInternalLines = false,
  isCreatedUnconfirmed = false,
  hasSelectedTable = false,
  locked = false,
  expectedColumns = '',
  expectedRows = '',
  onExpectedCountsChange,
  onDeleteTable,
  onCreateTable,
  onConfirmCreated,
  onCancelCreated,
  onAddAbove,
  onAddBelow,
  onDeleteLine,
  onAddRow,
  onAddLeft,
  onAddRight,
  onSetTitle,
  onDeleteTitle,
  onRemoveHeader,
  onAddHeader,
  onAddSubTitleRow,
  onDeleteSubTitleRow,
  onAddHiddenRow,
  onDeleteHiddenRow,
  headerCount = 0,
  hasSectionRowSelected = false,
  sectionAreaSelected = false,
  columnName = null,
  columnNameOptions = [],
  onColumnNameChange,
  onMergeCell,
  onExtendColumn,
  onReduceColumn,
  onExtendRow,
  onReduceRow,
  canExtendColumn = false,
  canReduceColumn = false,
  canExtendRow = false,
  canReduceRow = false,
  colouredSelected = false,
  foregroundColour,
  backgroundColour,
  colourPickMode = null,
  onColourAdd,
  onColourDelete,
  onToggleForegroundPick,
  onToggleBackgroundPick,
}) {
  let buttons = [];

  if (layer === 'border') {
    // A locked Borders layer keeps "Create table": drawing a NEW table is a page action,
    // not an edit of the amalgamated one, and it would otherwise be unreachable on a page
    // whose every table is part of a grid.
    buttons = [
      <OptionButton
        key={'delete-table'}
        testId={'opt-delete-table'}
        label={'Delete this table'}
        onClick={onDeleteTable}
        disabled={locked}
      />,
      <OptionButton
        key={'create-table'}
        testId={'opt-create-table'}
        label={'Create table'}
        onClick={onCreateTable}
      />,
    ];
    if (isCreatedUnconfirmed) {
      buttons.push(
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
        />,
      );
    }
    // The expected column/row hints describe one table, so they are only shown once a
    // table is selected — a page with no table gets the buttons alone.
    if (hasSelectedTable) {
      buttons.push(
        <ExpectedCountsFields
          key={'expected-counts'}
          expectedColumns={expectedColumns}
          expectedRows={expectedRows}
          onChange={onExpectedCountsChange}
          disabled={locked}
        />,
      );
    }
  } else if (layer === 'rows') {
    buttons = [
      <OptionButton
        key={'add-above'}
        testId={'opt-add-above'}
        label={'Add above'}
        onClick={onAddAbove}
        disabled={!hasSelectedLine}
      />,
      <OptionButton
        key={'add-below'}
        testId={'opt-add-below'}
        label={'Add below'}
        onClick={onAddBelow}
        disabled={!hasSelectedLine}
      />,
      <OptionButton
        key={'delete-line'}
        testId={'opt-delete-line'}
        label={'Delete'}
        onClick={onDeleteLine}
        disabled={!hasSelectedLine}
      />,
    ];
    if (!hasInternalLines) {
      buttons.push(
        <OptionButton
          key={'add-row'}
          testId={'opt-add-row'}
          label={'Add row'}
          onClick={onAddRow}
        />,
      );
    }
  } else if (layer === 'columns') {
    buttons = [
      <OptionButton
        key={'add-left'}
        testId={'opt-add-left'}
        label={'Add Left'}
        onClick={onAddLeft}
        disabled={locked || !hasSelectedLine}
      />,
      <OptionButton
        key={'add-right'}
        testId={'opt-add-right'}
        label={'Add Right'}
        onClick={onAddRight}
        disabled={locked || !hasSelectedLine}
      />,
      <OptionButton
        key={'delete-line'}
        testId={'opt-delete-line'}
        label={'Delete'}
        onClick={onDeleteLine}
        disabled={locked || !hasSelectedLine}
      />,
    ];
  } else if (layer === 'special') {
    // Special Areas carries far more actions than any other layer, so its buttons are
    // gathered into titled groups whose short labels sit side by side. The group heading
    // carries the meaning the long labels used to ("Set" under "Title management" reads
    // as the old "Set Title"), which keeps the whole block on screen.
    buttons = [
      <OptionsGroup key={'group-title'} title={'Title management'}>
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-set-title'}
            label={'Set'}
            onClick={onSetTitle}
          />
          <OptionButton
            testId={'opt-delete-title'}
            label={'Delete'}
            onClick={onDeleteTitle}
          />
        </OptionsButtonRow>
      </OptionsGroup>,
      // The title actions, the header-row actions, the hidden-row actions and the sub-title
      // actions are distinct jobs, so a rule closes each group.
      <OptionsSeparator key={'separator-title'} />,
      // The heading carries a count of what it manages, so how much of the table is header is
      // visible without leaving the panel. Left bare when there is none, rather than "(0)".
      <OptionsGroup
        key={'group-header'}
        title={
          headerCount > 0
            ? `Header row management (${headerCount})`
            : 'Header row management'
        }
      >
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-add-header'}
            label={'Add'}
            onClick={onAddHeader}
          />
          <OptionButton
            testId={'opt-remove-header'}
            label={'Remove'}
            onClick={onRemoveHeader}
          />
        </OptionsButtonRow>
      </OptionsGroup>,
      <OptionsSeparator key={'separator-header'} />,
      // A hidden row and a section title are both section-title rows. The difference is the
      // column name: a hidden row has none, so it is simply dropped from the output rather than
      // supplying a value to a column of it. Dropping a row is the coarser decision of the two,
      // so it comes first. Delete is shared with the section-title row below — both delete
      // whichever section-title row is selected.
      <OptionsGroup key={'group-hidden-rows'} title={'Hidden rows'}>
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-add-hidden-row'}
            label={'Add'}
            onClick={onAddHiddenRow}
          />
          <OptionButton
            testId={'opt-delete-hidden-row'}
            label={'Delete'}
            onClick={onDeleteHiddenRow}
            disabled={!hasSectionRowSelected}
          />
        </OptionsButtonRow>
      </OptionsGroup>,
      <OptionsSeparator key={'separator-hidden-rows'} />,
      <OptionsGroup key={'group-sub-title'} title={'Section title row management'}>
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-add-sub-title'}
            label={'Add'}
            onClick={onAddSubTitleRow}
          />
          <OptionButton
            testId={'opt-delete-sub-title'}
            label={'Delete'}
            onClick={onDeleteSubTitleRow}
            disabled={!hasSectionRowSelected}
          />
        </OptionsButtonRow>
        <ColumnNameCombo
          value={columnName}
          options={columnNameOptions}
          disabled={!sectionAreaSelected}
          onChange={onColumnNameChange}
        />
      </OptionsGroup>,
      // Merged cells are the last refinement of a table's structure, so they close the
      // block behind their own rule. Create arms a mode (like the sub-title-row Add) and
      // so is always clickable; the Row/Column +/- buttons are gated by the host's `can…`
      // props, keeping every table-data decision out of this component.
      <OptionsSeparator key={'separator-merged'} />,
      <OptionsGroup key={'group-merged'} title={'Merged cell management'}>
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-merge-cell'}
            label={'Create'}
            onClick={onMergeCell}
          />
          <OptionButton
            testId={'opt-extend-row'}
            label={'Row +'}
            onClick={onExtendRow}
            disabled={!canExtendRow}
          />
          <OptionButton
            testId={'opt-reduce-row'}
            label={'Row -'}
            onClick={onReduceRow}
            disabled={!canReduceRow}
          />
        </OptionsButtonRow>
        <OptionsButtonRow>
          <OptionButton
            testId={'opt-extend-column'}
            label={'Column +'}
            onClick={onExtendColumn}
            disabled={!canExtendColumn}
          />
          <OptionButton
            testId={'opt-reduce-column'}
            label={'Column -'}
            onClick={onReduceColumn}
            disabled={!canReduceColumn}
          />
        </OptionsButtonRow>
      </OptionsGroup>,
    ];
  } else if (layer === 'colours') {
    buttons = [
      <OptionButton
        key={'colour-add'}
        testId={'opt-colour-add'}
        label={'Add'}
        onClick={onColourAdd}
        disabled={locked}
      />,
    ];
    // A locked Colours layer still shows the selected area's colours — they are worth
    // reading — but neither swatch arms a pixel pick and the area cannot be deleted.
    if (colouredSelected) {
      buttons.push(
        <OptionButton
          key={'colour-delete'}
          testId={'opt-colour-delete'}
          label={'Delete'}
          onClick={onColourDelete}
          disabled={locked}
        />,
        <ColourSwatch
          key={'foreground-swatch'}
          testId={'opt-foreground-swatch'}
          label={'Foreground'}
          colour={foregroundColour}
          active={colourPickMode === 'foreground'}
          disabled={locked}
          onClick={onToggleForegroundPick}
        />,
        <ColourSwatch
          key={'background-swatch'}
          testId={'opt-background-swatch'}
          label={'Background'}
          colour={backgroundColour}
          active={colourPickMode === 'background'}
          disabled={locked}
          onClick={onToggleBackgroundPick}
        />,
      );
    }
  }
  // Any unknown layer renders an empty block.

  // The block takes whatever height the panel has left over and scrolls inside it, so a
  // long layer (Special Areas) stays reachable on a short window instead of pushing the
  // panel's Previous / Next buttons off the bottom.
  return (
    <Box
      data-testid={'layer-options'}
      sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}
    >
      <Stack spacing={1}>{buttons}</Stack>
    </Box>
  );
}
