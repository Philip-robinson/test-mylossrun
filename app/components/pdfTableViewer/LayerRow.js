'use client';

// A single row in the "Layers" panel of the staged grid editor: a large colour
// dot, the layer's label, its count, and — on the one row confirmed by a tick —
// a checkbox. Purely presentational and controlled: all state lives in the parent.
//
// Every row is selectable. The rows were once gates unlocked one at a time by the
// table's confirmation stage; they are not any more, so a click always selects.
// A tick, though, is live only on the row that is currently selected.

import { Box, Checkbox, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { layerTickSlotWidthPx } from 'config';

export default function LayerRow({
  colour,
  label,
  count,
  selected,
  tickable,
  ticked,
  locked = false,
  onSelect,
  onToggleTick,
}) {
  return (
    <Box
      data-testid={'layer-row'}
      onClick={onSelect}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        cursor: 'pointer',
        // Selected rows are tinted with a 90%-transparent version of their dot colour.
        backgroundColor: selected
          ? `color-mix(in srgb, ${colour} 10%, transparent)`
          : 'transparent',
        borderRadius: 1,
      }}
    >
      <Box
        data-testid={'layer-dot'}
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: colour,
          flexShrink: 0,
        }}
      />
      <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
      <Typography data-testid={'layer-count'} variant={'body2'}>
        {count}
      </Typography>
      {/* The slot is present on every row, so an untickable row's count lines up with a
          tickable one's rather than sitting a checkbox's width further right. An untickable
          row states whether it can be worked on: an eye when it can, a padlock when the
          selected table's grid has made it display-only. */}
      <Box
        data-testid={'layer-tick-slot'}
        sx={{
          width: layerTickSlotWidthPx(),
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {tickable ? (
          // The tick is live only while its own row is selected: confirming a layer is a
          // statement about the work just done on it, so the row has to be the one being
          // looked at. Clicking the row selects it and the tick becomes usable.
          <Checkbox
            data-testid={'layer-tick'}
            checked={ticked}
            disabled={!selected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleTick(e.target.checked)}
          />
        ) : locked ? (
          <LockIcon
            data-testid={'layer-lock'}
            fontSize={'small'}
            color={'disabled'}
          />
        ) : (
          <VisibilityIcon
            data-testid={'layer-eye'}
            fontSize={'small'}
            color={'disabled'}
          />
        )}
      </Box>
    </Box>
  );
}
