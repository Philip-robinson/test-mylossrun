'use client';

// The overlay's card: the HELP chip, one thing's title and the words describing it,
// and the two buttons on its foot — Hide, which puts the card away without leaving
// help, and Exit Help, which leaves. Presentational and told where to go — `position` is
// the viewport point tipPlacement settled on, and `side` the side of the hole the
// card settled on, which is the edge the caret points back from. `cardRef` reaches
// its root element, which is how the overlay reads back the height the words came to
// and places the card again knowing it.
//
// Its colours are literal values from config rather than var(--…) custom properties,
// so the card reads the same wherever it lands. The side is carried as data-help-side
// beside the caret's style, because that is the part a test needs to see.
//
// The card swallows its own clicks. It is drawn inside the scrim, and the scrim treats
// a click as a question about what lies under the pointer — which, for a point on the
// card, is whatever the card happens to be covering. Without this, clicking Hide would
// be undone by the same click, and clicking the card's own words would move the
// highlight to whatever is behind them.

import { Box, Button, Typography } from '@mui/material';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import {
  helpCardBackgroundColour,
  helpCardBodyFontSize,
  helpCardBodyLineHeight,
  helpCardCaretSizePx,
  helpCardTextColour,
  helpCardWidthPx,
  helpChipBackgroundColour,
} from 'config';
import { helpChipLabel, helpExitLabel, helpHideLabel } from 'app/lib/helpContent';
import { helpSegmentNodes } from 'components/help/helpSegments';

export default function HelpTipCard({
  cardRef,
  title,
  body,
  side,
  position,
  onExit,
  onHide,
}) {
  return (
    <Box
      ref={cardRef}
      data-testid={'help-tip-card'}
      data-help-side={side}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${helpCardWidthPx()}px`,
        p: 2,
        borderRadius: 2,
        backgroundColor: helpCardBackgroundColour(),
        color: helpCardTextColour(),
      }}
    >
      <Box sx={caretStyle(side)} />
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.25,
          borderRadius: '999px',
          backgroundColor: helpChipBackgroundColour(),
        }}
      >
        <LightbulbOutlinedIcon sx={{ fontSize: '1rem' }} />
        <Typography
          component={'span'}
          sx={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.08em' }}
        >
          {helpChipLabel()}
        </Typography>
      </Box>
      <Typography sx={{ mt: 1, fontWeight: 'bold' }}>{title}</Typography>
      {/* A div, not the default <p>: a body may hold a bulleted list, and a <ul>
          inside a <p> is invalid markup the browser would hoist out of it. */}
      <Typography
        component={'div'}
        sx={{
          mt: 0.5,
          fontSize: helpCardBodyFontSize(),
          lineHeight: helpCardBodyLineHeight(),
        }}
      >
        {helpSegmentNodes(body)}
      </Typography>
      {/* Hide sits at the far left of the foot and Exit Help at the far right, so the
          button that keeps you in help cannot be mistaken for the one that ends it. */}
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          type={'button'}
          variant={'text'}
          size={'small'}
          onClick={onHide}
          sx={{ color: helpCardTextColour() }}
        >
          {helpHideLabel()}
        </Button>
        <Button
          type={'button'}
          variant={'outlined'}
          size={'small'}
          onClick={onExit}
          sx={{ color: helpCardTextColour(), borderColor: helpCardTextColour() }}
        >
          {helpExitLabel()}
        </Button>
      </Box>
    </Box>
  );
}

// The caret as a border triangle on the card's edge nearest the hole, centred on that
// edge. `side` names the side of the HOLE the card is on, so the caret sits on the
// opposite edge of the card: a card below the hole points up from its own top.
function caretStyle(side) {
  const size = helpCardCaretSizePx();
  const transparent = `${size}px solid transparent`;
  const filled = `${size}px solid ${helpCardBackgroundColour()}`;

  const shared = { position: 'absolute', width: 0, height: 0 };
  const acrossX = { left: '50%', marginLeft: `${-size}px` };
  const acrossY = { top: '50%', marginTop: `${-size}px` };

  switch (side) {
    case 'top':
      return {
        ...shared,
        ...acrossX,
        bottom: `${-size}px`,
        borderLeft: transparent,
        borderRight: transparent,
        borderTop: filled,
      };
    case 'left':
      return {
        ...shared,
        ...acrossY,
        right: `${-size}px`,
        borderTop: transparent,
        borderBottom: transparent,
        borderLeft: filled,
      };
    case 'right':
      return {
        ...shared,
        ...acrossY,
        left: `${-size}px`,
        borderTop: transparent,
        borderBottom: transparent,
        borderRight: filled,
      };
    default:
      return {
        ...shared,
        ...acrossX,
        top: `${-size}px`,
        borderLeft: transparent,
        borderRight: transparent,
        borderBottom: filled,
      };
  }
}
