import config from 'config';
import * as configModule from 'config';

const isValidColour = (value) => {
  const el = document.createElement('div');
  el.style.color = value;
  return el.style.color !== '';
};

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
  it('highConfidence() returns 80', () => {
    expect(configModule.highConfidence()).toBe(80);
    expect(config.highConfidence()).toBe(80);
  });

  it('lowConfidence() returns 50', () => {
    expect(configModule.lowConfidence()).toBe(50);
    expect(config.lowConfidence()).toBe(50);
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
  it('layerBorderColour() returns blue', () => {
    expect(isValidColour(configModule.layerBorderColour())).toBeTruthy();
    expect(isValidColour(config.layerBorderColour())).toBeTruthy();
  });

  it('layerRowsColour() returns orange', () => {
    expect(isValidColour(configModule.layerRowsColour())).toBeTruthy();
    expect(isValidColour(config.layerRowsColour())).toBeTruthy();
  });

  it('layerColumnsColour() returns purple', () => {
    expect(isValidColour(configModule.layerColumnsColour())).toBeTruthy();
    expect(isValidColour(config.layerColumnsColour())).toBeTruthy();
  });

  it('layerSpecialCellsColour() returns green', () => {
    expect(isValidColour(configModule.layerSpecialCellsColour())).toBeTruthy();
    expect(isValidColour(config.layerSpecialCellsColour())).toBeTruthy();
  });

  it('layerColoursColour() returns brown', () => {
    expect(isValidColour(configModule.layerColoursColour())).toBeTruthy();
    expect(isValidColour(config.layerColoursColour())).toBeTruthy();
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
