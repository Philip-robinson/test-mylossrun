'use client';

import { Box } from '@mui/material';

// Presentational: the tables a root holds in `next`, listed under that root's Document
// Overview entry in document order. Each row picks its table for editing; the caller decides
// what selecting means and which row, if any, is current.
//
// Rendered only while the root's size line is expanded — either form of it, "Additional
// tables N" or "A × B Tables" — which the caller owns, so this component holds no state.
export default function AdditionalTablesList({ tables, selectedTableId, onSelect }) {
  return (
    <Box data-testid={'additional-tables-list'} sx={{ pl: 1 }}>
      {tables.map((t) => (
        <Box
          key={t.tableId}
          data-testid={'additional-table-entry'}
          data-tableid={t.tableId}
          data-selected={t.tableId === selectedTableId ? 'true' : 'false'}
          onClick={(e) => {
            // The root entry's own click selects the root; this row selects its own table.
            e.stopPropagation();
            onSelect(t);
          }}
          sx={{
            color: 'var(--secondary-text)',
            fontSize: '12px',
            cursor: 'pointer',
            py: 0.25,
            fontWeight: t.tableId === selectedTableId ? 'bold' : 'normal',
          }}
        >
          {`${t.name} — page ${(t.pdfPage ?? 0) + 1}`}
        </Box>
      ))}
    </Box>
  );
}
