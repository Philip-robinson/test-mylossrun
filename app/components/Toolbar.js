'use client';

// The application's header: the two logos, the tabs, the data slot, the ? that opens
// help and the account button that signs out.
//
// The tabs are the editor's, so they appear only in the editor view: back to the file
// list, and one for each of the editor's two passes, then Review or Grid Editor only while
// that screen is up. The tab for the screen that is up is the current tab and the Validate
// tabs are the ways to the passes. Each tab calls the action the
// editor host registered through the editor-pass context, because leaving a screen saves
// the document and settles what it owes; ← All Files falls back to `onAllFiles` where no
// host is mounted.

import HelpButton from 'components/help/HelpButton';
import SignOutButton from 'components/SignOutButton';
import ToolbarTab from 'components/ToolbarTab';
import { useEditorPass } from 'components/EditorPassProvider';
import {
  boundaryPassScreenId,
  contentsPassScreenId,
  linkTablesScreenId,
  reviewTableScreenId,
  toolbarAllFilesHelpId,
  toolbarAllFilesLabel,
  toolbarGridEditorHelpId,
  toolbarGridEditorLabel,
  toolbarReviewHelpId,
  toolbarReviewLabel,
  toolbarValidateBordersHelpId,
  toolbarValidateBordersLabel,
  toolbarValidateTablesHelpId,
  toolbarValidateTablesLabel,
} from 'config';

export default function Toolbar({ activeView = 'loader', onAllFiles }) {
  const editorPass = useEditorPass();
  const editorScreen = editorPass ? editorPass.screen : null;
  const actions = editorPass ? editorPass.actions : null;

  return (
    <div className={'toolbar'}>
      <img src={'/cactuslogo.png'} alt={'Cactus'} />
      <img src={'/MyLossRun.png'} alt={'MyLossRun'} />
      <div className={'toolbar-tabs'}>
        {activeView === 'editor' && (
          <>
            <ToolbarTab
              label={toolbarAllFilesLabel()}
              testId={'toolbar-all-files'}
              helpId={toolbarAllFilesHelpId()}
              onClick={actions && actions.allFiles ? actions.allFiles : onAllFiles}
            />
            <ToolbarTab
              label={toolbarValidateBordersLabel()}
              testId={'toolbar-validate-borders'}
              helpId={toolbarValidateBordersHelpId()}
              current={editorScreen === boundaryPassScreenId()}
              onClick={actions ? actions.validateBorders : undefined}
            />
            <ToolbarTab
              label={toolbarValidateTablesLabel()}
              testId={'toolbar-validate-tables'}
              helpId={toolbarValidateTablesHelpId()}
              current={editorScreen === contentsPassScreenId()}
              onClick={actions ? actions.validateTables : undefined}
            />
            {editorScreen === reviewTableScreenId() && (
              <ToolbarTab
                label={toolbarReviewLabel()}
                testId={'toolbar-review'}
                helpId={toolbarReviewHelpId()}
                current
              />
            )}
            {editorScreen === linkTablesScreenId() && (
              <ToolbarTab
                label={toolbarGridEditorLabel()}
                testId={'toolbar-grid-editor'}
                helpId={toolbarGridEditorHelpId()}
                current
              />
            )}
          </>
        )}
      </div>
      <div className={'toolbar-data'} />
      <HelpButton />
      <SignOutButton />
    </div>
  );
}
