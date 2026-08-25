'use client';

// The Special tool's submenu, shown immediately to the right of the grid tool-bar while
// the Special button is armed. Its entries are radio buttons among themselves: one armed
// at a time, and clicking the armed one disarms it.
//
// Controlled and stateless. The armed background is a var(--…) colour, which jsdom drops
// from an inline style, so the armed state is also carried as a data attribute.

import { Box, Button, Stack } from '@mui/material';
import { layerSpecialCellsBackgroundColour } from 'config';

const SPECIAL_TOOL_DEFS = [
  { key: 'header', label: 'Header' },
  { key: 'hideRow', label: 'Hide Row' },
  { key: 'sectionTitle', label: 'Section Title Row' },
  { key: 'colouredRows', label: 'Coloured Rows' },
  { key: 'colouredColumns', label: 'Coloured Columns' },
  { key: 'colouredTable', label: 'Coloured Table' },
  { key: 'colouredArea', label: 'Coloured Area' },
];

export default function SpecialToolMenu({ specialTool = null, onSelectSpecialTool }) {
  return (
    <Box data-testid={'special-tool-menu'} sx={{ flexShrink: 0, p: 0.5 }}>
      <Stack spacing={0.5}>
        {SPECIAL_TOOL_DEFS.map(({ key, label }) => (
          <Button
            key={key}
            data-testid={`special-tool-${key}`}
            data-active={specialTool === key ? 'true' : 'false'}
            size={'small'}
            variant={'outlined'}
            onClick={() => onSelectSpecialTool(key)}
            sx={{
              justifyContent: 'flex-start',
              whiteSpace: 'nowrap',
              backgroundColor:
                specialTool === key
                  ? layerSpecialCellsBackgroundColour()
                  : 'transparent',
            }}
          >
            {label}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}
