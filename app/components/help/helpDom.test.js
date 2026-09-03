import { helpButtonHelpId } from 'config';
import { helpIdChainsAt, measureHelpTarget } from 'components/help/helpDom';

// elementsFromPoint is unimplemented in this project's jsdom, so the hit list is
// stubbed onto the document and removed again afterwards.
function stubElementsFromPoint(elements) {
  document.elementsFromPoint = () => elements;
}

afterEach(() => {
  delete document.elementsFromPoint;
  document.body.innerHTML = '';
});

describe('measureHelpTarget', () => {
  it('answers a rect for an annotated element that is present', () => {
    document.body.innerHTML = `<div data-help-id="${helpButtonHelpId()}"></div>`;

    expect(measureHelpTarget(helpButtonHelpId())).toEqual(expect.any(Object));
  });

  it('answers nothing when no element carries the id', () => {
    document.body.innerHTML = '<div></div>';

    expect(measureHelpTarget(helpButtonHelpId())).toBeNull();
  });

  it('answers nothing when no id is asked for', () => {
    expect(measureHelpTarget(null)).toBeNull();
  });
});

describe('helpIdChainsAt', () => {
  it('collects an element and its annotated ancestors innermost first', () => {
    document.body.innerHTML = `
      <div data-help-id="outer">
        <div data-help-id="inner">
          <span id="leaf"></span>
        </div>
      </div>
    `;
    stubElementsFromPoint([document.getElementById('leaf')]);

    expect(helpIdChainsAt(10, 20)).toEqual([['inner', 'outer']]);
  });

  it('names the element itself first when it is annotated', () => {
    document.body.innerHTML = `
      <div data-help-id="outer">
        <div data-help-id="inner" id="leaf"></div>
      </div>
    `;
    stubElementsFromPoint([document.getElementById('leaf')]);

    expect(helpIdChainsAt(10, 20)).toEqual([['inner', 'outer']]);
  });

  it('keeps one chain per hit, in hit order', () => {
    document.body.innerHTML = `
      <div data-help-id="on-top" id="top"></div>
      <div data-help-id="behind" id="behind"></div>
    `;
    stubElementsFromPoint([
      document.getElementById('top'),
      document.getElementById('behind'),
    ]);

    expect(helpIdChainsAt(10, 20)).toEqual([['on-top'], ['behind']]);
  });

  it('drops a hit whose chain holds no annotated element', () => {
    document.body.innerHTML = `
      <span id="bare"></span>
      <div data-help-id="annotated" id="annotated"></div>
    `;
    stubElementsFromPoint([
      document.getElementById('bare'),
      document.getElementById('annotated'),
    ]);

    expect(helpIdChainsAt(10, 20)).toEqual([['annotated']]);
  });

  it("discards the overlay's own elements", () => {
    document.body.innerHTML = `
      <div data-help-layer="true" data-help-id="scrim">
        <div id="card"></div>
      </div>
      <div data-help-id="beneath" id="beneath"></div>
    `;
    stubElementsFromPoint([
      document.getElementById('card'),
      document.getElementById('beneath'),
    ]);

    expect(helpIdChainsAt(10, 20)).toEqual([['beneath']]);
  });

  it('answers nothing when the pointer hits nothing', () => {
    stubElementsFromPoint([]);

    expect(helpIdChainsAt(10, 20)).toEqual([]);
  });

  it('answers nothing when the document cannot hit-test at all', () => {
    expect(typeof document.elementsFromPoint).not.toBe('function');
    expect(helpIdChainsAt(10, 20)).toEqual([]);
  });
});

// An annotated element that takes no pointer events — a label drawn over the page —
// never appears in a hit list, so helpIdChainsAt looks for those by rect. jsdom gives
// every element an all-zero rect, so the rects here are stubbed on.
describe('helpIdChainsAt over elements that take no pointer events', () => {
  function stubRect(element, { left, top, width, height }) {
    element.getBoundingClientRect = () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    });
  }

  it('names an inert element over the point, ahead of what was hit beneath it', () => {
    document.body.innerHTML = `
      <div data-help-id="beneath" id="beneath">
        <div data-help-id="label" id="label" style="pointer-events: none"></div>
      </div>
    `;
    stubRect(document.getElementById('label'), {
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    stubElementsFromPoint([document.getElementById('beneath')]);

    expect(helpIdChainsAt(10, 10)).toEqual([['label', 'beneath'], ['beneath']]);
  });

  it('ignores an inert element the point is outside of', () => {
    document.body.innerHTML = `
      <div data-help-id="label" id="label" style="pointer-events: none"></div>
      <div data-help-id="beneath" id="beneath"></div>
    `;
    stubRect(document.getElementById('label'), {
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    stubElementsFromPoint([document.getElementById('beneath')]);

    expect(helpIdChainsAt(100, 100)).toEqual([['beneath']]);
  });

  it('ignores an inert element that is not laid out', () => {
    document.body.innerHTML = `
      <div data-help-id="label" id="label" style="pointer-events: none"></div>
    `;
    stubElementsFromPoint([]);

    expect(helpIdChainsAt(0, 0)).toEqual([]);
  });

  it('takes the smallest inert element first where two hold the point', () => {
    document.body.innerHTML = `
      <div data-help-id="wide" id="wide" style="pointer-events: none"></div>
      <div data-help-id="narrow" id="narrow" style="pointer-events: none"></div>
    `;
    stubRect(document.getElementById('wide'), {
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    });
    stubRect(document.getElementById('narrow'), {
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    stubElementsFromPoint([]);

    expect(helpIdChainsAt(10, 10)).toEqual([['narrow'], ['wide']]);
  });

  it("discards the overlay's own inert elements", () => {
    document.body.innerHTML = `
      <div data-help-layer="true">
        <div data-help-id="hole" id="hole" style="pointer-events: none"></div>
      </div>
    `;
    stubRect(document.getElementById('hole'), {
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    stubElementsFromPoint([]);

    expect(helpIdChainsAt(10, 10)).toEqual([]);
  });

  it('leaves an element that takes pointer events to the hit test', () => {
    document.body.innerHTML = `
      <div data-help-id="button" id="button"></div>
    `;
    stubRect(document.getElementById('button'), {
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    stubElementsFromPoint([]);

    expect(helpIdChainsAt(10, 10)).toEqual([]);
  });
});
