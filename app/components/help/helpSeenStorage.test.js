import {
  documentListScreenId,
  helpSeenKeyPrefix,
  reviewTableScreenId,
} from 'config';
import {
  helpEntryAction,
  readSeenValue,
  writeSeenVersion,
} from 'components/help/helpSeenStorage';

const SCREEN_ID = documentListScreenId();
const KEY = `${helpSeenKeyPrefix()}${SCREEN_ID}`;

const workingStorage = (entries = {}) => {
  const store = { ...entries };

  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
};

const throwingStorage = () => ({
  getItem: () => {
    throw new Error('read denied');
  },
  setItem: () => {
    throw new Error('write denied');
  },
});

describe('readSeenValue', () => {
  it('answers the raw stored value under the namespaced key', () => {
    expect(readSeenValue(workingStorage({ [KEY]: '3' }), SCREEN_ID)).toBe('3');
  });

  it('answers the raw value unparsed', () => {
    expect(readSeenValue(workingStorage({ [KEY]: 'yes' }), SCREEN_ID)).toBe(
      'yes',
    );
  });

  it('answers nothing when the key is absent', () => {
    expect(readSeenValue(workingStorage(), SCREEN_ID)).toBeNull();
  });

  it('answers nothing when another screen holds the only entry', () => {
    const otherKey = `${helpSeenKeyPrefix()}${reviewTableScreenId()}`;
    const storage = workingStorage({ [otherKey]: '2' });

    expect(readSeenValue(storage, SCREEN_ID)).toBeNull();
  });

  it('answers nothing when the read throws', () => {
    expect(readSeenValue(throwingStorage(), SCREEN_ID)).toBeNull();
  });

  it('answers nothing when there is no storage at all', () => {
    expect(readSeenValue(null, SCREEN_ID)).toBeNull();
  });
});

describe('writeSeenVersion', () => {
  it('stores the version as a decimal string under the namespaced key', () => {
    const storage = workingStorage();

    expect(writeSeenVersion(storage, SCREEN_ID, 3)).toBe(true);
    expect(storage.store[KEY]).toBe('3');
  });

  it('replaces a version already stored for that screen', () => {
    const storage = workingStorage({ [KEY]: '1' });

    expect(writeSeenVersion(storage, SCREEN_ID, 4)).toBe(true);
    expect(storage.store[KEY]).toBe('4');
  });

  it('answers false when the write throws', () => {
    expect(writeSeenVersion(throwingStorage(), SCREEN_ID, 3)).toBe(false);
  });

  it('answers false when there is no storage at all', () => {
    expect(writeSeenVersion(null, SCREEN_ID, 3)).toBe(false);
  });
});

describe('helpEntryAction', () => {
  it('opens the overlay when the screen has never been seen', () => {
    expect(helpEntryAction(null, 3)).toBe('open');
  });

  it('does nothing when the seen version equals the content version', () => {
    expect(helpEntryAction('3', 3)).toBe('none');
  });

  it('does nothing when the seen version is higher than the content version', () => {
    expect(helpEntryAction('7', 3)).toBe('none');
  });

  it('flags when the seen version is below the content version', () => {
    expect(helpEntryAction('2', 3)).toBe('flag');
  });

  it('flags when the stored value does not parse as an integer', () => {
    expect(helpEntryAction('yes', 3)).toBe('flag');
  });

  it('flags when the stored value is a decimal rather than an integer', () => {
    expect(helpEntryAction('3.5', 3)).toBe('flag');
  });

  it('flags when the stored value is empty', () => {
    expect(helpEntryAction('', 3)).toBe('flag');
  });

  it('reads a stored value padded with whitespace', () => {
    expect(helpEntryAction(' 3 ', 3)).toBe('none');
  });
});
