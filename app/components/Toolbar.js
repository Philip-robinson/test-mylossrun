'use client';

// The application's header: the two logos, the tabs, the data slot and the ? that opens
// help.
//
// The tabs are the editor's, so they appear only in the editor view: back to the file
// list, and one for each of the editor's two passes. The pass you are on is the current
// tab and the other is the way to the other pass, which is the same switch the Layers
// panel's own Validate button makes — it is that panel's handler the tab calls, reached
// through the editor-pass context, because ending a pass saves the document and settles
// what the pass owes.

import HelpButton from 'components/help/HelpButton';
import ToolbarTab from 'components/ToolbarTab';
import { useEditorPass } from 'components/EditorPassProvider';
import {
  toolbarAllFilesHelpId,
  toolbarValidateBordersHelpId,
  toolbarValidateTablesHelpId,
} from 'config';

export default function Toolbar({ activeView = 'loader', onAllFiles }) {
  const editorPass = useEditorPass();
  const pass = editorPass ? editorPass.pass : null;
  const actions = editorPass ? editorPass.actions : null;

  return (
    <div className={'toolbar'}>
      <img src={'/cactuslogo.png'} alt={'Cactus'} />
      <img src={'/MyLossRun.png'} alt={'MyLossRun'} />
      <div className={'toolbar-tabs'}>
        {activeView === 'editor' && (
          <>
            <ToolbarTab
              label={'← All Files'}
              testId={'toolbar-all-files'}
              helpId={toolbarAllFilesHelpId()}
              onClick={onAllFiles}
            />
            <ToolbarTab
              label={'Validate borders'}
              testId={'toolbar-validate-borders'}
              helpId={toolbarValidateBordersHelpId()}
              current={pass === 'border'}
              onClick={actions ? actions.validateBorders : undefined}
            />
            <ToolbarTab
              label={'Validate tables'}
              testId={'toolbar-validate-tables'}
              helpId={toolbarValidateTablesHelpId()}
              current={pass === 'grid'}
              onClick={actions ? actions.validateTables : undefined}
            />
          </>
        )}
      </div>
      <div className={'toolbar-data'} />
      <HelpButton />
    </div>
  );
}
