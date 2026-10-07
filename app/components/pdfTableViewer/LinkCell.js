'use client';

// One rendered table cell of the grid editor: its name plus the cropped image (or a
// placeholder spinner while the image is still loading). Draggable unless it is Root.
// The image renders at its natural pixel size — the back end serves every
// table at one shared dpi, so on-screen sizes reflect the tables' true
// relative scale and must not be stretched to a fixed cell width.
// A table whose end row is joined to the next gets a wavy bottom border.

import { Box, CircularProgress, Typography } from '@mui/material';
import LinkCellWavyBorder from 'components/pdfTableViewer/LinkCellWavyBorder';
import { linkCellBorderColour, linkCellBorderWidthPx, linkTableCellWidth } from 'config';

const CELL_WIDTH = linkTableCellWidth();

export default function LinkCell({ table, image, draggable, onDragStart, row, col }) {
  const joined = table.splitBottomRow === true;
  return (
    <Box
      data-testid={'link-cell'}
      data-tableid={table.tableId}
      // Set for a cell in the grid and left off one in the Available column, which has no
      // grid position: a drop reads these to work out which column it landed on, and every
      // grid cell must answer, not only the empty ones.
      data-row={row}
      data-col={col}
      data-joined-end-row={joined ? 'true' : 'false'}
      draggable={draggable}
      onDragStart={onDragStart}
      sx={{
        border: `${linkCellBorderWidthPx()}px solid ${linkCellBorderColour()}`,
        p: 0.5,
        boxSizing: 'border-box',
        cursor: draggable ? 'grab' : 'default',
        flexShrink: 0,
        alignSelf: 'flex-start',
        // The bottom border keeps its width so the layout does not shift under the wave.
        ...(joined ? { position: 'relative', borderBottomColor: 'transparent' } : {}),
      }}
    >
      <Typography variant={'caption'} noWrap display={'block'}>
        {table.name ?? table.tableId}
      </Typography>
      {image ? (
        <img
          src={`data:image/png;base64,${image}`}
          alt={table.name ?? table.tableId}
          style={{ display: 'block', maxWidth: '100%' }}
        />
      ) : (
        <Box
          sx={{
            width: CELL_WIDTH,
            minHeight: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={20} />
        </Box>
      )}
      {joined && <LinkCellWavyBorder />}
    </Box>
  );
}
