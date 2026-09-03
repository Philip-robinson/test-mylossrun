'use client';

// The review panel's tab strip, one tab per table the extraction returned. A merged group
// splits into one table per section, and this is how the reviewer moves between them.
//
// Nothing is drawn for fewer than two tables: a lone tab says nothing, and a document with
// no section titles should read exactly as it did before it could be split.

import { Box, Tab, Tabs } from '@mui/material';
import { reviewTabsHelpId } from 'config';

export default function ReviewTableTabs({ tables, activeIndex, onChange }) {
  if ((tables?.length ?? 0) < 2) return null;

  return (
    <Box
      data-help-id={reviewTabsHelpId()}
      sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider' }}
    >
      {/* Scrollable rather than wrapped: a loss run can carry many sections, and a strip
          that grows downwards would eat the grid it belongs to. */}
      <Tabs
        data-testid={'review-tabs'}
        value={activeIndex}
        onChange={(_, index) => onChange(index)}
        variant={'scrollable'}
        scrollButtons={'auto'}
      >
        {tables.map((table, index) => (
          <Tab
            key={index}
            data-testid={'review-tab'}
            label={table.name}
            id={`review-tab-${index}`}
          />
        ))}
      </Tabs>
    </Box>
  );
}
