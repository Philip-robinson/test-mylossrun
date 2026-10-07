import {
  accountButtonHelpId,
  boundaryCreateTableHelpId,
  boundaryCutCancelHelpId,
  boundaryCutEndHelpId,
  boundaryCutStartHelpId,
  boundaryDeleteAllTablesHelpId,
  boundaryDeleteTableHelpId,
  boundaryPassScreenId,
  cellEditCancelHelpId,
  cellEditConfidenceHelpId,
  cellEditConfirmHelpId,
  cellEditImageHelpId,
  cellEditNextHelpId,
  contentsPassScreenId,
  documentListActionsHelpId,
  documentOverviewEntryHelpId,
  documentOverviewExportHelpId,
  documentOverviewExportTableHelpId,
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
  layersBordersHelpId,
  layersColoursHelpId,
  layersColumnsHelpId,
  layersPanelHelpId,
  layersRowsHelpId,
  layersSpecialHelpId,
  documentListScreenId,
  layersNextHelpId,
  layersPreviousHelpId,
  pagesColumnHelpId,
  reviewTableScreenId,
  reviewTableNameHelpId,
  reviewFontScaleHelpId,
  reviewPreviousHelpId,
  reviewNextHelpId,
  specialToolJoinedEndRowHelpId,
  specialToolMergedHelpId,
  tableLinkLabelHelpId,
  tableNameLabelHelpId,
  toolbarAllFilesHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
  validateBordersHelpId,
  validateTablesHelpId,
  downloadOriginalLabel,
  exportDocumentLabel,
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
  if (keys[0] === 'break') {
    return segment.break === true;
  }
  return keys[0] === 'list' && isSegmentList(segment.list);
};

const isSegmentList = (items) =>
  Array.isArray(items) &&
  items.length > 0 &&
  items.every((item) => (Array.isArray(item) ? isSegmentArray(item) : isSegment(item)));

const isSegmentArray = (body) => Array.isArray(body) && body.length > 0 && body.every(isSegment);

const screenEntries = () => Object.entries(helpScreens());

// Tips in help-id order, for comparing what two screens say regardless of the order each
// steps through them.
const byHelpId = (tips) => [...tips].sort((a, b) => a.helpId.localeCompare(b.helpId));

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
    documentOverviewExportTableHelpId(),
    documentOverviewExportHelpId(),
  ];

  const columnTips = (screenId) =>
    helpScreens()[screenId].tips.filter((tip) =>
      overviewIds.includes(tip.helpId),
    );

  it('is described by the boundary pass', () => {
    expect(columnTips(boundaryPassScreenId()).map((tip) => tip.helpId).sort()).toEqual(
      [...overviewIds].sort(),
    );
  });

  it('is described by the contents pass in the same words', () => {
    expect(byHelpId(columnTips(contentsPassScreenId()))).toEqual(
      byHelpId(columnTips(boundaryPassScreenId())),
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
    expect(byHelpId(stepTips(contentsPassScreenId()))).toEqual(
      byHelpId(stepTips(boundaryPassScreenId())),
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
    expect(toolbarTips(boundaryPassScreenId()).map((tip) => tip.helpId).sort()).toEqual(
      [...toolbarIds].sort(),
    );
  });

  it('is described by the contents pass in the same words', () => {
    expect(byHelpId(toolbarTips(contentsPassScreenId()))).toEqual(
      byHelpId(toolbarTips(boundaryPassScreenId())),
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

// The review screen's header row: the table name on the left and the font zoom on the right,
// described first and in that order, since they are the first things on the screen.
describe("the review screen's header row", () => {
  it('describes Previous and Next on the review screen', () => {
    const ids = helpScreens()[reviewTableScreenId()].tips.map((tip) => tip.helpId);
    expect(ids).toEqual(expect.arrayContaining([reviewPreviousHelpId(), reviewNextHelpId()]));
  });

  it('is described first by the review screen, name then zoom', () => {
    expect(
      helpScreens()[reviewTableScreenId()].tips.slice(0, 2).map((tip) => tip.helpId),
    ).toEqual([reviewTableNameHelpId(), reviewFontScaleHelpId()]);
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

// Each Document Overview entry's Export button is described on both passes.
describe('the Table Export button tip', () => {
  const exportTableTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === documentOverviewExportTableHelpId(),
    );

  it('is titled Table Export button on both passes', () => {
    expect(exportTableTip(boundaryPassScreenId())?.title).toBe('Table Export button');
    expect(exportTableTip(contentsPassScreenId())?.title).toBe('Table Export button');
  });
});

// The selected table's boundary is one element carrying one help id, and each pass
// describes it as what that pass is about: its boundary on the borders pass, the grid it
// holds on the contents pass. Two screens, one id, deliberately different words.
// Help's Next steps through a screen's tips in the order they are listed, so the boundary
// pass lists them in the order the operator chose.
describe('the boundary pass tip order', () => {
  it('lists its tips in the order Next steps through them', () => {
    expect(helpScreens()[boundaryPassScreenId()].tips.map((tip) => tip.helpId)).toEqual([
      toolbarAllFilesHelpId(),
      toolbarValidateBordersHelpId(),
      toolbarValidateTablesHelpId(),
      editorDimDocumentHelpId(),
      editorScaleHelpId(),
      documentOverviewSaveHelpId(),
      documentOverviewHelpId(),
      includeDeletedHelpId(),
      documentOverviewEntryHelpId(),
      documentOverviewReviewHelpId(),
      documentOverviewExportTableHelpId(),
      tableNameLabelHelpId(),
      documentOverviewLinkHelpId(),
      tableLinkLabelHelpId(),
      documentOverviewExportHelpId(),
      editorPageTableHelpId(),
      layersBordersHelpId(),
      boundaryDeleteTableHelpId(),
      boundaryCutStartHelpId(),
      boundaryCutEndHelpId(),
      boundaryCutCancelHelpId(),
      boundaryDeleteAllTablesHelpId(),
      boundaryCreateTableHelpId(),
      layersPreviousHelpId(),
      layersNextHelpId(),
      validateTablesHelpId(),
      pagesColumnHelpId(),
      editorPageTitleHelpId(),
      accountButtonHelpId(),
    ]);
  });
});

// The contents pass lists its tips in the order the operator chose, ids named by role
// where the screen's own tips are not shared.
describe('the contents pass tip order', () => {
  const contentsTips = () => helpScreens()[contentsPassScreenId()].tips;
  const idOf = (title) => contentsTips().find((tip) => tip.title === title)?.helpId;

  it('lists its tips in the order Next steps through them', () => {
    expect(contentsTips().map((tip) => tip.helpId)).toEqual([
      toolbarAllFilesHelpId(),
      toolbarValidateBordersHelpId(),
      toolbarValidateTablesHelpId(),
      editorPageTitleHelpId(),
      editorDimDocumentHelpId(),
      editorScaleHelpId(),
      documentOverviewSaveHelpId(),
      includeDeletedHelpId(),
      documentOverviewHelpId(),
      documentOverviewEntryHelpId(),
      documentOverviewLinkHelpId(),
      documentOverviewReviewHelpId(),
      documentOverviewExportTableHelpId(),
      documentOverviewExportHelpId(),
      accountButtonHelpId(),
      idOf('Edit mode buttons'),
      idOf('Edit Rows button'),
      idOf('Edit Columns button'),
      idOf('Edit Special areas button'),
      idOf('Header button'),
      idOf('Title button'),
      idOf('Section button'),
      idOf('Merge Cells button'),
      idOf('Joined end row button'),
      idOf('Rows colouring button'),
      idOf('Tables colouring button'),
      idOf('Columns colouring button'),
      idOf('Cell colouring button'),
      idOf('Area colouring button'),
      idOf('Hide Row button'),
      tableNameLabelHelpId(),
      idOf('Table status'),
      editorPageTableHelpId(),
      layersPanelHelpId(),
      layersBordersHelpId(),
      layersRowsHelpId(),
      layersColumnsHelpId(),
      layersSpecialHelpId(),
      layersColoursHelpId(),
      layersNextHelpId(),
      layersPreviousHelpId(),
      validateBordersHelpId(),
    ]);
  });

  it('describes Show Borders in the same words as the boundary pass', () => {
    const showBorders = (screenId) =>
      helpScreens()[screenId].tips.find((tip) => tip.helpId === layersBordersHelpId());

    expect(showBorders(contentsPassScreenId())).toEqual(showBorders(boundaryPassScreenId()));
  });

  it('describes All files in the same words as the boundary pass', () => {
    const allFiles = (screenId) =>
      helpScreens()[screenId].tips.find((tip) => tip.helpId === toolbarAllFilesHelpId());

    expect(allFiles(contentsPassScreenId())).toEqual(allFiles(boundaryPassScreenId()));
  });
});

describe("the selected table's boundary", () => {
  const boundaryTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === editorPageTableHelpId(),
    );

  it('is the boundary pass\'s Selected Table Boundary', () => {
    expect(boundaryTip(boundaryPassScreenId()).title).toEqual('Selected Table Boundary');
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

// The Merge Cells button sits on the Special sub-menu, which the contents pass alone has, so
// that is the one screen which describes it.
describe('the Merge Cells button', () => {
  const mergedTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === specialToolMergedHelpId(),
    );

  it('is described by the contents pass', () => {
    expect(mergedTip(contentsPassScreenId())).toBeDefined();
    expect(mergedTip(contentsPassScreenId()).title).toEqual('Merge Cells button');
  });
});

// The Joined end row button sits on the Special sub-menu, so the contents pass describes it.
describe('the Joined end row button', () => {
  const joinedTip = (screenId) =>
    helpScreens()[screenId].tips.find(
      (tip) => tip.helpId === specialToolJoinedEndRowHelpId(),
    );

  it('is described by the contents pass', () => {
    expect(joinedTip(contentsPassScreenId())).toBeDefined();
    expect(joinedTip(contentsPassScreenId()).title).toEqual('Joined end row button');
  });
});

describe('the document row actions button', () => {
  // Strings, bold words and list items, flattened to one text, so a test can ask what a
  // tip says without caring how it is laid out.
  const segmentText = (segment) => {
    if (typeof segment === 'string') return segment;
    if (Array.isArray(segment)) return segment.map(segmentText).join('');
    if (segment.bold) return segment.bold;
    if (segment.list) return segment.list.map(segmentText).join(' ');
    return '';
  };

  const actionsTip = () =>
    helpScreens()[documentListScreenId()].tips.find(
      (tip) => tip.helpId === documentListActionsHelpId()
    );

  it('is described by the document list', () => {
    expect(actionsTip()).toBeDefined();
  });

  it('names both menu items in the words the menu uses', () => {
    const text = segmentText(actionsTip().body);
    expect(text).toContain(downloadOriginalLabel());
    expect(text).toContain(exportDocumentLabel());
  });
});
