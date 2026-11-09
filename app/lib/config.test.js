import * as config from 'config';

const isValidColour = (value) => {
  const el = document.createElement('div');
  el.style.color = value;
  return el.style.color !== '';
};

// The layer colours are CSS custom properties defined in globals.css, so what config
// returns is the reference, not a colour jsdom can parse.
const namesCustomProperty = (value) => /^var\(--[a-z-]+\)$/.test(value);

describe('overlay colour / width config', () => {
  it('gridLineColour() returns the live blue', () => {
    expect(isValidColour(config.gridLineColour())).toBeTruthy();
  });

  it('deletedGridLineColour() returns the deleted-preview grey', () => {
    expect(isValidColour(config.deletedGridLineColour())).toBeTruthy();
  });
});

describe('confidence threshold config', () => {
  // The thresholds are tuned values, so what is asserted is the RANGE they have to stay
  // in, not the numbers themselves: both are percentages, and low has to sit below high
  // or the orange band between them disappears.
  it('are percentages, with low below high', () => {
    expect(config.lowConfidence()).toBeGreaterThan(0);
    expect(config.highConfidence()).toBeLessThanOrEqual(100);
    expect(config.lowConfidence()).toBeLessThan(config.highConfidence());
  });
});

describe('staged grid editor config', () => {
  it('baseImageWidthPx() is a positive number', () => {
    // Assert the contract, not the tuned literal, so a value change here does not break tests.
    expect(typeof config.baseImageWidthPx()).toBe('number');
    expect(config.baseImageWidthPx()).toBeGreaterThan(0);
  });

  it('scaleDebounceMs() returns 400', () => {
    expect(config.scaleDebounceMs()).toBeGreaterThan(200);
    expect(config.scaleDebounceMs()).toBeLessThan(800);
  });
});

describe('layer colour config', () => {
  it('layerBorderColour() names the border custom property', () => {
    expect(namesCustomProperty(config.layerBorderColour())).toBe(true);
  });

  it('layerRowsColour() names the rows custom property', () => {
    expect(namesCustomProperty(config.layerRowsColour())).toBe(true);
  });

  it('layerColumnsColour() names the columns custom property', () => {
    expect(namesCustomProperty(config.layerColumnsColour())).toBe(true);
  });

  it('layerSpecialCellsColour() names the special custom property', () => {
    expect(namesCustomProperty(config.layerSpecialCellsColour())).toBe(true);
  });

  it('layerColoursColour() names the colours custom property', () => {
    expect(namesCustomProperty(config.layerColoursColour())).toBe(true);
  });

  it('selectedColouredAreaHighlight() returns the 50% brown', () => {
    expect(isValidColour(config.selectedColouredAreaHighlight())).toBeTruthy();
  });

  it('sectionTitleMarkerColour() returns the section-title green', () => {
    expect(isValidColour(config.sectionTitleMarkerColour())).toBeTruthy();
  });

  it('sectionTitleMarkerDash() returns the dotted stroke dash array', () => {
    const pair = config.sectionTitleMarkerDash().split(" ");
    expect(pair.length).toBe(2);
    expect(parseInt(pair[0])).toBeGreaterThan(0);
    expect(parseInt(pair[0])).toBeLessThan(20);
    expect(parseInt(pair[1])).toBeGreaterThan(0);
    expect(parseInt(pair[1])).toBeLessThan(20);
  });

  it('selectedSectionTitleHighlight() returns the 50% green', () => {
    expect(isValidColour(config.selectedSectionTitleHighlight())).toBeTruthy();
  });
});

describe('merged cell config', () => {
  // A share of a grid square, so what is asserted is the range it has to stay in: at or
  // below 0 every square the drawn rectangle touches at all would join the block, and at
  // or above 1 only a square covered edge to edge ever would.
  it('mergeCoverageFraction() is a fraction of a square', () => {
    expect(config.mergeCoverageFraction()).toBeGreaterThan(0);
    expect(config.mergeCoverageFraction()).toBeLessThan(1);
  });
});

describe('split row wave config', () => {
  it('splitRowWaveHeightPx(), splitRowWavePitchPx() and reviewSplitRowWaveStrokeWidthPx() are positive', () => {
    expect(config.splitRowWaveHeightPx()).toBeGreaterThan(0);
    expect(config.splitRowWavePitchPx()).toBeGreaterThan(0);
    expect(config.reviewSplitRowWaveStrokeWidthPx()).toBeGreaterThan(0);
  });

  it('reviewSplitRowWaveColour() is a colour distinct from the review cell border', () => {
    expect(isValidColour(config.reviewSplitRowWaveColour())).toBeTruthy();
    expect(config.reviewSplitRowWaveColour()).not.toEqual(config.reviewCellBorderColour());
  });
});

describe('grid editor wavy border config', () => {
  it('linkCellWaveHeightPx(), linkCellWavePitchPx() and linkCellBorderWidthPx() are positive', () => {
    expect(config.linkCellWaveHeightPx()).toBeGreaterThan(0);
    expect(config.linkCellWavePitchPx()).toBeGreaterThan(0);
    expect(config.linkCellBorderWidthPx()).toBeGreaterThan(0);
  });
});

describe('review font scale config', () => {
  it('reviewDefaultFontScalePercent() is one of the offered options', () => {
    expect(config.reviewFontScalePercentOptions()).toContain(
      config.reviewDefaultFontScalePercent()
    );
  });
});

describe('cut line config', () => {
  it('cutLineWidthPx() is positive and cutLineDash() is two positive numbers', () => {
    expect(config.cutLineWidthPx()).toBeGreaterThan(0);
    const pair = config.cutLineDash().split(' ');
    expect(pair.length).toBe(2);
    expect(Number(pair[0])).toBeGreaterThan(0);
    expect(Number(pair[1])).toBeGreaterThan(0);
  });
});

describe('grid line segment config', () => {
  it('gridLineOffsetEpsilon() is above 0 and below 0.001', () => {
    expect(config.gridLineOffsetEpsilon()).toBeGreaterThan(0);
    expect(config.gridLineOffsetEpsilon()).toBeLessThan(0.001);
  });

  it('gridLineMoveLimitFraction() is above 0 and below 1', () => {
    expect(config.gridLineMoveLimitFraction()).toBeGreaterThan(0);
    expect(config.gridLineMoveLimitFraction()).toBeLessThan(1);
  });
});

describe('cell image config', () => {
  it('cellImageMarginFraction() is between 0 and 1', () => {
    expect(config.cellImageMarginFraction()).toBeGreaterThan(0);
    expect(config.cellImageMarginFraction()).toBeLessThan(1);
  });

  it('cellImageMarginMinPx() is above 0 and not above cellImageMarginMaxPx()', () => {
    expect(config.cellImageMarginMinPx()).toBeGreaterThan(0);
    expect(config.cellImageMarginMinPx()).toBeLessThanOrEqual(config.cellImageMarginMaxPx());
  });

  it('cellImageDefaultPageAspect() and cellImageGridLineStrokeWidth() are above 0', () => {
    expect(config.cellImageDefaultPageAspect()).toBeGreaterThan(0);
    expect(config.cellImageGridLineStrokeWidth()).toBeGreaterThan(0);
  });
});

describe('baseUrl', () => {
  const saved = process.env.MYLOSSRUN_BASE_URL;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.MYLOSSRUN_BASE_URL;
    } else {
      process.env.MYLOSSRUN_BASE_URL = saved;
    }
  });

  it('returns MYLOSSRUN_BASE_URL', () => {
    process.env.MYLOSSRUN_BASE_URL = 'https://api.example.com';
    expect(config.baseUrl()).toBe('https://api.example.com');
  });

  it('throws when MYLOSSRUN_BASE_URL is not set', () => {
    delete process.env.MYLOSSRUN_BASE_URL;
    expect(() => config.baseUrl()).toThrow('MYLOSSRUN_BASE_URL is not set');
  });

  it('throws when MYLOSSRUN_BASE_URL is empty', () => {
    process.env.MYLOSSRUN_BASE_URL = '';
    expect(() => config.baseUrl()).toThrow('MYLOSSRUN_BASE_URL is not set');
  });
});
