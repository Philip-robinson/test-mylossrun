'use client';

// LayersPanel: the fixed-width (200px) right-hand "Layers" panel of the staged grid
// editor. Which rows it lists is the editor's mode: borderMode is about table boundaries
// alone and lists Borders, while gridMode is about one table's contents and lists the
// other four. Each listed row but Borders is an independent visibility flag, toggled by
// clicking the row. Below the rows sit the context-dependent Options block, the
// Previous / Next buttons, and the button that switches passes — Validate Tables in
// borderMode, Validate Borders in gridMode.
//
// It is controlled and holds no state: counts come from the pure `layerUtils` helpers,
// the flags and the mode come from props, and every action is forwarded to a callback.

import { Box, Button, Stack, Typography } from '@mui/material';
import LayerRow from 'components/pdfTableViewer/LayerRow';
import LayerOptions from 'components/pdfTableViewer/LayerOptions';
import { layerCounts } from 'components/pdfTableViewer/layerUtils';
import {
  layerBorderBackgroundColour,
  layerBorderColour,
  layerColoursBackgroundColour,
  layerColoursColour,
  layerColumnsBackgroundColour,
  layerColumnsColour,
  layerRowsBackgroundColour,
  layerRowsColour,
  layerSpecialCellsBackgroundColour,
  layerSpecialCellsColour,
  layersColoursHelpId,
  layersColumnsHelpId,
  layersNextHelpId,
  layersPanelHelpId,
  layersPanelWidthPx,
  layersPreviousHelpId,
  layersRowsHelpId,
  layersSpecialHelpId,
  validateBordersHelpId,
  validateTablesHelpId,
} from 'config';

// The five rows in display order: Borders first, because the boundary pass comes first,
// and Colours last. `countKey` selects the row's count from `layerCounts`; `toggleable`
// is false only for Borders, which is always drawn and so carries no eye. `helpId` is the
// id the help overlay describes the row by — the four gridMode layers have one, Borders
// none.
const LAYER_DEFS = [
  {
    key: 'border',
    label: 'Borders',
    colour: layerBorderColour,
    backgroundColour: layerBorderBackgroundColour,
    countKey: 'border',
    toggleable: false,
  },
  {
    key: 'rows',
    helpId: layersRowsHelpId,
    label: 'Rows',
    colour: layerRowsColour,
    backgroundColour: layerRowsBackgroundColour,
    countKey: 'rows',
    toggleable: true,
  },
  {
    key: 'columns',
    helpId: layersColumnsHelpId,
    label: 'Columns',
    colour: layerColumnsColour,
    backgroundColour: layerColumnsBackgroundColour,
    countKey: 'columns',
    toggleable: true,
  },
  {
    key: 'special',
    helpId: layersSpecialHelpId,
    label: 'Special Areas',
    colour: layerSpecialCellsColour,
    backgroundColour: layerSpecialCellsBackgroundColour,
    countKey: 'specialCells',
    toggleable: true,
  },
  {
    key: 'colours',
    helpId: layersColoursHelpId,
    label: 'Colours',
    colour: layerColoursColour,
    backgroundColour: layerColoursBackgroundColour,
    countKey: 'colours',
    toggleable: true,
  },
];

export default function LayersPanel({
  editorMode = 'border',
  layerVisibility = {},
  onToggleLayer,
  selectedTable,
  samePageTables,
  pageColouredAreas,
  tool = null,
  specialTool = null,
  onPrev,
  onNext,
  onValidateTables,
  onValidateBorders,
  isCreatedUnconfirmed,
  ...optionsCallbacks
}) {
  const counts = layerCounts({
    selectedTable,
    samePageTables,
    pageColouredAreas,
  });
  const borderMode = editorMode === 'border';
  const rows = LAYER_DEFS.filter((def) =>
    borderMode ? def.key === 'border' : def.key !== 'border'
  );

  return (
    <Box
      data-testid={'layers-panel'}
      data-help-id={layersPanelHelpId()}
      sx={{
        width: layersPanelWidthPx(),
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1,
      }}
    >
      <Typography variant={'h6'}>{'Layers'}</Typography>

      {/* The selected table's name, immediately under the heading. Rendered only when there is
          one, so a page with no selected table keeps its original layout. A long name wraps
          inside the panel's fixed width rather than overflowing it. */}
      {selectedTable?.name ? (
        <Typography
          data-testid={'layers-table-name'}
          variant={'caption'}
          color={'text.secondary'}
          sx={{ overflowWrap: 'anywhere' }}
        >
          {selectedTable.name}
        </Typography>
      ) : null}

      <Stack spacing={0.5}>
        {rows.map((def) => (
          <LayerRow
            key={def.key}
            colour={def.colour()}
            backgroundColour={def.backgroundColour()}
            label={def.label}
            count={counts[def.countKey]}
            helpId={def.helpId ? def.helpId() : undefined}
            on={def.toggleable ? layerVisibility[def.key] !== false : true}
            toggleable={def.toggleable}
            onToggle={() => onToggleLayer(def.key)}
          />
        ))}
      </Stack>

      {/* The Options block's values and callbacks arrive through the ...optionsCallbacks
          rest spread; only what this component destructures for its own use is forwarded
          explicitly. */}
      <LayerOptions
        editorMode={editorMode}
        tool={tool}
        specialTool={specialTool}
        isCreatedUnconfirmed={isCreatedUnconfirmed}
        {...optionsCallbacks}
      />

      {/* No spacer above the page buttons: the Options block itself grows into the
          leftover height (and scrolls within it), which keeps Previous / Next pinned to
          the bottom whether the active options are short or long. */}
      <Stack spacing={1} sx={{ flexShrink: 0 }}>
        <Stack direction={'row'} spacing={1}>
          <Button
            data-testid={'layers-prev'}
            data-help-id={layersPreviousHelpId()}
            size={'small'}
            variant={'outlined'}
            onClick={onPrev}
          >
            {'Previous'}
          </Button>
          <Button
            data-testid={'layers-next'}
            data-help-id={layersNextHelpId()}
            size={'small'}
            variant={'outlined'}
            onClick={onNext}
          >
            {'Next'}
          </Button>
        </Stack>
        {/* The pass switch, one button or the other and never neither: Validate Tables ends
            the boundary pass for the contents pass, Validate Borders goes back the other way.
            Either way what the pass being left owes is settled and saved before the move. */}
        {borderMode ? (
          <Button
            data-testid={'layers-validate-tables'}
            data-help-id={validateTablesHelpId()}
            size={'small'}
            variant={'outlined'}
            onClick={onValidateTables}
          >
            {'Validate Tables'}
          </Button>
        ) : (
          <Button
            data-testid={'layers-validate-borders'}
            data-help-id={validateBordersHelpId()}
            size={'small'}
            variant={'outlined'}
            onClick={onValidateBorders}
          >
            {'Validate Borders'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
