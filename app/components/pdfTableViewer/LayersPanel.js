'use client';

// LayersPanel: the fixed-width (200px) right-hand "Layers" panel of the staged
// grid editor. It renders the five ordered layer rows (Colours, Borders, Rows,
// Columns, Special Areas), the context-dependent Options block for the active row,
// and the Previous/Next page buttons. It is controlled and holds no state: all
// counts and selection come from props / the pure `layerUtils` helpers, and every
// action is forwarded to a callback.
//
// Every row is freely selectable, and only Special Areas is confirmed by a tick. The
// rows were once a ladder — each unlocked by the table's confirmation stage reaching
// the one below, each with its own tick — which made the layers a fixed order of work
// rather than five views of the same table.

import { Box, Button, Stack, Typography } from '@mui/material';
import LayerRow from 'components/pdfTableViewer/LayerRow';
import LayerOptions from 'components/pdfTableViewer/LayerOptions';
import {
  layerCounts,
  layerRowTicked,
} from 'components/pdfTableViewer/layerUtils';
import {
  layerBorderColour,
  layerColoursColour,
  layerColumnsColour,
  layerRowsColour,
  layerSpecialCellsColour,
  layersPanelWidthPx,
} from 'config';

// The five rows, in display order. `row` is the 1-based stage number K used by
// `layerRowTicked` and reported to `onToggleTick`; `key` is the layer key passed to
// LayerOptions / callbacks; `countKey` selects the value from `layerCounts`; `tickable`
// marks the one row confirmed by a tick.
//
// Special Areas is the only row with a tick, because it is the only row whose tick means
// anything: it confirms the table and performs Next. The other four were gates, and the two
// blocking grid-lines rebuilds that hung off the Colours and Borders ticks are fired by
// LEAVING those layers now — see the host's `handleSelectLayer`.
const LAYER_DEFS = [
  { row: 1, key: 'colours', label: 'Colours', colour: layerColoursColour, countKey: 'colours' },
  { row: 2, key: 'border', label: 'Borders', colour: layerBorderColour, countKey: 'border' },
  { row: 3, key: 'rows', label: 'Rows', colour: layerRowsColour, countKey: 'rows' },
  { row: 4, key: 'columns', label: 'Columns', colour: layerColumnsColour, countKey: 'columns' },
  {
    row: 5,
    key: 'special',
    label: 'Special Areas',
    colour: layerSpecialCellsColour,
    countKey: 'specialCells',
    tickable: true,
  },
];

export default function LayersPanel({
  selectedTable,
  samePageTables,
  pageColouredAreas,
  selectedLayer,
  confirmationStage,
  hasPrevPage,
  hasNextPage,
  onSelectLayer,
  onToggleTick,
  onPrev,
  onNext,
  hasSelectedLine,
  hasInternalLines,
  isCreatedUnconfirmed,
  lockedLayers = [],
  ...optionsCallbacks
}) {
  const counts = layerCounts({ selectedTable, samePageTables, pageColouredAreas });

  // Toggling a row's tick forwards the change and moves the selection:
  //  - On a confirming tick (checked), advance to the next row. The created-table Borders
  //    tick is skipped (it runs Calculate rather than confirming a stage, so selection stays
  //    on Borders); the last row has no next row.
  //  - On an untick, the high-water-mark stage clears this row and every following row;
  //    select the row that was just unticked.
  //
  // Special Areas is the only tickable row, so today only its branch is reachable. The rest
  // are kept for the other rows they were written for, should any of them be given a tick
  // again.
  const handleToggleTick = (def, checked) => {
    onToggleTick(def.row, checked, def.key);
    if (!checked) {
      onSelectLayer(def.key);
      return;
    }
    // The created-table Borders tick runs Calculate rather than confirming a stage, so
    // selection stays on Borders (keyed off the layer, not a fixed row number).
    if (def.key === 'border' && isCreatedUnconfirmed) return;
    // Confirming Colours fires a blocking back-end grid-lines probe; the selection must not
    // advance to Borders here. The host advances it to the next layer only once that response
    // has been received and merged into the table geometry the Border layer will draw from.
    if (def.key === 'colours') return;
    // Confirming Borders may fire a blocking, hinted grid-lines call (it does whenever a
    // border has been moved or an expected count typed), so the selection must not advance to
    // Rows here either. The host owns the advance: after the response has merged into the
    // geometry the Rows layer will draw from, or immediately when nothing qualified for a call.
    if (def.key === 'border') return;
    // Special Areas is the last row, so there is nothing to advance the selection to.
    // Confirming it instead performs the panel's Next action, which walks the page's remaining
    // tables in turn and only moves on to the next page once the last of them is reached. One
    // consequence is accepted: at the last page the host's Next merely toasts "End of list" —
    // the tick still registers.
    if (def.key === 'special') {
      onNext();
      return;
    }
    const next = LAYER_DEFS.find((d) => d.row === def.row + 1);
    if (next) onSelectLayer(next.key);
  };

  return (
    <Box
      data-testid={'layers-panel'}
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
        {LAYER_DEFS.map((def) => (
          <LayerRow
            key={def.key}
            colour={def.colour()}
            label={def.label}
            count={counts[def.countKey]}
            selected={selectedLayer === def.key}
            tickable={Boolean(def.tickable)}
            ticked={layerRowTicked(def.row, confirmationStage)}
            locked={lockedLayers.includes(def.key)}
            onSelect={() => onSelectLayer(def.key)}
            onToggleTick={(checked) => handleToggleTick(def, checked)}
          />
        ))}
      </Stack>

      {/* The Options block's values and callbacks arrive through the ...optionsCallbacks
          rest spread; only the flags derived from props this component destructures for
          its own use (selectedTable, the line/created state) are forwarded explicitly. */}
      <LayerOptions
        layer={selectedLayer}
        hasSelectedLine={hasSelectedLine}
        hasInternalLines={hasInternalLines}
        isCreatedUnconfirmed={isCreatedUnconfirmed}
        hasSelectedTable={Boolean(selectedTable)}
        locked={lockedLayers.includes(selectedLayer)}
        {...optionsCallbacks}
      />

      {/* No spacer above the page buttons: the Options block itself grows into the
          leftover height (and scrolls within it), which keeps Previous / Next pinned to
          the bottom whether the active layer's options are short or long. */}
      <Stack direction={'row'} spacing={1} sx={{ flexShrink: 0 }}>
        <Button
          data-testid={'layers-prev'}
          size={'small'}
          variant={'outlined'}
          onClick={onPrev}
        >
          {'Previous'}
        </Button>
        <Button
          data-testid={'layers-next'}
          size={'small'}
          variant={'outlined'}
          onClick={onNext}
        >
          {'Next'}
        </Button>
      </Stack>
    </Box>
  );
}
