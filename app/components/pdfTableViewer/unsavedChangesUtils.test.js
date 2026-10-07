import { gridArrangementChanged } from 'components/pdfTableViewer/unsavedChangesUtils';

// A root laid out over two members, plus the two members themselves.
const liveTables = () => [
  {
    tableId: 'root',
    grid: [['root', 'b'], ['a', '']],
    confirmationStage: 3,
  },
  { tableId: 'a', grid: null, confirmationStage: 2 },
  { tableId: 'b', grid: null, confirmationStage: 2 },
];

describe('gridArrangementChanged', () => {
  it('is false for identical lists', () => {
    expect(gridArrangementChanged(liveTables(), liveTables())).toBe(false);
  });

  it('is true when a member has moved', () => {
    const saved = liveTables();
    saved[0] = { ...saved[0], grid: [['root', 'a'], ['b', '']] };
    expect(gridArrangementChanged(saved, liveTables())).toBe(true);
  });

  it('treats an undefined root grid as equal to a null one', () => {
    const live = liveTables();
    live[0] = { ...live[0], grid: undefined };
    const saved = liveTables();
    saved[0] = { ...saved[0], grid: null };
    expect(gridArrangementChanged(saved, live)).toBe(false);
  });

  it('is true when the confirmation stage has been capped', () => {
    const saved = liveTables();
    saved[0] = { ...saved[0], grid: null, confirmationStage: 2 };
    const live = liveTables();
    live[0] = { ...live[0], grid: null };
    expect(gridArrangementChanged(saved, live)).toBe(true);
  });

  it('is true for lists of different length', () => {
    expect(gridArrangementChanged(liveTables().slice(0, 2), liveTables())).toBe(
      true,
    );
  });

  it('is true when a saved entry has no live match', () => {
    const saved = liveTables();
    saved[2] = { ...saved[2], tableId: 'c' };
    expect(gridArrangementChanged(saved, liveTables())).toBe(true);
  });
});
