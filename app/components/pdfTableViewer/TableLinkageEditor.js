'use client';

// The "Link tables" feature — the screen the user calls the GRID EDITOR: the
// `TableLinkageEditor` React component (default export).
//
// It renders inline as a panel filling whatever container the host mounts it in (today an
// overlay covering the whole editor, drawn over the page editor while it is open), so there
// are no `open`/`onClose` props and no portal: the host decides whether it is mounted at all.
//
// The pure helper functions that make up the join algorithm live in
// `gridUtilities.js`; this file imports the ones the component needs.

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import toast from 'react-hot-toast';
import { getTableImages } from 'services/images';
import LinkCell from 'components/pdfTableViewer/LinkCell';
import {
  confirmedTableStage,
  linkAvailableTablesHelpId,
  linkCancelHelpId,
  linkExportHelpId,
  linkExportLabel,
  linkExportingLabel,
  linkLinkedTablesHelpId,
  linkSaveHelpId,
  linkTableCellWidth,
  linkUnlinkHelpId,
} from 'config';
import {
  buildInitialState,
  buildSaveTables,
  dropCandidates,
  dropPlacementReason,
  dropRejectionReason,
  hasSavedGrid,
  insertSpineRow,
  moveGridCellToSelect,
  moveSelectToGridCell,
  padForDisplay,
  sortByOrder,
} from 'components/pdfTableViewer/gridUtilities';

// ---------------------------------------------------------------------------
// TableLinkageEditor component
// ---------------------------------------------------------------------------

const CELL_WIDTH = linkTableCellWidth();

// The grid column a drop landed on: the column of the cell whose horizontal band holds
// `clientX`, or the nearest column when the drop falls past the end of a row. Reads the
// laid-out cells rather than dividing the panel up, because a cell is as wide as the table
// image it holds, so the columns are not of one width.
const columnAt = (container, clientX) => {
  let column = null;
  let best = Number.POSITIVE_INFINITY;
  container.querySelectorAll('[data-col]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    const gap = Math.max(rect.left - clientX, clientX - rect.right, 0);
    // A pointer or a rectangle that cannot be measured leaves every cell the same distance
    // away, and the tie-break below then settles on the first column — the spine, which is
    // the safe reading of a drop whose column cannot be told.
    const distance = Number.isFinite(gap) ? gap : 0;
    const c = Number(el.getAttribute('data-col'));
    if (distance < best || (distance === best && column != null && c < column)) {
      column = c;
      best = distance;
    }
  });
  return column;
};

export default function TableLinkageEditor({
  pdfId,
  rootTable,
  tables,
  onCancel,
  onSave,
  // Exports the root table; the host reports its own errors.
  onExport = async () => {},
  // Registers a function returning this panel's save list, so the host can save the
  // arrangement on a move it drives; registered null on unmount.
  onRegisterSave = () => {},
}) {
  const [{ grid, select }, setState] = useState(() => {
    const init = buildInitialState(
      rootTable ?? { tableId: '', grid: null, next: null },
    );
    return { grid: padForDisplay(init.grid), select: init.select };
  });
  const [images, setImages] = useState({});
  const [exporting, setExporting] = useState(false);
  const requestedRef = useRef(new Set());

  // The set of tableIds currently on screen: Root + non-null grid cells + select.
  const displayed = [];
  if (rootTable) {
    grid.forEach((rowArr) =>
      rowArr.forEach((cell) => {
        if (cell) displayed.push(cell);
      }),
    );
    select.forEach((t) => displayed.push(t));
  }
  const displayedIds = displayed.map((t) => t.tableId).join('|');

  useEffect(() => {
    if (!rootTable) return;
    const needed = displayed.filter((t) => !requestedRef.current.has(t.tableId));
    if (needed.length === 0) return;
    needed.forEach((t) => requestedRef.current.add(t.tableId));
    const tableImages = needed.map((t) => ({
      page: t.pdfPage,
      tableId: t.tableId,
      bounds: {
        left: t.bounds.left,
        top: t.bounds.top,
        width: t.bounds.width,
        height: t.bounds.height,
      },
    }));
    getTableImages(pdfId, CELL_WIDTH, tableImages)
      .then((response) => {
        setImages((prev) => ({ ...prev, ...response.images }));
      })
      .catch((err) => {
        toast.error(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedIds, pdfId, rootTable]);

  // Assigned savedTables once it is defined below; read only when the host calls the
  // registered function.
  const savedTablesRef = useRef(null);
  useEffect(() => {
    onRegisterSave(() => savedTablesRef.current());
    return () => onRegisterSave(null);
  }, [onRegisterSave]);

  if (!rootTable) return null;

  const handleGridDragStart = (e, r, c) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ from: 'grid', r, c }),
    );
  };

  const handleSelectDragStart = (e, tableId) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ from: 'select', tableId }),
    );
  };

  const readPayload = (e) => {
    try {
      return JSON.parse(e.dataTransfer.getData('application/json'));
    } catch {
      return null;
    }
  };

  const handleDropOnSelect = (e) => {
    e.preventDefault();
    const payload = readPayload(e);
    if (!payload || payload.from !== 'grid') return;
    const { r, c } = payload;
    if (r === 0 && c === 0) return; // Root can never leave the grid
    if (grid[r]?.[c] == null) return;
    const next = moveGridCellToSelect(grid, select, r, c);
    setState({ grid: padForDisplay(next.grid), select: next.select });
  };

  // Drop on the grid panel: the COLUMN dropped on is the user's instruction and is obeyed,
  // the row within it is worked out. Every placement the column allows is computed (for the
  // spine, the ordered splice as well as its empty cells) and the one nearest the pointer
  // wins — so a drop right on an empty cell lands there, while a vaguer drop still takes
  // the right spot in the column aimed at, opening a new spine row when that is what the
  // document order calls for. A table the column cannot take is refused outright rather
  // than slid into a column the user did not choose.
  //
  // Every drop answers for itself in a toast, because neither outcome explains itself on
  // screen: an accepted table can land in a row the user was not aiming at, and a refused
  // one simply stays in the Available column with nothing to say why. The reasons are the
  // placement rules themselves, named against the neighbouring tables they were tested on.
  const handleDropOnGrid = (e) => {
    e.preventDefault();
    const payload = readPayload(e);
    if (!payload || payload.from !== 'select') return;
    const dragged = select.find((t) => t.tableId === payload.tableId);
    if (!dragged) return;
    const container = e.currentTarget;
    const column = columnAt(container, e.clientX);
    if (column == null) return; // an empty grid has no column to drop on
    const candidates = dropCandidates(dragged, grid, column);
    if (candidates.length === 0) {
      toast.error(
        `${dragged.name} was not placed: ${dropRejectionReason(dragged, grid, column)}.`,
      );
      return;
    }

    // Distance from the pointer to a candidate's anchor: an empty cell's
    // rectangle (0 when the pointer is inside it), or a spliced row's top edge.
    const distanceTo = (cand) => {
      const el =
        cand.kind === 'cell'
          ? container.querySelector(`[data-row="${cand.r}"][data-col="${cand.c}"]`)
          : container.querySelector(`[data-grid-row="${cand.r}"]`);
      if (!el) return Number.POSITIVE_INFINITY;
      const rect = el.getBoundingClientRect();
      const px = Math.min(Math.max(e.clientX, rect.left), rect.right);
      const py =
        cand.kind === 'cell'
          ? Math.min(Math.max(e.clientY, rect.top), rect.bottom)
          : rect.top;
      return Math.hypot(e.clientX - px, e.clientY - py);
    };

    let best = candidates[0];
    let bestDistance = distanceTo(best);
    for (const cand of candidates.slice(1)) {
      const d = distanceTo(cand);
      if (d < bestDistance) {
        best = cand;
        bestDistance = d;
      }
    }

    const next =
      best.kind === 'newRow'
        ? insertSpineRow(grid, select, payload.tableId, best.r)
        : moveSelectToGridCell(grid, select, payload.tableId, best.r, best.c);
    if (!next) {
      toast.error(`${dragged.name} was not placed.`);
      return;
    }
    // Described against the grid as it stood, before the placement is applied.
    const reason = dropPlacementReason(dragged, grid, best);
    setState({ grid: padForDisplay(next.grid), select: next.select });
    toast.success(reason);
  };

  // "Unlink" empties the GRID: Root stays at (0,0) and every table laid out under it returns
  // to the Available column, in document order like the rest of that list. It does NOT
  // dissolve the group — membership lives in the root's `next` map, which the linking flow
  // owns and this panel never writes — so every table it moves is still a member and is still
  // offered for placing. A LOCAL edit, exactly like dragging each table out by hand: Save
  // persists the cleared layout and Cancel abandons it.
  //
  // The tables returned are the ones ON SCREEN, not a reconstruction from `rootTable.next`:
  // the grid may hold tables placed but not yet saved, which going back to the saved state
  // would silently discard. Rebuilding through buildInitialState would be worse still — with
  // no saved grid it auto-populates the spine, re-placing everything this just cleared.
  const handleUnlink = () => {
    const linkedChildren = grid
      .flat()
      .filter((cell) => cell != null && cell.tableId !== rootTable.tableId);
    setState({
      grid: padForDisplay([[rootTable]]),
      select: sortByOrder([...linkedChildren, ...select]),
    });
  };

  // The save list for the current grid, with the root's stage taken back to
  // confirmedTableStage() when this save REMOVES its links.
  //
  // The ready stage says "this linked group is ready to be extracted"; once the links are
  // gone that claim no longer holds, so it is withdrawn. Nothing writes the ready stage any
  // more, so this only ever meets a root that reached it before, but the withdrawal still
  // has to happen. Two deliberate limits:
  //
  //  * it CAPS, never sets — a root part-way up the Layers ladder (or with no stage at all)
  //    must not be promoted to confirmed just by being unlinked;
  //  * it needs links to have actually gone, so opening this panel on a never-linked table
  //    that carries the ready stage and pressing Save does not demote it.
  const savedTables = () => {
    const saved = buildSaveTables(rootTable, grid, tables);
    const hadLinks =
      hasSavedGrid(rootTable) || Object.keys(rootTable.next ?? {}).length > 0;
    if (!hadLinks) return saved;
    return saved.map((entry) => {
      if (entry.tableId !== rootTable.tableId || entry.grid != null) return entry;
      const stage = entry.confirmationStage;
      return stage == null
        ? entry
        : { ...entry, confirmationStage: Math.min(stage, confirmedTableStage()) };
    });
  };

  // Asks the host to export the root table; a rejection is swallowed.
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport();
    } catch {
      // Reported by the host.
    } finally {
      setExporting(false);
    }
  };

  // The latest savedTables, so the registered function always reads the current grid.
  savedTablesRef.current = savedTables;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: (theme) => theme.palette.grey[200],
      }}
    >
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', p: 1 }}>
        <Box sx={{ display: 'flex', gap: '10px', flex: 1, minWidth: 0, minHeight: 0 }}>
          <Box
            data-testid={'available-panel'}
            data-help-id={linkAvailableTablesHelpId()}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'common.white',
              p: 1,
              borderRadius: 1,
              flexShrink: 0,
              minHeight: 0,
            }}
          >
            <Typography variant={'subtitle2'} sx={{ mb: 1 }}>
              {'Available tables'}
            </Typography>
            <Box
              data-testid={'select-column'}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnSelect}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                flex: 1,
                minHeight: 0,
                minWidth: CELL_WIDTH,
              }}
            >
              {select.length === 0 ? (
                <Box
                  data-testid={'select-empty'}
                  sx={{
                    width: CELL_WIDTH,
                    flexGrow: 1,
                    minHeight: 40,
                    border: '1px dashed #ccc',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                select.map((t) => (
                  <LinkCell
                    key={t.tableId}
                    table={t}
                    image={images[t.tableId]}
                    draggable
                    onDragStart={(e) => handleSelectDragStart(e, t.tableId)}
                  />
                ))
              )}
            </Box>
          </Box>

          <Box
            data-testid={'linked-panel'}
            data-help-id={linkLinkedTablesHelpId()}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'common.white',
              p: 1,
              borderRadius: 1,
              flex: 1,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <Typography variant={'subtitle2'} sx={{ mb: 1 }}>
              {'Linked tables'}
            </Typography>
            <Box
              data-testid={'linked-grid'}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnGrid}
              sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}
            >
              {grid.map((rowArr, r) => (
              // eslint-disable-next-line react/no-array-index-key
              <Box key={r} data-grid-row={r} sx={{ display: 'flex' }}>
                {rowArr.map((cell, c) => {
                  const isRoot = r === 0 && c === 0;
                  if (cell == null) {
                    return (
                      <Box
                        // eslint-disable-next-line react/no-array-index-key
                        key={c}
                        data-testid={'link-empty-cell'}
                        data-row={r}
                        data-col={c}
                        sx={{
                          width: CELL_WIDTH,
                          minHeight: 40,
                          border: '1px dashed #ccc',
                          boxSizing: 'border-box',
                          flexShrink: 0,
                        }}
                      />
                    );
                  }
                  return (
                    <LinkCell
                      // eslint-disable-next-line react/no-array-index-key
                      key={c}
                      table={cell}
                      image={images[cell.tableId]}
                      row={r}
                      col={c}
                      draggable={!isRoot}
                      onDragStart={
                        isRoot ? undefined : (e) => handleGridDragStart(e, r, c)
                      }
                    />
                  );
                })}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          gap: 1,
          p: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            data-testid={'link-unlink'}
            data-help-id={linkUnlinkHelpId()}
            variant={'contained'}
            disabled={exporting}
            onClick={handleUnlink}
          >
            {'Unlink'}
          </Button>
          <Button
            data-testid={'link-cancel'}
            data-help-id={linkCancelHelpId()}
            disabled={exporting}
            onClick={onCancel}
          >
            {'Cancel'}
          </Button>
          <Button
            data-testid={'link-export'}
            data-help-id={linkExportHelpId()}
            disabled={exporting}
            onClick={handleExport}
          >
            {exporting ? linkExportingLabel() : linkExportLabel()}
          </Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            data-testid={'link-save'}
            data-help-id={linkSaveHelpId()}
            variant={'contained'}
            disabled={exporting}
            onClick={() => onSave(savedTables())}
          >
            {'Save'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
