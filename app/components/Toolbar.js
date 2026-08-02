'use client';

import toast from 'react-hot-toast';

export default function Toolbar({ activeView = 'loader', onAllFiles }) {
  return (
    <div className={'toolbar'}>
      <img src={'/cactuslogo.png'} alt={'Cactus'} />
      <img src={'/MyLossRun.png'} alt={'MyLossRun'} />
      <div className={'toolbar-tabs'}>
        {activeView === 'editor' && (
          <>
            <button
              type={'button'}
              className={'toolbar-tab toolbar-tab-link'}
              onClick={onAllFiles}
            >
              {'← All Files'}
            </button>
            <button type={'button'} className={'toolbar-tab toolbar-tab-current'}>
              Validate
            </button>
            <button
              type={'button'}
              className={'toolbar-tab toolbar-tab-link'}
              onClick={() => toast('Export not yet supported')}
            >
              Export
            </button>
          </>
        )}
      </div>
      <div className={'toolbar-data'} />
    </div>
  );
}
