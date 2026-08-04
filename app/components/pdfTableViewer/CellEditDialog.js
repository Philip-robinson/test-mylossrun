'use client';

// The extraction review screen's cell-edit dialog: a small floating box, opened by
// clicking a cell of the merged table, showing that cell as it appears in the PDF
// above an editable copy of the text the extraction read from it. The tick hands the
// corrected text back to the panel; the X changes nothing.
//
// It owns no open state and takes no `open` prop — ReviewTablePanel renders it only
// while a cell is being edited, so mounting IS opening. It also owns no image cache
// and never imports `services/images`: it asks for the crop it needs through
// `onRequestImage` and renders whatever `image` it is handed, which keeps one cache in
// the panel rather than one per short-lived dialog.
//
// `image` is a PAIR — `{ raw, processed }` — mirroring the one response the panel caches,
// but only `raw`, the untouched crop, is displayed. Either member can be absent, so the
// crop is rendered defensively: the image is a convenience, and nothing about it is worth
// taking the dialog down for.
//
// A cell whose source reference is blank (`cellSourceKey` is null) has nothing in the
// metadata to write back to, so there is no rectangle to crop and no correction worth
// taking: the dialog still opens and still shows the text, but confirm is disabled and
// cancel is the only way out. Silently accepting an edit that could not be persisted,
// and would vanish at the next extraction, is worse than visibly refusing it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import RoundIconButton from 'components/pdfTableViewer/RoundIconButton';
import {
  cellSourceKey,
  dialogPlacement,
  draggedPosition,
  findSourceTable,
  findSourceValue,
} from 'components/pdfTableViewer/reviewEditUtils';
import {
  cancelColour,
  confirmColour,
  maxCellEditorImageHeight,
  reviewCellEditDialogWidthPx,
  reviewCellEditRowCount,
} from 'config';

export default function CellEditDialog({
  pdfId,
  cell,
  tables,
  reviewedTableId,
  anchorRect,
  anchorPointer,
  image,
  onRequestImage,
  onCancel,
  onConfirm,
  onConfirmAndNext,
}) {
  const [text, setText] = useState(cell?.text ?? '');
  const dialogRef = useRef(null);
  // The dialog's own height decides whether it fits above the cell, so it is measured
  // rather than assumed; 0 until the first measurement, which simply means the first
  // paint prefers the space above.
  const [height, setHeight] = useState(0);
  // Where the user has dragged the dialog to, or null while it still sits where it was
  // placed. Once set it OVERRIDES the computed placement, because a position the user
  // chose outranks one this code guessed at.
  const [dragged, setDragged] = useState(null);
  // The drag in progress: the dialog's position and the pointer's, both as they were at
  // pointer-down. Null between drags. A ref rather than state — it is read inside the
  // move handler and never affects what is rendered on its own.
  const dragOriginRef = useRef(null);

  const key = cellSourceKey(cell);

  // Clicking a second cell while the dialog is open re-uses this instance with a new
  // `cell`, so the edited text follows the cell rather than the mount. Keyed on the
  // source key so a re-render for any other reason never discards what has been typed.
  useEffect(() => {
    setText(cell?.text ?? '');
    // A new cell is a new question, and the answer to "where should this go?" is the
    // one computed beside THAT cell — so the drag is forgotten with the text.
    setDragged(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Measured after every paint, because the height changes when the image lands and
  // again if the textarea is dragged taller, and re-placing on a stale height would
  // leave the dialog overlapping the cell it edits. The equality guard is what makes a
  // dependency-free effect safe: an unchanged measurement sets no state, so the chain
  // of updates stops after one round.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const measured = dialogRef.current?.offsetHeight ?? 0;
    setHeight((current) => (current === measured ? current : measured));
  });

  // Ask the panel for this cell's crop once per source, and only while the panel has
  // not already supplied one. A cell with no source, a source table no longer in the
  // metadata, or a source value deleted since the extraction all resolve to nothing to
  // crop, and are left showing an empty image area.
  useEffect(() => {
    if (key === null || image !== undefined) return;
    const sourceTable = findSourceTable(tables, reviewedTableId, cell);
    if (!sourceTable) return;
    const sourceValue = findSourceValue(sourceTable, cell);
    if (!sourceValue) return;
    const { left, top, width, height: boundsHeight } = sourceValue.bounds;
    onRequestImage({
      key,
      page: sourceTable.pdfPage,
      bounds: { left, top, width, height: boundsHeight },
      // The crop is asked for at the width the CELL occupies on screen, so it comes
      // back at the scale the user is already reading the table at. A fixed width
      // magnified a narrow column and shrank a wide one, neither matching what is
      // being compared against it.
      width: Math.round(anchorRect.width),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, image]);

  // The untouched crop, which is the only one shown. Read through the optional chain
  // because the pair is undefined until the panel answers; a response that carried no raw
  // member leaves the image area empty rather than falling back to the processed one.
  const shownImage = image?.raw;

  const size = { width: reviewCellEditDialogWidthPx(), height };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  // `anchorPointer` is where the click that opened the dialog landed, and only decides
  // which side of it the dialog goes when there is room neither above nor beside the
  // element. Undefined when the dialog was opened without a click.
  const position =
    dragged ?? dialogPlacement(anchorRect, size, viewport, anchorPointer);

  // Dragging is driven by pointer events rather than mouse events so that a touch or a
  // stylus works the same way. The handle captures the pointer, so a fast drag that
  // outruns the dialog keeps sending its moves here instead of losing the drag to
  // whatever is underneath. preventDefault stops the gesture also starting a text
  // selection across the dialog.
  const handlePointerDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragOriginRef.current = {
      left: position.left,
      top: position.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
  };

  const handlePointerMove = (event) => {
    if (!dragOriginRef.current) return;
    setDragged(
      draggedPosition(
        dragOriginRef.current,
        { x: event.clientX, y: event.clientY },
        size,
        viewport
      )
    );
  };

  const handlePointerUp = (event) => {
    dragOriginRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <Box
      ref={dialogRef}
      data-testid={'cell-edit-dialog'}
      // The geometry is computed, so it is written inline; the chrome is left to `sx`.
      // The z-index lifts the dialog clear of the editor's panels, which is the only
      // stacking it has to beat.
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: reviewCellEditDialogWidthPx(),
      }}
      sx={{
        zIndex: 'tooltip',
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        boxShadow: 3,
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {/* The drag handle. A strip of its own rather than the whole dialog: a drag
          started anywhere would fight the textarea for the same gesture, and dragging
          text out of the field is a thing people legitimately do. */}
      <Box
        data-testid={'cell-edit-drag'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          cursor: 'move',
          color: 'text.secondary',
          backgroundColor: 'action.hover',
          borderRadius: 1,
          // The gesture must not be claimed by the browser as a scroll or a pan.
          touchAction: 'none',
        }}
      >
        <DragHandleIcon fontSize={'small'} />
      </Box>
      {/* The crop, which now has the dialog's full interior width to itself. */}
      <Box
        sx={{
          // Deliberately NOT a flex container. As a flex item the crop was squashed on
          // both axes: `align-items: stretch` compressed it to the capped height rather
          // than letting it overflow, and `flex-shrink` narrowed it independently of
          // that. A block box leaves the img in charge of its own aspect ratio.
          display: 'block',
          // The crop was requested at the cell's own width, so it arrives about the
          // size it should be shown at — but a cell wider than the dialog, or a tall
          // one, still has to be contained. Width is handled by scaling the image
          // down; height by scrolling, because scaling a tall crop to fit would shrink
          // it past reading and growing to fit it would push the text field out of the
          // dialog.
          maxHeight: maxCellEditorImageHeight(),
          overflowY: 'auto',
        }}
      >
        {shownImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid={'cell-edit-image'}
            src={`data:image/png;base64,${shownImage}`}
            alt={''}
            // The only constraint is on width: `max-width: 100%` scales a crop too wide
            // for the dialog down to fit, and `height: auto` makes the height follow so
            // the proportions hold. A crop that is then still too tall overflows and the
            // area above scrolls. `margin: 0 auto` centres it, which is what the removed
            // `justify-content` used to do.
            style={{
              display: 'block',
              margin: '0 auto',
              maxWidth: '100%',
              height: 'auto',
            }}
          />
        )}
      </Box>
      {/* The field and the buttons are topped level rather than bottomed: the textarea
          grows downwards as it is typed into or dragged taller, and buttons pinned to its
          bottom edge would walk down the dialog with it. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <TextField
          multiline
          minRows={reviewCellEditRowCount()}
          size={'small'}
          fullWidth
          value={text}
          onChange={(event) => setText(event.target.value)}
          inputProps={{ 'data-testid': 'cell-edit-text' }}
          // The textarea is left resizeable because a cell can hold far more text than
          // the configured row count shows, and the dialog is small on purpose.
          sx={{ '& textarea': { resize: 'vertical' } }}
        />
        <Box
          data-testid={'cell-edit-buttons'}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 1,
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1 }}>
            <RoundIconButton
              colour={cancelColour()}
              icon={<CloseIcon />}
              testId={'cell-edit-cancel'}
              onClick={onCancel}
            />
            <RoundIconButton
              colour={confirmColour()}
              icon={<CheckIcon />}
              testId={'cell-edit-confirm'}
              onClick={() => onConfirm(text)}
              disabled={!key}
            />
          </Box>
          {/* The same save, with the panel asked to move on to the next low confidence
              cell afterwards. It is reported separately rather than as a flag on
              onConfirm because the dialog has no idea what "next" is — the panel owns the
              list and the selection. Disabled on exactly the same terms as the tick: what
              it does first is the tick's job, and a save that cannot happen cannot be
              followed by anything. */}
          <Button
            data-testid={'cell-edit-confirm-next'}
            size={'small'}
            variant={'contained'}
            startIcon={<CheckIcon />}
            disabled={!key}
            onClick={() => onConfirmAndNext(text)}
            sx={{
              backgroundColor: confirmColour(),
              '&:hover': { backgroundColor: confirmColour() },
            }}
          >
            {'Next'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
