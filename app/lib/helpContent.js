/**
 * Help overlay copy
 *
 * The words the help overlay shows: the shared introduction, each screen's name,
 * summary and tips, and the three fixed labels on the card and the toolbar.
 *
 * A body is a segment array — plain strings, `{ bold: '…' }` objects and
 * `{ list: [...] }` objects in reading order, a list's items being segments of the
 * same kind. A tip is `{ helpId, title, body, side?, padding? }`, and every `helpId`
 * is read from its named function in `config`, never written as a literal.
 *
 * A screen's `version` is bumped when its tips change, which is what the "New
 * descriptions" flag compares against the version a user has already seen.
 */

import {
  boundaryCreateTableHelpId,
  boundaryDeleteTableHelpId,
  boundaryPassScreenId,
  cellEditCancelHelpId,
  cellEditConfidenceHelpId,
  cellEditConfirmHelpId,
  cellEditImageHelpId,
  cellEditNextHelpId,
  contentsPassScreenId,
  documentListCountsHelpId,
  documentListScreenId,
  documentListStatusHelpId,
  documentListTableHelpId,
  documentOverviewEntryHelpId,
  documentOverviewExportHelpId,
  documentOverviewHelpId,
  documentOverviewLinkHelpId,
  documentOverviewReviewHelpId,
  documentOverviewSaveHelpId,
  dropBoxHelpId,
  editorDimDocumentHelpId,
  editorPageTableHelpId,
  editorPageTitleHelpId,
  editorScaleHelpId,
  gridToolColumnsHelpId,
  gridToolRailHelpId,
  gridToolRowsHelpId,
  gridToolSpecialHelpId,
  includeDeletedHelpId,
  layersNextHelpId,
  layersColoursHelpId,
  layersColumnsHelpId,
  layersPanelHelpId,
  layersPreviousHelpId,
  layersRowsHelpId,
  layersSpecialHelpId,
  linkAvailableTablesHelpId,
  linkCancelHelpId,
  linkLinkedTablesHelpId,
  linkSaveHelpId,
  linkTablesScreenId,
  linkUnlinkHelpId,
  pagesColumnHelpId,
  reviewFlaggedCountHelpId,
  reviewGridHelpId,
  reviewPoorCellsHelpId,
  reviewSaveHelpId,
  reviewSectionTitleHelpId,
  reviewTableScreenId,
  reviewTabsHelpId,
  reviewTitleHelpId,
  specialToolColouredAreaHelpId,
  specialToolColouredCellHelpId,
  specialToolColouredColumnsHelpId,
  specialToolColouredRowsHelpId,
  specialToolColouredTableHelpId,
  specialToolHeaderHelpId,
  specialToolHideRowHelpId,
  specialToolSectionHelpId,
  specialToolTitleHelpId,
  tableLinkLabelHelpId,
  tableNameLabelHelpId,
  toolbarAllFilesHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
  validateBordersHelpId,
  validateTablesHelpId, emphasiseLowQualityCells,
} from 'config';

// Rendered under the screen summary on every entry card.
export function helpIntroBody() {
  return [
    'The ? in the toolbar opens help on whatever screen you are on. While help is open, click anything on the screen and this card will say what it is. Nothing you click while help is open can change your document.',
  ];
}

// The words describing each pass switch. The Layers panel's button and the toolbar's tab
// make the same switch as each other, so they are described by the same words; they are
// two elements, so they carry an id apiece and cannot be one tip.
function validateTablesTitle() {
  return 'Validate Tables';
}

function validateTablesBody() {
  return [
    "This button switches to the table contents form where the table's grid lines ",
    'and other internal items can be modified.',
  ];
}

function validateBordersTitle() {
  return 'Validate Borders';
}

function validateBordersBody() {
  return [
    'Switch to the validate borders page to allow table borders to be modified ',
    'and table linking to be redefined.',
  ];
}

// The toolbar's two pass tabs. The toolbar stands over every screen the editor has, so
// every one of them describes the tabs — the document list, which has no editor and no
// tabs, is the one screen that does not.
function toolbarValidateTips() {
  return [
    {
      helpId: toolbarValidateBordersHelpId(),
      title: validateBordersTitle(),
      body: validateBordersBody(),
    },
    {
      helpId: toolbarValidateTablesHelpId(),
      title: validateTablesTitle(),
      body: validateTablesBody(),
    },
  ];
}

// The editor's own title bar above the page: which document and page are on screen, and
// the Dim Document switch and Scale selector beside it. Both passes show all three and
// neither changes what they do, so both describe them from this one list.
function editorToolbarTips() {
  return [
    {
      helpId: editorPageTitleHelpId(),
      title: 'Selected page',
      body: [
        'The name of the currently selected PDF and the currently selected page.',
      ],
    },
    {
      helpId: editorDimDocumentHelpId(),
      title: 'Dim Document',
      body: [
        'This allows the document page currently displayed to be dimmed, ',
        'which is its default setting. Dimming the document makes the grid, ',
        'lines and other features drawn on top of it easier to see; ',
        'it can be undimmed to see the full colours of the document.',
      ],
    },
    {
      helpId: editorScaleHelpId(),
      title: 'Scale the page',
      body: [
        'This only affects the page display in the middle of the screen, ',
        'allowing it to be shown larger or smaller.',
      ],
    },
  ];
}

// The Previous / Next buttons at the foot of the Layers panel. They step through the
// same tables and pages in either pass, so both screens describe them from this one list.
function layersPageStepTips() {
  return [
    {
      helpId: layersPreviousHelpId(),
      title: 'Previous',
      body: [
        'This button steps through the tables and pages backwards. ',
        'If there is a table above the current table on the same page ',
        'it will step to that; if not it will move to the next page above; ',
        'if there is no next page above it will move to the last.',
      ],
    },
    {
      helpId: layersNextHelpId(),
      title: 'Next',
      body: [
        'This button steps through the tables and pages. If there is a table ',
        'below the current table on the same page it will step to that; ',
        'if not it will move to the next page; ',
        'if there is no next page it will move to the first.',
      ],
    },
  ];
}

// The Document Overview column down the left of the editor. It stands unchanged through
// both editor passes, so both screens describe it from this one list rather than from
// two copies that could drift apart.
function documentOverviewTips() {
  return [
    {
      helpId: documentOverviewSaveHelpId(),
      title: 'Save',
      body: [
        'When this is green the current state in the frontend can be saved to the backend, ',
        'when grey there is nothing to save. ',
        'NOTE: Many actions automatically save.',
      ],
    },
    {
      helpId: includeDeletedHelpId(),
      title: 'Include Deleted',
      body: [
        'This button defaults to off. When on, deleted tables are listed within the ',
        { bold: 'Document Overview' },
        ' list below, and clicking on a deleted table allows it to be reinstated ',
        'provided no other table occupies the same space.',
      ],
    },
    {
      helpId: documentOverviewHelpId(),
      title: 'Document Overview',
      body: [
        'This is a list of tables that have not been deleted. ',
        'If multiple tables have been linked to be a single table ',
        'then they are shown here as a single table. Clicking on a ',
        'table allows it to be selected for display in the centre panel.',
      ],
    },
    {
      helpId: documentOverviewEntryHelpId(),
      title: 'Table Entry',
      body: [
        'This is a table entry:',
        {
          list: [
            'At the top is the table name; clicking on the name allows it to be edited.',
            "Below, if one has been selected, is the table's title.",
            'Below this is the size of the table in rows and columns.',
            ['If the table is a linked group of tables, then grid arrangement of ',
              'tables is displayed as C x R.',
              {
                list: [
                  "C is the number of columns.",
                  "R is the number of rows.",
                  "Clicking on this rows will list the embedded tables"
               ]
              }
            ],
            ["The ", {bold: "Review"}, " button invokes the review screen to examine and edit cell values"],
            "The link (-) icon invokes the table link grid editor to modify how linked tables as aranged",
          ],
        },
      ],
    },
    {
      helpId: documentOverviewLinkHelpId(),
      title: 'Link review button',
      body: [
        'This button is only present if the table is a linked group of tables, ',
        'and invokes the table linking editor, where the tables of the group are laid out. ',
        'There is a default layout of all the tables in a group being one on top of another ',
        'in PDF page order, if this is adequate there is no need to invoke this editor.'
      ],
    },
    {
      helpId: documentOverviewReviewHelpId(),
      title: 'Review button',
      body: [
        'This button opens the Review page for this table, this allows cell values to ',
        'be examined and modified if necessary.',
      ],
    },
    {
      helpId: documentOverviewExportHelpId(),
      title: 'Export button',
      body: [
        'Clicking it will create an Excel Workbook from the ',
        'accumulated data of every non-deleted table. ',
        'It does not wait for the tables to have been reviewed, so a document part way through ',
        'review can be exported as it stands.',
      ],
    },
  ];
}

// Keyed by screen id. A screen whose features have no tips yet carries its entry
// card only, so its `tips` is empty rather than absent.
//
// The `linkTables` name is unsettled: it follows what users are recorded as
// calling the screen and does not describe what the screen does. Its summary is
// settled.
export function helpScreens() {
  return {
    [documentListScreenId()]: {
      version: 1,
      name: 'Your documents',
      summary: [
        'Every loss run you have uploaded is listed here with the stage it has reached. ',
        'Click on a row to work on the contained file.',
      ],
      tips: [
        {
          helpId: dropBoxHelpId(),
          title: 'Add a loss run',
          body: [
            'Drop a PDF here, or click anywhere in the panel to choose one from you file system. ',
            'PDFs only, up to 50MB. Upload and data extraction begins immediately but in the background ',
            'so you need not stay on this page.'
          ],
        },
        {
          helpId: documentListCountsHelpId(),
          title: 'How many, and how far along',
          body: [
            'A running count of your documents by stage. ',
            { bold: 'All' },
            ' is the total, and it includes any that failed — errors have no count of their own.',
          ],
        },
        {
          helpId: documentListTableHelpId(),
          title: 'Your documents',
          body: [
            'Name, when it was uploaded, ',
            'its size, the stage it has reached and how many pages it has. ',
            { bold: 'Click a row to open it.' },
            ' A long name is shortened; hover it to see the whole thing.',
          ],
        },
        {
          helpId: documentListStatusHelpId(),
          title: 'What the stage means',
          body: [
            {list:[
            [{ bold: 'Processing' },
              ' means the document is still being taken apart, and the small ',
              'bar shows roughly how far that has got. '],
            [{ bold: 'Ready' },
            ' means it is waiting for you; '],
            [{ bold: 'In Progress' },
            ' means you have started on it; '],
            [{ bold: 'Complete' },
            ' means you have finished with it. ',
              'A document that is still processing or that failed is greyed ',
              'and cannot be opened yet — hover over a failed one to see what went wrong.'],
            ]}
          ],
        },
      ],
    },
    [boundaryPassScreenId()]: {
      version: 6,
      name: 'Table Borders',
      summary: [
        "This pass is about where the tables are on the page and how they inter-relate. ",
        { list:[
          "Correct the borders of any table by dragging.",
          "Link tables together to form larger tables.",
          ["Validate Table grids from the ",
            {bold: "Validate Tables"},
            " button.",
          ]
        ]}
      ],
      tips: [
        {
          helpId: boundaryDeleteTableHelpId(),
          title: 'Delete the current table',
          body: [
            'Clicking this button will delete the currently selected table, ',
            'and its grid will be removed from the screen. It can be reinstated from the ',
            { bold: 'Document Overview' },
            ' column.',
          ],
        },
        {
          helpId: boundaryCreateTableHelpId(),
          title: 'Create a new table',
          body: [
            'Clicking this button will allow a rectangle to be drawn ',
            'on the screen which will be the border of a new table.',
          ],
        },
        ...editorToolbarTips(),
        {
          helpId: pagesColumnHelpId(),
          title: 'The Pages column',
          body: [
            'This is a list of thumbnails of the pages of the PDF. ',
            'All PDF pages are shown, with known tables highlighted ',
            'with a blue border and title. Clicking on a page will show ',
            'that page in the centre of the screen. ',
            'If a table has a red border it has been selected as part of a linked table group.',
          ],
        },
        {
          helpId: tableLinkLabelHelpId(),
          title: 'Selected/Link button',
          body: [
            'If labelled ',
            { list: [
            [{ bold: 'Selected' },
            ' the table to which it is attached is a single table. If labelled '],
            [{ bold: 'Linked' },
            ' then this table is the first in a group of linked tables that together ',
              'form a larger table. If labelled '],
            [{ bold: 'Linked to' },
            ' and a table name, this table is part of a group of tables, ',
              'the first being the named table. When this is labelled '],
            [{ bold: 'Selected' },
            ' or ',
            { bold: 'Linked' },
            ' it is clickable, and clicking changes it to be red and labelled ',
            { bold: 'End Linking' }],
            [{ bold: 'End Linking' },
            '. This mode is for gethering together a group of tables into a tables group.',
              ' The table group modification is achieved by clicking on other tables within the ',
              { bold: 'Pages list'},
              '. If they are selected shown by a red border, then clicking will remove them, ',
              'Otherwise clicking will add them. Once editing is finished, click on the ',
            { bold: 'End Linking' },
            ' button.'],
            ]}
          ],
        },
        {
          helpId: tableNameLabelHelpId(),
          title: 'Title label',
          body: [
            "This displays the table's name (defaulting to \"Page: X, Table: Y\") and ",
            "the currently understood size of the table in columns and rows.",
          ],
        },
        {
          helpId: toolbarAllFilesHelpId(),
          title: 'All files',
          body: ['This button returns to the PDF file list page.'],
        },
        ...toolbarValidateTips(),
        {
          helpId: validateTablesHelpId(),
          title: validateTablesTitle(),
          body: validateTablesBody(),
        },
        ...layersPageStepTips(),
        ...documentOverviewTips(),
      ],
    },
    [contentsPassScreenId()]: {
      version: 11,
      name: 'Table contents',
      summary: [
        'This pass is about the inside of one table — its rows, ',
        'its columns and its special areas. ',
        'Validate Borders saves and goes back to the boundaries.',
      ],
      tips: [
        ...toolbarValidateTips(),
        {
          helpId: editorPageTableHelpId(),
          title: 'Table',
          body: ['This is a table: ',
            'The boundary is fixed, to change the boundary click on ',
            {bold: 'Validate Boundary'},
            ' The grid lines can be moved by dragging and can be deleted or new ones added ',
            'using the edit mode buttons to the left. ',
            'The contents shown is the original PDF image with grid lines and ',
            'special areas drawn on top'],
        },
        ...editorToolbarTips(),
        {
          helpId: layersPanelHelpId(),
          title: 'Layers',
          body: [
            'This allows grid lines and other features to be highlighted or dimmed to grey.',
          ],
        },
        {
          helpId: layersRowsHelpId(),
          title: 'Show Rows',
          body: [
            'When selected horizontal grid lines in the currently selected table ',
            'will be shown in orange, otherwise they will be in grey.',
          ],
          side: "left"
        },
        {
          helpId: layersColumnsHelpId(),
          title: 'Show Columns',
          body: [
            'When selected vertical grid lines in the currently selected table ',
            'will be shown in dark red, otherwise they will be in grey.',
          ],
          side: "left"
        },
        {
          helpId: layersSpecialHelpId(),
          title: 'Show special areas',
          body: [
            'When selected special areas which includes header area, hidden rows, ',
            'section title rows and the title are identified by being surrounded by ',
            'dotted lines, when off they are not shown.',
          ],
          side: "left"
        },
        {
          helpId: layersColoursHelpId(),
          title: 'Coloured areas',
          body: [
            'When selected known coloured areas are converted to grey scale for clarity, ',
            'when not selected the original colouring is shown.',
          ],
          side: "left"
        },
        {
          helpId: validateBordersHelpId(),
          title: validateBordersTitle(),
          body: validateBordersBody(),
        },
        ...layersPageStepTips(),
        {
          helpId: gridToolRailHelpId(),
          title: 'Edit mode buttons',
          body: [
            'This allows the edit mode to be set by clicking on the buttons. ',
            'Only one is available at a time, and clicking the selected one de-selects it.',
          ],
        },
        {
          helpId: gridToolRowsHelpId(),
          title: 'Edit Rows button',
          body: [
            'Clicking this sets row edit mode, clicking again clears it.',
            'When in row edit mode:',
            {
              list: [
                ['Clicking within a table boundary where there is no horizontal ',
                 'grid line creates one.'],
                'Clicking on a horizontal grid line deletes it.',
                'Horizontal and vertical grid lines can be dragged.',
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: gridToolColumnsHelpId(),
          title: 'Edit Columns button',
          body: [
            'Clicking this sets column edit mode, clicking again clears it.',
            'When in column edit mode:',
            {
              list: [
                'Clicking within a table boundary where there is no vertical grid line creates one.',
                'Clicking on a vertical grid line deletes it.',
                'Horizontal and vertical grid lines can be dragged.',
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: gridToolSpecialHelpId(),
          title: 'Edit Special areas button',
          body: [
            'Clicking this sets special edit mode, clicking again clears it.',
            'When in special edit mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'A separate list of special edit mode buttons is displayed.',
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolHeaderHelpId(),
          title: 'Header button',
          body: [
            'Clicking this sets header edit mode, clicking again clears it.',
            'When in header edit mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'Any specified header is highlighted with a dotted line.',
                'Clicking on a row makes that row and all above it be identified as headers.',
                [
                  'A ',
                  { bold: 'Delete Header' },
                  ' button appears in the Layers column which can be used to remove headers.',
                ],
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolTitleHelpId(),
          title: 'Title button',
          body: [
            'Clicking this sets title selection mode, clicking again clears it.',
            'When in title selection mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'Any specified title is highlighted with a green dotted line.',
                'An existing title can be modified by dragging the edges of the ',
                'box surrounding the text.',
                'A new title can be created by dragging at any point on the PDF ',
                'page in the centre panel, ',
                'but only one title exists at a time so selecting a new one deletes the old one.',
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolSectionHelpId(),
          title: 'Section button',
          body: [
            'Clicking this sets Section mode, clicking again clears it.',
            'When in Section mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'You can select a section title on a row, drag with the mouse ',
                'to select an area around the section title.',
              ],
            },
            'When a section title has been selected then the row it is on will ',
            'not be included in the output; instead the output table will be ',
            'split at this point and the rows below will become a separate ',
            'spreadsheet within the output workbook. A table can have many sections.',
          ],
          side: "right"
        },
        {
          helpId: specialToolColouredRowsHelpId(),
          title: 'Rows colouring button',
          body: [
            'Clicking this sets Row colouring mode, clicking again clears it.',
            'When in Row colouring mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                [
                  'A row can be selected by clicking, then:',
                  {
                    list: [
                      'In the Layers panel foreground and background colours are ',
                      'guessed at, and can be modified by clicking on them and then ',
                      'picking colours within the middle panel.',
                    ],
                  },
                ],
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolColouredColumnsHelpId(),
          title: 'Columns colouring button',
          body: [
            'Clicking this sets Column colouring mode, clicking again clears it.',
            'When in Column colouring mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                [
                  'A column can be selected by clicking, then:',
                  {
                    list: [
                      'In the Layers panel foreground and background colours are guessed at, ',
                      'and can be modified by clicking on them and then picking colours within ',
                      'the middle panel.',
                    ],
                  },
                ],
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolColouredCellHelpId(),
          title: 'Cell colouring button',
          body: [
            'Clicking this sets Cell colouring mode, clicking again clears it.',
            'When in Cell colouring mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                [
                  'A cell can be selected by clicking, then:',
                  {
                    list: [
                      'In the Layers panel foreground and background colours are guessed at, ',
                      'and can be modified by clicking on them and then picking colours ',
                      'within the middle panel.',
                    ],
                  },
                ],
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolColouredAreaHelpId(),
          title: 'Area colouring button',
          body: [
            'Clicking this sets Area colouring mode, clicking again clears it.',
            'When in Area colouring mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                [
                  'An area can be drawn with the mouse, then:',
                  {
                    list: [
                      'In the Layers panel foreground and background colours are guessed at, ',
                      'and can be modified by clicking on them and then picking colours ',
                      'within the middle panel.',
                    ],
                  },
                ],
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolColouredTableHelpId(),
          title: 'Tables colouring button',
          body: [
            'Clicking this sets Tables colouring mode, clicking again clears it.',
            'When in Tables colouring mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'In the Layers panel foreground and background colours are guessed, ',
                'and can be modified by clicking on them and then picking colours ',
                'within the middle panel.',
              ],
            },
          ],
          side: "right"
        },
        {
          helpId: specialToolHideRowHelpId(),
          title: 'Hide Row button',
          body: [
            'Clicking this sets Row hiding mode, clicking again clears it.',
            'When in Row hiding mode:',
            {
              list: [
                'Horizontal and vertical grid line dragging is disabled.',
                'You can click on a row and that row will not appear in the excel output, ',
                'clicking again re-enables it.',
                'Hidden rows are highlighted with a green boundary.',
              ],
            },
          ],
          side: "right"
        },
        ...documentOverviewTips(),
      ],
    },
    [linkTablesScreenId()]: {
      version: 4,
      name: 'Grid Editor',
      summary: [
        'For grouped tables examine if they can form a single table and arrange the ',
        'ordering. On first entry an attempt will be made to auto generate the group ',
        'ordering:',
        {
          list: [
            [
              'For a table to be placed below another table:',
              {
                list: [
                  'It must have the same number of columns.',
                  'It must either be further down the same page as the table above or on a page further down the PDF.',
                  'For it to be placed automatically the header text must match.',
                ],
              },
            ],
            [
              'For a table to be to the right of another table:',
              {
                list: [
                  'There must be no gaps above it.',
                  'It must have the same number of rows as the one to its left.',
                  'It must have the same number of header rows as the one to its left.',
                ],
              },
            ],
          ],
        },
      ],
      tips: [
        {
          helpId: linkAvailableTablesHelpId(),
          title: 'Available tables',
          body: [
            'This is tables that have not yet been placed, tables can be dragged from ',
            'here into a particular column of the ',
            { bold: 'Linked Tables' },
            ' list, but will only be accepted if they meet the joining rules. Accepted ',
            'or not a message will be displayed indicating why.',
          ],
        },
        {
          helpId: linkLinkedTablesHelpId(),
          title: 'Linked tables',
          body: [
            'These are tables that have been placed, they can be dragged from here to ',
            'the ',
            { bold: 'Available tables' },
            ' list.',
          ],
        },
        {
          helpId: linkUnlinkHelpId(),
          title: 'Unlinked tables',
          body: [
            'Move all tables to the ',
            { bold: 'Available tables' },
            ' list.',
          ],
        },
        {
          helpId: linkCancelHelpId(),
          title: 'Cancel button',
          body: ['Return to the validate screen without saving.'],
        },
        {
          helpId: linkSaveHelpId(),
          title: 'Save button',
          body: ['Exit this screen saving the current state.'],
        },
        ...toolbarValidateTips(),
      ],
    },
    [reviewTableScreenId()]: {
      version: 4,
      name: 'Extraction review',
      summary: emphasiseLowQualityCells()?[
        'This is the data that will be written out to the workbook. Every cell is editable — ',
        'click one to edit it.',
        'The coloured cells are the ones we think are most likely ',
        'to be wrong, but any cell can be wrong, so please look for problems in all of them.'
      ]:[
        'This is the data that will be written out to the workbook. Every cell is editable — ',
        'click one to edit it.',
      ],
      tips: [
        {
          helpId: reviewFlaggedCountHelpId(),
          title: 'Low quality entry count',
          body: [
            'This is a count of the number of cells that we detect as low quality, ',
            'they will almost always be invalid and you cannot produce an output excel ',
            'file unless all have been edited. ',
            { bold: 'DO NOT' },
            ' only check these cells it is important that all cells are reviewed.',
          ],
        },
        {
          helpId: reviewPoorCellsHelpId(),
          title: 'Low confidence cells list',
          body: [
            'This lists all cells that are marked as low quality in spreadsheet ',
            'numbering form. It can be used to select a particular cell to examine, ',
            'the > and < arrows allow stepping through the list.',
          ],
        },
        {
          helpId: reviewTitleHelpId(),
          title: 'Title',
          body: [
            'When provided this will be the spreadsheet name which then becomes the ',
            'value in the tab for this table, this can be edited.',
          ],
        },
        {
          helpId: reviewSectionTitleHelpId(),
          title: 'Section Title',
          body: [
            'This is not always present but when it is it is a title of a section, ',
            'it will be the spreadsheet name which then becomes the value in the tab ',
            'for this table, this can be edited. ',
            'If both this and a title are provided then the tab name will be ',
            'this value followed by a title.',
          ],
        },
        {
          helpId: reviewGridHelpId(),
          title: 'Data entry grid',
          body: emphasiseLowQualityCells()?[
            'This shows the read cells as would be written to the output file, all ',
            'cells are editable by clicking on them, particularly low quality cells ',
            'are emphasised by having a pale brown background and a brown bar to the ',
            'left. ',
            { bold: 'NOTE THAT' },
            ' not emphasising a cell does not guarantee the data is correct, all cells ',
            'should be viewed and updated if they are wrong.',
          ]:[
            'This shows the read cells as would be written to the output file, all ',
            'cells are editable by clicking on them',
          ],
        },
        {
          helpId: cellEditImageHelpId(),
          title: 'Raw Image',
          body: [
            'This is the image of this cell in the original document so you can see ',
            'what it originally said.',
          ],
        },
        {
          helpId: cellEditCancelHelpId(),
          title: 'Close',
          body: ['Close the cell editor without saving the changes made.'],
        },
        {
          helpId: cellEditConfirmHelpId(),
          title: 'Save',
          body: [
            'Any text just entered is saved, confidence in that cell is set to 100% ',
            'and the cell editor is closed.',
          ],
        },
        {
          helpId: cellEditNextHelpId(),
          title: 'Save and Next',
          body: [
            'This saves any edits, sets confidence to 100% and moves the editor to the ',
            'next low quality cell if there is one.',
          ],
        },
        {
          helpId: cellEditConfidenceHelpId(),
          title: 'Confidence',
          body: [
            'This is the confidence rating given to this cell, 100% is full confidence ',
            'less than 80% is considered low confidence.',
          ],
        },
        {
          helpId: reviewTabsHelpId(),
          title: 'Sub table selection tabs',
          body: [
            'When the table has multiple sub tables defined by section titles this ',
            'list shows each section and allows one to be selected for editing.',
          ],
        },
        {
          helpId: reviewSaveHelpId(),
          title: 'Save button',
          body: [
            'The save button saves the current state and returns to the ',
            { bold: 'Validate borders' },
            ' screen.',
          ],
        },
        ...toolbarValidateTips(),
      ],
    },
  };
}

// Chip at the top of the tip card.
export function helpChipLabel() {
  return 'HELP';
}

// Button that closes the overlay.
export function helpExitLabel() {
  return 'Exit Help';
}

// Button that puts the card away without leaving help, for when the card is
// covering the very thing the reader wants to look at.
export function helpHideLabel() {
  return 'Hide';
}

// Flag on the toolbar button when a screen's tips have changed since the user
// last saw them.
export function helpNewBadgeLabel() {
  return 'New descriptions';
}
