'use client';

// A wavy line across the bottom edge of a review cell, marking a row joined to the one
// below it. Absolutely positioned, so its cell must be `position: relative`.

import { useId } from 'react';
import { waveCyclePath } from 'components/pdfTableViewer/wavyLineUtils';
import {
  reviewSplitRowWaveColour,
  reviewSplitRowWaveStrokeWidthPx,
  splitRowWaveHeightPx,
  splitRowWavePitchPx,
} from 'config';

export default function SplitRowWave() {
  // Colons from useId are stripped so the id is a plain url() fragment.
  const patternId = `split-row-wave-${useId().replace(/:/g, '')}`;
  const waveHeight = splitRowWaveHeightPx();
  const pitch = splitRowWavePitchPx();
  const strokeWidth = reviewSplitRowWaveStrokeWidthPx();
  const height = waveHeight + strokeWidth;
  return (
    <svg
      data-testid={'review-split-row-wave'}
      aria-hidden={true}
      width={'100%'}
      height={height}
      style={{
        position: 'absolute',
        left: 0,
        bottom: -height / 2,
        width: '100%',
        height,
        pointerEvents: 'none',
        // Above the next row's cells, positioned or not; below the rulers (z-index 2+).
        zIndex: 1,
        overflow: 'visible',
      }}
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits={'userSpaceOnUse'}
          width={pitch}
          height={height}
        >
          <path
            d={waveCyclePath(waveHeight, pitch)}
            transform={`translate(0 ${strokeWidth / 2})`}
            fill={'none'}
            stroke={reviewSplitRowWaveColour()}
            strokeWidth={strokeWidth}
          />
        </pattern>
      </defs>
      <rect width={'100%'} height={height} fill={`url(#${patternId})`} />
    </svg>
  );
}
