// The review screen's top row: the reviewed table's name on the left and the grid's font
// zoom on the right.

import { Box, Typography } from '@mui/material';
import EditorScaleSelector from 'components/pdfTableViewer/EditorScaleSelector';
import {
  reviewFontScaleHelpId,
  reviewFontScalePercentOptions,
  reviewHeaderRowGapPx,
  reviewTableNameHelpId,
} from 'config';

export default function ReviewHeaderRow({ name, fontScale, onFontScaleChange }) {
  return (
    <Box
      data-testid={'review-header-row'}
      sx={{
        flexShrink: 0,
        px: 1,
        pt: 1,
        mb: `${reviewHeaderRowGapPx()}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {name && (
          <Typography
            data-testid={'review-table-name'}
            data-help-id={reviewTableNameHelpId()}
            variant={'subtitle2'}
            noWrap
          >
            {name}
          </Typography>
        )}
      </Box>
      <EditorScaleSelector
        percent={fontScale}
        onChange={onFontScaleChange}
        options={reviewFontScalePercentOptions()}
        helpId={reviewFontScaleHelpId()}
      />
    </Box>
  );
}
