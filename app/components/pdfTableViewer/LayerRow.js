'use client';

// A single row in the "Layers" panel of the staged grid editor: a large colour dot, the
// layer's label, its count, and an eye stating whether the layer is drawn. The eye is not
// a separate control — clicking anywhere on the row toggles the layer. Purely
// presentational and controlled: all state lives in the parent.
//
// Borders is rendered untoggleable: it is always drawn, so it carries no eye and no click.

import { Box, Typography } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { layerTickSlotWidthPx } from 'config';

export default function LayerRow({
  colour,
  backgroundColour,
  label,
  count,
  on = true,
  toggleable = true,
  onToggle,
}) {
  return (
    <Box
      data-testid={'layer-row'}
      data-on={on ? 'true' : 'false'}
      onClick={toggleable ? () => onToggle(!on) : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        cursor: toggleable ? 'pointer' : 'default',
        // A layer that is off carries its own 10%-opacity background, so the panel states
        // what is hidden without the icons having to be read.
        backgroundColor: on ? 'transparent' : backgroundColour,
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
      {/* The slot is present on every row, so an untoggleable row's count lines up with a
          toggleable one's rather than sitting an icon's width further right. */}
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
        {toggleable ? (
          on ? (
            <VisibilityIcon
              data-testid={'layer-eye'}
              fontSize={'small'}
              color={'disabled'}
            />
          ) : (
            <VisibilityOffIcon
              data-testid={'layer-eye-off'}
              fontSize={'small'}
              color={'disabled'}
            />
          )
        ) : null}
      </Box>
    </Box>
  );
}
