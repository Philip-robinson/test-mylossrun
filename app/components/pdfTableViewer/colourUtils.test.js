import {
  rgbToHex,
  hexToRgb,
  invertHex,
  rgbaToPixels,
  analysePeakColours,
} from 'components/pdfTableViewer/colourUtils';

// Build N pixels of one { r, g, b } colour.
const fill = (n, c) => Array.from({ length: n }, () => ({ ...c }));

describe('colourUtils', () => {
  describe('hex <-> rgb', () => {
    it('rgbToHex formats and clamps channels', () => {
      expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
      expect(rgbToHex({ r: 255, g: 165, b: 0 })).toBe('#ffa500');
      expect(rgbToHex({ r: 300, g: -5, b: 16 })).toBe('#ff0010');
    });

    it('hexToRgb parses with or without a leading hash, black on garbage', () => {
      expect(hexToRgb('#ffa500')).toEqual({ r: 255, g: 165, b: 0 });
      expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('invertHex returns the opposite colour', () => {
      expect(invertHex('#000000')).toBe('#ffffff');
      expect(invertHex('#ffffff')).toBe('#000000');
      expect(invertHex('#ff0000')).toBe('#00ffff');
    });
  });

  describe('rgbaToPixels', () => {
    it('drops alpha and groups into rgb triples', () => {
      const data = [10, 20, 30, 255, 40, 50, 60, 128];
      expect(rgbaToPixels(data)).toEqual([
        { r: 10, g: 20, b: 30 },
        { r: 40, g: 50, b: 60 },
      ]);
    });
  });

  describe('analysePeakColours', () => {
    it('two peaks: highest is background, next is foreground', () => {
      // 60 near-white, 40 near-black -> two peaks; white is more frequent.
      const pixels = [
        ...fill(60, { r: 250, g: 250, b: 250 }),
        ...fill(40, { r: 5, g: 5, b: 5 }),
      ];
      const { background, foreground } = analysePeakColours(pixels);
      expect(background).toBe('#fafafa');
      expect(foreground).toBe('#050505');
    });

    it('single clear peak: background is the peak, foreground its opposite', () => {
      // 95 red, 5 scattered -> only red is a peak.
      const pixels = [
        ...fill(95, { r: 255, g: 0, b: 0 }),
        { r: 1, g: 2, b: 3 },
        { r: 9, g: 200, b: 30 },
        { r: 40, g: 40, b: 200 },
        { r: 120, g: 15, b: 250 },
        { r: 200, g: 180, b: 8 },
      ];
      const { background, foreground } = analysePeakColours(pixels);
      expect(background).toBe('#ff0000');
      expect(foreground).toBe(invertHex('#ff0000')); // #00ffff
    });

    it('no clear peak: darkest is background, lightest is foreground', () => {
      // Every pixel a distinct colour, none reaching 15% -> fall back to lum extremes.
      const pixels = [
        { r: 10, g: 10, b: 10 }, // darkest
        { r: 250, g: 250, b: 250 }, // lightest
        { r: 200, g: 20, b: 20 },
        { r: 20, g: 200, b: 20 },
        { r: 20, g: 20, b: 200 },
        { r: 200, g: 200, b: 20 },
        { r: 20, g: 200, b: 200 },
        { r: 200, g: 20, b: 200 },
      ];
      const { background, foreground } = analysePeakColours(pixels);
      expect(background).toBe('#0a0a0a');
      expect(foreground).toBe('#fafafa');
    });

    it('empty input returns white/black defaults', () => {
      expect(analysePeakColours([])).toEqual({
        background: '#ffffff',
        foreground: '#000000',
      });
    });
  });
});
