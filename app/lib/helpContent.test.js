import {
  boundaryPassScreenId,
  cellEditCancelHelpId,
  cellEditConfidenceHelpId,
  cellEditConfirmHelpId,
  cellEditImageHelpId,
  cellEditNextHelpId,
  contentsPassScreenId,
  documentOverviewEntryHelpId,
  documentOverviewExportHelpId,
  documentOverviewHelpId,
  documentOverviewLinkHelpId,
  documentOverviewReviewHelpId,
  documentOverviewSaveHelpId,
  editorDimDocumentHelpId,
  editorPageTitleHelpId,
  editorScaleHelpId,
  helpButtonHelpId,
  includeDeletedHelpId,
  documentListScreenId,
  layersNextHelpId,
  layersPreviousHelpId,
  reviewTableScreenId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
  validateBordersHelpId,
  validateTablesHelpId,
} from 'config';

import {
  helpScreens,
  helpIntroBody,
  helpChipLabel,
  helpExitLabel,
  helpNewBadgeLabel,
} from 'app/lib/helpContent';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// A list's items are segments in their own right: a bare string, or a segment array
// carrying bold words or a nested list. So this recurses.
const isSegment = (segment) => {
  if (typeof segment === 'string') {
    return segment !== '';
  }
  if (segment === null || typeof segment !== 'object') {
    return false;
  }
  const keys = Object.keys(segment);
  if (keys.length !== 1) {
    return false;
  }
  if (keys[0] === 'bold') {
    return isNonEmptyString(segment.bold);
  }
  return keys[0] === 'list' && isSegmentList(segment.list);
};

const isSegmentList = (items) =>
  Array.isArray(items) &&
  items.length > 0 &&
  items.every((item) => (Array.isArray(item) ? isSegmentArray(item) : isSegment(item)));

const isSegmentArray = (body) => Array.isArray(body) && body.length > 0 && body.every(isSegment);

const screenEntries = () => Object.entries(helpScreens());

const allTips = () =>
  screenEntries().flatMap(([screenId, screen]) => screen.tips.map((tip) => [screenId, tip]));

describe('helpScreens()', () => {
  it('gives every screen a name, a summary and a positive integer version', () => {
    const entries = screenEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const [screenId, screen] of entries) {
      expect(isNonEmptyString(screenId)).toBe(true);
      expect(isNonEmptyString(screen.name)).toBe(true);
      expect(isSegmentArray(screen.summary)).toBe(true);
      expect(Number.isInteger(screen.version)).toBe(true);
      expect(screen.version).toBeGreaterThan(0);
      expect(Array.isArray(screen.tips)).toBe(true);
    }
  });

  it('gives every tip a title and a body', () => {
    for (const [, tip] of allTips()) {
      expect(isNonEmptyString(tip.title)).toBe(true);
      expect(isSegmentArray(tip.body)).toBe(true);
    }
  });

  it('keeps tip help ids unique within each screen', () => {
    for (const [, screen] of screenEntries()) {
      const helpIds = screen.tips.map((tip) => tip.helpId);
      expect(new Set(helpIds).size).toBe(helpIds.length);
    }
  });

  it('gives every tip a help id, and never the help button its own', () => {
    for (const [, tip] of allTips()) {
      expect(isNonEmptyString(tip.helpId)).toBe(true);
      expect(tip.helpId).not.toBe(helpButtonHelpId());
    }
  });
});

describe('helpIntroBody()', () => {
  it('is a segment array', () => {
    expect(isSegmentArray(helpIntroBody())).toBe(true);
  });
});

describe('fixed labels', () => {
  it('are non-empty strings', () => {
    expect(isNonEmptyString(helpChipLabel())).toBe(true);
    expect(isNonEmptyString(helpExitLabel())).toBe(true);
    expect(isNonEmptyString(helpNewBadgeLabel())).toBe(true);
  });
});

// The Document Overview column stands unchanged through both editor passes, so both
// describe it — the same words about the same things, from the one list.
describe('the Document Overview column', () => {
  const overviewIds = [
    documentOverviewSaveHelpId(),
    includeDeletedHelpId(),
    documentOverviewHelpId(),
    documentOverviewEntryHelpId(),
    documentOverviewLinkHelpId(),
    documentOverviewReviewHelpId(),
    documentOverviewExportHelpId(),
  ];

  const columnTips = (screenId) =>
    helpScreens()[screenId].tips.filter((tip) =>
      overviewIds.includes(tip.helpId),
    );

  it('is described by the boundary pass, top to bottom', () => {
    expect(columnTips(boundaryPassScreenId()).map((tip) => tip.helpId)).toEqual(
      overviewIds,
    );
  });

  it('is described by the contents pass in the same words', () => {
    expect(columnTips(contentsPassScreenId())).toEqual(
      columnTips(boundaryPassScreenId()),
    );
  });
});

// Previous and Next sit at the foot of the Layers panel through both editor passes and
// step through the same tables and pages in each, so both describe them the same way.
describe('the Previous and Next buttons', () => {
  const stepIds = [layersPreviousHelpId(), layersNextHelpId()];

  const stepTips = (screenId) =>
    helpScreens()[screenId].tips.filter((tip) => stepIds.includes(tip.helpId));

  it('are described by the boundary pass', () => {
    expect(stepTips(boundaryPassScreenId()).map((tip) => tip.helpId)).toEqual(
      stepIds,
    );
  });

  it('are described by the contents pass in the same words', () => {
    expect(stepTips(contentsPassScreenId())).toEqual(
      stepTips(boundaryPassScreenId()),
    );
  });
});

// The Dim Document switch and the Scale selector sit in the editor's title bar through
// both passes and do the same thing in each, so both describe them the same way.
describe("the editor's own toolbar", () => {
  const toolbarIds = [
    editorPageTitleHelpId(),
    editorDimDocumentHelpId(),
    editorScaleHelpId(),
  ];

  const toolbarTips = (screenId) =>
    helpScreens()[screenId].tips.filter((tip) =>
      toolbarIds.includes(tip.helpId),
    );

  it('is described by the boundary pass', () => {
    expect(toolbarTips(boundaryPassScreenId()).map((tip) => tip.helpId)).toEqual(
      toolbarIds,
    );
  });

  it('is described by the contents pass in the same words', () => {
    expect(toolbarTips(contentsPassScreenId())).toEqual(
      toolbarTips(boundaryPassScreenId()),
    );
  });
});

// The toolbar stands over every screen the editor has, so every one of them describes its
// two pass tabs — in the same words as the Layers panel's buttons, which make the same
// switch. The document list has no editor and no tabs, so it is the one screen that does
// not describe them.
describe('the toolbar pass tabs', () => {
  const tabIds = [
    toolbarValidateBordersHelpId(),
    toolbarValidateTablesHelpId(),
  ];

  const tipFor = (screenId, helpId) =>
    helpScreens()[screenId].tips.find((tip) => tip.helpId === helpId);

  const editorScreenIds = () =>
    Object.keys(helpScreens()).filter(
      (screenId) => screenId !== documentListScreenId(),
    );

  it('are described by every screen the editor has', () => {
    for (const screenId of editorScreenIds()) {
      for (const helpId of tabIds) {
        expect(tipFor(screenId, helpId)).toBeDefined();
      }
    }
  });

  it('are not described by the document list', () => {
    for (const helpId of tabIds) {
      expect(tipFor(documentListScreenId(), helpId)).toBeUndefined();
    }
  });

  // Same words, different elements: the tab and the panel button each carry an id of their
  // own, because the overlay measures a tip's hole from the element it finds.
  it('say what the Layers panel says about the same switch', () => {
    const panelTables = tipFor(boundaryPassScreenId(), validateTablesHelpId());
    const panelBorders = tipFor(contentsPassScreenId(), validateBordersHelpId());
    const tabTables = tipFor(
      boundaryPassScreenId(),
      toolbarValidateTablesHelpId(),
    );
    const tabBorders = tipFor(
      contentsPassScreenId(),
      toolbarValidateBordersHelpId(),
    );

    expect(tabTables.title).toEqual(panelTables.title);
    expect(tabTables.body).toEqual(panelTables.body);
    expect(tabBorders.title).toEqual(panelBorders.title);
    expect(tabBorders.body).toEqual(panelBorders.body);
  });
});

// The cell-edit dialog is part of the review screen rather than a screen of its own, so
// it is the review screen that describes the dialog's parts — and no other screen does,
// the dialog being reachable from nowhere else.
describe('the cell-edit dialog', () => {
  const dialogIds = [
    cellEditImageHelpId(),
    cellEditCancelHelpId(),
    cellEditConfirmHelpId(),
    cellEditNextHelpId(),
    cellEditConfidenceHelpId(),
  ];

  const dialogTips = (screenId) =>
    helpScreens()[screenId].tips.filter((tip) => dialogIds.includes(tip.helpId));

  it('is described by the review screen, every part of it', () => {
    expect(dialogTips(reviewTableScreenId()).map((tip) => tip.helpId)).toEqual(
      dialogIds,
    );
  });

  it('is described by no other screen', () => {
    for (const screenId of Object.keys(helpScreens())) {
      if (screenId === reviewTableScreenId()) {
        continue;
      }

      expect(dialogTips(screenId)).toEqual([]);
    }
  });
});
