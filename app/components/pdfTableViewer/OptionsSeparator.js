'use client';

// OptionsSeparator: the faint horizontal rule that divides an Options block's
// buttons into groups. Purely decorative — it carries no label and takes no props —
// but it is its own component because the Special Areas block draws it more than
// once and every dimension comes from config rather than from a literal here.

import {
  optionsSeparatorColour,
  optionsSeparatorHeightPx,
  optionsSeparatorMarginBottomPx,
  optionsSeparatorMarginTopPx,
  optionsSeparatorRadiusPx,
  optionsSeparatorWidthPercent,
} from 'config';

export default function OptionsSeparator() {
  // Inline styles (not sx) so the rendered rule is directly observable, matching the
  // other small presentational pieces in this block. It is narrower than the block, so
  // the auto side margins centre it horizontally; `marginTop`/`marginBottom` cannot be
  // folded into a `margin` shorthand alongside them without losing that.
  return (
    <div
      data-testid={'opt-separator'}
      style={{
        backgroundColor: optionsSeparatorColour(),
        width: `${optionsSeparatorWidthPercent()}%`,
        height: optionsSeparatorHeightPx(),
        marginTop: optionsSeparatorMarginTopPx(),
        marginBottom: optionsSeparatorMarginBottomPx(),
        marginLeft: 'auto',
        marginRight: 'auto',
        borderRadius: optionsSeparatorRadiusPx(),
      }}
    />
  );
}
