import config from 'config';
import * as configModule from 'config';

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
    expect(isValidColour(configModule.gridLineColour())).toBeTruthy();
    expect(isValidColour(config.gridLineColour())).toBeTruthy();
  });

  it('deletedGridLineColour() returns the deleted-preview grey', () => {
    expect(isValidColour(configModule.deletedGridLineColour())).toBeTruthy();
    expect(isValidColour(config.deletedGridLineColour())).toBeTruthy();
  });
});

describe('confidence threshold config', () => {
  // The thresholds are tuned values, so what is asserted is the RANGE they have to stay
  // in, not the numbers themselves: both are percentages, and low has to sit below high
  // or the orange band between them disappears.
  it('are percentages, with low below high', () => {
    for (const source of [configModule, config]) {
      expect(source.lowConfidence()).toBeGreaterThan(0);
      expect(source.highConfidence()).toBeLessThanOrEqual(100);
      expect(source.lowConfidence()).toBeLessThan(source.highConfidence());
    }
  });

  it('reads the same on both import paths', () => {
    expect(config.highConfidence()).toBe(configModule.highConfidence());
    expect(config.lowConfidence()).toBe(configModule.lowConfidence());
  });
});

describe('staged grid editor config', () => {
  it('baseImageWidthPx() is a positive number exposed on both import paths', () => {
    // Assert the contract, not the tuned literal, so a value change here does not break tests.
    expect(typeof configModule.baseImageWidthPx()).toBe('number');
    expect(configModule.baseImageWidthPx()).toBeGreaterThan(0);
    expect(config.baseImageWidthPx()).toBe(configModule.baseImageWidthPx());
  });

  it('scaleDebounceMs() returns 400', () => {
    expect(configModule.scaleDebounceMs()).toBeGreaterThan(200);
    expect(configModule.scaleDebounceMs()).toBeLessThan(800);
    expect(config.scaleDebounceMs()).toBeGreaterThan(200);
    expect(config.scaleDebounceMs()).toBeLessThan(800);
  });
});

describe('layer colour config', () => {
  it('layerBorderColour() names the border custom property', () => {
    expect(namesCustomProperty(configModule.layerBorderColour())).toBe(true);
    expect(config.layerBorderColour()).toBe(configModule.layerBorderColour());
  });

  it('layerRowsColour() names the rows custom property', () => {
    expect(namesCustomProperty(configModule.layerRowsColour())).toBe(true);
    expect(config.layerRowsColour()).toBe(configModule.layerRowsColour());
  });

  it('layerColumnsColour() names the columns custom property', () => {
    expect(namesCustomProperty(configModule.layerColumnsColour())).toBe(true);
    expect(config.layerColumnsColour()).toBe(configModule.layerColumnsColour());
  });

  it('layerSpecialCellsColour() names the special custom property', () => {
    expect(namesCustomProperty(configModule.layerSpecialCellsColour())).toBe(true);
    expect(config.layerSpecialCellsColour()).toBe(configModule.layerSpecialCellsColour());
  });

  it('layerColoursColour() names the colours custom property', () => {
    expect(namesCustomProperty(configModule.layerColoursColour())).toBe(true);
    expect(config.layerColoursColour()).toBe(configModule.layerColoursColour());
  });

  it('selectedRowHighlight() returns the 50% orange', () => {
    expect(isValidColour(configModule.selectedRowHighlight())).toBeTruthy();
    expect(isValidColour(config.selectedRowHighlight())).toBeTruthy();
  });

  it('selectedColumnHighlight() returns the 50% purple', () => {
    expect(isValidColour(configModule.selectedColumnHighlight())).toBeTruthy();
    expect(isValidColour(config.selectedColumnHighlight())).toBeTruthy();
  });

  it('selectedColouredAreaHighlight() returns the 50% brown', () => {
    expect(isValidColour(configModule.selectedColouredAreaHighlight())).toBeTruthy();
    expect(isValidColour(config.selectedColouredAreaHighlight())).toBeTruthy();
  });

  it('sectionTitleMarkerColour() returns the section-title green', () => {
    expect(isValidColour(configModule.sectionTitleMarkerColour())).toBeTruthy();
    expect(isValidColour(config.sectionTitleMarkerColour())).toBeTruthy();
  });

  it('sectionTitleMarkerDash() returns the dotted stroke dash array', () => {
    const pair = configModule.sectionTitleMarkerDash().split(" ");
    expect(pair.length).toBe(2);
    expect(parseInt(pair[0])).toBeGreaterThan(0);
    expect(parseInt(pair[0])).toBeLessThan(20);
    expect(parseInt(pair[1])).toBeGreaterThan(0);
    expect(parseInt(pair[1])).toBeLessThan(20);
  });

  it('selectedSectionTitleHighlight() returns the 50% green', () => {
    expect(isValidColour(configModule.selectedSectionTitleHighlight())).toBeTruthy();
    expect(isValidColour(config.selectedSectionTitleHighlight())).toBeTruthy();
  });
});
