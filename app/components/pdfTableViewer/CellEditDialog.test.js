import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CellEditDialog from 'components/pdfTableViewer/CellEditDialog';
// reviewEditUtils and RoundIconButton are REAL collaborators here: the point of
// several of these tests is that the dialog agrees with the helpers about which
// source a cell names and where the dialog belongs, which a mock would hide.
import {
  cellSourceKey,
  dialogPlacement,
  draggedPosition,
  findSourceValue,
} from 'components/pdfTableViewer/reviewEditUtils';
import { confidenceLabel } from 'components/pdfTableViewer/reviewUtils';
// Config is MOCKED with sentinels, and every expectation is derived by CALLING the
// mocked accessor rather than by naming a literal, so a change to a real constant
// can never fail a test here.
import {
  cellEditCancelHelpId,
  cellEditConfidenceHelpId,
  cellEditConfirmHelpId,
  cellEditImageHelpId,
  cellEditImageLoadingHeightPx,
  cellEditImageSpinnerSizePx,
  cellEditNextHelpId,
  confirmColour,
  maxCellEditorImageHeight,
  reviewCellEditDialogWidthPx,
} from 'config';

jest.mock('config', () => ({
  __esModule: true,
  // Real apart from the six sentinels below, so that any other constant the dialog or
  // its real collaborators read is the real one rather than undefined.
  ...jest.requireActual('config'),
  cancelColour: jest.fn(() => 'rgb(9, 0, 0)'),
  confirmColour: jest.fn(() => 'rgb(0, 9, 0)'),
  // Deliberately wide enough that the stubbed viewport below leaves room on only one
  // side of some anchors, so the placement tests exercise both sides of the rule.
  reviewCellEditDialogWidthPx: jest.fn(() => 220),
  maxCellEditorImageHeight: jest.fn(() => 66),
  cellEditImageSpinnerSizePx: jest.fn(() => 18),
  cellEditImageLoadingHeightPx: jest.fn(() => 33),
}));

// jsdom implements no PointerEvent, so fireEvent falls back to a bare Event whose
// clientX/clientY are undefined and every drag arrives as NaN. A MouseEvent subclass is
// enough: it carries the coordinates, and pointerId is the only other field the dialog
// reads. Declared here rather than in a global setup because this is the only suite that
// drags anything.
class TestPointerEvent extends MouseEvent {
  constructor(type, props = {}) {
    super(type, props);
    this.pointerId = props.pointerId;
  }
}
window.PointerEvent = TestPointerEvent;

const bounds = (left, top, width, height) => ({ left, top, width, height });

// One table standing in for the editor's locally held metadata: two cells at
// distinct positions and two section titles, each carrying its own page-fraction
// bounds so a wrong lookup produces a visibly wrong rectangle.
const rootTable = {
  tableId: 'root',
  pdfPage: 3,
  cells: [
    {
      row: 0,
      column: 0,
      text: 'Claim',
      confidence: 99,
      bounds: bounds(0.1, 0.2, 0.3, 0.04),
    },
    {
      row: 1,
      column: 2,
      text: 'ABC Ltd',
      confidence: 97,
      bounds: bounds(0.11, 0.21, 0.31, 0.05),
    },
  ],
  sectionTitles: [
    {
      tableRow: 0,
      columnName: 'Policy',
      data: {
        text: 'Section A',
        confidence: 88,
        bounds: bounds(0.5, 0.6, 0.2, 0.03),
      },
    },
    {
      tableRow: 4,
      columnName: 'Policy',
      data: {
        text: 'Section B',
        confidence: 89,
        bounds: bounds(0.51, 0.61, 0.21, 0.031),
      },
    },
  ],
  next: {},
};

const tables = [rootTable];

const ordinaryCell = {
  tableId: 'root',
  row: 1,
  column: 2,
  text: 'ABC Ltd',
  confidence: 97,
};
const otherCell = {
  tableId: 'root',
  row: 0,
  column: 0,
  text: 'Claim',
  confidence: 99,
};
// Index 1, not 0, so an implementation that hard-wires the first section title fails.
const sectionTitleCell = {
  tableId: 'root',
  sectionTitleIndex: 1,
  text: 'Section B',
  confidence: 89,
};
const sourcelessCell = {
  tableId: '',
  row: 0,
  column: 0,
  text: 'no source',
  confidence: 0,
};

// The two crops of one cell, as the panel caches them. The processed payload is kept
// distinct from the raw one so that the assertions can prove it is NOT what reaches the
// screen — the dialog shows the raw crop and nothing else.
const bothImages = { raw: 'UkFX', processed: 'UFJPQw==' };

const anchorRect = {
  left: 400,
  top: 500,
  right: 460,
  bottom: 520,
  width: 60,
  height: 20,
};

// The viewport is stubbed so the expected placement is computed from known numbers;
// the expectation itself still calls the real dialogPlacement.
const viewportWidth = 500;
const viewportHeight = 640;

let onRequestImage;
let onCancel;
let onConfirm;
let onConfirmAndNext;

const renderDialog = (props = {}) =>
  render(
    <CellEditDialog
      pdfId={'pdf-1'}
      cell={ordinaryCell}
      tables={tables}
      reviewedTableId={'root'}
      anchorRect={anchorRect}
      onRequestImage={onRequestImage}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onConfirmAndNext={onConfirmAndNext}
      {...props}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  onRequestImage = jest.fn();
  onCancel = jest.fn();
  onConfirm = jest.fn();
  onConfirmAndNext = jest.fn();
  window.innerWidth = viewportWidth;
  window.innerHeight = viewportHeight;
});

describe('CellEditDialog', () => {
  // The correction is typed into the CELL now, so the dialog must carry no field of its
  // own: two places to type one value is one too many, and the second would be the one
  // the tick did not read.
  it('holds no text field of its own', () => {
    renderDialog();

    expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('cell-edit-text')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it("states the cell's confidence under the buttons", () => {
    renderDialog();

    const confidence = screen.getByTestId('cell-edit-confidence');
    expect(confidence).toHaveTextContent(confidenceLabel(ordinaryCell.confidence));
    // Under, not over: the buttons come first in document order within the dialog.
    const dialog = screen.getByTestId('cell-edit-dialog');
    const children = Array.from(dialog.children);
    expect(children.indexOf(confidence)).toBeGreaterThan(
      children.indexOf(screen.getByTestId('cell-edit-buttons'))
    );
  });

  it('states the confidence of whichever cell it is showing', () => {
    renderDialog({ cell: sectionTitleCell });

    expect(screen.getByTestId('cell-edit-confidence')).toHaveTextContent(
      confidenceLabel(sectionTitleCell.confidence)
    );
  });

  it('requests the image once, for the source cell of the source table', () => {
    renderDialog();

    expect(onRequestImage).toHaveBeenCalledTimes(1);
    expect(onRequestImage).toHaveBeenCalledWith({
      key: cellSourceKey(ordinaryCell),
      page: rootTable.pdfPage,
      bounds: findSourceValue(rootTable, ordinaryCell).bounds,
      width: anchorRect.width,
    });
  });

  it('keys the request differently for a different cell of the same table', () => {
    const { unmount } = renderDialog();
    unmount();
    renderDialog({ cell: otherCell });

    expect(onRequestImage).toHaveBeenCalledTimes(2);
    const [first, second] = onRequestImage.mock.calls.map(([request]) => request);
    expect(second.key).not.toBe(first.key);
    expect(second.bounds).toEqual(findSourceValue(rootTable, otherCell).bounds);
  });

  it("requests the bounds of a section title's own data", () => {
    renderDialog({ cell: sectionTitleCell });

    expect(onRequestImage).toHaveBeenCalledTimes(1);
    expect(onRequestImage).toHaveBeenCalledWith({
      key: cellSourceKey(sectionTitleCell),
      page: rootTable.pdfPage,
      bounds: rootTable.sectionTitles[1].data.bounds,
      width: anchorRect.width,
    });
  });

  // The untouched crop is the one the dialog shows, and it shows only that one.
  it('renders the raw image as a base64 png and asks for no other', () => {
    renderDialog({ image: bothImages });

    expect(screen.getByTestId('cell-edit-image')).toHaveAttribute(
      'src',
      `data:image/png;base64,${bothImages.raw}`
    );
    expect(onRequestImage).not.toHaveBeenCalled();
  });

  // There is no longer a choice of crop to offer, so there must be no control offering
  // one: a re-added toggle fails here rather than passing unnoticed.
  it('renders no raw switch', () => {
    renderDialog({ image: bothImages });

    expect(
      screen.queryByTestId('cell-edit-raw-toggle')
    ).not.toBeInTheDocument();
  });

  // A tall crop must not push the buttons off the bottom of the dialog, so the image
  // area is capped and scrolls instead of growing.
  it('caps the image area at the configured height and scrolls it', () => {
    renderDialog({ image: bothImages });

    const area = screen.getByTestId('cell-edit-image').parentElement;
    expect(area).toHaveStyle({
      maxHeight: `${maxCellEditorImageHeight()}px`,
      overflowY: 'auto',
    });
  });

  // The crop must never be distorted. A flex image area was: the img became a flex item, so
  // the default `align-items: stretch` compressed it to the capped height instead of
  // overflowing into a scrollbar, and the default `flex-shrink: 1` narrowed it independently
  // of that — each axis set on its own, which is exactly what squashes a picture. The area is
  // therefore an ordinary block, and the img scales on width alone with the height following.
  it('scales the crop on width alone, never stretching it to the area', () => {
    renderDialog({ image: bothImages });

    const image = screen.getByTestId('cell-edit-image');
    expect(image).toHaveStyle({ maxWidth: '100%', height: 'auto' });
    // Not a flex container: nothing may set the crop's height or width independently.
    expect(screen.getByTestId('cell-edit-image').parentElement).toHaveStyle({
      display: 'block',
    });
  });

  // Only the raw crop is displayed, so a response that carried just the processed one has
  // nothing to show — and there is deliberately no falling back to it. The dialog stays up
  // regardless: the image is a convenience and the edit is the point.
  it('renders no image when the response carried no raw crop', () => {
    renderDialog({ image: { processed: bothImages.processed } });

    expect(screen.getByTestId('cell-edit-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('cell-edit-image')).not.toBeInTheDocument();
  });

  it('renders no image element while the image is unresolved', () => {
    renderDialog();

    expect(screen.queryByTestId('cell-edit-image')).not.toBeInTheDocument();
  });

  // Three states, not two: the panel writes null when the fetch failed, so an empty area
  // that will never fill can be told from one that is still being waited on.
  describe('while the crop is being fetched', () => {
    it('spins for a cell whose source resolves and whose crop has not arrived', () => {
      renderDialog();

      expect(screen.getByTestId('cell-edit-image-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('cell-edit-image')).not.toBeInTheDocument();
    });

    it('reserves the configured height while it spins, so the dialog does not jump', () => {
      renderDialog();

      const area = screen.getByTestId('cell-edit-image-loading').parentElement;
      expect(area).toHaveStyle({
        minHeight: `${cellEditImageLoadingHeightPx()}px`,
        display: 'flex',
      });
    });

    it('sizes the spinner from config', () => {
      renderDialog();

      const spinner = screen.getByTestId('cell-edit-image-loading');
      expect(spinner).toHaveStyle({
        width: `${cellEditImageSpinnerSizePx()}px`,
        height: `${cellEditImageSpinnerSizePx()}px`,
      });
    });

    // A recorded null is an ANSWER — the fetch failed — so the dialog stops waiting.
    it('stops spinning once the panel records that there is no crop', () => {
      renderDialog({ image: null });

      expect(
        screen.queryByTestId('cell-edit-image-loading')
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('cell-edit-image')).not.toBeInTheDocument();
    });

    it('stops spinning once the crop arrives', () => {
      renderDialog({ image: bothImages });

      expect(
        screen.queryByTestId('cell-edit-image-loading')
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('cell-edit-image')).toBeInTheDocument();
    });

    // Nothing was asked for, so there is nothing to wait for.
    it('does not spin for a cell with no source', () => {
      renderDialog({ cell: sourcelessCell });

      expect(
        screen.queryByTestId('cell-edit-image-loading')
      ).not.toBeInTheDocument();
      expect(onRequestImage).not.toHaveBeenCalled();
    });

    it('does not spin when the source table is not among the tables', () => {
      renderDialog({ tables: [] });

      expect(
        screen.queryByTestId('cell-edit-image-loading')
      ).not.toBeInTheDocument();
      expect(onRequestImage).not.toHaveBeenCalled();
    });
  });

  it('requests nothing for a cell with no source', () => {
    renderDialog({ cell: sourcelessCell });

    expect(onRequestImage).not.toHaveBeenCalled();
  });

  it('requests nothing when the source table is not among the tables', () => {
    renderDialog({ tables: [] });

    expect(onRequestImage).not.toHaveBeenCalled();
  });

  it('calls onCancel alone when the cancel button is clicked', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('cell-edit-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // The dialog reports that the correction was accepted and nothing more: the text is
  // the panel's, typed into the cell, so passing one back would be passing back a copy
  // the dialog never saw change.
  it('calls onConfirm alone when the confirm button is clicked', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('cell-edit-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // "Confirm and next" is the same save with something else done afterwards, so the dialog
  // reports it separately and leaves the panel — which alone knows what "next" is — to
  // decide where that goes.
  it('calls onConfirmAndNext, and not the plain confirm', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('cell-edit-confirm-next'));

    expect(onConfirmAndNext).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // With no field to sit beside, all three buttons share one row of their own.
  it('keeps the three buttons together on one row', () => {
    renderDialog();

    const buttons = screen.getByTestId('cell-edit-buttons');
    for (const id of [
      'cell-edit-cancel',
      'cell-edit-confirm',
      'cell-edit-confirm-next',
    ]) {
      expect(buttons).toContainElement(screen.getByTestId(id));
    }
    expect(buttons).toHaveStyle({ display: 'flex', alignItems: 'center' });
  });

  it('labels the next button and gives it the confirm colour', () => {
    renderDialog();

    const next = screen.getByTestId('cell-edit-confirm-next');
    expect(next).toHaveTextContent('Next');
    expect(next).toHaveStyle({ backgroundColor: confirmColour() });
  });

  it('disables next for a cell with no source, exactly as it disables confirm', async () => {
    renderDialog({ cell: sourcelessCell });

    const next = screen.getByTestId('cell-edit-confirm-next');
    expect(next).toBeDisabled();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(next);
    expect(onConfirmAndNext).not.toHaveBeenCalled();
  });

  it('disables confirm for a cell with no source, leaving cancel as the only exit', async () => {
    renderDialog({ cell: sourcelessCell });

    const confirm = screen.getByTestId('cell-edit-confirm');
    expect(confirm).toBeDisabled();

    // MUI disables a button with `pointer-events: none`, which user-event would
    // otherwise refuse to click at all — the point here is that the click reaches
    // the DOM and still invokes nothing.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('cell-edit-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('positions itself where dialogPlacement puts it, at the configured width', () => {
    renderDialog();

    const dialog = screen.getByTestId('cell-edit-dialog');
    const expected = dialogPlacement(
      anchorRect,
      {
        width: reviewCellEditDialogWidthPx(),
        height: dialog.offsetHeight,
      },
      { width: window.innerWidth, height: window.innerHeight }
    );
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.left).toBe(`${expected.left}px`);
    expect(dialog.style.top).toBe(`${expected.top}px`);
    expect(dialog.style.width).toBe(`${reviewCellEditDialogWidthPx()}px`);
  });

  // The dialog is bottom-aligned with the cell and put BESIDE it, because the cell now
  // holds the field the correction is typed into and must stay visible. jsdom reports
  // every element 0px tall, so the height is stubbed to make the alignment observable.
  describe('placement beside the cell', () => {
    const dialogHeight = 120;
    let heightSpy;

    beforeEach(() => {
      heightSpy = jest
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(dialogHeight);
    });

    afterEach(() => {
      heightSpy.mockRestore();
    });

    const positionOf = () => {
      const dialog = screen.getByTestId('cell-edit-dialog');
      return { left: dialog.style.left, top: dialog.style.top };
    };

    it("lands its bottom right corner on the cell's bottom left corner", () => {
      renderDialog();

      const expected = dialogPlacement(
        anchorRect,
        { width: reviewCellEditDialogWidthPx(), height: dialogHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      expect(expected.placement).toBe('left');
      expect(positionOf()).toEqual({
        left: `${anchorRect.left - reviewCellEditDialogWidthPx()}px`,
        top: `${anchorRect.bottom - dialogHeight}px`,
      });
    });

    it("lands its bottom left corner on the cell's bottom right corner when the left will not fit", () => {
      // Near the left edge: 100 - 220 is off the screen, and 160 + 220 is not.
      const nearLeft = {
        left: 100,
        top: 500,
        right: 160,
        bottom: 520,
        width: 60,
        height: 20,
      };
      renderDialog({ anchorRect: nearLeft });

      expect(positionOf()).toEqual({
        left: `${nearLeft.right}px`,
        top: `${nearLeft.bottom - dialogHeight}px`,
      });
    });

    it('comes down the screen until it fits when the cell is too high for it', () => {
      const high = {
        left: 400,
        top: 10,
        right: 460,
        bottom: 30,
        width: 60,
        height: 20,
      };
      renderDialog({ anchorRect: high });

      // Bottom-aligning would put the top at -90, so it settles at the top instead.
      expect(positionOf()).toEqual({
        left: `${high.left - reviewCellEditDialogWidthPx()}px`,
        top: '0px',
      });
    });
  });

  // The crop is requested at the cell's own width, so it arrives about the size it should
  // be shown at. Pinning a width here would only rescale it; the cap on the width is what
  // stops a crop wider than the dialog spilling out of it, and the automatic height is
  // what keeps a capped crop in proportion.
  it('renders the image at its natural size, without overflowing the dialog', () => {
    renderDialog({ image: bothImages });

    const image = screen.getByTestId('cell-edit-image');
    expect(image.style.width).toBe('');
    expect(image.style.maxWidth).toBe('100%');
    expect(image.style.height).toBe('auto');
  });

  // The computed placement can only ever be a guess at where the user wants the dialog:
  // it may sit over the very row being compared against the crop. Dragging is the escape.
  describe('dragging', () => {
    const dragHandle = () => screen.getByTestId('cell-edit-drag');

    const placedAt = (dialog) =>
      dialogPlacement(
        anchorRect,
        { width: reviewCellEditDialogWidthPx(), height: dialog.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );

    const drag = (from, to) => {
      fireEvent.pointerDown(dragHandle(), {
        clientX: from.x,
        clientY: from.y,
        pointerId: 1,
      });
      fireEvent.pointerMove(dragHandle(), {
        clientX: to.x,
        clientY: to.y,
        pointerId: 1,
      });
    };

    it('moves with the pointer while the handle is held', () => {
      renderDialog();
      const dialog = screen.getByTestId('cell-edit-dialog');
      const start = placedAt(dialog);

      drag({ x: 100, y: 100 }, { x: 130, y: 60 });

      const expected = draggedPosition(
        { ...start, pointerX: 100, pointerY: 100 },
        { x: 130, y: 60 },
        { width: reviewCellEditDialogWidthPx(), height: dialog.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      expect(dialog.style.left).toBe(`${expected.left}px`);
      expect(dialog.style.top).toBe(`${expected.top}px`);
      // It really moved — the drag is not a no-op dressed up as one.
      expect(dialog.style.top).not.toBe(`${start.top}px`);
    });

    it('stops following once the handle is released', () => {
      renderDialog();
      const dialog = screen.getByTestId('cell-edit-dialog');

      drag({ x: 100, y: 100 }, { x: 130, y: 60 });
      const settled = { left: dialog.style.left, top: dialog.style.top };
      fireEvent.pointerUp(dragHandle(), { pointerId: 1 });
      fireEvent.pointerMove(dragHandle(), {
        clientX: 400,
        clientY: 400,
        pointerId: 1,
      });

      expect(dialog.style.left).toBe(settled.left);
      expect(dialog.style.top).toBe(settled.top);
    });

    it('ignores a pointer move that no drag started', () => {
      renderDialog();
      const dialog = screen.getByTestId('cell-edit-dialog');
      const start = placedAt(dialog);

      fireEvent.pointerMove(dragHandle(), {
        clientX: 400,
        clientY: 400,
        pointerId: 1,
      });

      expect(dialog.style.left).toBe(`${start.left}px`);
      expect(dialog.style.top).toBe(`${start.top}px`);
    });

    it('goes back to the computed placement when a different cell is opened', () => {
      const { rerender } = renderDialog();
      const dialog = screen.getByTestId('cell-edit-dialog');
      const start = placedAt(dialog);

      drag({ x: 100, y: 100 }, { x: 130, y: 60 });
      expect(dialog.style.top).not.toBe(`${start.top}px`);

      rerender(
        <CellEditDialog
          pdfId={'pdf-1'}
          cell={otherCell}
          tables={tables}
          reviewedTableId={'root'}
          anchorRect={anchorRect}
          onRequestImage={onRequestImage}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );

      expect(dialog.style.left).toBe(`${start.left}px`);
      expect(dialog.style.top).toBe(`${start.top}px`);
    });

    it('does not confirm or cancel just because it was dragged', () => {
      renderDialog();

      drag({ x: 100, y: 100 }, { x: 130, y: 60 });
      fireEvent.pointerUp(dragHandle(), { pointerId: 1 });

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  // The dialog reports no help screen of its own; what it does for help is annotate its
  // parts, which the review screen's tips then describe. The ids come from config, which
  // is where the copy module takes them too, so a literal appears on neither side.
  describe('what help can point at', () => {
    it.each([
      ['cell-edit-image-pane', cellEditImageHelpId],
      ['cell-edit-cancel', cellEditCancelHelpId],
      ['cell-edit-confirm', cellEditConfirmHelpId],
      ['cell-edit-confirm-next', cellEditNextHelpId],
      ['cell-edit-confidence', cellEditConfidenceHelpId],
    ])('annotates %s', (testId, helpId) => {
      renderDialog({ image: bothImages });

      expect(screen.getByTestId(testId)).toHaveAttribute(
        'data-help-id',
        helpId()
      );
    });

    // The crop pane is annotated rather than the img, so a cell whose crop has not
    // arrived — or that never had one — still has something for the tip to point at.
    it('annotates the crop pane even where there is no crop', () => {
      renderDialog({ cell: sourcelessCell });

      expect(screen.getByTestId('cell-edit-image-pane')).toHaveAttribute(
        'data-help-id',
        cellEditImageHelpId()
      );
    });
  });
});
