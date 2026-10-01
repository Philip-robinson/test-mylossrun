'use client';

// The account button at the far right of the toolbar, and the menu it opens.
//
// It needs no visibility condition: `AccessGate` renders the page only once it holds
// a validated access code, so a user who can see the toolbar is always signed in.

import { useState } from 'react';
import {
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';

import {
  accountButtonHelpId,
  appVersion,
  signOutLabel,
  toolbarIconButtonSizePx,
} from 'config';
import { navigateTo, signOut } from 'services/session';

export default function SignOutButton() {
  const [anchorEl, setAnchorEl] = useState(null);
  const version = appVersion();

  const handleSignOut = () => {
    setAnchorEl(null);
    signOut(window.localStorage, navigateTo);
  };

  return (
    <>
      <IconButton
        aria-label={'Account'}
        data-testid={'sign-out-button'}
        data-help-id={accountButtonHelpId()}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        // MUI's IconButton carries 8px of padding by default, which would draw this
        // visibly larger than the `?` beside it; p: 0 with an explicit box is what
        // makes the two one size.
        sx={{
          p: 0,
          width: `${toolbarIconButtonSizePx()}px`,
          height: `${toolbarIconButtonSizePx()}px`,
          color: 'var(--secondary-text)',
        }}
      >
        <AccountCircleOutlinedIcon
          sx={{ fontSize: `${toolbarIconButtonSizePx()}px` }}
        />
      </IconButton>
      <Menu
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem data-testid={'sign-out-menu-item'} onClick={handleSignOut}>
          <ListItemIcon>
            <LogoutOutlinedIcon fontSize={'small'} />
          </ListItemIcon>
          {signOutLabel()}
        </MenuItem>
        {version && [
          <Divider key={'version-divider'} />,
          <MenuItem
            key={'version'}
            data-testid={'version-menu-item'}
            disabled
            sx={{ opacity: '1 !important' }}
          >
            <Typography variant={'caption'} color={'text.secondary'}>
              {`Version ${version}`}
            </Typography>
          </MenuItem>,
        ]}
      </Menu>
    </>
  );
}
