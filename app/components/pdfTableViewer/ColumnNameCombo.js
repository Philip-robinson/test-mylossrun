'use client';

// ColumnNameCombo: the "Column name" free-solo combo shown in the Special Cells
// Options block. It binds the selected section-title row's `columnName`: the user
// may type a brand-new value or pick a previously-entered one from `options`
// (aggregated across the whole PDF). It is a thin controlled wrapper around MUI's
// Autocomplete — it holds no state and reports every change up via `onChange`.

import { Autocomplete, TextField } from '@mui/material';

export default function ColumnNameCombo({
  value = null,
  options = [],
  disabled = false,
  onChange,
}) {
  return (
    <Autocomplete
      freeSolo
      disabled={disabled}
      options={options}
      value={value ?? null}
      // Selecting an option (or clearing) reports the chosen value.
      onChange={(_e, next) => onChange && onChange(next)}
      // Typing a brand-new value reports it too; the 'reset' reason (value set
      // programmatically) is ignored so a controlled update does not loop.
      onInputChange={(_e, next, reason) => {
        if (reason === 'input' && onChange) onChange(next);
      }}
      renderInput={(params) => (
        <TextField {...params} label={'Column name'} size={'small'} />
      )}
    />
  );
}
