// Signing out: forget the login data, then leave for the signed-out path.
import { accessCodeStorageKey, signedOutPath, userEmailStorageKey } from 'config';

// Removes both login keys from the given storage and then navigates. The removals
// are swallowed because a private window or a browser with site data blocked hands
// back a storage that throws, and a storage that cannot forget must not strand the
// user in the application. Clearing happens first so the next document cannot see
// the old credentials.
export function signOut(storage, navigate) {
  try {
    storage.removeItem(accessCodeStorageKey());
    storage.removeItem(userEmailStorageKey());
  } catch {
    // A storage that cannot forget still lets the user leave.
  }

  navigate(signedOutPath());
}

// The whole of this module's contact with the browser's navigation. Named so a
// caller's test can assert it was handed over by identity; jsdom implements no
// navigation, so every test stops here.
export function navigateTo(url) {
  window.location.assign(url);
}
