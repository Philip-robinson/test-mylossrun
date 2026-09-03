'use client';

// The hole the overlay's scrim leaves around the element being described.
//
// It is also the scrim: a box-shadow spread wide enough to cover any viewport paints
// the scrim colour OUTWARD from this one rect, which greys everything else without a
// second element and without a mask.
//
// A screen may name an element that is not mounted, so a null rect is an answer
// rather than an error and nothing at all is drawn.

import { helpHoleRadiusPx, helpHoleShadowSpreadPx, helpScrimColour } from 'config';

export default function HelpHole({ rect, helpId }) {
  if (!rect) {
    return null;
  }

  return (
    <div
      data-testid={'help-hole'}
      data-help-id={helpId}
      style={{
        position: 'fixed',
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${helpHoleRadiusPx()}px`,
        boxShadow: `0 0 0 ${helpHoleShadowSpreadPx()}px ${helpScrimColour()}`,
      }}
    />
  );
}
