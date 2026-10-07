// Reading and writing the review grid's remembered font scale. The storage is an argument
// so a test can hand in one that is absent or throws; neither ever throws outward.

// The stored percent when it is one of `options`, otherwise `fallback`.
export function readFontScale(storage, key, options, fallback) {
  try {
    const stored = Number(storage.getItem(key));
    return options.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

// Stores the percent, answering whether that stuck.
export function writeFontScale(storage, key, percent) {
  try {
    storage.setItem(key, String(percent));
    return true;
  } catch {
    return false;
  }
}

// The browser's localStorage, or null when it cannot be reached.
export function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
