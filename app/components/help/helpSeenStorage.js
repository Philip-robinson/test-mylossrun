/**
 * Help overlay seen-flag storage and entry decision
 *
 * What the overlay remembers between visits — one stored version per screen —
 * and the decision it makes on arriving at a screen from that record.
 *
 * The storage is an argument rather than a reach for `window.localStorage`, so a
 * test can hand in one that throws, which is what a private window or a browser
 * with site data blocked does. Every read failure reads as "nothing stored" and
 * every write failure is reported to the caller; neither ever throws outward,
 * because help that cannot remember is still help.
 *
 * The stored value is returned raw and parsed only inside the decision, so
 * "nothing stored" and "stored but unparseable" stay distinguishable — the two
 * lead to opposite actions.
 */

import { helpSeenKeyPrefix } from 'config';

// The localStorage key holding one screen's seen record.
function seenKey(screenId) {
  return `${helpSeenKeyPrefix()}${screenId}`;
}

// The raw stored value for a screen, unparsed, or null when there is none — which
// covers an absent key, an absent storage and a read that threw alike.
export function readSeenValue(storage, screenId) {
  try {
    const value = storage.getItem(seenKey(screenId));

    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

// Records that a screen's hints have been seen at a content version, and answers
// whether that stuck. A false answer means the record is gone on the next visit,
// which shows the hints again rather than losing anything.
export function writeSeenVersion(storage, screenId, version) {
  try {
    storage.setItem(seenKey(screenId), String(version));

    return true;
  } catch {
    return false;
  }
}

// What arriving at a screen should do, given its raw stored value and the version
// of the copy now on offer: open the overlay, flag that there is something new, or
// nothing at all.
//
// An unparseable value flags rather than opens: something was stored, so the screen
// has been seen, and the user is offered the hints instead of being interrupted by
// them.
export function helpEntryAction(rawValue, contentVersion) {
  if (rawValue === null || rawValue === undefined) {
    return 'open';
  }

  const seenVersion = parsedVersion(rawValue);

  if (seenVersion === null) {
    return 'flag';
  }

  return seenVersion >= contentVersion ? 'none' : 'flag';
}

// The stored value as an integer, or null when it is not one. Deliberately stricter
// than parseInt, which answers 3 for both '3.5' and '3abc'.
function parsedVersion(rawValue) {
  if (typeof rawValue !== 'string' || !/^-?\d+$/.test(rawValue.trim())) {
    return null;
  }

  return Number.parseInt(rawValue.trim(), 10);
}
