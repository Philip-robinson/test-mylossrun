import {
  readFontScale,
  writeFontScale,
} from 'components/pdfTableViewer/reviewFontScaleStorage';

const options = [70, 85, 100];
const key = 'test.key';

const memoryStorage = (initial = {}) => {
  const values = { ...initial };
  return {
    getItem: (k) => (k in values ? values[k] : null),
    setItem: (k, v) => {
      values[k] = v;
    },
    values,
  };
};

const throwingStorage = () => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
});

describe('readFontScale', () => {
  it('returns the stored percent when it is one of the options', () => {
    expect(readFontScale(memoryStorage({ [key]: '100' }), key, options, 85)).toBe(100);
  });

  it('falls back when nothing is stored', () => {
    expect(readFontScale(memoryStorage(), key, options, 85)).toBe(85);
  });

  it('falls back when the stored value is not one of the options', () => {
    expect(readFontScale(memoryStorage({ [key]: '90' }), key, options, 85)).toBe(85);
    expect(readFontScale(memoryStorage({ [key]: 'big' }), key, options, 85)).toBe(85);
  });

  it('falls back when the storage is absent or throws', () => {
    expect(readFontScale(null, key, options, 85)).toBe(85);
    expect(readFontScale(throwingStorage(), key, options, 85)).toBe(85);
  });
});

describe('writeFontScale', () => {
  it('stores the percent and reports success', () => {
    const storage = memoryStorage();
    expect(writeFontScale(storage, key, 115)).toBe(true);
    expect(storage.values[key]).toBe('115');
  });

  it('reports failure when the storage is absent or throws', () => {
    expect(writeFontScale(null, key, 115)).toBe(false);
    expect(writeFontScale(throwingStorage(), key, 115)).toBe(false);
  });
});
