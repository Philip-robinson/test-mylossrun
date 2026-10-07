'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import {
  deleteAllCancelLabel,
  deleteAllTablesBody,
  deleteAllTablesTitle,
  deleteAllYesAllLabel,
  deleteAllYesPageLabel,
} from 'config';

// Confirm dialog for "Delete all tables": cancel, delete in the whole PDF, or delete on this page.
export default function DeleteAllTablesDialog({
  open,
  onCancel,
  onDeleteAll,
  onDeletePage,
}) {
  return (
    <Dialog open={open} onClose={onCancel} data-testid={'delete-all-dialog'}>
      <DialogTitle>{deleteAllTablesTitle()}</DialogTitle>
      <DialogContent>{deleteAllTablesBody()}</DialogContent>
      <DialogActions>
        <Button data-testid={'delete-all-cancel'} onClick={onCancel}>
          {deleteAllCancelLabel()}
        </Button>
        <Button data-testid={'delete-all-yes-all'} onClick={onDeleteAll}>
          {deleteAllYesAllLabel()}
        </Button>
        <Button data-testid={'delete-all-yes-page'} onClick={onDeletePage}>
          {deleteAllYesPageLabel()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
