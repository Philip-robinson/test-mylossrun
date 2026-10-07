// A null or undefined value, normalised to null.
const orNull = (value) => value ?? null;

// Structural equality for a saved grid: nested arrays of table ids, or null.
const sameGrid = (a, b) =>
  JSON.stringify(orNull(a)) === JSON.stringify(orNull(b));

// True when the Grid Editor's savedTables() list differs from the live list it would replace.
export const gridArrangementChanged = (savedEntries, liveTables) => {
  const saved = savedEntries ?? [];
  const live = liveTables ?? [];
  if (saved.length !== live.length) return true;
  const liveById = new Map(live.map((t) => [t.tableId, t]));
  return saved.some((entry) => {
    const match = liveById.get(entry.tableId);
    if (match == null) return true;
    return (
      !sameGrid(entry.grid, match.grid) ||
      orNull(entry.confirmationStage) !== orNull(match.confirmationStage)
    );
  });
};
