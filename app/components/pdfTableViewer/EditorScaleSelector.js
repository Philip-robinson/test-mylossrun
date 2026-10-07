// Controlled presentational zoom/scale selector. Renders a ZoomOut button, the current
// percentage, and a ZoomIn button. The ordered options and help id default to the staged
// grid editor's from config; stepping between them is delegated to the pure `stepScale`
// helper in `layerUtils`.

import { Box, IconButton, Typography } from '@mui/material';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { editorScaleHelpId, scalePercentOptions } from 'config';
import { stepScale } from 'components/pdfTableViewer/layerUtils';

export default function EditorScaleSelector({
  percent,
  onChange,
  options = scalePercentOptions(),
  helpId = editorScaleHelpId(),
}) {
  const previous = stepScale(options, percent, -1);
  const next = stepScale(options, percent, +1);

  return (
    <Box
      data-help-id={helpId}
      sx={{ display: 'flex', alignItems: 'center' }}
    >
      <IconButton
        data-testid={'scale-zoom-out'}
        aria-label={'Zoom out'}
        size={'small'}
        disabled={previous === percent}
        onClick={() => onChange(previous)}
      >
        <ZoomOutIcon fontSize={'small'} />
      </IconButton>
      <Typography data-testid={'scale-value'} component={'span'} variant={'body2'}>
        {`${percent}%`}
      </Typography>
      <IconButton
        data-testid={'scale-zoom-in'}
        aria-label={'Zoom in'}
        size={'small'}
        disabled={next === percent}
        onClick={() => onChange(next)}
      >
        <ZoomInIcon fontSize={'small'} />
      </IconButton>
    </Box>
  );
}
