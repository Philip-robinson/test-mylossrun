import { accessCodeStorageKey, signedOutPath, userEmailStorageKey } from 'config';

import { signOut } from 'services/session';

function makeStorage(initial = {}) {
  const items = { ...initial };

  return {
    items,
    removed: [],
    removeItem(key) {
      this.removed.push(key);
      delete items[key];
    }
  };
}

describe('signOut', () => {
  it('removes the access-code key and the user-email key, and nothing else', () => {
    const storage = makeStorage({
      [accessCodeStorageKey()]: 'code',
      [userEmailStorageKey()]: 'someone@example.com',
      other: 'kept'
    });

    signOut(storage, jest.fn());

    expect(storage.removed.sort()).toEqual(
      [accessCodeStorageKey(), userEmailStorageKey()].sort()
    );
    expect(storage.items).toEqual({ other: 'kept' });
  });

  it('navigates exactly once, to the signed-out path', () => {
    const navigate = jest.fn();

    signOut(makeStorage(), navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(signedOutPath());
  });

  it('clears before it navigates', () => {
    const storage = makeStorage({
      [accessCodeStorageKey()]: 'code',
      [userEmailStorageKey()]: 'someone@example.com'
    });
    const navigate = jest.fn(() => {
      expect(storage.items[accessCodeStorageKey()]).toBeUndefined();
      expect(storage.items[userEmailStorageKey()]).toBeUndefined();
    });

    signOut(storage, navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still navigates when removeItem throws on the first key', () => {
    const navigate = jest.fn();
    const storage = {
      removeItem() {
        throw new Error('site data blocked');
      }
    };

    signOut(storage, navigate);

    expect(navigate).toHaveBeenCalledWith(signedOutPath());
  });
});
