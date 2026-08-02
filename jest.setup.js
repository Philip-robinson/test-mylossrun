import '@testing-library/jest-dom';

// jsdom does not implement HTMLCanvasElement#getContext and logs a noisy "Not implemented"
// error to the console every time it is called. The staged grid editor's Colours layer
// draws the page to an offscreen canvas for colour sampling, so this fires in otherwise
// passing tests. Stub getContext to return null — the component already treats a null 2d
// context as "no canvas" and degrades gracefully; tests that need real pixels spy over
// this with jest.spyOn(...).mockReturnValue(...), and mockRestore() restores this stub.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null;
}
