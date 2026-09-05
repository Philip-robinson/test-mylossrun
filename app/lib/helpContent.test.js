import {
  accountButtonHelpId,
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
  editorPageTableHelpId,
  editorPageTitleHelpId,
  editorScaleHelpId,
  helpButtonHelpId,
  includeDeletedHelpId,
  documentListScreenId,
  layersNextHelpId,
  layersPreviousHelpId,
  reviewTableScreenId,
  tableLinkLabelHelpId,
  tableNameLabelHelpId,
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

// The name label sits above the selected table's top-left corner in both passes and says
// the same thing in each, so both screens describe it from the one list.
describe("the table's name label", () => {
  const nameTips = (screenId) =>
    helpScreens()[screenId].tips.filter(
      (tip) => tip.helpId === tableNameLabelHelpId(),
    );

  it('is described by the boundary pass', () => {
    expect(nameTips(boundaryPassScreenId()).map((tip) => tip.title)).toEqual([
      'Title label',
    ]);
  });

  it('is described by the contents pass in the same words', () => {
    expect(nameTips(contentsPassScreenId())).toEqual(
      nameTips(boundaryPassScreenId()),
    );
  });
});

// The selected table's boundary is one element carrying one help id, and each pass
// describes it as what that pass is about: its boundary on the borders pass, the grid it
// holds on the contents pass. Two screens, one id, deliberately different words.
describe("the selected table's boundary", () => {
  const boundaryTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === editorPageTableHelpId(),
    );

  it('is the first thing the boundary pass describes', () => {
    const tips = helpScreens()[boundaryPassScreenId()].tips;

    expect(tips[0].helpId).toEqual(editorPageTableHelpId());
    expect(tips[0].title).toEqual('Selected Table Boundary');
  });

  it('is described by the contents pass in words of its own', () => {
    expect(boundaryTip(contentsPassScreenId()).title).toEqual('Table');
    expect(boundaryTip(contentsPassScreenId())).not.toEqual(
      boundaryTip(boundaryPassScreenId()),
    );
  });
});

// The status label above the selected table's top-right corner. The borders pass makes it
// clickable and describes the linking it drives; the contents pass renders it inert, so
// that pass describes what it says rather than what it does.
describe("the table's status label", () => {
  const statusTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === tableLinkLabelHelpId(),
    );

  it('is described by the contents pass as a status, not a button', () => {
    expect(statusTip(contentsPassScreenId()).title).toEqual('Table status');
  });

  it('is described by the borders pass in words of its own', () => {
    expect(statusTip(boundaryPassScreenId()).title).toEqual(
      'Selected/Link button',
    );
    expect(statusTip(contentsPassScreenId())).not.toEqual(
      statusTip(boundaryPassScreenId()),
    );
  });
});

// The account button sits at the far right of the toolbar, and the toolbar stands over
// every screen the application has — the document list included, which has no editor and
// no tabs. So every screen describes it, from the one list.
describe('the account button', () => {
  const accountTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === accountButtonHelpId(),
    );

  it('is described by every screen', () => {
    for (const screenId of Object.keys(helpScreens())) {
      expect(accountTip(screenId)).toBeDefined();
      expect(accountTip(screenId).title).toEqual('Account');
    }
  });

  it('is described by every screen in the same words', () => {
    const tips = Object.keys(helpScreens()).map(accountTip);

    for (const tip of tips) {
      expect(tip).toEqual(tips[0]);
    }
  });
});
