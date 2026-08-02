'use client';

// ExpectedCountsFields: the "Expected Columns" / "Expected Rows" pair shown in the
// Borders layer's Options block. They are transient per-table hints — nothing on
// PDFTable stores them — consumed later by the layer-transition and recalculation
// calls. Purely presentational and controlled: both values are owned by the parent
// (as strings, blank being the empty string) and every accepted keystroke is
// reported up via `onChange(field, value)`.

import { Stack, TextField } from '@mui/material';

// A value is adoptable when it is blank or a positive integer. Expressed as a
// character pattern rather than a numeric comparison so there is no bound literal
// here: a leading digit of 1-9 rules out 0, and the absence of any sign or decimal
// character rules out negatives and non-integers. Rejected input is simply not
// reported, so the field keeps the parent's previous value and no error UI is needed.
const ADOPTABLE = /^[1-9][0-9]*$/;

function isAdoptable(value) {
  return value === '' || ADOPTABLE.test(value);
}

export default function ExpectedCountsFields({
  expectedColumns = '',
  expectedRows = '',
  disabled = false,
  onChange,
}) {
  const report = (field) => (event) => {
    const next = event.target.value;
    if (!isAdoptable(next)) return;
    if (onChange) onChange(field, next);
  };

  return (
    <Stack spacing={1}>
      <TextField
        label={'Expected Columns'}
        size={'small'}
        value={expectedColumns}
        disabled={disabled}
        onChange={report('expectedColumns')}
        inputProps={{ 'data-testid': 'opt-expected-columns' }}
      />
      <TextField
        label={'Expected Rows'}
        size={'small'}
        value={expectedRows}
        disabled={disabled}
        onChange={report('expectedRows')}
        inputProps={{ 'data-testid': 'opt-expected-rows' }}
      />
    </Stack>
  );
}
