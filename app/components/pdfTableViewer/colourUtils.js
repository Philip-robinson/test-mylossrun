'use client';

// Pure colour helpers for the Colours layer of the staged grid editor: hex/rgb
// conversion, inversion, and histogram peak analysis used to guess the
// foreground/background of a mouse-selected page region. No React, no DOM.

// Quantise each channel to 2 bits (4 levels) -> 64 buckets, coarse enough that
// near-identical pixels fall together when looking for dominant colours.
const QUANT_SHIFT = 6;
// A quantised bucket counts as a "peak" when it holds at least this fraction of
// the sampled pixels.
const PEAK_MIN_FRACTION = 0.15;

// Clamp to 0..255 and format one channel as two lowercase hex digits.
function channelHex(value) {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return v.toString(16).padStart(2, '0');
}

// { r, g, b } (0..255) -> '#rrggbb'.
export function rgbToHex({ r, g, b }) {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

// '#rrggbb' (or 'rrggbb') -> { r, g, b }. Returns black on a malformed value.
export function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// The opposite colour: each channel subtracted from 255.
export function invertHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: 255 - r, g: 255 - g, b: 255 - b });
}

// Perceived brightness (0..255) used to pick darkest/lightest.
function luminance({ r, g, b }) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Flatten a canvas RGBA buffer (Uint8ClampedArray or plain array, 4 bytes per
// pixel) into an array of { r, g, b }, dropping alpha.
export function rgbaToPixels(data) {
  const pixels = [];
  for (let i = 0; i + 2 < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

// Guess { background, foreground } (both '#rrggbb') for a set of sampled pixels:
//   - two or more peaks: the highest-count peak is the background, the next the
//     foreground;
//   - exactly one clear peak: it is the background, the foreground is its opposite;
//   - no clear peak: the darkest sampled colour is the background, the lightest the
//     foreground.
// A "peak" is a quantised bucket holding >= PEAK_MIN_FRACTION of the pixels; the
// colour of a peak is the mean of the pixels that fell in it.
export function analysePeakColours(pixels) {
  if (!pixels || pixels.length === 0) {
    return { background: '#ffffff', foreground: '#000000' };
  }
  const buckets = new Map();
  let darkest = null;
  let lightest = null;
  for (const p of pixels) {
    const key =
      ((p.r >> QUANT_SHIFT) << 4) |
      ((p.g >> QUANT_SHIFT) << 2) |
      (p.b >> QUANT_SHIFT);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, sr: 0, sg: 0, sb: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.sr += p.r;
    bucket.sg += p.g;
    bucket.sb += p.b;
    const lum = luminance(p);
    if (darkest === null || lum < darkest.lum) darkest = { lum, p };
    if (lightest === null || lum > lightest.lum) lightest = { lum, p };
  }
  const mean = (bk) => ({
    r: bk.sr / bk.count,
    g: bk.sg / bk.count,
    b: bk.sb / bk.count,
  });
  const total = pixels.length;
  const peaks = [...buckets.values()]
    .filter((bk) => bk.count >= PEAK_MIN_FRACTION * total)
    .sort((a, b) => b.count - a.count);
  if (peaks.length >= 2) {
    return {
      background: rgbToHex(mean(peaks[0])),
      foreground: rgbToHex(mean(peaks[1])),
    };
  }
  if (peaks.length === 1) {
    const background = rgbToHex(mean(peaks[0]));
    return { background, foreground: invertHex(background) };
  }
  return {
    background: rgbToHex(darkest.p),
    foreground: rgbToHex(lightest.p),
  };
}
