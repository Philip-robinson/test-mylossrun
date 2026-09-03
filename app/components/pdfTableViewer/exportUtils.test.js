import {
  excelFilename,
  exportableTables,
  exportableTableIds,
  saveBlob,
} from './exportUtils';

describe('excelFilename', () => {
  it('replaces the uploaded document extension with the workbook one', () => {
    expect(excelFilename('losses.pdf')).toBe('losses.xlsx');
  });

  it('replaces only the last extension, so a dotted name keeps the rest of it', () => {
    expect(excelFilename('acme.2024.q1.pdf')).toBe('acme.2024.q1.xlsx');
  });

  it('appends to a name that has no extension', () => {
    expect(excelFilename('losses')).toBe('losses.xlsx');
  });

  // A leading dot is the whole name, not an extension of an empty one.
  it('appends to a dotfile rather than eating its name', () => {
    expect(excelFilename('.losses')).toBe('.losses.xlsx');
  });

  it('still names a file when there is no original to name it after', () => {
    expect(excelFilename(undefined)).toBe('.xlsx');
    expect(excelFilename(null)).toBe('.xlsx');
  });
});

describe('saveBlob', () => {
  let clicked;
  const createObjectURL = jest.fn(() => 'blob:mock-url');
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    clicked = [];
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    // jsdom neither downloads nor navigates, so the click is recorded off the prototype:
    // the anchor is created inside the call and the test never otherwise sees it.
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function record() {
        clicked.push({
          href: this.href,
          download: this.download,
          inDocument: document.body.contains(this),
        });
      });
  });

  afterEach(() => {
    HTMLAnchorElement.prototype.click.mockRestore();
  });

  it('clicks an anchor at the blob under the given filename', () => {
    const blob = new Blob(['PK the workbook']);

    saveBlob(blob, 'losses.xlsx');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([
      { href: 'blob:mock-url', download: 'losses.xlsx', inDocument: true },
    ]);
  });

  // The bytes are already in the page, so nothing is in flight for the revoke to cancel —
  // which is exactly why this is safe in the same tick, and was not when the href was S3's.
  it('leaves nothing behind: the anchor is removed and the url revoked', () => {
    saveBlob(new Blob(['PK the workbook']), 'losses.xlsx');

    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('cleans up even when the click itself throws', () => {
    HTMLAnchorElement.prototype.click.mockImplementation(() => {
      throw new Error('no download for you');
    });

    expect(() => saveBlob(new Blob(['x']), 'losses.xlsx')).toThrow(
      'no download for you'
    );
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('exportableTableIds', () => {
  it('answers every table id, in list order', () => {
    const tables = [{ tableId: 't-1' }, { tableId: 't-2' }, { tableId: 't-3' }];

    expect(exportableTableIds(tables)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('leaves out a soft-deleted table', () => {
    const tables = [{ tableId: 't-1' }, { tableId: 't-2', deleted: true }, { tableId: 't-3' }];

    expect(exportableTableIds(tables)).toEqual(['t-1', 't-3']);
  });

  it('takes a linking root once, by its own id, and not the members it holds', () => {
    // A joined table lives in the root's `next` map and is off the top-level list, so the
    // root stands for the whole group.
    const tables = [
      { tableId: 'root', next: { 'joined-1': { tableId: 'joined-1' } } },
      { tableId: 't-2' },
    ];

    expect(exportableTableIds(tables)).toEqual(['root', 't-2']);
  });

  it('answers nothing for an empty or absent list', () => {
    expect(exportableTableIds([])).toEqual([]);
    expect(exportableTableIds(undefined)).toEqual([]);
  });
});

describe('exportableTables', () => {
  it('answers the tables themselves, in list order', () => {
    const tables = [{ tableId: 't-1' }, { tableId: 't-2' }];

    expect(exportableTables(tables)).toEqual(tables);
  });

  it('leaves out a soft-deleted table', () => {
    const kept = { tableId: 't-1' };
    const tables = [kept, { tableId: 't-2', deleted: true }];

    expect(exportableTables(tables)).toEqual([kept]);
  });

  it('answers nothing for an empty or absent list', () => {
    expect(exportableTables([])).toEqual([]);
    expect(exportableTables(undefined)).toEqual([]);
  });

  // One definition of the set, so the ids and the objects can never disagree.
  it('names exactly the tables exportableTableIds answers for', () => {
    const tables = [
      { tableId: 'root', next: { 'joined-1': { tableId: 'joined-1' } } },
      { tableId: 't-2', deleted: true },
      { tableId: 't-3' },
    ];

    expect(exportableTables(tables).map((t) => t.tableId)).toEqual(
      exportableTableIds(tables)
    );
  });
});
