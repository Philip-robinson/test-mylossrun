import { excelFilename, saveBlob } from './exportUtils';

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
