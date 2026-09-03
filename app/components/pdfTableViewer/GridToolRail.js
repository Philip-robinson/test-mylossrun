'use client';

// The left rail of the grid editor: the tool-bar, and the Special tool's sub-menu below it
// while that tool is armed. The rail owns placement, so the tool-bar and the sub-menu are
// centred as a pair — arming Special grows the group downward and re-centres it rather than
// moving the tool-bar.
//
// Controlled and stateless: it passes both selections straight through to the parent.

import { Box } from '@mui/material';
import GridToolbar from 'components/pdfTableViewer/GridToolbar';
import SpecialToolMenu from 'components/pdfTableViewer/SpecialToolMenu';
import { gridToolRailHelpId } from 'config';

export default function GridToolRail({
  tool = null,
  specialTool = null,
  onSelectTool,
  onSelectSpecialTool,
}) {
  return (
    <Box
      data-testid={'grid-tool-rail'}
      data-help-id={gridToolRailHelpId()}
      sx={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        // A tall sub-menu scrolls inside the rail on a short window rather than pushing
        // its own top edge out of view.
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      <GridToolbar tool={tool} onSelectTool={onSelectTool} />
      {tool === 'special' ? (
        <SpecialToolMenu
          specialTool={specialTool}
          onSelectSpecialTool={onSelectSpecialTool}
        />
      ) : null}
    </Box>
  );
}
