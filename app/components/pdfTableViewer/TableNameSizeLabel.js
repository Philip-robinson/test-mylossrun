'use client';

import { Box } from '@mui/material';
import { tableNameLabelHelpId } from 'config';

// Presentational: a table's name and its column × row size, lifted just above the table's
// top-left corner. An absolutely-positioned HTML sibling of the overlay SVG rather than SVG
// text, because the overlay uses preserveAspectRatio="none", which would distort it.
//
// `left` and `top` are CSS lengths naming that corner. The colour is a var(--…) value, which
// jsdom drops from an inline style, so which colour was taken is also carried as a data
// attribute.
export default function TableNameSizeLabel({ table, left, top, colour, colourName }) {
  return (
    <Box
      data-testid={'selected-label'}
      data-help-id={tableNameLabelHelpId()}
      data-tableid={table.tableId}
      data-colour={colourName}
      style={{
        position: 'absolute',
        left,
        top,
        backgroundColor: colour,
        color: 'white',
        fontFamily: 'sans-serif',
        fontSize: 12,
        lineHeight: '12px',
        padding: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <span data-testid={'selected-label-name'}>{table.name}</span>
      <span
        style={{
          width: 1,
          alignSelf: 'stretch',
          backgroundColor: 'white',
          margin: '0 6px',
        }}
      />
      <span data-testid={'selected-label-size'}>
        {`${(table.columnWidths ?? []).length} × ${
          (table.rowHeights ?? []).length
        }`}
      </span>
    </Box>
  );
}
